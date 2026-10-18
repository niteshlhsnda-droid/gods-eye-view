/**
 * Great-circle segment math: spherical linear interpolation (slerp),
 * waypoint densification along a great-circle arc, and great-circle
 * segment intersection — exact on-the-sphere 3D vector math.
 *
 * PIVOT NOTE (Cycle 17, gemini lane): the original brief asked for
 * `greatCircleDistanceM` plus `midpoint`, but both already exist in
 * `src/data/geoMath.js` (`haversineDistanceM` — the haversine great-circle
 * distance — and `midpoint`). Duplicating them here would create two
 * competing APIs for the same formula, so per the brief's pivot rule this
 * module deliberately does NOT export distance or midpoint and instead
 * covers the missing great-circle segment operations. `geoMath.js` owns
 * point-to-point spherical math (distance, bearing, destination,
 * midpoint); this module owns segment-level spherical math
 * (interpolation along an arc, arc densification, arc–arc intersection).
 * Also see `src/data/sphericalPolygonMath.js` (Cycle 16) for spherical
 * polygon math — the same no-import, null-on-invalid, lat-first
 * conventions are used here.
 *
 * RESEARCH BASIS (standard spherical geometry):
 * - Slerp (spherical linear interpolation): Ken Shoemake, "Animating
 *   rotation with quaternion curves", SIGGRAPH 1985, pp. 245–254. The
 *   same formula interpolates unit vectors on the sphere:
 *   P(f) = (sin((1−f)·Ω)·A + sin(f·Ω)·B) / sin(Ω), Ω = angle(A, B).
 * - Great-circle segment intersection via plane normals: each great
 *   circle is the intersection of the sphere with a plane through the
 *   origin; the circles meet at ±(n1 × n2) where n1, n2 are the plane
 *   normals. This is the method in Chris Veness's "Calculate distance,
 *   bearing and more between Latitude/Longitude points"
 *   (movable-type.co.uk/scripts/latlong.html, "Intersection of two
 *   paths"), extended here with minor-arc membership tests, coincident
 *   great-circle handling, and degenerate (point) arcs.
 * - Haversine distance (used internally for densification): the standard
 *   haversine formula, same IUGG mean radius as `geoMath.js`.
 *
 * INPUT CONVENTION: latitude first (degrees), matching `geoMath.js`
 * argument order. Segment endpoints accept `[lat, lon]` pairs or
 * `{lat, lon}` objects. Outputs are `{lat, lon}` with longitude wrapped
 * to [-180, 180]. All segments are MINOR arcs: the endpoints are joined
 * by the shorter of the two great-circle paths (this module never
 * interpolates the long way around).
 *
 * Canonical semantics (standalone — no call sites re-pointed):
 * - Pure: no DOM, no Cesium, no imports. The haversine copy here shares
 *   the IUGG mean radius with `geoMath.js` (6_371_008.8 m); if that
 *   constant ever changes there, change it here too.
 * - Error values: `null` on invalid input — never a throw, never `NaN`.
 *   Coordinates are invalid when non-finite, latitude outside [-90, 90],
 *   or longitude outside [-180, 180]. `fraction` is invalid when
 *   non-finite or outside [0, 1]. `maxSegmentM` is invalid when
 *   non-finite or <= 0.
 * - No unit conversions live here: distances are always metres
 *   (`unitMath.js` owns conversions).
 *
 * @module data/greatCircleMath
 */

/** IUGG mean Earth radius, metres — shared with geoMath.js, do not drift. */
export const EARTH_MEAN_RADIUS_M = 6_371_008.8;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** Angle below which two points count as coincident (radians, ~6 nm). */
const COINCIDENT_EPS = 1e-12;
/** On-arc membership tolerance (radians, ~6 mm on the surface). */
const ON_ARC_EPS = 1e-9;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function validLatLon(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/** Normalise a segment endpoint: `[lat, lon]` or `{lat, lon}` -> {lat, lon} | null. */
function asLatLon(p) {
  if (Array.isArray(p) && p.length === 2) {
    const [lat, lon] = p;
    return validLatLon(lat, lon) ? { lat, lon } : null;
  }
  if (p !== null && typeof p === 'object') {
    const { lat, lon } = p;
    return validLatLon(lat, lon) ? { lat, lon } : null;
  }
  return null;
}

/** Unit 3D vector for a lat/lon point (x: lon 0, y: lon 90E, z: north pole). */
function toVec(lat, lon) {
  const la = lat * D2R;
  const lo = lon * D2R;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

function toLatLon(v) {
  const [x, y, z] = v;
  const lat = Math.asin(clamp(z, -1, 1)) * R2D;
  // atan2 returns (-180, 180] — already inside [-180, 180].
  const lon = Math.atan2(y, x) * R2D;
  return { lat, lon };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
/** Central angle between two unit vectors, radians (chord-length form: exact for identical vectors and accurate at small angles, where acos(1-eps) would amplify floating-point noise into ~1e-8 rad errors). */
const angleBetween = (a, b) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return 2 * Math.asin(clamp(Math.hypot(dx, dy, dz) / 2, 0, 1));
};

/**
 * Great-circle distance between two points (haversine, IUGG mean radius).
 * Local copy of the `geoMath.js` formula — kept standalone per module
 * convention; see the PIVOT NOTE above.
 */
function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Point at `fraction` of the way along the great-circle minor arc from
 * (lat1, lon1) to (lat2, lon2), via spherical linear interpolation.
 *
 * Near-antipodal endpoints are genuinely ambiguous (infinitely many
 * great circles pass through them), so exact slerp would divide by a
 * ~zero sin(Ω) and explode. Instead this module falls back to a
 * deterministic, documented choice: the great circle through the first
 * point whose plane is perpendicular to a fixed reference axis (the
 * z-axis, or the x-axis when the point is near a pole). The fallback is
 * a valid point on the sphere with fraction 0 -> start and 1 -> end;
 * only the path between them is reference-dependent, which is
 * unavoidable at the antipode.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @param {number} fraction - 0 = start, 1 = end.
 * @returns {{lat:number, lon:number}|null} Interpolated point, or null on
 *   invalid input.
 */
export function interpolateGreatCircle(lat1, lon1, lat2, lon2, fraction) {
  if (
    !validLatLon(lat1, lon1) ||
    !validLatLon(lat2, lon2) ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 1
  ) {
    return null;
  }
  const a = toVec(lat1, lon1);
  const b = toVec(lat2, lon2);
  const omega = angleBetween(a, b);
  if (omega < COINCIDENT_EPS) {
    // Coincident endpoints: every fraction is the same point.
    return toLatLon(a);
  }
  const sinOmega = Math.sin(omega);
  if (sinOmega > COINCIDENT_EPS) {
    // Standard slerp (Shoemake 1985).
    const wa = Math.sin((1 - fraction) * omega) / sinOmega;
    const wb = Math.sin(fraction * omega) / sinOmega;
    return toLatLon([
      wa * a[0] + wb * b[0],
      wa * a[1] + wb * b[1],
      wa * a[2] + wb * b[2],
    ]);
  }
  // Near-antipodal: deterministic fallback great circle. Pick a reference
  // axis far from the point's own axis, build the in-plane tangent, and
  // rotate by fraction * omega within that plane.
  const ref = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const alongRef = dot(ref, a);
  const t = norm([
    ref[0] - alongRef * a[0],
    ref[1] - alongRef * a[1],
    ref[2] - alongRef * a[2],
  ]);
  const c = Math.cos(fraction * omega);
  const s = Math.sin(fraction * omega);
  return toLatLon([
    c * a[0] + s * t[0],
    c * a[1] + s * t[1],
    c * a[2] + s * t[2],
  ]);
}

/**
 * Waypoints along the great-circle minor arc from (lat1, lon1) to
 * (lat2, lon2) such that no consecutive pair is more than `maxSegmentM`
 * metres apart — the standard densification used to draw great-circle
 * arcs as polylines. Includes both endpoints; a zero-length arc yields
 * a single point.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @param {number} maxSegmentM - Maximum segment length in metres (> 0).
 * @returns {Array<{lat:number, lon:number}>|null} Waypoints from start
 *   to end, or null on invalid input.
 */
export function densifyGreatCircle(lat1, lon1, lat2, lon2, maxSegmentM) {
  if (
    !validLatLon(lat1, lon1) ||
    !validLatLon(lat2, lon2) ||
    !Number.isFinite(maxSegmentM) ||
    maxSegmentM <= 0
  ) {
    return null;
  }
  const distance = haversineDistanceM(lat1, lon1, lat2, lon2);
  if (distance === 0) {
    return [{ lat: lat1, lon: lon1 }];
  }
  const segments = Math.max(1, Math.ceil(distance / maxSegmentM));
  const points = [];
  for (let i = 0; i <= segments; i++) {
    points.push(interpolateGreatCircle(lat1, lon1, lat2, lon2, i / segments));
  }
  return points;
}

/** True when unit vector p lies on the minor arc e1->e2 (length arcLen). */
function onArc(p, e1, e2, arcLen) {
  return angleBetween(p, e1) + angleBetween(p, e2) <= arcLen + ON_ARC_EPS;
}

/**
 * Intersection of two great-circle minor-arc segments. Segments are
 * given as endpoint pairs; all arithmetic is 3D vector math, so this is
 * exact on the sphere and safe across the antimeridian and the poles.
 *
 * Degenerate cases:
 * - A zero-length segment is a point: intersects iff the point lies on
 *   the other segment.
 * - Segments on the same great circle (parallel plane normals):
 *   returns the first endpoint of either segment that lies on the other
 *   segment (i.e. the segments touch or overlap), else null.
 * - Otherwise the two great circles meet at two antipodal points; the
 *   one lying on both minor arcs (if any) is returned.
 *
 * @param {Array|Object} a1 - First segment start (`[lat, lon]` or `{lat, lon}`).
 * @param {Array|Object} a2 - First segment end.
 * @param {Array|Object} b1 - Second segment start.
 * @param {Array|Object} b2 - Second segment end.
 * @returns {{lat:number, lon:number}|null} Intersection point, or null
 *   when the segments do not intersect / input is invalid.
 */
export function greatCircleSegmentsIntersect(a1, a2, b1, b2) {
  const pa1 = asLatLon(a1);
  const pa2 = asLatLon(a2);
  const pb1 = asLatLon(b1);
  const pb2 = asLatLon(b2);
  if (!pa1 || !pa2 || !pb1 || !pb2) {
    return null;
  }
  const A1 = toVec(pa1.lat, pa1.lon);
  const A2 = toVec(pa2.lat, pa2.lon);
  const B1 = toVec(pb1.lat, pb1.lon);
  const B2 = toVec(pb2.lat, pb2.lon);
  const arcA = angleBetween(A1, A2);
  const arcB = angleBetween(B1, B2);

  // Degenerate (point) segments.
  if (arcA < COINCIDENT_EPS) {
    if (arcB < COINCIDENT_EPS) {
      return angleBetween(A1, B1) < COINCIDENT_EPS ? toLatLon(A1) : null;
    }
    return onArc(A1, B1, B2, arcB) ? toLatLon(A1) : null;
  }
  if (arcB < COINCIDENT_EPS) {
    return onArc(B1, A1, A2, arcA) ? toLatLon(B1) : null;
  }

  const n1 = norm(cross(A1, A2));
  const n2 = norm(cross(B1, B2));

  // Coincident great circles: touch/overlap check via endpoints.
  if (Math.abs(dot(n1, n2)) > 1 - COINCIDENT_EPS) {
    for (const [p, pp, q1, q2, arc] of [
      [A1, pa1, B1, B2, arcB],
      [A2, pa2, B1, B2, arcB],
      [B1, pb1, A1, A2, arcA],
      [B2, pb2, A1, A2, arcA],
    ]) {
      if (onArc(p, q1, q2, arc)) {
        return { lat: pp.lat, lon: pp.lon };
      }
    }
    return null;
  }

  // General case: the circles meet at ±(n1 × n2); keep the one on both arcs.
  const x = norm(cross(n1, n2));
  const negX = [-x[0], -x[1], -x[2]];
  for (const c of [x, negX]) {
    if (onArc(c, A1, A2, arcA) && onArc(c, B1, B2, arcB)) {
      return toLatLon(c);
    }
  }
  return null;
}
