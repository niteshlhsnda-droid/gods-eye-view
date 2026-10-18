/**
 * Spherical Voronoi diagram (order-1): partition of the sphere into one
 * cell per site, where cell(i) = { x on S^2 : dist(x, p_i) <= dist(x, p_j)
 * for all j }. Each cell is returned as a spherical polygon ring
 * (great-circle edges, lat-first [lat, lon] vertices), index-aligned with
 * the input sites.
 *
 * Construction (definitional, exact in 3D): for unit vectors, spherical
 * distance is monotone in the dot product, so dist(x, p_i) = dist(x, p_j)
 * <=> x . p_i = x . p_j <=> x . (p_i - p_j) = 0. The bisector of two sites
 * is therefore a GREAT CIRCLE: the unit sphere cut by the plane through
 * the origin with normal (p_i - p_j). Cell(i) is the intersection of the
 * sphere with the n-1 closed half-spaces x . n_ij >= 0, where
 * n_ij = normalize(p_i - p_j) -- a spherically convex polygon. Its
 * corners are the pairwise bisector-great-circle intersections
 * +/-normalize(n_ij x n_ik) that satisfy every half-space; they are
 * sorted by azimuth in the tangent plane at p_i, and consecutive corners
 * are joined along their shared bisector great circle with the arc
 * midpoint inserted, so every output edge is an unambiguous MINOR
 * great-circle arc (the sibling modules' ring convention).
 *
 * RESEARCH BASIS:
 * - Na, H.-S., Lee, C.-N. & Cheong, O., "Voronoi diagrams on the
 *   sphere", Computational Geometry 23(2), 2002, pp. 183-194
 *   (doi:10.1016/S0925-7721(02)00077-9): the order-1 spherical Voronoi
 *   diagram; faces are intersections of hemispheres bounded by bisector
 *   great circles (the face/half-sphere characterization is also
 *   restated in Claverol, de las Heras & Huemer 2022, generalizing
 *   Na-Lee-Cheong to order k).
 * - de Berg, M., Cheong, O., van Kreveld, M. & Overmars, M.,
 *   "Computational Geometry: Algorithms and Applications", 3rd ed.,
 *   Springer, 2008, section 7.2: the planar Voronoi cell of p_i is the
 *   common intersection of the half-planes h(p_i, p_j) over j != i.
 *   This module is the direct spherical analogue -- intersection of
 *   hemispheres -- computed definitionally (corners from bisector-pair
 *   intersections, filtered by the half-spaces) rather than via the
 *   book's O(n log n) plane sweep, which has no comparably simple
 *   spherical form. Renka's STRIPACK (ACM TOMS 23(3), 1997, Algorithm
 *   772) takes the other classic route via spherical Delaunay
 *   triangulation; it is related work, not the algorithm used here.
 * - Azimuth ordering in the tangent plane at p_i and the minor-arc edge
 *   convention follow the Cycle 16/17/18 spherical modules' 3D
 *   unit-vector style (no longitude arithmetic, antimeridian-safe).
 *
 * INPUT CONVENTION: sites are [lat, lon] pairs or {lat, lon} objects,
 * latitude first (NOT GeoJSON [lon, lat]), matching geoMath.js and the
 * Cycle 16-19 spherical modules. At least 3 sites; every site finite
 * with |lat| <= 90. Near-duplicate sites (angular separation below
 * ~1.4e-6 rad, about 9 mm on Earth) are rejected -- their bisector
 * plane is numerically undefined.
 *
 * OUTPUT: array of rings, index-aligned with the input (ring[i] is the
 * cell of sites[i]). Each ring is a non-empty list of [lat, lon] pairs
 * in degrees (lon in (-180, 180]); vertices are ordered by increasing
 * azimuth around the site as seen from outside the sphere
 * (counter-clockwise around the site's outward normal). Corners and
 * inserted edge midpoints alternate, so every edge is a minor
 * great-circle arc.
 *
 * Non-overlap with the existing geometry code:
 * - src/data/sphericalPolygonMath.js (Cycle 16) owns area/perimeter/
 *   centroid/containment of a GIVEN polygon -- no site sets, no
 *   partitioning.
 * - src/data/greatCircleMath.js (Cycle 17) owns segment-level ops
 *   (slerp, densification, arc-arc intersection) -- no polygons.
 * - src/data/sphericalClipMath.js (Cycle 18) intersects a subject ring
 *   with a CONVEX polygon window (Sutherland-Hodgman) -- it cannot
 *   build a Voronoi diagram: the n-1 half-spaces here are hemispheres,
 *   which are not polygons, and it computes one intersection, not an
 *   n-way partition.
 * - src/data/sphericalBooleanMath.js (Cycle 19) unions/differences
 *   GIVEN polygons (Weiler-Atherton) -- no site-set partitioning.
 * - src/data/geoMath.js owns point-to-point spherical math -- no
 *   polygons at all.
 *
 * Canonical semantics (standalone -- no call sites re-pointed):
 * - Pure: zero imports, no DOM, no network, no randomness.
 * - Null on invalid input, never throws, never returns NaN: every
 *   arithmetic path is guarded (zero-length normals, parallel bisector
 *   planes, empty corner sets, ambiguous edges all yield null).
 * - Worst-case complexity is O(n^4) (per cell: bisector pairs x
 *   half-space filter); exact and practical for site counts up to ~100.
 *   For thousands of sites, prefer a Delaunay-based builder (Renka).
 * - Degenerate inputs that survive validation but defeat the tolerances
 *   (e.g. pathologically clustered sites) yield null rather than a
 *   corrupt ring.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const TAU = Math.PI * 2;

// Tolerances (see header):
const DUP_DOT = 1 - 1e-12; // minimum site separation, as a dot product
const PARALLEL_CROSS = 1e-12; // |n1 x n2| below this: parallel bisectors
const PLANE_TOL = 1e-9; // half-space satisfaction / bisector tightness
const VERTEX_DUP_DOT = 1 - 1e-12; // corner dedup, as a dot product
const FRAME_CROSS = 1e-12; // local-frame degeneracy threshold

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 0)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
};

const toVec = (latDeg, lonDeg) => {
  const la = latDeg * D2R;
  const lo = lonDeg * D2R;
  return [
    Math.cos(la) * Math.cos(lo),
    Math.cos(la) * Math.sin(lo),
    Math.sin(la),
  ];
};

const toLatLon = (v) => {
  const z = Math.min(1, Math.max(-1, v[2]));
  let lon = Math.atan2(v[1], v[0]) * R2D;
  // atan2(-0, x<0) is -PI: fold the -180 artifact to +180 so output
  // always honors the documented (-180, 180] range.
  if (lon <= -180) lon += 360;
  return [Math.asin(z) * R2D, lon];
};

const readSite = (s) => {
  if (Array.isArray(s)) {
    if (s.length < 2) return null;
    return [s[0], s[1]];
  }
  if (s !== null && typeof s === 'object') return [s.lat, s.lon];
  return null;
};

const normalizeSites = (sites) => {
  if (!Array.isArray(sites) || sites.length < 3) return null;
  const pts = [];
  for (const s of sites) {
    const pair = readSite(s);
    if (!pair) return null;
    const [lat, lon] = pair;
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90
    ) {
      return null;
    }
    pts.push(toVec(lat, lon));
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (dot(pts[i], pts[j]) > DUP_DOT) return null;
    }
  }
  return pts;
};

const buildCell = (pts, i) => {
  const n = pts.length;
  const p = pts[i];

  // Bisector plane normals n_ij = normalize(p_i - p_j); null at j == i.
  const normals = new Array(n).fill(null);
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const d = [p[0] - pts[j][0], p[1] - pts[j][1], p[2] - pts[j][2]];
    const u = norm(d);
    if (!u) return null; // unreachable: duplicates rejected during validation
    normals[j] = u;
  }

  const insideAll = (v) => {
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (dot(v, normals[j]) < -PLANE_TOL) return false;
    }
    return true;
  };

  // Corner candidates: pairwise bisector-great-circle intersections that
  // satisfy every half-space.
  const verts = [];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    for (let k = j + 1; k < n; k++) {
      if (k === i) continue;
      const c = cross(normals[j], normals[k]);
      const s = Math.hypot(c[0], c[1], c[2]);
      if (s < PARALLEL_CROSS) continue; // parallel bisectors: no corner
      const ux = c[0] / s;
      const uy = c[1] / s;
      const uz = c[2] / s;
      for (let sgn = 1; sgn >= -1; sgn -= 2) {
        const v = [sgn * ux, sgn * uy, sgn * uz];
        if (!insideAll(v)) continue;
        let dup = false;
        for (const u of verts) {
          if (dot(v, u) > VERTEX_DUP_DOT) {
            dup = true;
            break;
          }
        }
        if (!dup) verts.push(v);
      }
    }
  }
  if (verts.length === 0) return null;

  // Local tangent frame at p, right-handed: e x f = p.
  let e = cross(p, [0, 0, 1]);
  let el = Math.hypot(e[0], e[1], e[2]);
  if (el < FRAME_CROSS) {
    e = cross(p, [1, 0, 0]);
    el = Math.hypot(e[0], e[1], e[2]);
    if (el < FRAME_CROSS) return null; // unreachable: |p| == 1
  }
  e = [e[0] / el, e[1] / el, e[2] / el];
  const f = cross(p, e);
  const azimuth = (v) => {
    const d = dot(v, p);
    const tx = v[0] - d * p[0];
    const ty = v[1] - d * p[1];
    const tz = v[2] - d * p[2];
    return Math.atan2(
      tx * f[0] + ty * f[1] + tz * f[2],
      tx * e[0] + ty * e[1] + tz * e[2],
    );
  };

  verts.sort((a, b) => azimuth(a) - azimuth(b));

  // Bisector indices each corner lies on (within tolerance).
  const tight = verts.map((v) => {
    const s = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (Math.abs(dot(v, normals[j])) < PLANE_TOL) s.push(j);
    }
    return s;
  });

  // Midpoint of the boundary arc from corner a to corner b. The arc lies
  // on a bisector great circle shared by both corners; of the two arc
  // midpoints (minor/major), exactly one is inside the cell, and in
  // degenerate cases (antipodal corners, several shared bisectors) the
  // azimuth-betweenness test selects the geometrically correct one.
  const edgeMidpoint = (a, b, tA, tB) => {
    const azA = azimuth(a);
    let span = azimuth(b) - azA;
    if (span <= 0) span += TAU;
    let best = null;
    let count = 0;
    for (const j of tA) {
      if (!tB.includes(j)) continue;
      const w = cross(normals[j], a);
      const wl = Math.hypot(w[0], w[1], w[2]);
      if (wl < FRAME_CROSS) continue;
      const wx = w[0] / wl;
      const wy = w[1] / wl;
      const wz = w[2] / wl;
      const theta = Math.atan2(b[0] * wx + b[1] * wy + b[2] * wz, dot(b, a));
      const ch = Math.cos(theta / 2);
      const sh = Math.sin(theta / 2);
      const mx = ch * a[0] + sh * wx;
      const my = ch * a[1] + sh * wy;
      const mz = ch * a[2] + sh * wz;
      for (const sgn of [1, -1]) {
        const m = [sgn * mx, sgn * my, sgn * mz];
        if (!insideAll(m)) continue;
        let rel = azimuth(m) - azA;
        if (rel <= 0) rel += TAU;
        if (rel > 0 && rel < span) {
          best = m;
          count += 1;
        }
      }
    }
    return count === 1 ? best : null;
  };

  const ring = [];
  const m = verts.length;
  for (let k = 0; k < m; k++) {
    const a = verts[k];
    const b = verts[(k + 1) % m];
    const mid = edgeMidpoint(a, b, tight[k], tight[(k + 1) % m]);
    if (!mid) return null;
    ring.push(toLatLon(a), toLatLon(mid));
  }
  return ring;
};

/**
 * Compute the order-1 spherical Voronoi diagram of the given sites.
 *
 * @param {Array<[number, number] | {lat: number, lon: number}>} sites
 *   at least 3 sites, latitude first.
 * @returns {Array<Array<[number, number]>> | null} one ring per site,
 *   index-aligned with the input; null on invalid or degenerate input.
 */
export function sphericalVoronoi(sites) {
  const pts = normalizeSites(sites);
  if (!pts) return null;
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const ring = buildCell(pts, i);
    if (!ring) return null;
    rings.push(ring);
  }
  return rings;
}
