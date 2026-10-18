/**
 * Spherical polygon booleans: UNION and DIFFERENCE of two simple spherical
 * polygons (great-circle edges) via the Weiler–Atherton traversal adapted
 * to the sphere in 3D.
 *
 * The classical Weiler–Atherton algorithm inserts every subject/clip edge
 * intersection as a linked vertex in both rings, then walks the augmented
 * rings: UNION follows subject arcs outside the clip and clip arcs outside
 * the subject; DIFFERENCE (A − B) follows A arcs outside B and B arcs
 * inside A, switching rings at each intersection. All inside/outside tests
 * here are 3D (signed angle sums and great-circle / plane arithmetic on
 * unit vectors), so the walk is exact on the sphere and antimeridian-safe
 * with no longitude arithmetic, and it needs no winding assumptions.
 *
 * RESEARCH BASIS:
 * - Weiler, K. & Atherton, P., "Hidden Surface Removal Using Polygon Area
 *   Sorting", SIGGRAPH 1977: the boolean-op traversal — insert pairwise
 *   edge intersections as linked ("twin") vertices, then walk the
 *   augmented rings following the arcs that bound the result region,
 *   switching rings at intersections. UNION and DIFFERENCE differ only in
 *   which arcs count as result boundary (A-arcs outside B in both; B-arcs
 *   outside A for union, inside A for difference). Entering/exiting is
 *   evaluated here per directed arc with a 3D midpoint-in-polygon test
 *   instead of planar point-in-polygon, which keeps the walk
 *   winding-agnostic and antimeridian-safe.
 * - Great-circle / plane intersection via plane normals, following Chris
 *   Veness's "Intersection of two paths"
 *   (movable-type.co.uk/scripts/latlong.html): each great circle is the
 *   sphere ∩ a plane through the origin, so two minor arcs meet at
 *   ±(mA × mB) (mA, mB the edge plane normals), keeping the antipode that
 *   lies on both minor arcs.
 * - Point-in-polygon on the sphere via the signed angle sum (spherical
 *   winding number): robust for simple rings of any size, including
 *   hemispheres — where vertex-fan solid angles degenerate (every fan
 *   triangle is flat, so the sign comes out of floating-point residue;
 *   verified by probe). The Van Oosterom & Strackee fan is used here only
 *   for |solid angle| magnitude checks, never for orientation.
 * - Coincident (collinear-overlapping) boundary segments are resolved with
 *   an explicit side test: polygons on opposite sides of the shared arc
 *   make it interior (dropped for union); polygons on the same side make
 *   it result boundary (one copy kept). This is the degenerate-
 *   intersection regime that planar boolean codes handle with fragile
 *   labelling rules; the side test keeps it deterministic in 3D.
 * - PIVOT NOTE (Cycle 19, gemini lane): the brief positioned this as the
 *   follow-up to Cycle 18's Sutherland–Hodgman module (intersection
 *   against a convex window only; Greiner–Hormann evaluated and rejected
 *   there for needing polygon sets). Weiler–Atherton IS buildable in one
 *   cycle because its output is naturally a ring LIST: UNION of disjoint
 *   polygons is two rings and DIFFERENCE can produce a holed ring — both
 *   representable without breaking the null-on-invalid contract. The
 *   single-ring contract is therefore intentionally NOT kept: these
 *   functions return an array of rings (possibly empty).
 *
 * INPUT CONVENTION (read this first): vertices are `[lat, lon]` pairs or
 * `{lat, lon}` objects — latitude first, matching `geoMath.js` argument
 * order and the Cycle 16/17/18 modules. Edges are MINOR great-circle arcs;
 * a ring with adjacent antipodal vertices is rejected (the minor arc is
 * ambiguous there). Rings do NOT need to be explicitly closed: the
 * closing edge is implied, and consecutive duplicates (plus a trailing
 * duplicate of the first vertex) are dropped during normalization.
 *
 * CONTRACT:
 * - Pure: no DOM, no Cesium, no imports. All inputs/outputs are plain
 *   numbers, arrays, and small objects.
 * - `null` on invalid input — never a throw, never `NaN`. A ring is
 *   invalid when it is not an array of at least three valid vertices; a
 *   vertex is invalid when it is not a finite `[lat, lon]` pair or
 *   `{lat, lon}` object, or its latitude is outside [-90, 90] or its
 *   longitude outside [-180, 180]. Fewer than three distinct vertices
 *   after normalization, adjacent antipodal vertices, or a numerically
 *   zero-area ring (|solid angle| < 1e-15 sr) are also invalid. (Cycle 16
 *   treats a degenerate ring as valid with area 0; for booleans a
 *   zero-area input has no meaningful result, so it is invalid here —
 *   matching Cycle 18's zero-area-clip rule.)
 * - Both rings must be simple (non-self-intersecting); like Cycles 16/18
 *   this is documented, not validated.
 * - The interior of a ring is the region to the LEFT of its directed
 *   edges. Inputs are used as-given (either winding); outputs are
 *   canonicalized: outer rings are positive-wound (interior on left),
 *   hole rings negative-wound. A ring strictly contained in another output
 *   ring is a hole.
 * - Intended regions are at most a hemisphere; results are exact in that
 *   domain. (A ring and its vertex-reversed twin share a boundary curve
 *   and are treated as the same region by the identity fast-path;
 *   whole-sphere-complement semantics for small clockwise rings are
 *   outside the intended domain.)
 * - Returns an array of rings, each `[{lat, lon}, ...]` (implicitly
 *   closed, never explicitly closed). `[]` when the result is empty
 *   (e.g. A − B with A inside B) or degenerate. UNION of disjoint
 *   polygons returns both rings (the correct set representation — `[]`
 *   would silently drop data); DIFFERENCE of disjoint polygons returns
 *   the first ring.
 *
 * Non-overlap with the existing geometry code:
 * - `src/data/sphericalClipMath.js` (Cycle 18) owns INTERSECTION, and only
 *   against a CONVEX clip window (Sutherland–Hodgman). This module owns
 *   UNION and DIFFERENCE with both polygons arbitrary simple rings
 *   (Weiler–Atherton) — the documented follow-up.
 * - `src/data/sphericalPolygonMath.js` (Cycle 16) owns spherical area,
 *   perimeter, centroid, and containment — no booleans.
 * - `src/data/greatCircleMath.js` (Cycle 17) owns segment-level ops —
 *   no polygons.
 * - `src/sources/militaryTileGeometry.js` owns PLANAR tile-box clipping;
 *   `src/sources/featureGeometry.js` owns planar polygon ops — no
 *   spherical booleans anywhere.
 *
 * @module data/sphericalBooleanMath
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** Consecutive vertices closer than this (radians) are duplicates. */
const COINCIDENT_EPS = 1e-12;
/** Radians tolerance for on-minor-arc membership. */
const ARC_EPS = 1e-9;
/** Nodes closer than this (radians) are the same intersection. */
const TWIN_EPS = 1e-9;
/** Adjacent vertices with dot <= this are treated as antipodal. */
const ANTIPODAL_DOT = -1 + 1e-12;
/** |solid angle| below this (steradians) is a degenerate ring. */
const DEGENERATE_SR = 1e-15;
/** Relative tolerance for edge-plane parallelism (collinear edges). */
const COLLINEAR_EPS = 1e-12;
/** Boundary margin (radians) for strict inside/outside tests. */
const STRICT_EPS = 1e-9;
/** Offset (radians) for interior-side sample points. */
const SAMPLE_OFF = 1e-7;

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
const vlen = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => {
  const n = vlen(v);
  return [v[0] / n, v[1] / n, v[2] / n];
};
/** Unit midpoint of two non-antipodal unit vectors. */
const normMid = (a, b) => norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
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

/** True when q lies on the minor arc from s to e (unit vectors). */
function onMinorArc(s, e, q, eps) {
  const total = angleBetween(s, e);
  return angleBetween(q, s) + angleBetween(q, e) <= total + eps;
}

/**
 * Signed angle sum (spherical winding number) of the ring around p.
 * +2π when p is strictly inside a positive-wound ring, -2π for a
 * negative-wound one, ~0 outside. Robust for rings of any size — unlike
 * vertex-fan triangulation it never builds degenerate flat triangles.
 * Returns NaN when p is at (or antipodal to) a vertex.
 */
function signedAngleSum(p, vecs) {
  let sum = 0;
  const n = vecs.length;
  for (let i = 0; i < n; i++) {
    const a = vecs[i];
    const b = vecs[(i + 1) % n];
    const da = dot(p, a);
    const db = dot(p, b);
    if (Math.abs(da) > 1 - 1e-10 || Math.abs(db) > 1 - 1e-10) return NaN;
    const ax = a[0] - p[0] * da;
    const ay = a[1] - p[1] * da;
    const az = a[2] - p[2] * da;
    const bx = b[0] - p[0] * db;
    const by = b[1] - p[1] * db;
    const bz = b[2] - p[2] * db;
    const al = Math.hypot(ax, ay, az);
    const bl = Math.hypot(bx, by, bz);
    if (al < 1e-15 || bl < 1e-15) return NaN;
    const ux = ax / al;
    const uy = ay / al;
    const uz = az / al;
    const vx = bx / bl;
    const vy = by / bl;
    const vz = bz / bl;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    sum += Math.atan2(
      p[0] * cx + p[1] * cy + p[2] * cz,
      ux * vx + uy * vy + uz * vz,
    );
  }
  return sum;
}

/** Angular distance from p to the minor arc a → b. */
function distToArc(p, a, b) {
  const n = norm(cross(a, b));
  const d = dot(n, p);
  const qx = p[0] - n[0] * d;
  const qy = p[1] - n[1] * d;
  const qz = p[2] - n[2] * d;
  const ql = Math.hypot(qx, qy, qz);
  if (ql < 1e-15) return Math.PI / 2;
  const q = [qx / ql, qy / ql, qz / ql];
  if (onMinorArc(a, b, q, ARC_EPS)) return angleBetween(p, q);
  return Math.min(angleBetween(p, a), angleBetween(p, b));
}

/** True when p is further than STRICT_EPS from every ring edge. */
function clearOfBoundary(p, vecs) {
  const n = vecs.length;
  for (let i = 0; i < n; i++) {
    if (distToArc(p, vecs[i], vecs[(i + 1) % n]) < STRICT_EPS) return false;
  }
  return true;
}

/**
 * Winding-aware strict containment: p is strictly inside the ring's
 * left-of-edge interior.
 */
function strictlyInside(p, vecs) {
  if (!clearOfBoundary(p, vecs)) return false;
  const s = signedAngleSum(p, vecs);
  return Number.isFinite(s) && s > Math.PI;
}

/**
 * Winding-agnostic strict containment: p is strictly inside the ring's
 * enclosed region (either winding). Ambiguous only for exactly-
 * hemisphere rings, which never need it here.
 */
function enclosedInside(p, vecs) {
  if (!clearOfBoundary(p, vecs)) return false;
  const s = signedAngleSum(p, vecs);
  return Number.isFinite(s) && Math.abs(s) > Math.PI;
}

/**
 * Signed solid angle of a vertex loop (steradians), via fan
 * triangulation from the first vertex with Van Oosterom & Strackee
 * signed triangle solid angles — the Cycle 16 formula, kept local per
 * module convention. Used ONLY for |solid angle| magnitude checks
 * (degenerate inputs/outputs); never for orientation, whose sign is
 * numerically fragile for hemisphere-scale rings.
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

/** True when two vec-rings hold the same vertices up to rotation/reversal. */
function ringsEqualCyclic(a, b) {
  if (a.length !== b.length) return false;
  const n = a.length;
  const close = (u, v) => angleBetween(u, v) < TWIN_EPS;
  for (let dir = 0; dir < 2; dir++) {
    for (let shift = 0; shift < n; shift++) {
      let ok = true;
      for (let i = 0; i < n; i++) {
        const j = dir === 0 ? (i + shift) % n : (shift - i + 2 * n) % n;
        if (!close(a[i], b[j])) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

/**
 * A point strictly inside the ring's left-of-edge interior, or null for
 * pathological (sub-mm-thin) rings. Probes the left side of each edge in
 * turn — the interior side for a positive-wound ring, the exterior for a
 * negative-wound one (in which case the probe fails and we try the next
 * edge; a negative-wound ring still yields a sample via its right side).
 */
function interiorSample(vecs) {
  const n = vecs.length;
  for (let i = 0; i < n; i++) {
    const s = vecs[i];
    const e = vecs[(i + 1) % n];
    const nhat = norm(cross(s, e));
    const m = normMid(s, e);
    for (const sgn of [1, -1]) {
      const p = norm([
        m[0] + nhat[0] * SAMPLE_OFF * sgn,
        m[1] + nhat[1] * SAMPLE_OFF * sgn,
        m[2] + nhat[2] * SAMPLE_OFF * sgn,
      ]);
      if (strictlyInside(p, vecs)) return p;
    }
  }
  return null;
}

/**
 * Return the ring positive-wound (interior on left), reversing when
 * needed. Orientation is decided with the robust angle sum at a point
 * just left of the first edge — never with the fan-triangulation sign.
 */
function ensurePositiveWinding(vecs) {
  const s = vecs[0];
  const e = vecs[1];
  const nhat = norm(cross(s, e));
  const m = normMid(s, e);
  const p = norm([
    m[0] + nhat[0] * SAMPLE_OFF,
    m[1] + nhat[1] * SAMPLE_OFF,
    m[2] + nhat[2] * SAMPLE_OFF,
  ]);
  // p is just left of the first edge: inside the enclosed region iff
  // the ring is already positive-wound.
  if (enclosedInside(p, vecs)) return vecs;
  return [...vecs].reverse();
}

/** Return the ring negative-wound (for hole rings). */
function ensureNegativeWinding(vecs) {
  return [...ensurePositiveWinding(vecs)].reverse();
}

/**
 * Intersection of minor arc s → e with minor arc t → u.
 * Returns {point} for a point intersection, {overlap:[...]} when the arcs
 * share a great circle with a nonzero-length overlap (the overlap's
 * endpoint set, for edge splitting), or null.
 */
function edgePairHit(s, e, t, u) {
  const mA = cross(s, e);
  const mB = cross(t, u);
  const mAm = vlen(mA);
  const mBm = vlen(mB);
  const d = cross(mA, mB);
  const dMag = vlen(d);
  if (dMag <= COLLINEAR_EPS * mAm * mBm) {
    // Same great circle (planes through the origin coincide).
    const pts = [];
    if (onMinorArc(s, e, t, ARC_EPS)) pts.push(t);
    if (onMinorArc(s, e, u, ARC_EPS)) pts.push(u);
    if (onMinorArc(t, u, s, ARC_EPS)) pts.push(s);
    if (onMinorArc(t, u, e, ARC_EPS)) pts.push(e);
    const uniq = [];
    for (const p of pts) {
      if (!uniq.some((q) => angleBetween(p, q) < TWIN_EPS)) uniq.push(p);
    }
    if (uniq.length >= 2) return { overlap: uniq };
    if (uniq.length === 1) return { point: uniq[0] };
    return null;
  }
  const q = [d[0] / dMag, d[1] / dMag, d[2] / dMag];
  if (onMinorArc(s, e, q, ARC_EPS) && onMinorArc(t, u, q, ARC_EPS)) {
    return { point: q };
  }
  const nq = [-q[0], -q[1], -q[2]];
  if (onMinorArc(s, e, nq, ARC_EPS) && onMinorArc(t, u, nq, ARC_EPS)) {
    return { point: nq };
  }
  return null;
}

/**
 * Build the augmented node list for one polygon: original vertices plus
 * intersection points spliced into their edges in arc order. Nodes are
 * {v, twin, coincNext, coincPrev}; twin links the same geometric point
 * across the two polygons (filled in later by coincidence).
 */
function buildList(vecs, ptsMap) {
  const n = vecs.length;
  const nodes = vecs.map((v) => ({
    v,
    twin: null,
    coincNext: false,
    coincPrev: false,
  }));
  const out = [];
  for (let e = 0; e < n; e++) {
    out.push(nodes[e]);
    const s = vecs[e];
    const en = vecs[(e + 1) % n];
    const total = angleBetween(s, en);
    const pts = ptsMap.get(e) || [];
    const sorted = pts
      .map((p) => ({ p, d: angleBetween(s, p) }))
      .filter((o) => o.d > TWIN_EPS && total - o.d > TWIN_EPS)
      .sort((x, y) => x.d - y.d);
    let prev = null;
    for (const o of sorted) {
      if (prev && angleBetween(prev, o.p) < TWIN_EPS) continue;
      prev = o.p;
      out.push({ v: o.p, twin: null, coincNext: false, coincPrev: false });
    }
  }
  return out;
}

/**
 * Decide the fate of a coincident directed-edge pair (shared boundary
 * segment, nonzero length) via the side test: sample just left and right
 * of the shared arc and check strict containment in each polygon.
 * - UNION: same side → the arc is result boundary — keep A's copy, shadow
 *   B's. Opposite sides → interior to the union — skip both.
 * - DIFFERENCE (A − B): same side → the arc is not on A−B's boundary —
 *   skip both. Opposite sides → keep A's copy, shadow B's.
 * An undetermined side (sub-mm slivers only) keeps A's copy: the
 * boundary-preserving default, documented here.
 */
function disposeCoincidentEdge(LA, i, LB, j, aVecs, bVecs, mode) {
  const a1 = LA[i].v;
  const a2 = LA[(i + 1) % LA.length].v;
  const m = normMid(a1, a2);
  const nhat = norm(cross(a1, a2));
  const L = norm([
    m[0] + nhat[0] * SAMPLE_OFF,
    m[1] + nhat[1] * SAMPLE_OFF,
    m[2] + nhat[2] * SAMPLE_OFF,
  ]);
  const R = norm([
    m[0] - nhat[0] * SAMPLE_OFF,
    m[1] - nhat[1] * SAMPLE_OFF,
    m[2] - nhat[2] * SAMPLE_OFF,
  ]);
  const aL = strictlyInside(L, aVecs);
  const aR = strictlyInside(R, aVecs);
  const bL = strictlyInside(L, bVecs);
  const bR = strictlyInside(R, bVecs);
  const sideA = aL ? 'L' : aR ? 'R' : '?';
  const sideB = bL ? 'L' : bR ? 'R' : '?';
  const sameSide = sideA !== '?' && sideA === sideB;
  const opposite = sideA !== '?' && sideB !== '?' && sideA !== sideB;
  const keepA = mode === 'union' ? !opposite : !sameSide;
  if (keepA) {
    LB[j].coincNext = true;
  } else {
    LA[i].coincNext = true;
    LB[j].coincNext = true;
  }
}

/**
 * Build both augmented rings: pairwise edge intersections (splitting
 * collinear overlaps at their endpoints), twin-linking by geometric
 * coincidence, and coincident-edge disposition.
 */
function buildAugmented(aVecs, bVecs, mode) {
  const nA = aVecs.length;
  const nB = bVecs.length;
  const ptsA = new Map();
  const ptsB = new Map();
  const addPt = (map, e, p) => {
    let arr = map.get(e);
    if (!arr) {
      arr = [];
      map.set(e, arr);
    }
    arr.push(p);
  };
  for (let i = 0; i < nA; i++) {
    const s = aVecs[i];
    const e = aVecs[(i + 1) % nA];
    for (let j = 0; j < nB; j++) {
      const t = bVecs[j];
      const u = bVecs[(j + 1) % nB];
      const hit = edgePairHit(s, e, t, u);
      if (!hit) continue;
      if (hit.point) {
        addPt(ptsA, i, hit.point);
        addPt(ptsB, j, hit.point);
      } else {
        for (const p of hit.overlap) {
          addPt(ptsA, i, p);
          addPt(ptsB, j, p);
        }
      }
    }
  }
  const LA = buildList(aVecs, ptsA);
  const LB = buildList(bVecs, ptsB);
  for (let i = 0; i < LA.length; i++) {
    for (let j = 0; j < LB.length; j++) {
      if (angleBetween(LA[i].v, LB[j].v) < TWIN_EPS) {
        LA[i].twin = j;
        LB[j].twin = i;
      }
    }
  }
  for (let i = 0; i < LA.length; i++) {
    const a1 = LA[i].v;
    const a2 = LA[(i + 1) % LA.length].v;
    for (let j = 0; j < LB.length; j++) {
      const b1 = LB[j].v;
      const b2 = LB[(j + 1) % LB.length].v;
      const sameDir =
        angleBetween(a1, b1) < TWIN_EPS && angleBetween(a2, b2) < TWIN_EPS;
      const oppDir =
        angleBetween(a1, b2) < TWIN_EPS && angleBetween(a2, b1) < TWIN_EPS;
      if (!sameDir && !oppDir) continue;
      disposeCoincidentEdge(LA, i, LB, j, aVecs, bVecs, mode);
    }
  }
  for (const nodes of [LA, LB]) {
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      nodes[i].coincPrev = nodes[(i - 1 + n) % n].coincNext;
    }
  }
  return { LA, LB };
}

/**
 * Valid departures from node i on its ring: the next/prev directed arcs
 * that are not coincident-skipped, not the excluded U-turn, and pass the
 * region test. 'next' is preferred for determinism.
 */
function candidateDepartures(nodes, valid, i, excludeJ) {
  const n = nodes.length;
  const out = [];
  const nxt = (i + 1) % n;
  const prv = (i - 1 + n) % n;
  if (!nodes[i].coincNext && nxt !== excludeJ && valid(i, nxt)) out.push(nxt);
  if (!nodes[i].coincPrev && prv !== excludeJ && valid(i, prv)) out.push(prv);
  return out;
}
/**
 * Weiler–Atherton walk from a twin node: follow valid directed arcs
 * (arcs whose midpoint is on the result-boundary side), preferring the
 * current ring and switching to the twin ring only when the current one
 * offers no valid departure. Touch intersections are walked straight
 * through; proper crossings force the switch. Closes when the trail
 * returns to the start node (or its twin). Returns the vertex loop or
 * null when the trail dead-ends or revisits a node (defensive — the
 * property tests pin the geometry this guards).
 */
function walkFrom(tagS, s, d0, LA, LB, validA, validB, visitedArcs) {
  const other = (t) => (t === 'A' ? 'B' : 'A');
  const listOf = (t) => (t === 'A' ? LA : LB);
  const validOf = (t) => (t === 'A' ? validA : validB);
  const twinOf = (t, i) => listOf(t)[i].twin;
  const startTwin = twinOf(tagS, s);
  const isStartPos = (t, i) =>
    (t === tagS && i === s) || (t === other(tagS) && i === startTwin);

  const seen = new Set();
  const markSeen = (t, i) => {
    seen.add(`${t}:${i}`);
    const tw = twinOf(t, i);
    if (tw != null) seen.add(`${other(t)}:${tw}`);
  };
  markSeen(tagS, s);

  const vecs = [listOf(tagS)[s].v];
  let tag = tagS;
  let from = s;
  let to = d0;
  const maxSteps = 8 * (LA.length + LB.length) + 16;
  for (let step = 0; step < maxSteps; step++) {
    const key = `${tag}:${from}>${to}`;
    if (visitedArcs.has(key)) return null; // already walked — defensive
    visitedArcs.add(key);
    if (isStartPos(tag, to)) return vecs; // closed; no duplicate vertex
    const tok = `${tag}:${to}`;
    if (seen.has(tok)) return null; // non-simple revisit — defensive
    markSeen(tag, to);
    vecs.push(listOf(tag)[to].v);
    const cn = listOf(tag);
    let opts = candidateDepartures(cn, validOf(tag), to, from);
    if (opts.length > 0) {
      from = to;
      to = opts[0];
      continue;
    }
    const t = twinOf(tag, to);
    if (t == null) return null; // dead end — defensive
    const nt = other(tag);
    const tn = listOf(nt);
    opts = candidateDepartures(tn, validOf(nt), t, -1);
    if (opts.length === 0) return null; // dead end — defensive
    // Jump to the twin (same geometric point — no vertex pushed) and go.
    tag = nt;
    from = t;
    to = opts[0];
  }
  return null; // step guard exceeded — defensive
}

/**
 * Run walks from every twin node on both rings and every valid departure.
 * Duplicate (reversed) trails are suppressed by the shared visited-arc
 * set and by ring dedupe downstream.
 */
function traceRings(LA, LB, validA, validB) {
  const visitedArcs = new Set();
  const rings = [];
  const lists = [
    { nodes: LA, valid: validA, tag: 'A' },
    { nodes: LB, valid: validB, tag: 'B' },
  ];
  for (const { nodes, valid, tag } of lists) {
    for (let s = 0; s < nodes.length; s++) {
      if (nodes[s].twin == null) continue;
      for (const d of candidateDepartures(nodes, valid, s, -1)) {
        if (visitedArcs.has(`${tag}:${s}>${d}`)) continue;
        const ring = walkFrom(tag, s, d, LA, LB, validA, validB, visitedArcs);
        if (ring && ring.length >= 3) rings.push(ring);
      }
    }
  }
  return rings;
}

/** Drop vertices strictly on the minor arc between their neighbours. */
function stripCollinear(vecs) {
  let cur = vecs;
  for (let pass = 0; pass < 3; pass++) {
    const n = cur.length;
    if (n <= 3) return cur;
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = cur[(i - 1 + n) % n];
      const c = cur[i];
      const next = cur[(i + 1) % n];
      if (
        angleBetween(prev, c) > TWIN_EPS &&
        angleBetween(c, next) > TWIN_EPS &&
        onMinorArc(prev, next, c, ARC_EPS)
      ) {
        continue;
      }
      out.push(c);
    }
    if (out.length === cur.length) return out;
    cur = out;
  }
  return cur;
}

/** Dedupe rings by cyclic equality (either winding). */
function dedupeRings(rings) {
  const out = [];
  for (const r of rings) {
    if (!out.some((o) => ringsEqualCyclic(o, r))) out.push(r);
  }
  return out;
}

/**
 * Finalize walked rings: strip collinear vertices, drop degenerate ones,
 * dedupe, detect holes by containment, and canonicalize winding (outers
 * positive, holes negative — via the robust angle sum, never the fan).
 */
function canonicalizeRings(rings) {
  const alive = [];
  for (const r of rings) {
    const s = stripCollinear(r);
    if (s.length >= 3 && Math.abs(loopSolidAngle(s)) >= DEGENERATE_SR) {
      alive.push(s);
    }
  }
  const deduped = dedupeRings(alive);
  if (deduped.length === 0) return [];
  const positive = deduped.map(ensurePositiveWinding);
  const isHole = positive.map(() => false);
  for (let k = 0; k < positive.length; k++) {
    const sample = interiorSample(positive[k]);
    if (!sample) continue;
    for (let m = 0; m < positive.length; m++) {
      if (m === k) continue;
      if (strictlyInside(sample, positive[m])) {
        isHole[k] = true;
        break;
      }
    }
  }
  return positive.map((r, k) => {
    const vecs = isHole[k] ? ensureNegativeWinding(r) : r;
    return vecs.map(toLatLon);
  });
}

/**
 * No intersections at all: the boundaries are disjoint. Decide by strict
 * vertex containment. (A vertex strictly inside the other with no
 * boundary contact is only possible in these configurations.)
 */
function noIntersectionCase(aVecs, bVecs, mode) {
  const aInB = aVecs.some((v) => strictlyInside(v, bVecs));
  const bInA = bVecs.some((v) => strictlyInside(v, aVecs));
  const A = aVecs.map(toLatLon);
  const B = bVecs.map(toLatLon);
  if (mode === 'union') {
    if (aInB && !bInA) return [B];
    if (bInA && !aInB) return [A];
    return [A, B]; // disjoint (both-true is impossible without crossings)
  }
  if (aInB && !bInA) return [];
  if (bInA && !aInB) return [A, ensureNegativeWinding(bVecs).map(toLatLon)];
  return [A]; // disjoint
}

/**
 * Intersections exist but the walk emitted nothing: every boundary is
 * coincident (fully shared boundary curves). Distinguish identical
 * regions from merely touching ones with an interior sample.
 */
function allCoincidentCase(aVecs, bVecs, mode) {
  // All edges coincide: regions identical iff interiors on same side.
  // Sample from both (a sample near one ring's edge can sit near the
  // other's vertex, defeating the strict-inside test numerically).
  let identical = false;
  const p = interiorSample(aVecs);
  if (p != null && strictlyInside(p, bVecs)) identical = true;
  if (!identical) {
    const q = interiorSample(bVecs);
    if (q != null && strictlyInside(q, aVecs)) identical = true;
  }
  if (identical) return mode === 'union' ? [aVecs.map(toLatLon)] : [];
  // Same boundary curve but disjoint interiors cannot happen for simple
  // rings; reaching here means touching boundaries — union keeps both as
  // the correct set, difference keeps A.
  if (mode === 'union') return [aVecs.map(toLatLon), bVecs.map(toLatLon)];
  return [aVecs.map(toLatLon)];
}

function booleanOp(aRing, bRing, mode) {
  const aVecs = normalizeRing(aRing);
  if (!aVecs) return null;
  const bVecs = normalizeRing(bRing);
  if (!bVecs) return null;
  if (Math.abs(loopSolidAngle(aVecs)) < DEGENERATE_SR) return null;
  if (Math.abs(loopSolidAngle(bVecs)) < DEGENERATE_SR) return null;
  // Same boundary curve (either winding) — the fast path both ops need.
  if (ringsEqualCyclic(aVecs, bVecs)) {
    return mode === 'union' ? [aVecs.map(toLatLon)] : [];
  }
  const { LA, LB } = buildAugmented(aVecs, bVecs, mode);
  const hasTwin = LA.some((nd) => nd.twin != null);
  if (!hasTwin) return noIntersectionCase(aVecs, bVecs, mode);
  // A-arcs bound the result when outside B (both ops); B-arcs when
  // outside A (union) or inside A (difference).
  const validA = (i, j) => !strictlyInside(normMid(LA[i].v, LA[j].v), bVecs);
  const validB = (i, j) => {
    const inside = strictlyInside(normMid(LB[i].v, LB[j].v), aVecs);
    return mode === 'difference' ? inside : !inside;
  };
  const rings = traceRings(LA, LB, validA, validB);
  if (rings.length === 0) return allCoincidentCase(aVecs, bVecs, mode);
  return canonicalizeRings(rings);
}

/**
 * UNION of two simple spherical polygons (Weiler–Atherton on the sphere).
 *
 * @param {Array} aRing - first ring, `[lat, lon]` / `{lat, lon}` vertices.
 * @param {Array} bRing - second ring, `[lat, lon]` / `{lat, lon}` vertices.
 * @returns {Array<Array<{lat:number, lon:number}>>|null} Array of result
 *   rings (implicitly closed), outer rings positive-wound; `[]` never
 *   occurs for valid inputs (the union is never empty); `null` on invalid
 *   input. Disjoint inputs yield both rings.
 */
export function unionSphericalPolygons(aRing, bRing) {
  return booleanOp(aRing, bRing, 'union');
}

/**
 * DIFFERENCE of two simple spherical polygons, A − B (Weiler–Atherton on
 * the sphere): the part of A outside B, with B-shaped holes where B lies
 * strictly inside A.
 *
 * @param {Array} aRing - first ring, `[lat, lon]` / `{lat, lon}` vertices.
 * @param {Array} bRing - second ring, `[lat, lon]` / `{lat, lon}` vertices.
 * @returns {Array<Array<{lat:number, lon:number}>>|null} Array of result
 *   rings (implicitly closed); `[]` when B covers A; `null` on invalid
 *   input. Disjoint inputs yield the first ring.
 */
export function differenceSphericalPolygons(aRing, bRing) {
  return booleanOp(aRing, bRing, 'difference');
}
