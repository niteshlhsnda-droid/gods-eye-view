/**
 * Shared geographic bounding-box math.
 *
 * Bounding boxes currently exist in (at least) three shapes with
 * DIVERGENT antimeridian semantics (evidence, `origin/main` @ `05ad633`):
 * - Array `[west, south, east, north]`: `src/data/adminBoundaries.js:186`
 *   (`boxDistanceKm` at :211 destructures it), `src/data/naturalEarthRegions.js:159`.
 * - Object `{ west, south, east, north }`: `src/data/tomtomTiles.js:88`
 *   (`tileToBBox`), `src/layers/recentImagery/model.js:78` (`normalizeBox`).
 * - Object `{ south, west, north, east }`: `src/data/trafficBounds.js`
 *   (`clampBoundsAroundCenter`), `src/data/militaryInstallationData.js:180`
 *   (`isValidInstallationBoundingBox`).
 * And the antimeridian is handled five different ways:
 * - `src/layers/traffic/viewport.js:99` `getBoundsCenter` takes the naive
 *   midpoint `(west + east) / 2` — for a crossing box (170 to -170) that
 *   answers 0, the point FARTHEST from the box, instead of 180.
 * - `src/layers/traffic/viewport.js:136` `boundsOverlap` intersects with
 *   plain `Math.max(west)` / `Math.min(east)` — for a crossing box the
 *   overlap rectangle is inverted and every crossing overlap reads as
 *   "no intersection".
 * - `src/layers/alpr/records.js:36` `boxContains` says so itself:
 *   "no dateline handling; the viewport gate already rejects east <= west".
 * - `src/data/militaryInstallationData.js:180` rejects any box with
 *   `west >= east`, so a crossing box is invalid input there.
 * - `src/layers/streetLevel/tileMath.js:62` `normalizeBbox` sorts the
 *   edges (`Math.min(w, e)` / `Math.max(w, e)`), silently converting a
 *   20-degree crossing box (170 to -170) into a 340-degree box
 *   (-170 to 170) that covers most of the planet.
 * - `src/data/trafficBounds.js` keeps boxes monotonic by SHIFTING the whole
 *   box at the antimeridian, which moves the box off the viewport it was
 *   meant to cover.
 * - `src/data/neighborhoodPolygons.js:144` tests containment by hand
 *   (`lon >= bbox[0] && lon <= bbox[2]`), which can never match a
 *   crossing box.
 *
 * This module fixes one canonical representation and one semantics per
 * operation:
 * - Canonical bounds: `{ west, south, east, north }` with `south <= north`
 *   (latitudes clamped to [-90, 90]) and longitudes wrapped to [-180, 180].
 * - An antimeridian-crossing box keeps `west > east` (e.g. 170 to -170
 *   spans 20 degrees eastward across the seam). Crossing is data, not an
 *   error — the one exception is the whole-globe pair `west = -180`,
 *   `east = 180`, which is the only box with a 360-degree span.
 * - Every predicate/operation below is crossing-aware. Consumers that need
 *   monotonic boxes (Overpass, the military validator, tile math) should
 *   call `splitAtAntimeridian` and feed the pieces, instead of each
 *   re-implementing — and re-breaking — the crossing case.
 * - `boundsUnion` returns the MINIMAL covering bounds, which may include
 *   area in neither input (a union of disjoint boxes is one box, not a
 *   set). `boundsIntersection` returns null when the intersection is two
 *   disjoint segments, because a single bounds cannot represent that.
 *
 * Pure: no DOM, no Cesium, no imports.
 *
 * Adoption follow-up (NOT done here): migrating a call site means adding
 * this file to every boundary group that owns the importing module
 * (`scripts/package-boundaries.json` rejects unowned transitive imports),
 * so migration is a separate, per-group change — no call site is
 * re-pointed in this commit.
 *
 * @module data/geoBounds
 */

/** Whole-globe bounds, returned when an operation covers every longitude. */
const WHOLE_GLOBE = { west: -180, south: -90, east: 180, north: 90 };

/**
 * Wrap a longitude edge into [-180, 180], keeping +180 as +180.
 * Plain modulo maps 180 to -180, which would collapse the whole-globe
 * pair (-180, 180) into a degenerate box.
 * @param {number} lon Longitude in degrees.
 * @returns {number} The equivalent edge in [-180, 180].
 */
function wrapLonEdge(lon) {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  // `wrapped` is in [-180, 180). Only a POSITIVE multiple of 180 lands on
  // -180 while meaning +180; -180 itself stays -180.
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

/**
 * Wrap a longitude into [-180, 180) for centres, where 180 and -180 are
 * the same meridian and one representative must win.
 * @param {number} lon Longitude in degrees.
 * @returns {number} The equivalent longitude in [-180, 180).
 */
function wrapLonCenter(lon) {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/**
 * Coerce an array `[west, south, east, north]` or an object
 * `{ west, south, east, north }` into canonical bounds.
 * Latitude edges are sorted then clamped to [-90, 90]; longitude edges
 * are wrapped. Returns null for non-finite edges or a degenerate
 * (zero-width / zero-height) box.
 * @param {unknown} input Bounds in either accepted shape.
 * @returns {{west:number, south:number, east:number, north:number}|null}
 *   Canonical bounds, or null when the input is unusable.
 */
export function normalizeBounds(input) {
  let west;
  let south;
  let east;
  let north;
  if (Array.isArray(input)) {
    if (input.length !== 4) return null;
    [west, south, east, north] = input;
  } else if (input && typeof input === 'object') {
    ({ west, south, east, north } = input);
  } else {
    return null;
  }
  west = Number(west);
  south = Number(south);
  east = Number(east);
  north = Number(north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  const lo = Math.min(south, north);
  const hi = Math.max(south, north);
  south = Math.max(-90, lo);
  north = Math.min(90, hi);
  if (north <= south) return null;
  west = wrapLonEdge(west);
  east = wrapLonEdge(east);
  const width = west <= east ? east - west : east - west + 360;
  if (width <= 0 || width > 360) return null;
  return { west, south, east, north };
}

/**
 * Whether the input normalizes to usable bounds.
 * @param {unknown} input Bounds in either accepted shape.
 * @returns {boolean} True for usable bounds.
 */
export function isValidBounds(input) {
  return normalizeBounds(input) !== null;
}

/**
 * Eastward longitude span and latitude span of a bounds.
 * @param {unknown} input Bounds in either accepted shape.
 * @returns {{widthDeg:number, heightDeg:number}|null} Spans in degrees,
 *   or null for unusable input.
 */
export function boundsSpanDeg(input) {
  const bounds = normalizeBounds(input);
  if (!bounds) return null;
  return {
    widthDeg:
      bounds.west <= bounds.east
        ? bounds.east - bounds.west
        : bounds.east - bounds.west + 360,
    heightDeg: bounds.north - bounds.south,
  };
}

/**
 * Centre of a bounds. For a crossing box the centre longitude is the
 * eastward midpoint (170 to -170 centres on -180, not on 0 — the naive
 * `(west + east) / 2` that `src/layers/traffic/viewport.js` uses).
 * @param {unknown} input Bounds in either accepted shape.
 * @returns {{lat:number, lon:number}|null} Centre, longitude in
 *   [-180, 180), or null for unusable input.
 */
export function boundsCenter(input) {
  const bounds = normalizeBounds(input);
  if (!bounds) return null;
  const { widthDeg } = boundsSpanDeg(bounds);
  return {
    lat: (bounds.south + bounds.north) / 2,
    lon: wrapLonCenter(bounds.west + widthDeg / 2),
  };
}

/**
 * Whether a point lies inside a bounds, edges inclusive. The longitude
 * is wrapped first, so 190 counts as -170.
 * @param {unknown} input Bounds in either accepted shape.
 * @param {number} lat Point latitude in degrees.
 * @param {number} lon Point longitude in degrees.
 * @returns {boolean} True when the point is inside the bounds.
 */
export function boundsContains(input, lat, lon) {
  const bounds = normalizeBounds(input);
  if (!bounds) return false;
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return false;
  if (latNum < bounds.south || latNum > bounds.north) return false;
  const edge = wrapLonEdge(lonNum);
  if (bounds.west <= bounds.east) {
    return edge >= bounds.west && edge <= bounds.east;
  }
  return edge >= bounds.west || edge <= bounds.east;
}

/**
 * Whether `inner` lies entirely inside `outer`, edges inclusive.
 * @param {unknown} outerInput Outer bounds in either accepted shape.
 * @param {unknown} innerInput Inner bounds in either accepted shape.
 * @returns {boolean} True when `inner` is fully contained in `outer`.
 */
export function boundsContainsBounds(outerInput, innerInput) {
  const outer = normalizeBounds(outerInput);
  const inner = normalizeBounds(innerInput);
  if (!outer || !inner) return false;
  if (inner.south < outer.south || inner.north > outer.north) return false;
  if (outer.west === -180 && outer.east === 180) return true;
  if (inner.west === -180 && inner.east === 180) return false;
  const outerSegments = splitAtAntimeridian(outer);
  const innerSegments = splitAtAntimeridian(inner);
  return innerSegments.every((segment) =>
    outerSegments.some(
      (outerSegment) =>
        segment.west >= outerSegment.west && segment.east <= outerSegment.east,
    ),
  );
}

/**
 * Whether two bounds overlap at all. Edge-touching counts as overlap
 * (closed intervals); use `boundsIntersection` when the overlap itself
 * is needed.
 * @param {unknown} aInput First bounds in either accepted shape.
 * @param {unknown} bInput Second bounds in either accepted shape.
 * @returns {boolean} True when the bounds overlap.
 */
export function boundsIntersects(aInput, bInput) {
  const a = normalizeBounds(aInput);
  const b = normalizeBounds(bInput);
  if (!a || !b) return false;
  if (Math.max(a.south, b.south) > Math.min(a.north, b.north)) return false;
  return splitAtAntimeridian(a).some((aSegment) =>
    splitAtAntimeridian(b).some(
      (bSegment) =>
        aSegment.west <= bSegment.east && bSegment.west <= aSegment.east,
    ),
  );
}

/**
 * The single contiguous overlap of two bounds, or null when there is
 * none, when either input is unusable, or when the overlap is two
 * disjoint segments (a crossing box overlapping a wide box on both sides
 * of the seam) — a single bounds cannot represent that. Intersect
 * per-segment via `splitAtAntimeridian` when the two-piece case matters.
 * @param {unknown} aInput First bounds in either accepted shape.
 * @param {unknown} bInput Second bounds in either accepted shape.
 * @returns {{west:number, south:number, east:number, north:number}|null}
 *   The intersection, or null as above.
 */
export function boundsIntersection(aInput, bInput) {
  const a = normalizeBounds(aInput);
  const b = normalizeBounds(bInput);
  if (!a || !b) return null;
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (north <= south) return null;
  const overlaps = [];
  for (const aSegment of splitAtAntimeridian(a)) {
    for (const bSegment of splitAtAntimeridian(b)) {
      const west = Math.max(aSegment.west, bSegment.west);
      const east = Math.min(aSegment.east, bSegment.east);
      if (east > west) overlaps.push({ west, east });
    }
  }
  if (overlaps.length !== 1) return null;
  return {
    west: overlaps[0].west,
    south,
    east: overlaps[0].east,
    north,
  };
}

/**
 * The minimal bounds covering both inputs. The covering box may include
 * area in neither input (a union of disjoint boxes is one box, not a
 * set); the seam-crossing direction is the one with the smaller eastward
 * span, so the union of 170-to-180 and -180-to--170 is the 20-degree
 * crossing box, not the 340-degree box around the other way.
 * @param {unknown} aInput First bounds in either accepted shape.
 * @param {unknown} bInput Second bounds in either accepted shape.
 * @returns {{west:number, south:number, east:number, north:number}|null}
 *   The minimal covering bounds, or null for unusable input.
 */
export function boundsUnion(aInput, bInput) {
  const a = normalizeBounds(aInput);
  const b = normalizeBounds(bInput);
  if (!a || !b) return null;
  const south = Math.min(a.south, b.south);
  const north = Math.max(a.north, b.north);
  if (a.west === -180 && a.east === 180)
    return { ...WHOLE_GLOBE, south, north };
  if (b.west === -180 && b.east === 180)
    return { ...WHOLE_GLOBE, south, north };
  const segments = [...splitAtAntimeridian(a), ...splitAtAntimeridian(b)];
  let bestWest = null;
  let bestSpan = Infinity;
  for (const candidate of segments) {
    const west = candidate.west;
    let reach = 0;
    for (const segment of segments) {
      const startOff = (segment.west - west + 360) % 360;
      const endOff = startOff + (segment.east - segment.west);
      if (endOff > reach) reach = endOff;
    }
    if (reach < bestSpan) {
      bestSpan = reach;
      bestWest = west;
    }
  }
  if (bestSpan >= 360) return { ...WHOLE_GLOBE, south, north };
  return normalizeBounds({
    west: bestWest,
    south,
    east: wrapLonEdge(bestWest + bestSpan),
    north,
  });
}

/**
 * Expand a bounds outward by `marginDeg` on every side. Latitude is
 * clamped to [-90, 90]; longitude wraps across the seam, and a margin
 * that covers the whole circle yields the whole-globe bounds.
 * @param {unknown} input Bounds in either accepted shape.
 * @param {number} marginDeg Non-negative margin in degrees.
 * @returns {{west:number, south:number, east:number, north:number}|null}
 *   The expanded bounds, or null for unusable input / margin.
 */
export function expandBounds(input, marginDeg) {
  const bounds = normalizeBounds(input);
  const margin = Number(marginDeg);
  if (!bounds || !Number.isFinite(margin) || margin < 0) return null;
  if (margin === 0) return { ...bounds };
  const south = Math.max(-90, bounds.south - margin);
  const north = Math.min(90, bounds.north + margin);
  const { widthDeg } = boundsSpanDeg(bounds);
  if (widthDeg + 2 * margin >= 360) {
    return { ...WHOLE_GLOBE, south, north };
  }
  return normalizeBounds({
    west: wrapLonEdge(bounds.west - margin),
    south,
    east: wrapLonEdge(bounds.east + margin),
    north,
  });
}

/**
 * Minimal bounds covering a set of points. Longitude uses the
 * minimal-covering-arc rule: the west edge is the first longitude after
 * the largest gap between sorted longitudes, so points at 179 and -179
 * yield a 2-degree crossing box, not a 358-degree box.
 * @param {Array<{lat:number, lon:number}>} points Points to cover.
 * @returns {{west:number, south:number, east:number, north:number}|null}
 *   The covering bounds, or null when the points are missing, invalid,
 *   or degenerate (one meridian / one parallel only).
 */
export function boundsFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const lats = [];
  const lons = [];
  for (const point of points) {
    if (!point || typeof point !== 'object') return null;
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90) return null;
    lats.push(lat);
    lons.push(wrapLonEdge(lon));
  }
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  if (north <= south) return null;
  const sorted = [...new Set(lons)].sort((a, b) => a - b);
  if (sorted.length === 1) return null;
  let bestGap = -1;
  let bestIndex = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next =
      sorted[(i + 1) % sorted.length] + (i === sorted.length - 1 ? 360 : 0);
    const gap = next - current;
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  return normalizeBounds({
    west: sorted[(bestIndex + 1) % sorted.length],
    south,
    east: sorted[bestIndex],
    north,
  });
}

/**
 * Split a bounds at the antimeridian into one or two non-crossing
 * (west <= east) bounds. The pieces are what monotonic-only consumers
 * (Overpass, the military validator, tile math) need; the union of the
 * pieces is exactly the input.
 * @param {unknown} input Bounds in either accepted shape.
 * @returns {Array<{west:number, south:number, east:number, north:number}>|null}
 *   One or two non-crossing bounds, or null for unusable input.
 */
export function splitAtAntimeridian(input) {
  const bounds = normalizeBounds(input);
  if (!bounds) return null;
  if (bounds.west <= bounds.east) return [{ ...bounds }];
  return [
    { west: bounds.west, south: bounds.south, east: 180, north: bounds.north },
    { west: -180, south: bounds.south, east: bounds.east, north: bounds.north },
  ];
}

/**
 * Bounds as a GeoJSON-style `[west, south, east, north]` array — the
 * shape `src/data/adminBoundaries.js` and
 * `src/data/naturalEarthRegions.js` store.
 * @param {unknown} input Bounds in either accepted shape.
 * @returns {Array<number>|null} The array form, or null for unusable input.
 */
export function boundsToArray(input) {
  const bounds = normalizeBounds(input);
  if (!bounds) return null;
  return [bounds.west, bounds.south, bounds.east, bounds.north];
}
