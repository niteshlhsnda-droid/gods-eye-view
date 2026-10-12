/**
 * Multi-globe comparison model — pure, renderer-independent logic.
 *
 * A comparison pairs a BEFORE state (e.g. pre-event imagery + pre-event
 * geometry) with an AFTER state, computes Turf-derived deltas between the two
 * geometries (flood-area delta being the canonical example), and describes how
 * the two panes should be laid out on screen.
 *
 * Turf is injected, never imported, so this module stays testable and does not
 * hard-require the dependency in unit tests. Only `area` and `difference` are
 * used; callers pass any object exposing those functions (e.g. the real
 * `@turf/turf` module once installed, or a stub in tests).
 */

export const COMPARE_MODES = Object.freeze(['split', 'side-by-side']);

/**
 * Build a comparison descriptor from two pane states.
 * @param {{before:{label:string, product?:string|null, day?:string|null, geometry?:Object|null}, after:{label:string, product?:string|null, day?:string|null, geometry?:Object|null}, mode?:'split'|'side-by-side', title?:string|null}} spec
 */
export function createComparisonSpec({
  before,
  after,
  mode = 'split',
  title = null,
} = {}) {
  if (!before || typeof before !== 'object')
    throw new Error('before is required');
  if (!after || typeof after !== 'object') throw new Error('after is required');
  if (!COMPARE_MODES.includes(mode))
    throw new Error(`unsupported compare mode: ${mode}`);
  const id = `cmp-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
  return {
    id,
    title: title ?? `${before.label ?? 'Before'} vs ${after.label ?? 'After'}`,
    mode,
    before: normalizePane(before),
    after: normalizePane(after),
  };
}

function normalizePane(pane) {
  return {
    label: String(pane.label ?? 'Pane'),
    product: pane.product ?? null,
    day: pane.day ?? null,
    geometry: pane.geometry ?? null,
  };
}

/** Geometry types we accept for delta computation. */
const SUPPORTED_GEOMETRY_TYPES = new Set([
  'Polygon',
  'MultiPolygon',
  'Feature',
  'FeatureCollection',
]);

/**
 * Compute the area delta between before/after geometries.
 *
 * @param {Object} turf Module exposing `area(geojson)` (m²) and `difference(a, b)`.
 * @param {Object|null} beforeGeojson GeoJSON polygon(s) for the before state.
 * @param {Object|null} afterGeojson GeoJSON polygon(s) for the after state.
 * @returns {{beforeKm2:number|null, afterKm2:number|null, deltaKm2:number|null, pctChange:number|null, addedKm2:number|null, removedKm2:number|null}}
 */
export function computeAreaDelta(turf, beforeGeojson, afterGeojson) {
  const empty = {
    beforeKm2: null,
    afterKm2: null,
    deltaKm2: null,
    pctChange: null,
    addedKm2: null,
    removedKm2: null,
  };
  if (
    !turf ||
    typeof turf.area !== 'function' ||
    typeof turf.difference !== 'function'
  )
    return empty;
  if (!isComparable(beforeGeojson) || !isComparable(afterGeojson)) return empty;
  const beforeKm2 = turf.area(beforeGeojson) / 1e6;
  const afterKm2 = turf.area(afterGeojson) / 1e6;
  const deltaKm2 = afterKm2 - beforeKm2;
  const added = turf.difference(afterGeojson, beforeGeojson);
  const removed = turf.difference(beforeGeojson, afterGeojson);
  return {
    beforeKm2,
    afterKm2,
    deltaKm2,
    pctChange: beforeKm2 > 0 ? (deltaKm2 / beforeKm2) * 100 : null,
    addedKm2: added ? turf.area(added) / 1e6 : 0,
    removedKm2: removed ? turf.area(removed) / 1e6 : 0,
  };
}

function isComparable(geojson) {
  if (!geojson || typeof geojson !== 'object') return false;
  if (SUPPORTED_GEOMETRY_TYPES.has(geojson.type)) return true;
  return false;
}

/** Human-readable one-liner for a computed delta. */
export function describeDelta(delta, { unit = 'km²' } = {}) {
  if (!delta || delta.deltaKm2 == null) return 'No comparable geometry';
  const fmt = (n) =>
    `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`;
  const pct =
    delta.pctChange == null
      ? ''
      : ` (${delta.pctChange >= 0 ? '+' : '−'}${Math.abs(delta.pctChange).toFixed(0)}%)`;
  return `${fmt(delta.deltaKm2)}${pct}`;
}

/** Clamp the split-divider position to the unit range. */
export function clampSplitPosition(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Describe a comparison HUD snapshot: labels, delta text and pane metadata.
 * Renderers use this to paint the overlay; no DOM here.
 */
export function comparisonHud(spec, delta) {
  return {
    title: spec.title,
    mode: spec.mode,
    before: {
      label: spec.before.label,
      product: spec.before.product,
      day: spec.before.day,
    },
    after: {
      label: spec.after.label,
      product: spec.after.product,
      day: spec.after.day,
    },
    deltaText: describeDelta(delta),
    delta,
  };
}
