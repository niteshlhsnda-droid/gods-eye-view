/**
 * @module cameraLabelHonesty
 *
 * Camera-feed display-label honesty (Cycle 17, chatgpt lane).
 *
 * Pure function that turns a camera feed's metadata — refresh cadence,
 * loop vs live transport, health status, last-known-good timestamp, source —
 * into the single honest display label. Encodes the standing honesty rule
 * from `docs/data-freshness-live-labels.md` ("a static label must never
 * assert liveness"; `LIVE` only for a fresh dynamic feed) and the CCTV
 * precedent in `src/layers/cctv/presentation.js` (`LIVE STREAM` for HLS
 * only, never for looping clips) as a data-aware function that also covers
 * staleness and the Oct-15 "FAILED TO FETCH CAMERAS" case: while the fetch
 * pipeline is failing, the label can never read LIVE or CONTINUOUS — the
 * badge must agree with the banner.
 *
 * Label vocabulary (the complete set — nothing else may render as a
 * liveness claim):
 *
 * | Label      | Meaning                                                                 |
 * |------------|-------------------------------------------------------------------------|
 * | `LIVE`       | Truly streaming now: HLS transport, fetch pipeline working, fresh frame. |
 * | `CONTINUOUS` | Regularly refreshed but not live: a looping finite video clip or a       |
 * |            | snapshot/still being re-fetched on cadence, last good frame fresh.      |
 * | `STALE`      | Last good fetch older than the staleness threshold (or the pipeline is   |
 * |            | failing after at least one good fetch): the picture is out of date.     |
 * | `UNKNOWN`    | No frame ever received, or no health/fetch data to judge by: we cannot  |
 * |            | say what this feed is.                                                  |
 *
 * This module is a specification, not yet wired into any view. A view
 * adopts it when it renders `cameraFeedHonestyLabel(meta).label` next to
 * the camera's picture. See `docs/camera-label-honesty.md`.
 */

/**
 * The complete honest label vocabulary. Callers must render one of these
 * (or the companion `reason`) — never a hand-rolled liveness claim.
 * @type {{LIVE:'LIVE', CONTINUOUS:'CONTINUOUS', STALE:'STALE', UNKNOWN:'UNKNOWN'}}
 */
export const CAMERA_LABEL = Object.freeze({
  LIVE: 'LIVE',
  CONTINUOUS: 'CONTINUOUS',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Default staleness threshold: a feed whose newest good frame is older than
 * this reads STALE. CCTV's idle snapshot cadence is 60 s
 * (`IDLE_FRAME_REFRESH_MS` in `./policy.js`); 15 min is 15x that, well past
 * any normal poll jitter, so a STALE reading means the upstream (or the
 * pipeline) is genuinely not delivering.
 */
export const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

/** @param {unknown} feedType */
function isStreamingTransport(feedType) {
  return (
    String(feedType ?? '')
      .trim()
      .toLowerCase() === 'hls'
  );
}

/** @param {unknown} feedType */
function isLoopedVideo(feedType) {
  const t = String(feedType ?? '')
    .trim()
    .toLowerCase();
  return t === 'mp4' || t === 'webm';
}

/** @param {unknown} v */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatAge(ageMs) {
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/**
 * Honest display label for one camera feed.
 *
 * Decision order is deliberate: we never claim LIVE/CONTINUOUS on absence
 * of evidence (no frame ever, unknown health) and never claim it while the
 * fetch pipeline reports failure.
 *
 * @param {object} [meta={}] Feed metadata.
 * @param {string|null|undefined} [meta.feedType] - 'hls' | 'mp4' | 'webm' |
 *   'image' | 'mjpeg' | … (case-insensitive; unknown types are snapshots).
 * @param {string|null|undefined} [meta.healthStatus] - 'ok' | 'failed' |
 *   'unknown' (from the health sync; 'failed' is the Oct-15 banner case).
 * @param {number|null|undefined} [meta.lastGoodFetchMs] - Timestamp of the
 *   last successfully fetched frame (ms since epoch).
 * @param {number|null|undefined} [meta.refreshCadenceMs] - Expected
 *   re-fetch cadence in ms, when known (surfaced in the reason string).
 * @param {number} [meta.staleThresholdMs=DEFAULT_STALE_AFTER_MS] - Age
 *   beyond which the feed reads STALE.
 * @param {number} [meta.nowMs=Date.now()] - Clock (injectable for tests).
 * @returns {{label: 'LIVE'|'CONTINUOUS'|'STALE'|'UNKNOWN', reason: string}}
 *   `label` is the display token; `reason` is the one-line justification
 *   for tooltips / QA.
 */
export function cameraFeedHonestyLabel(meta = {}) {
  const feedType = meta?.feedType ?? null;
  const healthStatus = String(meta?.healthStatus ?? '')
    .trim()
    .toLowerCase();
  const failed = healthStatus === 'failed';
  const now = isFiniteNumber(meta?.nowMs) ? meta.nowMs : Date.now();
  const threshold =
    isFiniteNumber(meta?.staleThresholdMs) && meta.staleThresholdMs > 0
      ? meta.staleThresholdMs
      : DEFAULT_STALE_AFTER_MS;
  const lastGood = isFiniteNumber(meta?.lastGoodFetchMs)
    ? meta.lastGoodFetchMs
    : null;
  // Future timestamps are clock skew, not fresh data: clamp to now.
  const ageMs = lastGood === null ? Infinity : Math.max(0, now - lastGood);
  const cadence = isFiniteNumber(meta?.refreshCadenceMs)
    ? meta.refreshCadenceMs
    : null;
  const cadenceNote =
    cadence !== null ? `, refreshed every ${formatAge(cadence)}` : '';
  const ageNote =
    ageMs === Infinity
      ? 'no frame received yet'
      : `last good frame ${formatAge(ageMs)} ago`;

  // No evidence at all: never invent a liveness claim.
  if (ageMs === Infinity) {
    return {
      label: CAMERA_LABEL.UNKNOWN,
      reason: failed
        ? 'no frame received yet; fetch pipeline failing'
        : 'no frame received yet; feed status unknown',
    };
  }

  // Pipeline failure overrides everything else: the badge must agree with
  // the fetch-failure banner instead of claiming the feed is fine.
  if (failed) {
    return {
      label: CAMERA_LABEL.STALE,
      reason: `fetch pipeline failing; ${ageNote}`,
    };
  }

  if (ageMs > threshold) {
    return {
      label: CAMERA_LABEL.STALE,
      reason: `stale feed; ${ageNote}${cadenceNote}`,
    };
  }

  if (isStreamingTransport(feedType)) {
    return { label: CAMERA_LABEL.LIVE, reason: `HLS streaming; ${ageNote}` };
  }

  return {
    label: CAMERA_LABEL.CONTINUOUS,
    reason: isLoopedVideo(feedType)
      ? `looped clip; ${ageNote}${cadenceNote}`
      : `snapshot refresh; ${ageNote}${cadenceNote}`,
  };
}
