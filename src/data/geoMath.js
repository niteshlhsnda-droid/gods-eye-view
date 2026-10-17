/**
 * Shared spherical-earth geodesic math.
 *
 * Fifteen-plus call sites currently inline their own haversine with their
 * own Earth radius (evidence, `origin/main` @ `16831c4`):
 * `src/annotations/annotationEngine.js:1561`, `src/annotations/drawMode.js:50`,
 * `src/cockpitCloudEffects.js:146`, `src/data/adminBoundaries.js:79-102`,
 * `src/data/analystEngine.js:101`, `src/data/cctvFootprint.js:19`,
 * `src/data/naturalEarthRegions.js:22-45`, `src/data/regionalModel.js:153`,
 * `src/data/routePlausible.js:14`, `src/data/trafficBounds.js:17-68`,
 * `src/data/transitFeeds.js:333`, `src/layers/bikeshare/model.js:39`,
 * `src/layers/cctv/model.js:306` — and two different radii are in use:
 * 6_371_000 m (most sites, incl. `cctvFootprint.js`) vs 6_371_008.8 m
 * (IUGG mean radius: `src/layers/alpr/policy.js:74`,
 * `src/layers/installations/policy.js:19`, `src/layers/localAdsb/motion.js:39`).
 * The 8.8 m radius difference is ~0.00014% (~0.5 m on London–Paris), so
 * this module standardises on the IUGG mean radius and documents it,
 * rather than silently re-baselining every call site.
 *
 * Pure: no DOM, no Cesium, no imports. Spherical-earth formulas, good to
 * ~0.5% (the same accuracy class as every existing inline copy).
 *
 * Adoption follow-up (NOT done here): migrating a call site means adding
 * this file to every boundary group that owns the importing module
 * (`scripts/package-boundaries.json` rejects unowned transitive imports),
 * so migration is a separate, per-group change — no call site is
 * re-pointed in this commit.
 *
 * @module data/geoMath
 */

/** IUGG mean Earth radius, metres. */
export const EARTH_MEAN_RADIUS_M = 6_371_008.8;
/** IUGG mean Earth radius, kilometres. */
export const EARTH_MEAN_RADIUS_KM = EARTH_MEAN_RADIUS_M / 1000;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Validate a latitude/longitude pair.
 * @param {number} lat
 * @param {number} lon
 * @throws {RangeError} On non-finite or out-of-range coordinates.
 */
export function assertLatLon(lat, lon) {
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
 * Great-circle distance between two points (haversine).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in metres.
 */
export function haversineDistanceM(lat1, lon1, lat2, lon2) {
  assertLatLon(lat1, lon1);
  assertLatLon(lat2, lon2);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial compass bearing from the first point to the second.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number|null} Bearing in degrees clockwise from north, [0, 360),
 *   or null when the bearing is undefined (coincident or antipodal points).
 */
export function initialBearingDeg(lat1, lon1, lat2, lon2) {
  assertLatLon(lat1, lon1);
  assertLatLon(lat2, lon2);
  if (lat1 === lat2 && lon1 === lon2) return null;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  if (Math.hypot(x, y) < 1e-12) return null; // Antipodal: every bearing is valid.
  // (Epsilon, not exact zero: sin(pi) is ~1.2e-16 in floating point, so an
  // exact x === 0 && y === 0 check misses the antipodal case.)
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Point reached by travelling a distance from a start point on a bearing.
 * @param {number} lat
 * @param {number} lon
 * @param {number} bearingDeg - Compass bearing, degrees clockwise from north.
 * @param {number} distanceM - Distance in metres (>= 0).
 * @returns {{lat:number, lon:number}} Destination, longitude wrapped to [-180, 180].
 */
export function destinationPoint(lat, lon, bearingDeg, distanceM) {
  assertLatLon(lat, lon);
  if (!Number.isFinite(bearingDeg) || !Number.isFinite(distanceM)) {
    throw new RangeError(
      `Invalid bearing/distance: ${bearingDeg}, ${distanceM}`,
    );
  }
  if (distanceM < 0) {
    throw new RangeError(`Distance must be >= 0: ${distanceM}`);
  }
  const ad = distanceM / EARTH_MEAN_RADIUS_M;
  const b = toRad(bearingDeg);
  const la = toRad(lat);
  const la2 = Math.asin(
    Math.sin(la) * Math.cos(ad) + Math.cos(la) * Math.sin(ad) * Math.cos(b),
  );
  const lo2 =
    toRad(lon) +
    Math.atan2(
      Math.sin(b) * Math.sin(ad) * Math.cos(la),
      Math.cos(ad) - Math.sin(la) * Math.sin(la2),
    );
  // Wrap longitude to [-180, 180].
  const lon2 = ((toDeg(lo2) + 540) % 360) - 180;
  return { lat: toDeg(la2), lon: lon2 };
}

/**
 * Midpoint of the great-circle arc between two points.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {{lat:number, lon:number}} Midpoint, longitude wrapped to [-180, 180].
 */
export function midpoint(lat1, lon1, lat2, lon2) {
  assertLatLon(lat1, lon1);
  assertLatLon(lat2, lon2);
  const dLon = toRad(lon2 - lon1);
  const bx = Math.cos(toRad(lat2)) * Math.cos(dLon);
  const by = Math.cos(toRad(lat2)) * Math.sin(dLon);
  const la1 = toRad(lat1);
  const la2 = toRad(lat2);
  const midLat = Math.atan2(
    Math.sin(la1) + Math.sin(la2),
    Math.sqrt((Math.cos(la1) + bx) ** 2 + by ** 2),
  );
  const midLon = toRad(lon1) + Math.atan2(by, Math.cos(la1) + bx);
  return {
    lat: toDeg(midLat),
    lon: ((toDeg(midLon) + 540) % 360) - 180,
  };
}
