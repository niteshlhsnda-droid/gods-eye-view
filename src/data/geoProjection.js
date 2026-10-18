/**
 * Shared coordinate-projection math: WGS84 geodetic <-> ECEF, ECEF <->
 * local ENU tangent plane, and Web Mercator (EPSG:3857) point projection.
 *
 * These conversions currently exist only through Cesium (`origin/main` @
 * `05ad633`): `Cesium.Cartographic.fromDegrees` / `fromCartesian` /
 * `Cartesian3.fromRadians` appear in `src/cameraVerbs.js`,
 * `src/cameraGroundGuard.js`, `src/annotations/resolver.js` and elsewhere.
 * Cesium is viewer-only — server code, Node scripts, and unit tests cannot
 * use it — so every non-viewer consumer that needs an ECEF or ENU number
 * re-derives the ellipsoid math by hand or goes without. This module is the
 * one canonical, dependency-free implementation.
 *
 * What it does NOT duplicate:
 * - `src/layers/streetLevel/tileMath.js` covers Web-Mercator TILE indices
 *   (fractional column/row, tile bounds). It has no point projection in
 *   metres and no ECEF/ENU. The Mercator latitude limit here
 *   (`WEB_MERCATOR_MAX_LAT`) matches tileMath's `MAX_LAT` by definition
 *   (the latitude where the Mercator square closes), not by import, so
 *   this module stays dependency-free.
 * - `src/data/geoid.js` converts between ellipsoidal and orthometric
 *   HEIGHT (h = H + N). It never converts horizontal coordinates.
 * - The `geoMath` / `angleMath` / `geoBounds` / `timeMath` shared modules
 *   (prior idea-cycle branches, not yet merged) cover geodesic
 *   distance/bearing, angle wrapping, bounding boxes, and time
 *   formatting — none converts datums.
 *
 * Conventions:
 * - Angles in degrees on the public API; metres for heights/distances.
 * - Geodetic inputs: latitude must be in [-90, 90]; longitude may be any
 *   finite number (trig is periodic, so no wrapping is applied).
 * - Every function returns `null` for non-finite or out-of-range input
 *   instead of throwing or returning NaN.
 * - Web Mercator clamps latitude to +/-`WEB_MERCATOR_MAX_LAT` and the
 *   projected coordinates to the +/-`WEB_MERCATOR_MAX` square (the same
 *   clamping tileMath applies to tile rows), instead of diverging to
 *   infinity at the poles.
 *
 * Pure: no DOM, no Cesium, no imports. All inputs/outputs are plain
 * numbers and plain objects.
 *
 * Adoption follow-up (NOT done here): migrating a call site means adding
 * this file to every boundary group that owns the importing module
 * (`scripts/package-boundaries.json` rejects unowned transitive imports),
 * so migration is a separate, per-group change — no call site is
 * re-pointed in this commit.
 *
 * @module data/geoProjection
 */

/** WGS84 semi-major axis (equatorial radius), metres. */
export const WGS84_A = 6378137;
/** WGS84 flattening. */
export const WGS84_F = 1 / 298.257223563;
/** WGS84 semi-minor axis (polar radius), metres. */
export const WGS84_B = WGS84_A * (1 - WGS84_F);
/** WGS84 first eccentricity squared. */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** WGS84 second eccentricity squared. */
export const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
/** Web Mercator sphere radius, metres (== WGS84_A by definition). */
export const WEB_MERCATOR_RADIUS = 6378137;
/** Maximum latitude the Web Mercator square can represent, degrees. */
export const WEB_MERCATOR_MAX_LAT = 85.05112878;
/** Half the side of the Web Mercator square, metres (PI * radius). */
export const WEB_MERCATOR_MAX = Math.PI * WEB_MERCATOR_RADIUS;

/** Degrees to radians. */
export function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Radians to degrees. */
export function radToDeg(radians) {
  return (radians * 180) / Math.PI;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidLat(lat) {
  return isFiniteNumber(lat) && lat >= -90 && lat <= 90;
}

function isValidLon(lat) {
  return isFiniteNumber(lat);
}

/**
 * Geodetic coordinates to Earth-centered, Earth-fixed (ECEF) Cartesian.
 * @param {{lat:number, lon:number, height?:number}} point Latitude/longitude
 *   in degrees, ellipsoidal height in metres (default 0).
 * @returns {{x:number, y:number, z:number}|null} ECEF metres, or null for
 *   invalid input.
 */
export function geodeticToEcef(point) {
  if (!point || typeof point !== 'object') return null;
  const { lat, lon } = point;
  const height = point.height === undefined ? 0 : point.height;
  if (!isValidLat(lat) || !isValidLon(lon) || !isFiniteNumber(height)) {
    return null;
  }
  const latRad = degToRad(lat);
  const lonRad = degToRad(lon);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const primeVerticalRadius =
    WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (primeVerticalRadius + height) * cosLat * Math.cos(lonRad),
    y: (primeVerticalRadius + height) * cosLat * Math.sin(lonRad),
    z: (primeVerticalRadius * (1 - WGS84_E2) + height) * sinLat,
  };
}

/**
 * ECEF Cartesian to geodetic coordinates (iterative, converges to well
 * under a millimetre; the poles are handled as a special case because
 * longitude is undefined there).
 * @param {{x:number, y:number, z:number}} point ECEF metres.
 * @returns {{lat:number, lon:number, height:number}|null} Latitude/longitude
 *   in degrees and ellipsoidal height in metres, or null for invalid input.
 */
export function ecefToGeodetic(point) {
  if (!point || typeof point !== 'object') return null;
  const { x, y, z } = point;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return null;
  }
  const lon = radToDeg(Math.atan2(y, x));
  const p = Math.hypot(x, y);
  if (p === 0) {
    // On the polar axis: longitude is arbitrary (0 by convention).
    return {
      lat: z >= 0 ? 90 : -90,
      lon: 0,
      height: Math.abs(z) - WGS84_B,
    };
  }
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  let height = 0;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const sinLat = Math.sin(lat);
    const primeVerticalRadius =
      WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    height = p / Math.cos(lat) - primeVerticalRadius;
    const nextLat = Math.atan2(z + WGS84_E2 * primeVerticalRadius * sinLat, p);
    if (Math.abs(nextLat - lat) < 1e-12) {
      lat = nextLat;
      break;
    }
    lat = nextLat;
  }
  const sinLat = Math.sin(lat);
  const primeVerticalRadius =
    WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  height = p / Math.cos(lat) - primeVerticalRadius;
  return { lat: radToDeg(lat), lon, height };
}

/**
 * ECEF point to local East-North-Up (ENU) coordinates about an origin.
 * @param {{x:number, y:number, z:number}} point ECEF metres.
 * @param {{lat:number, lon:number, height?:number}} origin Geodetic origin.
 * @returns {{east:number, north:number, up:number}|null} ENU metres
 *   relative to the origin, or null for invalid input.
 */
export function ecefToEnu(point, origin) {
  if (!point || typeof point !== 'object') return null;
  const originEcef = geodeticToEcef(origin);
  if (originEcef === null) return null;
  const { x, y, z } = point;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return null;
  }
  const dx = x - originEcef.x;
  const dy = y - originEcef.y;
  const dz = z - originEcef.z;
  const latRad = degToRad(origin.lat);
  const lonRad = degToRad(origin.lon);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  return {
    east: -sinLon * dx + cosLon * dy,
    north: -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz,
    up: cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz,
  };
}

/**
 * Local East-North-Up (ENU) coordinates about an origin to ECEF.
 * @param {{east:number, north:number, up:number}} enu ENU metres relative
 *   to the origin.
 * @param {{lat:number, lon:number, height?:number}} origin Geodetic origin.
 * @returns {{x:number, y:number, z:number}|null} ECEF metres, or null for
 *   invalid input.
 */
export function enuToEcef(enu, origin) {
  if (!enu || typeof enu !== 'object') return null;
  const { east, north, up } = enu;
  if (!isFiniteNumber(east) || !isFiniteNumber(north) || !isFiniteNumber(up)) {
    return null;
  }
  const originEcef = geodeticToEcef(origin);
  if (originEcef === null) return null;
  const latRad = degToRad(origin.lat);
  const lonRad = degToRad(origin.lon);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  return {
    x:
      originEcef.x -
      sinLon * east -
      sinLat * cosLon * north +
      cosLat * cosLon * up,
    y:
      originEcef.y +
      cosLon * east -
      sinLat * sinLon * north +
      cosLat * sinLon * up,
    z: originEcef.z + cosLat * north + sinLat * up,
  };
}

/**
 * Offset a geodetic point by a local ENU displacement (e.g. "1 km east").
 * @param {{lat:number, lon:number, height?:number}} origin Starting point.
 * @param {{east:number, north:number, up:number}} enu Displacement in metres.
 * @returns {{lat:number, lon:number, height:number}|null} Destination
 *   geodetic coordinates, or null for invalid input.
 */
export function offsetGeodetic(origin, enu) {
  const ecef = enuToEcef(enu, origin);
  if (ecef === null) return null;
  return ecefToGeodetic(ecef);
}

/**
 * Longitude/latitude to Web Mercator (EPSG:3857) projected metres.
 * @param {{lon:number, lat:number}} point Longitude/latitude in degrees.
 * @returns {{x:number, y:number}|null} Projected metres, or null for
 *   invalid input. Latitude is clamped to +/-`WEB_MERCATOR_MAX_LAT` and
 *   both outputs to the +/-`WEB_MERCATOR_MAX` square.
 */
export function lonLatToWebMercator(point) {
  if (!point || typeof point !== 'object') return null;
  const { lon, lat } = point;
  if (!isValidLon(lon) || !isValidLat(lat)) return null;
  const clampedLat = Math.max(
    -WEB_MERCATOR_MAX_LAT,
    Math.min(WEB_MERCATOR_MAX_LAT, lat),
  );
  const x = Math.max(
    -WEB_MERCATOR_MAX,
    Math.min(WEB_MERCATOR_MAX, WEB_MERCATOR_RADIUS * degToRad(lon)),
  );
  const y = Math.max(
    -WEB_MERCATOR_MAX,
    Math.min(
      WEB_MERCATOR_MAX,
      WEB_MERCATOR_RADIUS *
        Math.log(Math.tan(Math.PI / 4 + degToRad(clampedLat) / 2)),
    ),
  );
  return { x, y };
}

/**
 * Web Mercator (EPSG:3857) projected metres to longitude/latitude.
 * @param {{x:number, y:number}} point Projected metres.
 * @returns {{lon:number, lat:number}|null} Longitude/latitude in degrees,
 *   or null for invalid input. Inputs outside the square are clamped to it.
 */
export function webMercatorToLonLat(point) {
  if (!point || typeof point !== 'object') return null;
  const { x, y } = point;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const clampedX = Math.max(-WEB_MERCATOR_MAX, Math.min(WEB_MERCATOR_MAX, x));
  const clampedY = Math.max(-WEB_MERCATOR_MAX, Math.min(WEB_MERCATOR_MAX, y));
  const lon = radToDeg(clampedX / WEB_MERCATOR_RADIUS);
  const lat = radToDeg(
    2 * Math.atan(Math.exp(clampedY / WEB_MERCATOR_RADIUS)) - Math.PI / 2,
  );
  return { lon, lat };
}
