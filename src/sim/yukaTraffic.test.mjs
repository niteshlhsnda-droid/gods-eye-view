import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  latLonToSim,
  simToLatLon,
  velocityToHeadingDeg,
  droneSwarmConfig,
  makePatrolRoute,
  seededRandom,
  FLOCK_GAINS,
} from './yukaTraffic.js';

const ORIGIN = { lat: 25.5941, lon: 85.1376, altM: 50 }; // Patna

describe('sim frame conversions', () => {
  it('round-trips lat/lon through the sim frame', () => {
    const p = latLonToSim(ORIGIN, 25.6, 85.14, 200);
    const back = simToLatLon(ORIGIN, p.x, p.y, p.z);
    assert.ok(Math.abs(back.lat - 25.6) < 1e-6);
    assert.ok(Math.abs(back.lon - 85.14) < 1e-6);
    assert.ok(Math.abs(back.altM - 200) < 1e-9);
  });

  it('maps +x to east and -z to north', () => {
    const east = simToLatLon(ORIGIN, 1000, 0, 0);
    assert.ok(east.lon > ORIGIN.lon);
    assert.ok(Math.abs(east.lat - ORIGIN.lat) < 1e-9);
    const north = simToLatLon(ORIGIN, 0, 0, -1000);
    assert.ok(north.lat > ORIGIN.lat);
  });

  it('converts velocity to compass heading', () => {
    assert.equal(velocityToHeadingDeg(0, -10), 0); // north
    assert.equal(velocityToHeadingDeg(10, 0), 90); // east
    assert.equal(velocityToHeadingDeg(0, 10), 180); // south
    assert.equal(velocityToHeadingDeg(-10, 0), 270); // west
  });
});

describe('swarm + patrol configs', () => {
  it('spawns deterministic swarms from a seed', () => {
    const a = droneSwarmConfig({ count: 8, origin: ORIGIN, seed: 42 });
    const b = droneSwarmConfig({ count: 8, origin: ORIGIN, seed: 42 });
    const c = droneSwarmConfig({ count: 8, origin: ORIGIN, seed: 43 });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.equal(a.length, 8);
    for (const s of a) {
      const r = Math.hypot(s.x, s.z);
      assert.ok(r <= 500, `spawn radius ${r} within 500m`);
    }
  });

  it('seededRandom is a stable uniform generator', () => {
    const r1 = seededRandom(7);
    const r2 = seededRandom(7);
    for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
  });

  it('builds looped patrol routes with waypoint indices', () => {
    const route = makePatrolRoute('ghat', [
      { lat: 25.6, lon: 85.13 },
      { lat: 25.61, lon: 85.14, altM: 200 },
    ]);
    assert.equal(route.loop, true);
    assert.equal(route.waypoints.length, 2);
    assert.equal(route.waypoints[0].index, 0);
    assert.equal(route.waypoints[1].altM, 200);
    assert.throws(() => makePatrolRoute('x', [{ lat: 0, lon: 0 }]), TypeError);
  });

  it('exposes sane flocking gains', () => {
    for (const k of ['separation', 'alignment', 'cohesion', 'wander']) {
      assert.ok(FLOCK_GAINS[k] > 0 && FLOCK_GAINS[k] <= 2, k);
    }
  });
});
