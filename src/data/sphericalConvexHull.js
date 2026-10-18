/**
 * Spherical convex hull: the smallest spherically-convex region containing
 * a set of lat/lon points, as an open ring of `{lat, lon}` vertices joined
 * by minor great-circle arcs.
 *
 * This is the last genuinely-new primitive in the sphere-math line:
 * `geoMath.js` owns point-to-point math (distance, bearing, midpoint),
 * `greatCircleMath.js` owns segment math (slerp, densification, arc-arc
 * intersection), `sphericalClipMath.js` owns Sutherland-Hodgman clipping
 * against a convex window, `sphericalBooleanMath.js` owns Weiler-Atherton
 * union/difference, and `sphericalPolygonMath.js` owns ring area/perimeter/
 * containment. None of them computes a hull; no pivot was needed.
 *
 * RESEARCH BASIS (standard computational geometry):
 * - Gift wrapping (Jarvis march): R. A. Jarvis, "On the identification of
 *   the convex hull of a finite set of points in the plane", Information
 *   Processing Letters 2(1), 1973, pp. 18-21. The march is run directly
 *   on the sphere with 3D vector tests, which is exactly planar gift
 *   wrapping under gnomonic projection: for points inside an open
 *   hemisphere with pole u, the map p -> p / (p . u) sends great-circle
 *   arcs to straight segments and preserves the "left of a directed edge"
 *   sign ((a x b) . d keeps its sign under positive scaling), so the
 *   spherical walk enumerates the planar hull vertices in order. The
 *   3D formulation is used because it is antimeridian-safe by
 *   construction -- no longitude arithmetic appears anywhere.
 * - Hemisphere containment is decided exactly via the spherical 1-center
 *   problem: points lie in some open hemisphere iff
 *   max_{|u|=1} min_p (u . p) > 0. The optimum is attained at a cap
 *   determined by 1, 2, or 3 points (the spherical analogue of the
 *   smallest-enclosing-circle theorem), so evaluating the min-dot over
 *   the finite candidate set {p_i} U {normalize(p_i + p_j)} U
 *   {normalize((p_j - p_i) x (p_k - p_i))} (both signs for the pair and
 *   triple caps) certifies containment exactly: a positive witness proves
 *   containment, and a non-positive maximum proves none exists.
 *
 * INPUT CONVENTION: latitude first (degrees), matching `geoMath.js`.
 * Points accept `[lat, lon]` pairs or `{lat, lon}` objects. The returned
 * ring is open (the closing edge back to the first vertex is implied),
 * ordered counter-clockwise (interior on the left of every directed
 * edge), and starts at a deterministic hull vertex (the input point
 * minimizing the dot product with the winning hemisphere pole).
 * Longitude is wrapped to [-180, 180].
 *
 * Canonical semantics (standalone -- no call sites re-pointed):
 * - Pure: no DOM, no Cesium, no imports.
 * - Error values: `null` on invalid input -- never a throw, never `NaN`.
 *   A point is invalid when non-finite, latitude outside [-90, 90], or
 *   longitude outside [-180, 180]. A non-array or empty input is `null`.
 * - Degenerate but valid inputs return documented non-null results:
 *   one distinct point -> `[point]`; two distinct points, or three or
 *   more distinct points collinear on a great circle spanning less than
 *   180 degrees -> the two extreme endpoints `[e1, e2]` (a segment;
 *   densify with `greatCircleMath.js` if arc vertices are needed).
 * - `null` (not `[]`) means "no representable hull": the points are not
 *   contained in any open hemisphere -- antipodal pairs, full
 *   tetrahedron/octahedron vertex sets, great-circle spans of >= 180
 *   degrees -- so the true spherical hull would be the whole sphere,
 *   which a ring cannot represent. Fail closed.
 * - Complexity is O(n^4) worst case (triple-cap candidates in the
 *   hemisphere test); intended for small feature point sets.
 *
 * @module data/sphericalConvexHull
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** Angle below which two points count as coincident (radians, ~6 nm). */
const COINCIDENT_EPS = 1e-12;
/** "Left of edge" tolerance in dot-product units (~6 mm on the surface). */
const LEFT_EPS = 1e-9;
/** Hemisphere margin below which containment is rejected. */
const MARGIN_EPS = 1e-9;
/** Below this cross-product length, points are coincident or antipodal. */
const DEGENERATE_CROSS_EPS = 1e-12;

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

/** Normalise a point: `[lat, lon]` or `{lat, lon}` -> {lat, lon} | null. */
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

/** Wrap longitude to [-180, 180]. */
function wrapLon(lon) {
  let w = lon % 360;
  if (w > 180) w -= 360;
  else if (w < -180) w += 360;
  return w === 0 ? 0 : w;
}

/** Unit 3D vector for a lat/lon point (x: lon 0, y: lon 90E, z: north pole). */
function toVec(lat, lon) {
  const la = lat * D2R;
  const lo = lon * D2R;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.sqrt(dot(a, a));
/** Central angle between two unit vectors, radians. */
const angleBetween = (a, b) =>
  Math.atan2(len(cross(a, b)), clamp(dot(a, b), -1, 1));

/**
 * Best open hemisphere containing the points: largest over unit poles u
 * of the smallest dot product u . p (spherical 1-center; the optimum cap
 * is determined by 1, 2, or 3 points -- see module header).
 * @returns {{margin: number, pole: number[]}|null} The winning pole and
 *   its margin, or `null` when no open hemisphere contains the set.
 */
function hemispherePole(vecs) {
  const n = vecs.length;
  let best = -Infinity;
  let bestU = null;
  const consider = (u) => {
    let m = Infinity;
    for (let k = 0; k < n; k += 1) {
      const d = dot(u, vecs[k].v);
      if (d < m) m = d;
    }
    if (m > best) {
      best = m;
      bestU = u;
    }
  };
  for (let i = 0; i < n; i += 1) {
    consider(vecs[i].v);
    for (let j = i + 1; j < n; j += 1) {
      const s = add(vecs[i].v, vecs[j].v);
      const l = len(s);
      if (l > DEGENERATE_CROSS_EPS) {
        const u = scale(s, 1 / l);
        consider(u);
        consider(scale(u, -1));
      }
      for (let k = j + 1; k < n; k += 1) {
        const cr = cross(sub(vecs[j].v, vecs[i].v), sub(vecs[k].v, vecs[i].v));
        const l3 = len(cr);
        if (l3 > DEGENERATE_CROSS_EPS) {
          const u = scale(cr, 1 / l3);
          consider(u);
          consider(scale(u, -1));
        }
      }
    }
  }
  return best > MARGIN_EPS ? { margin: best, pole: bestU } : null;
}

/**
 * Spherical convex hull of a point set.
 * @param {unknown} points Array of `[lat, lon]` pairs or `{lat, lon}`
 *   objects.
 * @returns {Array<{lat: number, lon: number}>|null} Open CCW ring of hull
 *   vertices (great-circle edges, closing edge implied), `[point]` for a
 *   single distinct point, `[e1, e2]` for a segment / sub-180-degree
 *   collinear set, or `null` for invalid input or a point set no open
 *   hemisphere contains.
 */
export function sphericalConvexHull(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  // Normalise + dedupe (coincident within COINCIDENT_EPS), keeping the
  // first occurrence's lat/lon for output fidelity.
  const vecs = [];
  for (const p of points) {
    const ll = asLatLon(p);
    if (!ll) return null;
    const v = toVec(ll.lat, ll.lon);
    let dup = false;
    for (const w of vecs) {
      if (angleBetween(v, w.v) < COINCIDENT_EPS) {
        dup = true;
        break;
      }
    }
    if (!dup) vecs.push({ v, lat: ll.lat, lon: wrapLon(ll.lon) });
  }

  const n = vecs.length;
  if (n === 1) return [{ lat: vecs[0].lat, lon: vecs[0].lon }];

  // No open hemisphere contains the set (antipodal pairs, full
  // tetrahedron/octahedron vertex sets, >= 180-degree great-circle
  // spans): the true hull would be the whole sphere -- fail closed.
  // Runs before the segment cases so an antipodal pair -> null.
  const hs = hemispherePole(vecs);
  if (!hs) return null;

  if (n === 2) {
    return [
      { lat: vecs[0].lat, lon: vecs[0].lon },
      { lat: vecs[1].lat, lon: vecs[1].lon },
    ];
  }

  // All points on one great circle: the hull is the minor-arc segment
  // between the extreme pair (the >= 180-degree case already returned
  // null above via the hemisphere test).
  const axis = cross(vecs[0].v, vecs[1].v);
  let collinear = len(axis) > DEGENERATE_CROSS_EPS;
  if (collinear) {
    const normal = scale(axis, 1 / len(axis));
    for (let i = 2; i < n; i += 1) {
      if (Math.abs(dot(normal, vecs[i].v)) > LEFT_EPS) {
        collinear = false;
        break;
      }
    }
  }
  if (collinear) {
    let bi = 0;
    let bj = 1;
    let bestAng = -1;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = angleBetween(vecs[i].v, vecs[j].v);
        if (a > bestAng) {
          bestAng = a;
          bi = i;
          bj = j;
        }
      }
    }
    return [
      { lat: vecs[bi].lat, lon: vecs[bi].lon },
      { lat: vecs[bj].lat, lon: vecs[bj].lon },
    ];
  }

  // Gift wrap (Jarvis march) on the sphere. Edge a -> b is a CCW hull
  // edge iff every point lies left of (or on) the directed great-circle
  // arc, i.e. ((a x b) . d) >= 0; ties along one edge resolve to the
  // farthest point so collinear edge points are skipped.
  //
  // Start vertex: the point minimizing (pole . p) for the winning
  // hemisphere pole. This is provably a hull vertex: if it were not, it
  // would be a spherical convex combination normalize(sum l_q q) of
  // other hull vertices q, but then
  //   pole.p = sum l_q (pole.q) / ||sum l_q q||
  //          >= (pole.p) / ||sum l_q q|| >= pole.p > 0,
  // forcing ||sum l_q q|| = 1 and hence all q equal -- contradiction.
  // (The northernmost point is NOT safe: a high-latitude point can sit
  // strictly inside the hull cap while still being a 3D-hull vertex.)
  let start = 0;
  let startDot = Infinity;
  for (let i = 0; i < n; i += 1) {
    const d = dot(hs.pole, vecs[i].v);
    if (d < startDot) {
      startDot = d;
      start = i;
    }
  }
  const ring = [start];
  let cur = start;
  let prev = -1;
  let closed = false;
  for (let step = 0; step < n + 1; step += 1) {
    const va = vecs[cur].v;
    let best = -1;
    let bestAng = -1;
    for (let c = 0; c < n; c += 1) {
      if (c === cur || c === prev) continue;
      const vc = vecs[c].v;
      const cr = cross(va, vc);
      const l = len(cr);
      // Coincident (deduped above) or antipodal to cur: cannot be a
      // hull edge endpoint -- the hemisphere test already excluded
      // antipodal pairs from the set.
      if (l < DEGENERATE_CROSS_EPS) continue;
      const normal = scale(cr, 1 / l);
      let ok = true;
      for (let d = 0; d < n; d += 1) {
        if (dot(normal, vecs[d].v) < -LEFT_EPS) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const ang = Math.atan2(l, clamp(dot(va, vc), -1, 1));
      if (ang > bestAng) {
        bestAng = ang;
        best = c;
      }
    }
    if (best < 0) return null;
    if (best === start) {
      closed = true;
      break;
    }
    // Defensive: a repeated non-start vertex means the walk cycled
    // without closing -- cannot happen for hemisphere-contained input.
    if (ring.includes(best)) return null;
    ring.push(best);
    prev = cur;
    cur = best;
  }
  // Walk did not close within n + 1 steps -- fail closed.
  if (!closed) return null;
  if (ring.length < 3) return null;
  return ring.map((i) => ({ lat: vecs[i].lat, lon: vecs[i].lon }));
}
