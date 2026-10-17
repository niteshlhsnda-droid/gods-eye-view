/**
 * Live GNSS spoof-movement signals from OpenSky-style state vectors.
 *
 * Evidence (`research/100-videos.md`, Docs #10, GPSJam entry): alongside the
 * daily GPSJam cell bands, the dossier lists three "secondary movement
 * signals from OpenSky" — teleport (>500 m/s or >150 km step), stale
 * position (>30 s), spoof cluster (>=5 aircraft within 3 km) — and names
 * live spoof-cluster detection as the explicit second-phase follow-up to the
 * cell-band layer ("Follow-up idea: live spoof-cluster detection from
 * OpenSky state vectors (teleport/stale/cluster heuristics) as a
 * second-phase enhancement"). This module implements exactly those three
 * heuristics, with the dossier's thresholds verbatim.
 *
 * What this is NOT: the cell-band layer classifies per-aircraft NIC/NACp
 * reports into cells (`src/layers/gnss/records.js` on `feature/gnss`, not on
 * `main`) and Cycle 1's `coverageState` judges whether a cell has enough
 * reports to judge at all. Neither looks at MOVEMENT: an aircraft whose
 * reported position jumps 200 km between polls, or five aircraft suddenly
 * reporting (nearly) the same position, passes both. These three checks
 * close that gap, on successive fixes and on one snapshot.
 *
 * Honesty rules, same as the cell layer: each check reports an observed
 * movement fact (`teleport`, `stale-position`, `spoof-cluster`). Spoofing is
 * a SECOND, unvalidated interpretation (`suspected-gnss-spoofing`), never
 * the primary state — a teleport can be a decoder error, a stale position
 * a coverage gap, a cluster a busy holding pattern or a shared wrong
 * position from one faulty ground station. Callers must surface the fact
 * first and the interpretation as "suspected".
 *
 * Pure: no DOM, no Cesium, no imports. Thresholds are exported so a future
 * wiring change unifies them instead of duplicating them.
 */

/** Implied-speed teleport edge: metres per second (dossier: >500 m/s). */
export const SPOOF_TELEPORT_SPEED_MPS = 500;
/** Step teleport edge: metres between successive fixes (dossier: >150 km). */
export const SPOOF_TELEPORT_STEP_M = 150_000;
/** Stale-position edge: ms since the last position fix (dossier: >30 s). */
export const SPOOF_STALE_AGE_MS = 30_000;
/** Spoof-cluster edge: minimum aircraft in one cluster (dossier: >=5). */
export const SPOOF_CLUSTER_MIN_AIRCRAFT = 5;
/** Spoof-cluster edge: km from the cluster centroid (dossier: within 3 km). */
export const SPOOF_CLUSTER_RADIUS_KM = 3;

/** Observed movement fact: one aircraft's position jumped impossibly. */
export const SPOOF_SIGNAL_TELEPORT = 'teleport';
/** Observed movement fact: one aircraft's position stopped updating. */
export const SPOOF_SIGNAL_STALE = 'stale-position';
/** Observed movement fact: >=5 aircraft report (nearly) one position. */
export const SPOOF_SIGNAL_CLUSTER = 'spoof-cluster';
/** Secondary, unvalidated reading of any spoof signal. */
export const SPOOF_INTERPRETATION = 'suspected-gnss-spoofing';

/** IUGG mean Earth radius, metres (same as Cycle 1's geoMath module). */
const EARTH_MEAN_RADIUS_M = 6_371_008.8;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Validate a latitude/longitude pair.
 * @throws {RangeError} On non-finite or out-of-range coordinates.
 */
export function assertSpoofLatLon(lat, lon) {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new RangeError(`Invalid lat/lon: ${lat}, ${lon}`);
  }
}

/**
 * Great-circle distance between two points (haversine, spherical earth).
 * The longitude delta is normalised to [-180, 180], so a pair straddling
 * the date line measures the short way across it, not around the world.
 */
export function greatCircleDistanceM(lat1, lon1, lat2, lon2) {
  assertSpoofLatLon(lat1, lon1);
  assertSpoofLatLon(lat2, lon2);
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  let dl = toRad(lon2 - lon1);
  if (dl > Math.PI) dl -= 2 * Math.PI;
  if (dl < -Math.PI) dl += 2 * Math.PI;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_MEAN_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function assertFix(fix, name) {
  if (!fix || typeof fix !== 'object')
    throw new TypeError(`${name} must be an object with lat, lon, atMs`);
  assertSpoofLatLon(fix.lat, fix.lon);
  if (!Number.isFinite(fix.atMs))
    throw new TypeError(`${name}.atMs must be a finite epoch-ms number`);
}

/**
 * Teleport check between two successive fixes of ONE aircraft.
 *
 * Teleport when the step exceeds 150 km OR the implied speed exceeds
 * 500 m/s (dossier rule, strict `>` on both edges). A zero or negative
 * interval (duplicate / out-of-order fix) cannot yield a speed, so it is
 * reported as not judged rather than as evidence either way.
 *
 * @param {{lat: number, lon: number, atMs: number}} prev Earlier fix.
 * @param {{lat: number, lon: number, atMs: number}} next Later fix.
 * @returns {Readonly<{judged: boolean, teleport: boolean, signal: string|null, distanceM: number|null, dtMs: number, speedMps: number|null, interpretation: string|null, reason: string}>}
 */
export function teleportCheck(prev, next) {
  assertFix(prev, 'prev');
  assertFix(next, 'next');
  const dtMs = next.atMs - prev.atMs;
  if (dtMs <= 0)
    return Object.freeze({
      judged: false,
      teleport: false,
      signal: null,
      distanceM: null,
      dtMs,
      speedMps: null,
      interpretation: null,
      reason:
        dtMs === 0
          ? 'duplicate timestamp — no interval to judge a jump over'
          : 'out-of-order fixes — the later fix predates the earlier one',
    });
  const distanceM = greatCircleDistanceM(
    prev.lat,
    prev.lon,
    next.lat,
    next.lon,
  );
  const speedMps = distanceM / (dtMs / 1000);
  const teleport =
    distanceM > SPOOF_TELEPORT_STEP_M || speedMps > SPOOF_TELEPORT_SPEED_MPS;
  return Object.freeze({
    judged: true,
    teleport,
    signal: teleport ? SPOOF_SIGNAL_TELEPORT : null,
    distanceM,
    dtMs,
    speedMps,
    interpretation: teleport ? SPOOF_INTERPRETATION : null,
    reason: teleport
      ? `position jumped ${(distanceM / 1000).toFixed(1)} km in ${(dtMs / 1000).toFixed(1)} s (${speedMps.toFixed(0)} m/s)`
      : `position moved ${(distanceM / 1000).toFixed(1)} km in ${(dtMs / 1000).toFixed(1)} s (${speedMps.toFixed(0)} m/s) — within the movement bounds`,
  });
}

/**
 * Stale-position check for one aircraft's latest fix.
 *
 * Stale when the fix is older than 30 s at `nowMs` (dossier rule, strict
 * `>`). A fix dated in the future is not stale — it is clock skew, and it
 * is labelled as such rather than silently treated as fresh.
 *
 * @param {{atMs: number}} fix Latest fix (only its timestamp is read).
 * @param {number} nowMs Current epoch ms.
 * @returns {Readonly<{ageMs: number, stale: boolean, signal: string|null, interpretation: string|null, reason: string}>}
 */
export function staleCheck(fix, nowMs) {
  if (!fix || typeof fix !== 'object' || !Number.isFinite(fix.atMs))
    throw new TypeError('fix.atMs must be a finite epoch-ms number');
  if (!Number.isFinite(nowMs))
    throw new TypeError('nowMs must be a finite epoch-ms number');
  const ageMs = nowMs - fix.atMs;
  if (ageMs < 0)
    return Object.freeze({
      ageMs,
      stale: false,
      signal: null,
      interpretation: null,
      reason: 'fix is dated in the future — clock skew, not fresh evidence',
    });
  const stale = ageMs > SPOOF_STALE_AGE_MS;
  return Object.freeze({
    ageMs,
    stale,
    signal: stale ? SPOOF_SIGNAL_STALE : null,
    interpretation: stale ? SPOOF_INTERPRETATION : null,
    reason: stale
      ? `no position update for ${(ageMs / 1000).toFixed(1)} s`
      : `position updated ${(ageMs / 1000).toFixed(1)} s ago — within the freshness bound`,
  });
}

/**
 * Vector-mean centroid of points, antimeridian-safe: averaging longitudes
 * arithmetically would put a cluster at +179.9 / -179.9 on the Greenwich
 * meridian. Unit-vector averaging keeps it on the date line.
 */
function centroid(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const { lat, lon } of points) {
    const phi = toRad(lat);
    const lambda = toRad(lon);
    x += Math.cos(phi) * Math.cos(lambda);
    y += Math.cos(phi) * Math.sin(lambda);
    z += Math.sin(phi);
  }
  const norm = Math.hypot(x, y, z);
  return {
    lat: toDeg(Math.asin(z / norm)),
    lon: toDeg(Math.atan2(y, x)),
  };
}

/**
 * Spoof-cluster check over one snapshot of aircraft positions.
 *
 * A cluster is >=5 aircraft all within 3 km of their shared centroid
 * (dossier rule). Seed-and-refine per aircraft — candidates within the
 * radius of the seed, then re-kept within the radius of their centroid —
 * so a line of real aircraft spaced 2.5 km apart along an airway does NOT
 * chain into one false cluster: the centroid of a 12 km line is >3 km
 * from its ends. Sets that are strict subsets of another reported cluster
 * are suppressed, so one spoof event reports once.
 *
 * Malformed rows (missing / out-of-range coordinates) are skipped, like
 * the cell layer's normaliser; a repeated ICAO hex counts once (first row
 * wins). Complexity is O(n^2) haversine calls — callers pass a
 * viewport-bounded snapshot, not a global feed.
 *
 * @param {{hex?: string|null, lat: number, lon: number}[]} aircraft Snapshot rows.
 * @param {{minAircraft?: number, radiusKm?: number}} [options] Threshold overrides.
 * @returns {ReadonlyArray<Readonly<{members: ReadonlyArray<Readonly<{hex: string|null, lat: number, lon: number}>>, count: number, centroid: Readonly<{lat: number, lon: number}>, maxRadiusKm: number, signal: string, interpretation: string}>>}
 */
export function spoofClusterCheck(
  aircraft,
  {
    minAircraft = SPOOF_CLUSTER_MIN_AIRCRAFT,
    radiusKm = SPOOF_CLUSTER_RADIUS_KM,
  } = {},
) {
  if (!Array.isArray(aircraft))
    throw new TypeError('aircraft must be an array of {hex, lat, lon} rows');
  if (!Number.isFinite(minAircraft) || minAircraft < 1)
    throw new TypeError('minAircraft must be a finite number >= 1');
  if (!Number.isFinite(radiusKm) || radiusKm <= 0)
    throw new TypeError('radiusKm must be a finite number > 0');
  const radiusM = radiusKm * 1000;

  const points = [];
  const seenHex = new Set();
  for (const row of aircraft) {
    if (!row || typeof row !== 'object') continue;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
    if (row.lat < -90 || row.lat > 90 || row.lon < -180 || row.lon > 180)
      continue;
    const hex = typeof row.hex === 'string' && row.hex !== '' ? row.hex : null;
    if (hex !== null) {
      if (seenHex.has(hex)) continue;
      seenHex.add(hex);
    }
    points.push(Object.freeze({ hex, lat: row.lat, lon: row.lon }));
  }

  const found = [];
  const seenSets = new Set();
  for (const seed of points) {
    const nearSeed = points.filter(
      (point) =>
        greatCircleDistanceM(seed.lat, seed.lon, point.lat, point.lon) <=
        radiusM,
    );
    if (nearSeed.length < minAircraft) continue;
    const center = centroid(nearSeed);
    const members = nearSeed.filter(
      (point) =>
        greatCircleDistanceM(center.lat, center.lon, point.lat, point.lon) <=
        radiusM,
    );
    if (members.length < minAircraft) continue;
    const key = members
      .map((point) => `${point.hex ?? ''}|${point.lat}|${point.lon}`)
      .sort()
      .join(';');
    if (seenSets.has(key)) continue;
    seenSets.add(key);
    found.push({ members, center });
  }

  // Suppress strict subsets: one spoof event reports once.
  const clusters = found.filter(
    (candidate) =>
      !found.some(
        (other) =>
          other !== candidate &&
          other.members.length > candidate.members.length &&
          candidate.members.every((member) => other.members.includes(member)),
      ),
  );

  return Object.freeze(
    clusters.map(({ members, center }) => {
      const sorted = [...members].sort(
        (a, b) =>
          (a.hex ?? '').localeCompare(b.hex ?? '') ||
          a.lat - b.lat ||
          a.lon - b.lon,
      );
      const maxRadiusKm = Math.max(
        ...sorted.map(
          (point) =>
            greatCircleDistanceM(center.lat, center.lon, point.lat, point.lon) /
            1000,
        ),
      );
      return Object.freeze({
        members: Object.freeze(sorted),
        count: sorted.length,
        centroid: Object.freeze({ lat: center.lat, lon: center.lon }),
        maxRadiusKm: Math.round(maxRadiusKm * 1000) / 1000,
        signal: SPOOF_SIGNAL_CLUSTER,
        interpretation: SPOOF_INTERPRETATION,
      });
    }),
  );
}
