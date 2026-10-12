/**
 * H3 hex-density aggregation for the deck.gl overlay.
 *
 * Aggregates entity data into H3 cells and emits H3HexagonLayer-ready props.
 * The `h3` API is injected (defaulting to a dynamic `import('h3-js')`) so the
 * aggregation math stays unit-testable without the dependency installed.
 */

export const H3_MIN_RESOLUTION = 2;
export const H3_MAX_RESOLUTION = 6;

/**
 * Choose an H3 resolution from camera altitude (meters above the ellipsoid).
 * Zoomed out -> coarse cells; zoomed in -> fine cells.
 */
export function resolutionForAltitude(altitudeM) {
  const alt = Number(altitudeM);
  if (!Number.isFinite(alt) || alt <= 0) return 3;
  if (alt > 12_000_000) return 2;
  if (alt > 5_000_000) return 3;
  if (alt > 1_500_000) return 4;
  if (alt > 400_000) return 5;
  return 6;
}

/** Clamp a caller-supplied resolution into the supported band. */
export function clampResolution(resolution) {
  const r = Math.floor(Number(resolution));
  if (!Number.isFinite(r)) return 3;
  return Math.min(H3_MAX_RESOLUTION, Math.max(H3_MIN_RESOLUTION, r));
}

function boundaryToPolygon(boundary) {
  // h3-js returns [[lat, lng], ...]; deck.gl wants [[lng, lat], ...].
  const ring = boundary.map(([lat, lng]) => [lng, lat]);
  if (ring.length > 0) ring.push([...ring[0]]);
  return [ring];
}

/**
 * Aggregate deck.gl data into H3 cells.
 * @param {Array} data - deck.gl data (entityToDatum output).
 * @param {object} h3 - h3-js API (latLngToCell, cellToBoundary).
 * @param {number} resolution - H3 resolution 0-15 (clamped to 2-6).
 * @returns {Array<{hex, count, polygon}>}
 */
export function aggregateToH3(data, h3, resolution) {
  if (!h3 || typeof h3.latLngToCell !== 'function')
    throw new TypeError('An h3-js API is required');
  const res = clampResolution(resolution);
  const counts = new Map();
  for (const d of data ?? []) {
    const pos = d?.position;
    if (!Array.isArray(pos)) continue;
    const [lon, lat] = pos;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const clampedLat = Math.max(-90, Math.min(90, lat));
    const cell = h3.latLngToCell(clampedLat, lon, res);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  const cells = [];
  for (const [hex, count] of counts) {
    cells.push({
      hex,
      count,
      polygon: boundaryToPolygon(h3.cellToBoundary(hex)),
    });
  }
  cells.sort((a, b) => b.count - a.count);
  return cells;
}

/** Log-scale count -> amber/red fill color ramp. */
export function densityFillColor(count, maxCount) {
  const t =
    maxCount > 1
      ? Math.log(1 + count) / Math.log(1 + maxCount)
      : count > 0
        ? 1
        : 0;
  const r = Math.round(255 * (0.35 + 0.65 * t));
  const g = Math.round(140 * (1 - 0.55 * t));
  const b = Math.round(40 * (1 - 0.5 * t));
  return [r, g, b, Math.round(90 + 140 * t)];
}

/** H3HexagonLayer props for the density overlay (deck.gl constructs the layer). */
export function h3HexagonProps(cells, { id = 'deck-h3-density' } = {}) {
  const maxCount = cells.reduce((m, c) => Math.max(m, c.count), 0);
  return {
    id,
    data: cells,
    pickable: true,
    filled: true,
    extruded: false,
    stroked: true,
    getHexagon: (d) => d.hex,
    getFillColor: (d) => densityFillColor(d.count, maxCount),
    getLineColor: [255, 255, 255, 60],
    lineWidthMinPixels: 1,
    parameters: { depthTest: false },
  };
}
