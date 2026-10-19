/**
 * Spherical spatial index: an exact vantage-point (VP) tree over the
 * great-circle (haversine) metric for k-nearest-neighbor and radius
 * queries on a fixed set of latitude/longitude points.
 *
 * A VP-tree recursively picks a vantage point, splits the remaining
 * points at the median distance from it, and prunes subtrees during
 * search with the triangle inequality — so queries cost O(log n) on
 * average instead of the O(n) of a brute-force scan. Build is O(n log n)
 * with the balanced median split used here.
 *
 * INPUT CONVENTION: points are `[lat, lon]` pairs or
 * `{lat, lon, id?}` objects — latitude first, matching `geoMath.js`
 * argument order and the other `spherical*` modules. Only `id` is
 * carried through from object points; it is echoed back untouched in
 * query results.
 *
 * Primary sources (research-first, per the lane contract):
 * - J. K. Uhlmann, "Satisfying general proximity/similarity queries
 *   with metric trees", Information Processing Letters 40(4):175–179
 *   (1991), doi:10.1016/0020-0190(91)90074-r — the metric-tree
 *   foundation: partition by distance to a pivot, prune with the
 *   triangle inequality.
 * - P. N. Yianilos, "Data structures and algorithms for nearest
 *   neighbor search in general metric spaces", Proc. 4th ACM-SIAM
 *   Symposium on Discrete Algorithms, pp. 311–321 (1993) — the VP-tree
 *   proper: vantage point + median-distance split, exact (non-
 *   approximate) nearest-neighbor search, and the second-moment
 *   criterion for choosing good vantage points.
 * - GeographicLib, "Finding nearest neighbors"
 *   (geographiclib.sourceforge.io) — the geographic precedent: its
 *   `NearestNeighbor` class implements exactly this Uhlmann/Yianilos
 *   construction, and notes that geodesic distance satisfies the
 *   metric conditions (in particular the triangle inequality). The
 *   great-circle distance used here is the shortest-path (Riemannian)
 *   metric of the 2-sphere, so the triangle inequality — and hence
 *   every pruning bound below — holds on the sphere.
 *
 * Design notes (what this is NOT):
 * - Deterministic vantage points: Yianilos picks them randomly and
 *   optimizes the distance second moment; here the vantage point is
 *   the point nearest the subset's 3D centroid, lowest original index
 *   breaking ties. Deterministic builds make tests reproducible and
 *   indexes comparable; central points maximize distance spread, which
 *   is what the second-moment criterion rewards.
 * - Balanced median split: inner holds the ⌈m/2⌉ smallest distances,
 *   outer the rest, with `medianM` = max inner distance. A classic
 *   median split can degenerate to O(n) depth when many distances
 *   tie (e.g. duplicate points); the balanced split keeps depth
 *   O(log n) in all cases, and the pruning bounds are proved below
 *   with `medianM` as the inner/outer boundary in both cases.
 * - Pruning correctness (great-circle metric `d`, query `q`, node with
 *   vantage point `v` and boundary `m`):
 *   - Outer holds points with d(v,p) ≥ m. Then
 *     d(q,p) ≥ d(v,p) − d(q,v) ≥ m − dp. The kNN search skips outer
 *     only when m − dp > tau (best-so-far k-th distance), so no
 *     skipped point can improve the answer; it visits outer when
 *     dp + tau ≥ m. Radius search visits outer when dp + r ≥ m.
 *   - Inner holds points with d(v,p) ≤ m. Then d(q,p) ≥ dp − d(v,p) ≥
 *     dp − m. kNN visits inner when dp − tau ≤ m; radius visits when
 *     dp − r ≤ m.
 *   Both bounds use non-strict comparisons so points sitting exactly
 *   on the boundary are never wrongly pruned.
 * - No unit conversions live here: distances are always metres
 *   (`unitMath.js` owns conversions).
 *
 * Non-overlap with the existing geometry code:
 * - `src/data/geoMath.js` owns point-to-point spherical primitives
 *   (haversine distance, bearing, destination, midpoint) — no
 *   indexing, no set queries. The haversine here is re-implemented
 *   locally (chord form) so this module stays import-free.
 * - `src/data/sphericalVoronoiMath.js` owns the nearest-site
 *   TESSELLATION (cell regions for every site — areal assignment).
 *   This module answers discrete point-set queries (k nearest, all
 *   within a radius) with sublinear average cost and no geometry
 *   construction. Complementary: Voronoi builds regions, this finds
 *   points.
 * - No call sites are re-pointed (no call-site migration).
 *
 * Canonical semantics (standalone — no call sites re-pointed):
 * - Pure: no DOM, no Cesium, no imports. Inputs and outputs are
 *   plain numbers, arrays, and small objects.
 * - Error values: `null` on invalid input — never a throw, never
 *   `NaN`. An index is valid when it is an object built by
 *   `buildSphericalSpatialIndex` (recognized by its type tag).
 * - Results are exact (this is not an approximate index): kNN and
 *   radius answers always agree with a brute-force scan, only faster
 *   on average.
 * - Results are full double precision, never rounded: display rounding
 *   is the caller's job.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in
 * this commit — migration is a separate, per-group change, like the
 * prior idea-cycle modules.
 *
 * @module data/sphericalSpatialIndex
 */

/** IUGG mean Earth radius, metres — matches geoMath.EARTH_MEAN_RADIUS_M. */
const EARTH_MEAN_RADIUS_M = 6_371_008.8;
/** Type tag recognizing indexes built by this module. */
const INDEX_TAG = 'spherical-spatial-index/v1';

const toRad = (deg) => (deg * Math.PI) / 180;

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
 * Great-circle distance between two unit 3D vectors, metres. Chord
 * form `2R·asin(|a−b|/2)` — numerically stable at both ends (no acos
 * amplification near zero, no asin domain blowup), exact 0 for
 * coincident points.
 * @param {[number,number,number]} a
 * @param {[number,number,number]} b
 * @returns {number}
 */
function haversineVecM(a, b) {
  const chord = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, chord / 2));
}

/**
 * Normalize one indexed point to an internal record, or `null` when
 * invalid. Records keep the original array position (`index`) for
 * deterministic tie-breaking and carry `id` through untouched.
 * @param {unknown} raw
 * @param {number} index Original array position.
 * @returns {{index:number,id:unknown,lat:number,lon:number,vec:[number,number,number]}|null}
 */
function toIndexedPoint(raw, index) {
  const vertex = toVertex(raw);
  if (!vertex) return null;
  const id =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? raw.id
      : undefined;
  return {
    index,
    id,
    lat: vertex.lat,
    lon: vertex.lon,
    vec: toVec3(vertex.lat, vertex.lon),
  };
}

/**
 * True when `value` looks like an internal point record (used to
 * fail closed on hand-built/mutated index objects).
 * @param {unknown} value
 * @returns {boolean}
 */
function isInternalPoint(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Number.isInteger(value.index) &&
    value.index >= 0 &&
    isFiniteNumber(value.lat) &&
    isFiniteNumber(value.lon) &&
    Array.isArray(value.vec) &&
    value.vec.length === 3 &&
    isFiniteNumber(value.vec[0]) &&
    isFiniteNumber(value.vec[1]) &&
    isFiniteNumber(value.vec[2])
  );
}

/**
 * Build one VP-tree node from a list of internal point records.
 * Vantage point = record nearest the subset's 3D centroid (lowest
 * original index breaks ties — fully deterministic). The rest split
 * at the balanced median: inner holds the ⌈m/2⌉ smallest distances,
 * outer the remainder, `medianM` = largest inner distance.
 * @param {Array} points Internal point records.
 * @returns {object|null} Node, or `null` for an empty list.
 */
function buildNode(points) {
  if (points.length === 0) return null;
  // Subset centroid in 3D.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.vec[0];
    cy += p.vec[1];
    cz += p.vec[2];
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;
  // Vantage point: nearest to the centroid (squared chord distance —
  // monotone with angular distance, no trig needed).
  let vpPos = 0;
  let bestDist2 = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const dx = points[i].vec[0] - cx;
    const dy = points[i].vec[1] - cy;
    const dz = points[i].vec[2] - cz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 < bestDist2) {
      bestDist2 = dist2;
      vpPos = i;
    }
  }
  const vp = points[vpPos];
  const rest = points.slice(0, vpPos).concat(points.slice(vpPos + 1));
  if (rest.length === 0) {
    return { point: vp, medianM: null, inner: null, outer: null };
  }
  const withDist = rest.map((p) => ({
    p,
    d: haversineVecM(vp.vec, p.vec),
  }));
  // Stable sort: ties keep original order (lower original index first).
  withDist.sort((a, b) => a.d - b.d);
  const mid = Math.ceil(withDist.length / 2);
  const medianM = withDist[mid - 1].d;
  return {
    point: vp,
    medianM,
    inner: buildNode(withDist.slice(0, mid).map((w) => w.p)),
    outer: buildNode(withDist.slice(mid).map((w) => w.p)),
  };
}

/**
 * Build a spherical spatial index over a fixed set of points.
 * @param {unknown} points Array of `[lat, lon]` pairs or
 *   `{lat, lon, id?}` objects; latitude first. The array is not
 *   mutated.
 * @returns {object|null} The index (a plain JSON-able object), or
 *   `null` for an invalid/empty point list.
 */
export function buildSphericalSpatialIndex(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const records = [];
  for (let i = 0; i < points.length; i += 1) {
    const record = toIndexedPoint(points[i], i);
    if (!record) return null;
    records.push(record);
  }
  return { type: INDEX_TAG, size: records.length, root: buildNode(records) };
}

/**
 * Recognize an index built by `buildSphericalSpatialIndex`.
 * @param {unknown} index
 * @returns {object|null} The index, or `null` when it is not one.
 */
function asIndex(index) {
  if (index === null || typeof index !== 'object') return null;
  if (index.type !== INDEX_TAG) return null;
  if (!Number.isInteger(index.size) || index.size < 1) return null;
  if (index.root === null || typeof index.root !== 'object') return null;
  return index;
}

/**
 * Normalize a query point.
 * @param {unknown} query `[lat, lon]` pair or `{lat, lon}` object.
 * @returns {{lat:number,lon:number,vec:[number,number,number]}|null}
 */
function toQuery(query) {
  const vertex = toVertex(query);
  if (!vertex) return null;
  return {
    lat: vertex.lat,
    lon: vertex.lon,
    vec: toVec3(vertex.lat, vertex.lon),
  };
}

/**
 * Recognize a stats collector: a plain object to receive `visited`.
 * @param {unknown} options
 * @returns {object|null}
 */
function asStats(options) {
  if (
    options !== null &&
    typeof options === 'object' &&
    options.stats !== null &&
    typeof options.stats === 'object'
  ) {
    return options.stats;
  }
  return null;
}

/**
 * Insert a candidate into the k-best list, kept sorted ascending by
 * `(distanceM, index)` and capped at `want` entries.
 * @param {Array<{point:object,d:number}>} best
 * @param {number} want
 * @param {object} point Internal point record.
 * @param {number} d Distance in metres.
 */
function insertBest(best, want, point, d) {
  let pos = best.length;
  for (let i = 0; i < best.length; i += 1) {
    if (
      d < best[i].d ||
      (d === best[i].d && point.index < best[i].point.index)
    ) {
      pos = i;
      break;
    }
  }
  best.splice(pos, 0, { point, d });
  if (best.length > want) best.length = want;
}

/**
 * Recursive exact kNN search with triangle-inequality pruning. `state`
 * accumulates `{visited, bad}`; `bad` fails the whole query closed on
 * a malformed node.
 * @param {object|null} node
 * @param {object} q Normalized query.
 * @param {number} want min(k, size).
 * @param {Array} best K-best list under construction.
 * @param {{visited:number,bad:boolean}} state
 */
function searchKnn(node, q, want, best, state) {
  if (!node || state.bad) return;
  if (!isInternalPoint(node.point)) {
    state.bad = true;
    return;
  }
  state.visited += 1;
  const dp = haversineVecM(q.vec, node.point.vec);
  insertBest(best, want, node.point, dp);
  const m = node.medianM;
  if (m === null || m === undefined) return; // leaf
  if (!isFiniteNumber(m) || m < 0) {
    state.bad = true;
    return;
  }
  const tauAfter = () =>
    best.length === want ? best[best.length - 1].d : Infinity;
  if (dp < m) {
    // Inner first (it holds the vantage point's neighborhood); outer
    // can only improve when dp + tau ≥ m (outer points sit at ≥ m
    // from the vantage point, so ≥ m − dp from the query).
    searchKnn(node.inner, q, want, best, state);
    if (dp + tauAfter() >= m) searchKnn(node.outer, q, want, best, state);
  } else {
    // Outer first; inner points sit at ≤ m from the vantage point, so
    // ≥ dp − m from the query — visit only when dp − tau ≤ m.
    searchKnn(node.outer, q, want, best, state);
    if (dp - tauAfter() <= m) searchKnn(node.inner, q, want, best, state);
  }
}

/**
 * Recursive exact radius search with triangle-inequality pruning.
 * @param {object|null} node
 * @param {object} q Normalized query.
 * @param {number} radiusM
 * @param {Array} out Collected `{point, d}` pairs.
 * @param {{visited:number,bad:boolean}} state
 */
function searchRadius(node, q, radiusM, out, state) {
  if (!node || state.bad) return;
  if (!isInternalPoint(node.point)) {
    state.bad = true;
    return;
  }
  state.visited += 1;
  const dp = haversineVecM(q.vec, node.point.vec);
  if (dp <= radiusM) out.push({ point: node.point, d: dp });
  const m = node.medianM;
  if (m === null || m === undefined) return; // leaf
  if (!isFiniteNumber(m) || m < 0) {
    state.bad = true;
    return;
  }
  if (dp < m) {
    searchRadius(node.inner, q, radiusM, out, state);
    if (dp + radiusM >= m) searchRadius(node.outer, q, radiusM, out, state);
  } else {
    searchRadius(node.outer, q, radiusM, out, state);
    if (dp - radiusM <= m) searchRadius(node.inner, q, radiusM, out, state);
  }
}

/**
 * Shape one result entry.
 * @param {{point:object,d:number}} hit
 * @returns {{index:number,id:unknown,lat:number,lon:number,distanceM:number}}
 */
function toEntry(hit) {
  const entry = {
    index: hit.point.index,
    id: hit.point.id,
    lat: hit.point.lat,
    lon: hit.point.lon,
    distanceM: hit.d,
  };
  return entry;
}

/**
 * The `k` nearest indexed points to a query point, exact.
 * @param {unknown} index Built by `buildSphericalSpatialIndex`.
 * @param {unknown} query `[lat, lon]` pair or `{lat, lon}` object.
 * @param {number} [k=1] How many neighbors; a positive integer.
 * @param {object} [options] Optional `{stats}` object receiving
 *   `visited` (node distance computations — for tuning/tests).
 * @returns {Array|null} Entries `{index, id, lat, lon, distanceM}`
 *   sorted ascending by `(distanceM, index)`; fewer than `k` when the
 *   index holds fewer points. `null` on invalid input.
 */
export function sphericalKnn(index, query, k = 1, options) {
  const tree = asIndex(index);
  const q = toQuery(query);
  if (!tree || !q) return null;
  if (!Number.isInteger(k) || k < 1) return null;
  const stats = asStats(options);
  const want = Math.min(k, tree.size);
  const best = [];
  const state = { visited: 0, bad: false };
  searchKnn(tree.root, q, want, best, state);
  if (state.bad) return null;
  if (stats) stats.visited = state.visited;
  return best.map(toEntry);
}

/**
 * All indexed points within `radiusM` metres of a query point, exact.
 * @param {unknown} index Built by `buildSphericalSpatialIndex`.
 * @param {unknown} query `[lat, lon]` pair or `{lat, lon}` object.
 * @param {number} radiusM Non-negative finite radius in metres.
 * @param {object} [options] Optional `{stats}` object receiving
 *   `visited` (node distance computations — for tuning/tests).
 * @returns {Array|null} Entries `{index, id, lat, lon, distanceM}`
 *   sorted ascending by `(distanceM, index)`; `[]` when nothing is in
 *   range. `null` on invalid input.
 */
export function sphericalRadiusSearch(index, query, radiusM, options) {
  const tree = asIndex(index);
  const q = toQuery(query);
  if (!tree || !q) return null;
  if (!isFiniteNumber(radiusM) || radiusM < 0) return null;
  const stats = asStats(options);
  const out = [];
  const state = { visited: 0, bad: false };
  searchRadius(tree.root, q, radiusM, out, state);
  if (state.bad) return null;
  if (stats) stats.visited = state.visited;
  out.sort((a, b) => (a.d === b.d ? a.point.index - b.point.index : a.d - b.d));
  return out.map(toEntry);
}
