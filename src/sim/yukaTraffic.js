/**
 * Yuka traffic simulation — living traffic for the traffic layer.
 *
 * Autonomous drone swarms (flocking: separation + alignment + cohesion +
 * wander) and patrol routes (follow-path steering) simulated with the
 * MIT-licensed `yuka` game-AI library. yuka is imported lazily inside the
 * async factory so this module loads (and the app boots) even before the
 * dependency is installed — see DEPS.md.
 *
 * Sim frame: x = east, y = up, z = south (right-handed, Y-up like yuka),
 * origin-anchored at a geographic point. Pure coordinate helpers are
 * exported for unit tests; the yuka wiring lives in createYukaTrafficSim.
 */

export const EARTH_RADIUS_M = 6_371_000;

export const FLOCK_GAINS = Object.freeze({
  separation: 1.4,
  alignment: 0.8,
  cohesion: 0.6,
  wander: 0.5,
  neighborRadiusM: 60,
});

export const PATROL_DEFAULTS = Object.freeze({
  speedMps: 14,
  altitudeM: 120,
});

/** Deterministic LCG for reproducible swarm spawns. */
export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Origin-anchored { lat, lon, altM } -> sim meters { x, y, z }. */
export function latLonToSim(origin, lat, lon, altM = 0) {
  const latRad = (origin.lat * Math.PI) / 180;
  const east =
    (((lon - origin.lon) * Math.PI) / 180) * EARTH_RADIUS_M * Math.cos(latRad);
  const north = (((lat - origin.lat) * Math.PI) / 180) * EARTH_RADIUS_M;
  return { x: east, y: altM - (origin.altM ?? 0), z: -north };
}

/** Sim meters { x, y, z } -> { lat, lon, altM } (inverse of latLonToSim). */
export function simToLatLon(origin, x, y, z) {
  const latRad = (origin.lat * Math.PI) / 180;
  const north = -z;
  const lat = origin.lat + ((north / EARTH_RADIUS_M) * 180) / Math.PI;
  const lon =
    origin.lon + ((x / (EARTH_RADIUS_M * Math.cos(latRad))) * 180) / Math.PI;
  return { lat, lon, altM: (origin.altM ?? 0) + y };
}

/** Velocity (x=east, z=south) -> compass heading degrees. */
export function velocityToHeadingDeg(vx, vz) {
  const north = -vz;
  const heading = (Math.atan2(vx, north) * 180) / Math.PI;
  return ((heading % 360) + 360) % 360;
}

/**
 * Build a deterministic drone-swarm spawn config.
 * @returns {Array<{id, x, y, z, vx, vy, vz}>} sim-frame spawn states.
 */
export function droneSwarmConfig({
  count,
  origin,
  radiusM = 500,
  altitudeM = 150,
  seed = 1337,
} = {}) {
  const rand = seededRandom(seed);
  const spawns = [];
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * radiusM;
    spawns.push({
      id: `drone-${i}`,
      x: Math.cos(angle) * radius,
      y: altitudeM + (rand() - 0.5) * 40,
      z: Math.sin(angle) * radius,
      vx: (rand() - 0.5) * 10,
      vy: 0,
      vz: (rand() - 0.5) * 10,
    });
  }
  return spawns;
}

/** Normalize patrol waypoints into a looped route config. */
export function makePatrolRoute(name, waypoints, { loop = true } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2)
    throw new TypeError('A patrol route needs at least 2 waypoints');
  return {
    name,
    loop,
    waypoints: waypoints.map((w, i) => ({
      index: i,
      lat: Number(w.lat),
      lon: Number(w.lon),
      altM: Number(w.altM ?? PATROL_DEFAULTS.altitudeM),
    })),
  };
}

/**
 * Create the live simulation. Resolves yuka lazily; rejects with a clear
 * error when the dependency is not installed yet.
 *
 * @param {object} options
 * @param {{lat, lon, altM?}} options.origin - geographic anchor of the sim frame.
 * @returns {Promise<{ addDroneSwarm, addPatrol, update, entityCount, dispose }>}
 */
export async function createYukaTrafficSim({ origin } = {}) {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon))
    throw new TypeError('A geographic origin { lat, lon } is required');
  let YUKA;
  try {
    YUKA = await import('yuka');
  } catch {
    throw new Error(
      'yuka is not installed — add it to package.json (see DEPS.md) and retry',
    );
  }

  const manager = new YUKA.EntityManager();
  const world = { time: 0 };
  const vehicles = new Map(); // id -> { vehicle, kind }

  function toSim(lat, lon, altM) {
    return latLonToSim(origin, lat, lon, altM);
  }

  function track(id, kind, vehicle) {
    manager.add(vehicle);
    vehicles.set(id, { vehicle, kind });
  }

  const sim = {
    get entityCount() {
      return vehicles.size;
    },

    /** Spawn a flocking drone swarm around the origin. */
    addDroneSwarm(config = {}) {
      const spawns = droneSwarmConfig({ origin, ...config });
      for (const spawn of spawns) {
        const vehicle = new YUKA.Vehicle();
        vehicle.position.set(spawn.x, spawn.y, spawn.z);
        vehicle.velocity.set(spawn.vx, spawn.vy, spawn.vz);
        vehicle.maxSpeed = 18;
        vehicle.updateNeighborhood = true;
        vehicle.neighborhoodRadius = FLOCK_GAINS.neighborRadiusM;

        const separation = new YUKA.SeparationBehavior();
        separation.weight = FLOCK_GAINS.separation;
        const alignment = new YUKA.AlignmentBehavior();
        alignment.weight = FLOCK_GAINS.alignment;
        const cohesion = new YUKA.CohesionBehavior();
        cohesion.weight = FLOCK_GAINS.cohesion;
        const wander = new YUKA.WanderBehavior();
        wander.weight = FLOCK_GAINS.wander;
        vehicle.steering.add(separation, alignment, cohesion, wander);
        track(spawn.id, 'drone', vehicle);
      }
      return spawns.map((s) => s.id);
    },

    /** Add a waypoint patrol (e.g. a police / survey drone circuit). */
    addPatrol(name, waypoints, { speedMps, altitudeM } = {}) {
      const route = makePatrolRoute(name, waypoints);
      const path = new YUKA.Path();
      for (const wp of route.waypoints) {
        const p = toSim(
          wp.lat,
          wp.lon,
          wp.altM ?? altitudeM ?? PATROL_DEFAULTS.altitudeM,
        );
        path.add(new YUKA.Vector3(p.x, p.y, p.z));
      }
      path.loop = route.loop;
      const vehicle = new YUKA.Vehicle();
      const first = route.waypoints[0];
      const start = toSim(first.lat, first.lon, first.altM);
      vehicle.position.set(start.x, start.y, start.z);
      vehicle.maxSpeed = speedMps ?? PATROL_DEFAULTS.speedMps;
      const follow = new YUKA.FollowPathBehavior(path, 8);
      vehicle.steering.add(follow);
      const id = `patrol-${name}`;
      track(id, 'patrol', vehicle);
      return id;
    },

    /**
     * Step the simulation and return live entity states as geographic
     * records (feed these into the deck.gl overlay or the traffic layer).
     */
    update(deltaSeconds) {
      const dt = Math.max(0, Math.min(0.25, Number(deltaSeconds) || 0));
      world.time += dt;
      manager.update(dt);
      const records = [];
      for (const [id, { vehicle, kind }] of vehicles) {
        const { lat, lon, altM } = simToLatLon(
          origin,
          vehicle.position.x,
          vehicle.position.y,
          vehicle.position.z,
        );
        records.push({
          id,
          kind,
          lat,
          lon,
          altM,
          headingDeg: velocityToHeadingDeg(
            vehicle.velocity.x,
            vehicle.velocity.z,
          ),
          speedMps: vehicle.getSpeed(),
        });
      }
      return records;
    },

    dispose() {
      manager.clear();
      vehicles.clear();
    },
  };
  return sim;
}
