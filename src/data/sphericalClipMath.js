/**
 * Spherical polygon clipping: the intersection of a simple spherical
 * polygon (the subject — convex or concave, great-circle edges) with a
 * CONVEX spherical polygon (the clip window, great-circle edges), via
 * Sutherland–Hodgman clipping adapted to the sphere in 3D.
 *
 * Each clip edge (a → b) defines a hemisphere through the Earth's centre
 * with plane normal n = a × b; a point p is inside that half-plane when
 * sign·(n·p) ≥ 0 (sign absorbs the clip ring's winding). The subject is
 * clipped against one such hemisphere at a time, and each subject edge
 * that straddles a clip plane is cut at the great-circle / plane
 * intersection ±((s × e) × n), keeping the antipode on the minor arc.
 * All arithmetic is 3D unit-vector math, so clipping is exact
 * on-the-sphere and antimeridian-safe with no longitude arithmetic.
 *
 * RESEARCH BASIS:
 * - Sutherland, I. E. & Hodgman, G. W., "Reentrant polygon clipping",
 *   CACM 17(1), 1974, pp. 32–42: clip the subject against one convex
 *   window edge (half-space) at a time; the window MUST be convex while
 *   the subject may be concave. Four cases per subject edge
 *   (in→in, out→in, in→out, out→out).
 * - Great-circle / plane intersection via plane normals: each great
 *   circle is the sphere ∩ a plane through the origin, so the segment's
 *   great circle meets the clip plane along ±((s × e) × n) — the same
 *   construction `src/data/greatCircleMath.js` (Cycle 17) uses for
 *   arc–arc intersection, following Chris Veness's "Intersection of two
 *   paths" (movable-type.co.uk/scripts/latlong.html).
 * - Convexity test: a simple ring is convex iff every vertex lies in the
 *   closed interior half-plane of every edge (supporting-hemisphere
 *   characterization); evaluated here per edge in 3D, so it also rejects
 *   inconsistent winding and works across the antimeridian.
 * - Degenerate-output area check: Van Oosterom & Strackee signed solid
 *   angles (same basis as `src/data/sphericalPolygonMath.js`, Cycle 16).
 * - PIVOT NOTE (Cycle 18, gemini lane): the brief suggested researching
 *   Greiner–Hormann ("Efficient clipping of arbitrary polygons",
 *   Eurographics 1998). Evaluated and REJECTED for this module:
 *   Greiner–Hormann handles arbitrary (non-convex) clip windows but
 *   needs intersection labelling with degenerate-vertex resolution and
 *   returns polygon SETS — that breaks the single-ring, null-on-invalid
 *   contract this math line keeps. Sutherland–Hodgman against a convex
 *   window is the cleanly-buildable researched subset, and convexity of
 *   the window is exactly the classic algorithm's documented requirement.
 *   Union/difference are therefore out of scope (S–H is intersection
 *   only); a Weiler–Atherton spherical variant would be a separate idea.
 *
 * INPUT CONVENTION (read this first): vertices are `[lat, lon]` pairs or
 * `{lat, lon}` objects — latitude first, matching `geoMath.js` argument
 * order and the Cycle 16/17 modules. This is NOT the `[lon, lat]`
 * (GeoJSON) order used by `src/sources/featureGeometry.js` and
 * `src/data/adminBoundaries.js`. Edges are MINOR great-circle arcs; a
 * ring with adjacent antipodal vertices is rejected (the minor arc is
 * ambiguous there). Rings do NOT need to be explicitly closed: the
 * closing edge is implied, and consecutive duplicates (plus a trailing
 * duplicate of the first vertex) are dropped during normalization.
 *
 * Non-overlap with the existing geometry code:
 * - `src/sources/militaryTileGeometry.js` owns PLANAR tile-box clipping
 *   (`clipTileRing` clips a ring to an axis-aligned tile core in
 *   projected space). This module is the SPHERICAL counterpart: polygon ∩
 *   convex-polygon on the sphere, no boxes, no projection.
 * - `src/sources/featureGeometry.js` owns planar polygon ops (shoelace
 *   area, planar point-in-polygon, buffering) — no clipping at all.
 * - `src/data/sphericalPolygonMath.js` (Cycle 16) owns spherical area,
 *   perimeter, centroid, and containment — no clipping.
 * - `src/data/greatCircleMath.js` (Cycle 17) owns segment-level ops
 *   (slerp, densification, arc–arc intersection) — no polygons.
 * - `src/data/geoMath.js` owns point-to-point spherical math — no
 *   polygons.
 *
 * Canonical semantics (standalone — no call sites re-pointed):
 * - Pure: no DOM, no Cesium, no imports. All inputs/outputs are plain
 *   numbers, arrays, and small objects.
 * - Error values: `null` on invalid input — never a throw, never `NaN`.
 *   A ring is invalid when it is not an array of at least three valid
 *   vertices; a vertex is invalid when it is not a finite `[lat, lon]`
 *   pair or `{lat, lon}` object, or its latitude is outside [-90, 90] or
 *   its longitude outside [-180, 180]. Fewer than three distinct
 *   vertices after normalization, adjacent antipodal vertices, or a
 *   non-convex / zero-area clip ring are also invalid.
 * - The subject ring must be simple (non-self-intersecting); like Cycle
 *   16 this is documented, not validated — a self-intersecting subject
 *   yields a signed-sum-style result that is not a meaningful polygon.
 * - The clip ring must be convex (all interior angles < 180°) and is
 *   accepted wound either clockwise or counter-clockwise.
 * - Returns the intersection ring as `[{lat, lon}, ...]` (implicitly
 *   closed, never explicitly closed), `[]` when the polygons are
 *   disjoint or the intersection is degenerate (fewer than three
 *   surviving vertices, or |solid angle| < 1e-15 sr — numerically zero).
 * - Points within tolerance of a clip plane count as inside, so clipping
 *   a polygon against a window that contains it returns the subject's
 *   vertices, and touching at a point or sharing only an edge yields [].
 *
 * @module data/sphericalClipMath
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** Consecutive vertices closer than this (radians) are duplicates. */
const COINCIDENT_EPS = 1e-12;
/** Dot-product tolerance for on-plane / inside-half-plane tests. */
const PLANE_EPS = 1e-12;
/**
 * Dot-product threshold for "strictly off the plane" in the clip ring's
 * nonzero-area check. 1e-12 sits just above float noise (~1e-16) while a
 * genuine triangle only a few metres across still clears it; a ring whose
 * vertices are all within this of a common great circle is treated as
 * zero-area and rejected. (If such a ring ever slipped through, the
 * output degeneracy checks would still reduce it to [].)
 */
const STRICT_EPS = 1e-12;
/** Radians tolerance for on-minor-arc membership. */
const ARC_EPS = 1e-9;
/** Adjacent vertices with dot <= this are treated as antipodal. */
const ANTIPODAL_DOT = -1 + 1e-12;
/** |solid angle| below this (steradians) is a degenerate output. */
const DEGENERATE_SR = 1e-15;
/** Relative tolerance for segment-plane collinearity detection. */
const COLLINEAR_EPS = 1e-12;

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

/** Normalise a vertex: `[lat, lon]` or `{lat, lon}` -> {lat, lon} | null. */
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
  const lat = Math.asin(clamp(v[2], -1, 1)) * R2D;
  // atan2 returns (-180, 180] — already inside [-180, 180].
  const lon = Math.atan2(v[1], v[0]) * R2D;
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
/** Central angle between two unit vectors, radians (chord-length form). */
const angleBetween = (a, b) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return 2 * Math.asin(clamp(Math.hypot(dx, dy, dz) / 2, 0, 1));
};

/**
 * Normalize a ring to unit vectors: validate, drop consecutive
 * duplicates and a trailing duplicate of the first vertex. Returns null
 * for anything that is not a usable ring, including adjacent antipodal
 * vertices (the minor arc between them is ambiguous).
 */
function normalizeRing(ring) {
  if (!Array.isArray(ring)) return null;
  const pts = [];
  for (const p of ring) {
    const ll = asLatLon(p);
    if (!ll) return null;
    pts.push(toVec(ll.lat, ll.lon));
  }
  const deduped = [];
  for (const v of pts) {
    const prev = deduped[deduped.length - 1];
    if (!prev || angleBetween(prev, v) >= COINCIDENT_EPS) deduped.push(v);
  }
  if (
    deduped.length > 1 &&
    angleBetween(deduped[0], deduped[deduped.length - 1]) < COINCIDENT_EPS
  ) {
    deduped.pop();
  }
  if (deduped.length < 3) return null;
  const n = deduped.length;
  for (let i = 0; i < n; i++) {
    if (dot(deduped[i], deduped[(i + 1) % n]) <= ANTIPODAL_DOT) return null;
  }
  return deduped;
}

/**
 * Validate the clip ring as a convex spherical polygon and return its
 * edge plane normals plus the inside-sign (+1 for CCW, -1 for CW).
 * A simple ring is convex iff every vertex lies in the closed interior
 * half-plane of every edge; that test also rejects inconsistent
 * winding. Returns null when the ring is not convex or has zero area.
 */
function clipHalfPlanes(vecs) {
  const n = vecs.length;
  const normals = [];
  for (let i = 0; i < n; i++) {
    // Nonzero: normalizeRing removed duplicate and antipodal adjacents.
    normals.push(norm(cross(vecs[i], vecs[(i + 1) % n])));
  }
  let allNonNeg = true;
  let allNonPos = true;
  let anyStrict = false;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = dot(normals[i], vecs[j]);
      if (d < -PLANE_EPS) allNonNeg = false;
      if (d > PLANE_EPS) allNonPos = false;
      if (Math.abs(d) > STRICT_EPS) anyStrict = true;
    }
  }
  if (!(allNonNeg || allNonPos) || !anyStrict) return null;
  return { normals, sign: allNonNeg ? 1 : -1 };
}

/** True when q lies on the minor arc from s to e (unit vectors). */
function onMinorArc(s, e, q) {
  const total = angleBetween(s, e);
  return angleBetween(q, s) + angleBetween(q, e) <= total + ARC_EPS;
}

/**
 * Intersection of the minor arc s → e with the clip plane of normal n.
 * sIn says which endpoint is inside/on the half-plane (exactly one is,
 * per the caller's straddle test). When the segment is (near-)coplanar
 * with the clip plane — e.g. a subject edge overlapping a clip edge —
 * the parametric limit is the inside endpoint, so return it directly
 * instead of dividing by a ~zero cross product.
 */
function intersectSegmentPlane(s, e, n, sIn) {
  const m = cross(s, e);
  const mMag = Math.hypot(m[0], m[1], m[2]);
  const d = cross(m, n);
  const dMag = Math.hypot(d[0], d[1], d[2]);
  if (dMag <= COLLINEAR_EPS * mMag) return sIn ? s : e;
  const q = [d[0] / dMag, d[1] / dMag, d[2] / dMag];
  if (onMinorArc(s, e, q)) return q;
  return [-q[0], -q[1], -q[2]];
}

/** Sutherland–Hodgman pass: clip a vertex loop against one half-plane. */
function clipAgainstHalfPlane(pts, n, sign) {
  const out = [];
  let s = pts[pts.length - 1];
  let sIn = sign * dot(n, s) >= -PLANE_EPS;
  for (const e of pts) {
    const eIn = sign * dot(n, e) >= -PLANE_EPS;
    if (eIn) {
      if (!sIn) out.push(intersectSegmentPlane(s, e, n, false));
      out.push(e);
    } else if (sIn) {
      out.push(intersectSegmentPlane(s, e, n, true));
    }
    s = e;
    sIn = eIn;
  }
  return out;
}

/**
 * Signed solid angle of a vertex loop (steradians), via fan
 * triangulation from the first vertex with Van Oosterom & Strackee
 * signed triangle solid angles — the Cycle 16 formula, kept local per
 * module convention. Used only to detect degenerate output.
 */
function loopSolidAngle(pts) {
  const a = pts[0];
  let total = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const b = pts[i];
    const c = pts[i + 1];
    const numerator = dot(a, cross(b, c));
    const denominator = 1 + dot(a, b) + dot(b, c) + dot(c, a);
    total += 2 * Math.atan2(numerator, denominator);
  }
  return total;
}

/** Drop consecutive near-duplicate vertices (unit vectors). */
function dedupeLoop(pts) {
  const out = [];
  for (const v of pts) {
    const prev = out[out.length - 1];
    if (!prev || angleBetween(prev, v) >= COINCIDENT_EPS) out.push(v);
  }
  if (
    out.length > 1 &&
    angleBetween(out[0], out[out.length - 1]) < COINCIDENT_EPS
  ) {
    out.pop();
  }
  return out;
}

/**
 * Intersection of a simple spherical polygon with a convex spherical
 * polygon: Sutherland–Hodgman clipping on the sphere (great-circle
 * edges, 3D half-plane tests — antimeridian-safe).
 *
 * @param {Array} subjectRing - simple ring, `[lat, lon]` / `{lat, lon}`
 *   vertices, convex or concave.
 * @param {Array} clipRing - CONVEX ring, `[lat, lon]` / `{lat, lon}`
 *   vertices, either winding.
 * @returns {Array<{lat:number, lon:number}>|null} Intersection ring
 *   (implicitly closed), `[]` when disjoint or degenerate, `null` on
 *   invalid input.
 */
export function clipSphericalPolygon(subjectRing, clipRing) {
  const subject = normalizeRing(subjectRing);
  if (!subject) return null;
  const clipVecs = normalizeRing(clipRing);
  if (!clipVecs) return null;
  const clip = clipHalfPlanes(clipVecs);
  if (!clip) return null;

  let pts = subject;
  for (const n of clip.normals) {
    pts = clipAgainstHalfPlane(pts, n, clip.sign);
    if (pts.length === 0) return [];
  }
  pts = dedupeLoop(pts);
  if (pts.length < 3) return [];
  if (Math.abs(loopSolidAngle(pts)) < DEGENERATE_SR) return [];
  return pts.map(toLatLon);
}
