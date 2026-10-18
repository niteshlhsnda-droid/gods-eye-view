/**
 * Shared spherical polygon math: true-on-the-sphere area (spherical
 * excess), great-circle perimeter, vector-mean centroid, and containment
 * for latitude/longitude rings and polygons.
 *
 * INPUT CONVENTION (read this first): vertices are `[lat, lon]` pairs or
 * `{lat, lon}` objects — latitude first, matching `geoMath.js` argument
 * order. This is NOT the `[lon, lat]` (GeoJSON) order used by
 * `src/sources/featureGeometry.js`, `src/data/adminBoundaries.js`, and
 * `src/data/naturalEarthRegions.js`. Swapping the two usually produces
 * `null` here (longitudes outside [-90, 90] land in the latitude slot and
 * fail validation), but a swapped pair that happens to be in range would
 * silently compute the wrong answer — keep the order straight.
 *
 * Non-overlap with the existing geometry code:
 * - `src/sources/featureGeometry.js` (Grok's lane) owns PLANAR polygon
 *   ops for small features: planar shoelace `ringAreaM2`, vertex-average
 *   `ringCentroid`, planar `pointInPolygon`, corridor buffering, ring
 *   simplification. Those are equirectangular approximations — fine for
 *   buildings, degrading for large rings. This module owns the SPHERICAL
 *   counterparts: different formulas, exact on the sphere, valid for
 *   rings of any size (countries, fire perimeters, detection zones).
 *   The two agree to ~0.1% at whiteboard scale and diverge for large
 *   regions — that is the point.
 * - `src/annotations/drawMode.js` owns planar whiteboard-scale measure
 *   math (same planar-vs-spherical distinction as above).
 * - `src/data/adminBoundaries.js` and `src/data/naturalEarthRegions.js`
 *   each carry a PRIVATE area helper (`ringAreaKm2`, `[lon, lat]` order,
 *   no validation) built on the Chamberlain–Duquette trapezoid sum in
 *   (lon, lat) space, plus an exported planar ray-cast `pointInRing`
 *   (`[lon, lat]`, no antimeridian handling). The trapezoid is exact
 *   for ordinary rings but breaks down for pole-encircling rings (a
 *   phantom ±4πR² residue from the longitude singularity at the pole —
 *   e.g. a small triangle around the north pole computes as nearly the
 *   whole sphere). This module instead fan-triangulates in 3D with
 *   Van Oosterom & Strackee signed solid angles: exact for great-circle
 *   edges, with no longitude arithmetic at all, so it stays correct
 *   across the antimeridian AND around poles. Those domain helpers are
 *   not replaced (no call sites re-pointed); this is the shared,
 *   validated superset with its own documented input order.
 * - `src/data/geoMath.js` owns point-to-point spherical math
 *   (haversine distance, bearing, destination, midpoint) — no polygon
 *   math at all. `geoBounds.js` / `geoAntimeridian.js` own bounding
 *   boxes and antimeridian splitting — no area, perimeter, centroid,
 *   or containment.
 * - No unit conversions live here: areas are always m² and perimeters
 *   always metres (`unitMath.js` owns conversions).
 *
 * Canonical semantics (standalone — no call sites re-pointed):
 * - Pure: no DOM, no Cesium, no imports. All inputs/outputs are plain
 *   numbers, arrays, and small objects.
 * - Error values: `null` on invalid input — never a throw, never `NaN`.
 *   A ring is invalid when it is not an array of at least three valid
 *   vertices; a vertex is invalid when it is not a finite `[lat, lon]`
 *   pair or `{lat, lon}` object, or its latitude is outside [-90, 90]
 *   or its longitude outside [-180, 180].
 * - Rings do NOT need to be explicitly closed: the closing edge is
 *   implied, and a trailing duplicate of the first vertex (plus any
 *   consecutive duplicates) is dropped during normalization.
 * - A degenerate but valid ring (e.g. three collinear points) has area
 *   0 — `0` is a valid result, `null` means "not a ring".
 * - Area is computed in 3D (fan triangulation from the first vertex,
 *   Van Oosterom & Strackee signed solid angles — spherical excess via
 *   Girard's theorem), so no longitude arithmetic is involved: rings
 *   crossing the antimeridian and rings encircling a pole compute
 *   correctly. Containment unwraps ring longitudes continuously and
 *   brings the query point into the ring's frame before projecting to
 *   the tangent plane — also antimeridian-safe.
 * - Rings must be simple (non-self-intersecting); a self-intersecting
 *   ring yields the signed-sum result, which is not a meaningful area.
 * - Holes subtract by magnitude: polygon area is
 *   `max(0, |outer| − Σ|hole|)`; a hole larger than its outer ring is a
 *   caller bug and the result clamps at 0 rather than going negative.
 * - The centroid is the 3D vector mean of the ring's vertices,
 *   projected back to the sphere (unlike a plain lat/lon average it
 *   stays correct across the antimeridian and near the poles). It is
 *   `null` for a degenerate ring whose mean vector vanishes
 *   (antipodally symmetric vertices).
 * - Containment projects the ring into the tangent plane at the query
 *   point (gnomonic-style) and uses the winding number — an exact
 *   spherical test for any ring that does not contain the query point's
 *   antipode. Points on the boundary (within ~1 mm) count as inside.
 *   Query latitudes within 1° of a pole return `null` (the tangent
 *   projection degenerates there).
 * - Results are full double precision, never rounded: display rounding
 *   is the caller's job.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in this
 * commit — migration is a separate, per-group change, like the prior
 * idea-cycle modules.
 *
 * @module data/sphericalPolygonMath
 */

/** IUGG mean Earth radius, metres — matches geoMath.EARTH_MEAN_RADIUS_M. */
const EARTH_MEAN_RADIUS_M = 6_371_008.8;
/** Below this 3D mean-vector length the centroid is degenerate. */
const CENTROID_DEGENERATE_EPS = 1e-12;
/** Boundary tolerance for containment, ~1 mm expressed in radians. */
const CONTAINMENT_BOUNDARY_RAD = 0.001 / EARTH_MEAN_RADIUS_M;
/** Query latitudes closer than this to a pole are rejected (null). */
const POLE_GUARD_DEG = 1;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * True when `value` is a finite number.
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalize one vertex to `{lat, lon}`, or `null` when invalid.
 * Accepts `[lat, lon]` pairs and `{lat, lon}` objects.
 * @param {unknown} vertex
 * @returns {{lat:number,lon:number}|null}
 */
function toVertex(vertex) {
  let lat;
  let lon;
  if (Array.isArray(vertex)) {
    if (vertex.length < 2) return null;
    [lat, lon] = vertex;
  } else if (vertex !== null && typeof vertex === 'object') {
    ({ lat, lon } = vertex);
  } else {
    return null;
  }
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Normalize a ring to a deduped `[{lat, lon}]` array, or `null` when the
 * ring is invalid. Consecutive duplicates and a closing duplicate of the
 * first vertex are dropped (zero-length edges add nothing but would bias
 * the centroid).
 * @param {unknown} ring
 * @returns {Array<{lat:number,lon:number}>|null}
 */
function toRing(ring) {
  if (!Array.isArray(ring)) return null;
  const vertices = [];
  for (const raw of ring) {
    const vertex = toVertex(raw);
    if (!vertex) return null;
    vertices.push(vertex);
  }
  if (vertices.length < 3) return null;
  const deduped = [vertices[0]];
  for (let i = 1; i < vertices.length; i += 1) {
    const prev = deduped[deduped.length - 1];
    const cur = vertices[i];
    if (cur.lat === prev.lat && cur.lon === prev.lon) continue;
    deduped.push(cur);
  }
  const first = deduped[0];
  const last = deduped[deduped.length - 1];
  if (deduped.length > 1 && first.lat === last.lat && first.lon === last.lon) {
    deduped.pop();
  }
  return deduped.length >= 3 ? deduped : null;
}

/**
 * Wrap a longitude delta into (-180, 180] degrees, so unwrapped ring
 * longitudes take the short way round and antimeridian-crossing rings
 * keep their topology.
 * @param {number} deltaDeg
 * @returns {number}
 */
function wrapDeltaDeg(deltaDeg) {
  const wrapped = (((((deltaDeg % 360) + 540) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/**
 * Unit 3D vector for a lat/lon point.
 * @param {number} lat
 * @param {number} lon
 * @returns {[number, number, number]}
 */
function toVec3(lat, lon) {
  const latRad = toRad(lat);
  const lonRad = toRad(lon);
  return [
    Math.cos(latRad) * Math.cos(lonRad),
    Math.cos(latRad) * Math.sin(lonRad),
    Math.sin(latRad),
  ];
}

/**
 * Signed solid angle (steradians) subtended by the spherical triangle
 * (a, b, c) — Van Oosterom & Strackee (1983). Positive when (a, b, c)
 * is counterclockwise viewed from outside the sphere. Exact for
 * great-circle edges, with no longitude arithmetic, so it is immune to
 * the antimeridian and to poles (unlike trapezoid sums in (lon, lat)
 * space, which pick up a phantom ±4πR² residue for pole-encircling
 * rings).
 * @param {[number,number,number]} a
 * @param {[number,number,number]} b
 * @param {[number,number,number]} c
 * @returns {number}
 */
function signedSolidAngleSr(a, b, c) {
  const cross = [
    b[1] * c[2] - b[2] * c[1],
    b[2] * c[0] - b[0] * c[2],
    b[0] * c[1] - b[1] * c[0],
  ];
  const numerator = a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2];
  const denominator =
    1 +
    (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) +
    (b[0] * c[0] + b[1] * c[1] + b[2] * c[2]) +
    (c[0] * a[0] + c[1] * a[1] + c[2] * a[2]);
  // atan2(0, 0) is 0 in JS — degenerate triangles contribute nothing,
  // never NaN.
  return 2 * Math.atan2(numerator, denominator);
}

/**
 * Area of one normalized ring: fan-triangulate from the first vertex and
 * sum signed solid angles (spherical excess via Girard's theorem).
 * Exact for great-circle edges; signed terms cancel correctly for
 * simple (non-self-intersecting) rings of any size, including
 * pole-containing ones. Internal: takes an already-validated ring.
 * @param {Array<{lat:number,lon:number}>} ring
 * @returns {number}
 */
function ringAreaM2Normalized(ring) {
  const vectors = ring.map((p) => toVec3(p.lat, p.lon));
  const v0 = vectors[0];
  let solidAngle = 0;
  for (let i = 1; i < vectors.length - 1; i += 1) {
    solidAngle += signedSolidAngleSr(v0, vectors[i], vectors[i + 1]);
  }
  return Math.abs(solidAngle) * EARTH_MEAN_RADIUS_M * EARTH_MEAN_RADIUS_M;
}

/**
 * Great-circle distance between two points, metres (haversine).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return (
    2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))))
  );
}

/**
 * True spherical area of a ring, in square metres.
 * @param {unknown} ring Array of `[lat, lon]` pairs or `{lat, lon}`
 *   objects; need not be explicitly closed.
 * @returns {number|null} Area in m², or `null` for an invalid ring.
 */
export function sphericalRingAreaM2(ring) {
  const normalized = toRing(ring);
  if (!normalized) return null;
  return ringAreaM2Normalized(normalized);
}

/**
 * Great-circle perimeter of a ring, in metres (the closing edge is
 * implied for open rings).
 * @param {unknown} ring Array of `[lat, lon]` pairs or `{lat, lon}`
 *   objects.
 * @returns {number|null} Perimeter in metres, or `null` for an invalid
 *   ring.
 */
export function sphericalRingPerimeterM(ring) {
  const normalized = toRing(ring);
  if (!normalized) return null;
  let total = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const a = normalized[i];
    const b = normalized[(i + 1) % normalized.length];
    total += haversineM(a.lat, a.lon, b.lat, b.lon);
  }
  return total;
}

/**
 * True spherical area of a polygon with holes, in square metres.
 * @param {unknown} polygon Array of rings `[outer, ...holes]`, each ring
 *   in the same `[lat, lon]` / `{lat, lon}` form as `sphericalRingAreaM2`.
 * @returns {number|null} `max(0, |outer| − Σ|hole|)` in m², or `null`
 *   when the polygon or any ring is invalid.
 */
export function sphericalPolygonAreaM2(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  const rings = [];
  for (const raw of polygon) {
    const normalized = toRing(raw);
    if (!normalized) return null;
    rings.push(normalized);
  }
  const [outer, ...holes] = rings;
  let area = ringAreaM2Normalized(outer);
  for (const hole of holes) area -= ringAreaM2Normalized(hole);
  return Math.max(0, area);
}

/**
 * Spherical centroid of a ring: the 3D vector mean of its vertices,
 * projected back onto the sphere. Correct across the antimeridian and
 * near the poles, where a plain lat/lon average breaks.
 * @param {unknown} ring Array of `[lat, lon]` pairs or `{lat, lon}`
 *   objects.
 * @returns {{lat:number,lon:number}|null} Centroid, or `null` for an
 *   invalid ring or a degenerate (antipodally symmetric) one.
 */
export function sphericalRingCentroid(ring) {
  const normalized = toRing(ring);
  if (!normalized) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const { lat, lon } of normalized) {
    const latRad = toRad(lat);
    const lonRad = toRad(lon);
    x += Math.cos(latRad) * Math.cos(lonRad);
    y += Math.cos(latRad) * Math.sin(lonRad);
    z += Math.sin(latRad);
  }
  const length = Math.hypot(x, y, z);
  if (length < CENTROID_DEGENERATE_EPS) return null;
  const lat = toDeg(Math.asin(Math.max(-1, Math.min(1, z / length))));
  const lon = toDeg(Math.atan2(y / length, x / length));
  return { lat, lon };
}

/**
 * Whether a point lies inside a ring on the sphere. The ring is
 * projected into the tangent plane at the query point and the winding
 * number is taken — an exact spherical test for rings that do not
 * contain the query point's antipode. The ring is unwrapped continuously
 * (so antimeridian-crossing rings keep their topology) and the query
 * point is brought into the ring's frame before projection.
 * @param {unknown} ring Array of `[lat, lon]` pairs or `{lat, lon}`
 *   objects.
 * @param {number} lat Query latitude, degrees.
 * @param {number} lon Query longitude, degrees.
 * @returns {boolean|null} `true` inside (boundary counts as inside),
 *   `false` outside, `null` for an invalid ring, an invalid query point,
 *   or a query within 1° of a pole.
 */
export function sphericalPointInRing(ring, lat, lon) {
  const normalized = toRing(ring);
  const query = toVertex([lat, lon]);
  if (!normalized || !query) return null;
  if (Math.abs(query.lat) > 90 - POLE_GUARD_DEG) return null;
  const lat0 = toRad(query.lat);
  const cosLat0 = Math.cos(lat0);
  // Unwrap the ring continuously around its first vertex so the ring's
  // own topology survives the antimeridian, then bring the query point
  // into the same frame. Unwrapping each vertex around the QUERY instead
  // would tear a far-away ring across the whole plane and misclassify
  // outside points as inside.
  const baseLon = normalized[0].lon;
  const unwrapped = normalized.map(({ lat: la, lon: lo }) => ({
    lat: la,
    lon:
      Math.abs(la) === 90
        ? query.lon // a pole is due north/south of the query point
        : baseLon + wrapDeltaDeg(lo - baseLon),
  }));
  const centerLon =
    unwrapped.reduce((sum, p) => sum + p.lon, 0) / unwrapped.length;
  const queryLon = centerLon + wrapDeltaDeg(query.lon - centerLon);
  // Tangent-plane coordinates (radians) relative to the query point.
  const local = unwrapped.map(({ lat: la, lon: lo }) => [
    toRad(lo - queryLon) * cosLat0,
    toRad(la) - lat0,
  ]);
  // On-boundary (within ~1 mm) counts as inside.
  for (let i = 0; i < local.length; i += 1) {
    const [ax, ay] = local[i];
    const [bx, by] = local[(i + 1) % local.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let dist;
    if (len2 === 0) {
      dist = Math.hypot(ax, ay);
    } else {
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      dist = Math.hypot(ax + t * dx, ay + t * dy);
    }
    if (dist <= CONTAINMENT_BOUNDARY_RAD) return true;
  }
  // Winding number about the query point (the origin).
  let winding = 0;
  for (let i = 0; i < local.length; i += 1) {
    const [x1, y1] = local[i];
    const [x2, y2] = local[(i + 1) % local.length];
    // z-component of edge × (query − edge start); query is the origin.
    const isLeft = (x2 - x1) * (0 - y1) - (0 - x1) * (y2 - y1);
    if (y1 <= 0) {
      if (y2 > 0 && isLeft > 0) winding += 1;
    } else if (y2 <= 0 && isLeft < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}
