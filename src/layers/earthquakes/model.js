import * as Cesium from 'cesium';
import { normalizeEarthquakeReviewStatus } from './records.js';
export const EARTHQUAKE_OVERLAY_SOURCE_ID = 'earthquakes';
export const EARTHQUAKE_OVERLAY_COHORT_LIMIT = 96;
export const EARTHQUAKE_OVERLAY_COLLISION_CAPACITY = 48;

/** Neutral for an unreported/invalid depth — the shared "unknown" grey
 * (#91a4b4, the bikeshare COLOR_NEUTRAL precedent). An unknown depth
 * must never render as a measured band. */
export const UNKNOWN_DEPTH_COLOR = Cesium.Color.fromCssColorString('#91a4b4');

/**
 * Color by depth:
 *  - Shallow (<70km): Red
 *  - Intermediate (70-300km): Orange
 *  - Deep (>300km): Yellow
 *  - Unknown (missing, non-finite, or negative): neutral grey — mirrors
 *    `labelEarthquakeDepthBand`, which reads those as "Depth unknown".
 *    A reported depth of exactly 0 is a real shallow measurement and
 *    stays red.
 */
export function depthColor(depthKm) {
  if (typeof depthKm !== 'number' || !Number.isFinite(depthKm) || depthKm < 0)
    return UNKNOWN_DEPTH_COLOR;
  if (depthKm < 70) return Cesium.Color.RED;
  if (depthKm < 300) return Cesium.Color.ORANGE;
  return Cesium.Color.YELLOW;
}

/**
 * Human-readable review label for one earthquake's USGS review state.
 * Automatic events are machine-located and unreviewed: their magnitude and
 * location can still change on human review, so they are labelled
 * PRELIMINARY, never shown as final. Reviewed events carry the plain
 * `Reviewed` label. Null / unknown states return null — no review claim
 * in either direction. See `docs/earthquake-review-status.md`.
 * @param {string|null|undefined} reviewStatus Normalized review state.
 * @returns {string|null}
 */
export function earthquakeReviewLabel(reviewStatus) {
  if (reviewStatus === 'automatic')
    return 'PRELIMINARY · automatic (unreviewed)';
  if (reviewStatus === 'reviewed') return 'Reviewed';
  return null;
}

/**
 * Build the source-owned presentation for one ambient magnitude label.
 * Magnitude formatting deliberately remains here instead of moving into the
 * shared renderer.
 * @param {object} input
 * @param {string} input.id Stable USGS or deterministic fallback id.
 * @param {Cesium.Cartesian3} input.position Ground anchor shared with the pulse.
 * @param {number} input.magnitude USGS magnitude.
 * @param {string} input.accent Source-owned depth-band color.
 * @param {string|null} [input.reviewStatus] Normalized USGS review state.
 * @returns {object}
 */
export function createEarthquakeOverlayEntry({
  id,
  position,
  magnitude,
  accent,
  reviewStatus = null,
}) {
  const mag = Number(magnitude);
  const title =
    normalizeEarthquakeReviewStatus(reviewStatus) === 'automatic'
      ? `M${mag.toFixed(1)} · PRELIMINARY`
      : `M${mag.toFixed(1)}`;
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    accent,
    priority: Math.round(mag * 1000),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the largest events, with stable identity as the tie-break. */
export function selectEarthquakeOverlayCohort(
  entries,
  limit = EARTHQUAKE_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(EARTHQUAKE_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
  );
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort(
      (a, b) =>
        b.priority - a.priority || String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, cap);
}

/**
 * Map one earthquake's raw plain values to a JSON-safe analyst record
 * (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id
 * when the USGS event id is absent.
 * @param {Object|null|undefined} raw - Plain values pulled off the entity:
 *   {id, mag, place, time, depth, lat, lon, reviewStatus}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, magnitude: number|null, depthKm: number|null,
 *   lat: number|null, lon: number|null, timeMs: number|null, place: string|null,
 *   reviewStatus: 'automatic'|'reviewed'|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.id) || `QUAKE-${String(index).padStart(4, '0')}`,
    magnitude: num(raw?.mag),
    depthKm: num(raw?.depth),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    timeMs: num(raw?.time), // USGS epoch ms
    place: text(raw?.place),
    reviewStatus: normalizeEarthquakeReviewStatus(raw?.reviewStatus),
  };
}

export {
  normalizeEarthquakeSnapshot,
  normalizeEarthquakeReviewStatus,
} from './records.js';
