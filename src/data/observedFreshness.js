/**
 * Observed-vs-fetched freshness labels.
 *
 * A freshness label must report when the DATA was observed, not when it was
 * fetched. A refetch of the same old dataset resets a fetch-time clock to
 * "just now" while the observations stay hours old — that is how a stale
 * feed gets narrated as fresh. The rule for every label built here:
 *
 * - The headline age is always the observation age (`observedAt`).
 * - The fetch time appears only as a labelled suffix, and only when the
 *   refetch is materially newer than the observation (see
 *   OBSERVED_FETCHED_DISCLOSURE_GAP_MS), so a refetch of old data is
 *   disclosed instead of hidden.
 * - When no observation time exists, the label says the observation age is
 *   unknown — fetch time is never silently presented as observation time.
 *
 * Precedent: transit already keeps this distinction per vehicle
 * (`timestampSource: 'vehicle' | 'header' | 'fetch'` in
 * `src/data/transitProxy.js`). This module is the shared label form of that
 * ladder. The rule itself lives in
 * `docs/observed-vs-fetched-freshness.md`.
 *
 * @module data/observedFreshness
 */

/**
 * A refetch is worth disclosing when it is at least this much newer than
 * the newest observation. Below the gap the two clocks agree closely
 * enough that the suffix would be noise.
 */
export const OBSERVED_FETCHED_DISCLOSURE_GAP_MS = 5 * 60 * 1000;

/** Valid epoch-ms stamp, or null for missing/invalid/non-positive input. */
function validStamp(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * Millisecond delta → `<1m ago` / `Xm ago` / `Xh ago`, mirroring the
 * FIRMS fresh-feed readout (`formatAgoMinutes`). Invalid or future
 * deltas read `just now` rather than a negative age.
 * @param {number} deltaMs Milliseconds between the stamp and now.
 * @returns {string} Compact age string.
 */
export function formatObservedAge(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 'just now';
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return '<1m ago';
  if (minutes < 90) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * One honest freshness label from an observation time and a fetch time.
 * @param {object} [times] Timestamps, epoch ms.
 * @param {number|null|undefined} [times.observedAt] When the data itself
 *   was observed (e.g. a FIRMS detection's acquisition time).
 * @param {number|null|undefined} [times.fetchedAt] When the data was
 *   fetched (e.g. the proxy's cache time).
 * @param {number} [times.now=Date.now()] Clock for tests.
 * @returns {string} `observed 5h ago · fetched <1m ago`, `observed 3m ago`,
 *   `fetched 10m ago · observation age unknown`, or `age unknown`.
 */
export function observedFreshnessLabel({
  observedAt,
  fetchedAt,
  now = Date.now(),
} = {}) {
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const observed = validStamp(observedAt);
  const fetched = validStamp(fetchedAt);
  if (observed === null) {
    if (fetched === null) return 'age unknown';
    return `fetched ${formatObservedAge(at - fetched)} · observation age unknown`;
  }
  const observedAge = formatObservedAge(at - observed);
  if (
    fetched !== null &&
    fetched - observed >= OBSERVED_FETCHED_DISCLOSURE_GAP_MS
  ) {
    return `observed ${observedAge} · fetched ${formatObservedAge(at - fetched)}`;
  }
  return `observed ${observedAge}`;
}

/**
 * Newest observation time across records, or null when none carries one.
 * @param {Array<object>|null|undefined} items Records to scan.
 * @param {(item: object) => number} [pickMs] Observation-time picker.
 *   Defaults to FIRMS detections (`acqMs`); other callers pass their own.
 * @returns {number|null} Newest valid epoch-ms observation time, or null.
 */
export function newestObservedAt(items, pickMs = (item) => item?.acqMs) {
  let newest = null;
  for (const item of items || []) {
    const stamp = validStamp(
      typeof pickMs === 'function' ? pickMs(item) : null,
    );
    if (stamp !== null && (newest === null || stamp > newest)) newest = stamp;
  }
  return newest;
}
