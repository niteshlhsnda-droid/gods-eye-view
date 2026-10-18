/**
 * Shared time/interval math and UTC formatting.
 *
 * Elapsed-time and UTC formatting currently exist as divergent inline
 * copies (evidence, `origin/main` @ `05ad633`):
 * - Two `formatAge` implementations with DIFFERENT scales and rounding:
 *   `src/layers/firms/model.js:482` returns `'<1h'` / rounded `"Xh"` /
 *   rounded `"Xd"` (and `''` for invalid input), while
 *   `src/layers/perimeters/cards.js:81` returns floored `"Nm"` / `"Nh"` /
 *   `"Nd"` (and `null` for invalid input). A 30-minute-old fire reads
 *   `'<1h'` in one layer and `'30m'` in the other; a 90-minute-old
 *   incident reads `'2h'` (rounded) in one and `'1h'` (floored) in the
 *   other. `formatAge` here fixes one canonical scale (see below).
 * - A third age shape, `formatAgoMinutes` (`firms/model.js:490`),
 *   returns `'<1m ago'` / `"Xm ago"` / rounded `"Xh ago"` and
 *   `'just now'` for invalid input — `formatAgo` here canonicalises it.
 * - Ad-hoc staleness checks: `Date.now() - lastUpdate < TTL` appears in
 *   `src/layers/alpr/index.js:132`, `src/layers/perimeters/index.js:86`
 *   and elsewhere, with no shared definition of the exact-TTL boundary.
 * - UTC slicing: `new Date(x).toISOString().slice(0, 10)` (date) appears
 *   in `src/data/tomtomTiles.js:140`, `src/data/layerState.js:266`,
 *   `src/layers/recentImagery/model.js:246,261,358` and
 *   `src/layers/streetLevel/providers/kartaview/policy.js:174`;
 *   `.slice(11, 19)` (time) in `src/ui/cockpitSignals.js:56`,
 *   `src/layers/vessels/cards.js:169`, `src/layers/gnss/index.js:379`;
 *   `.slice(5, 16).replace('T', ' ')` (date-time) in
 *   `src/ui/railTimeline.js:6` and `src/ui/weatherPanel.js:17`, and
 *   `.slice(0, 16).replace('T', ' ')` in `src/layers/wind/index.js:20`.
 *   Each copy re-derives the slice indices and none guards invalid input
 *   (an invalid Date throws `RangeError` from `toISOString`).
 * - Clock durations: `elapsedLabel` (`src/data/bhoteKoshiEvent.js:174`)
 *   formats a progress fraction as `"M:SS"`; there is no shared
 *   milliseconds-to-clock formatter.
 *
 * This module fixes one canonical semantics per operation:
 * - `formatAge`: invalid/negative input -> `''` (the firms convention);
 *   under a minute -> `'<1m'`; under an hour -> floored `"Nm"`;
 *   under 48 hours -> ROUNDED `"Xh"` (the firms convention, so 90 min
 *   reads `'2h'`); beyond -> ROUNDED `"Xd"`. This deliberately differs
 *   from the perimeters copy (floored hours, `null` on invalid input).
 * - `formatAgo`: `formatAge` plus `' ago'`; invalid/negative input ->
 *   `'just now'` (the firms `formatAgoMinutes` convention).
 * - `isStale`: a timestamp is stale when its age is STRICTLY greater
 *   than the TTL — at exactly the TTL it is still fresh. Non-finite
 *   timestamps/TTLs and negative TTLs are never stale.
 * - UTC formatters return `''` for invalid input instead of throwing.
 *
 * Pure: no DOM, no Cesium, no imports. All inputs/outputs are plain
 * numbers and strings; `Date.now()` is only the default `nowMs`.
 *
 * Adoption follow-up (NOT done here): migrating a call site means adding
 * this file to every boundary group that owns the importing module
 * (`scripts/package-boundaries.json` rejects unowned transitive imports),
 * so migration is a separate, per-group change — no call site is
 * re-pointed in this commit.
 *
 * @module data/timeMath
 */

/** Milliseconds in one second. */
export const SECOND_MS = 1000;
/** Milliseconds in one minute. */
export const MINUTE_MS = 60 * SECOND_MS;
/** Milliseconds in one hour. */
export const HOUR_MS = 60 * MINUTE_MS;
/** Milliseconds in one day. */
export const DAY_MS = 24 * HOUR_MS;
/** Milliseconds in one week. */
export const WEEK_MS = 7 * DAY_MS;

/**
 * Elapsed milliseconds between two epoch timestamps.
 * @param {number} fromMs Earlier epoch timestamp, milliseconds.
 * @param {number} [nowMs=Date.now()] Later epoch timestamp, milliseconds.
 * @returns {number} `nowMs - fromMs`, or NaN when either input is non-finite.
 */
export function elapsedMs(fromMs, nowMs = Date.now()) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) return NaN;
  return nowMs - fromMs;
}

/**
 * Whether a timestamp is older than a time-to-live.
 * @param {number} timestampMs Epoch timestamp to test, milliseconds.
 * @param {number} ttlMs Time-to-live, milliseconds.
 * @param {number} [nowMs=Date.now()] Reference epoch timestamp, milliseconds.
 * @returns {boolean} True when the age is strictly greater than the TTL.
 *   False for non-finite inputs, negative TTLs, and future timestamps.
 */
export function isStale(timestampMs, ttlMs, nowMs = Date.now()) {
  if (
    !Number.isFinite(timestampMs) ||
    !Number.isFinite(ttlMs) ||
    !Number.isFinite(nowMs) ||
    ttlMs < 0
  ) {
    return false;
  }
  return nowMs - timestampMs > ttlMs;
}

/**
 * Millisecond delta to a compact age label.
 * @param {number} deltaMs Age in milliseconds.
 * @returns {string} `'<1m'` / `"Nm"` / `"Xh"` / `"Xd"`, or `''` for
 *   non-finite or negative input.
 */
export function formatAge(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return '';
  if (deltaMs < MINUTE_MS) return '<1m';
  if (deltaMs < HOUR_MS) return `${Math.floor(deltaMs / MINUTE_MS)}m`;
  if (deltaMs < 48 * HOUR_MS) return `${Math.round(deltaMs / HOUR_MS)}h`;
  return `${Math.round(deltaMs / DAY_MS)}d`;
}

/**
 * Millisecond delta to a compact "… ago" label.
 * @param {number} deltaMs Age in milliseconds.
 * @returns {string} `formatAge(deltaMs) + ' ago'`, or `'just now'` for
 *   non-finite or negative input.
 */
export function formatAgo(deltaMs) {
  const age = formatAge(deltaMs);
  return age === '' ? 'just now' : `${age} ago`;
}

/**
 * Millisecond delta to a clock duration.
 * @param {number} deltaMs Duration in milliseconds.
 * @returns {string} `"M:SS"` under an hour, `"H:MM:SS"` at or above an
 *   hour, or `''` for non-finite or negative input.
 */
export function formatDurationMs(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return '';
  const totalSeconds = Math.floor(deltaMs / SECOND_MS);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}:${String(seconds).padStart(2, '0')}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Coerce a Date, epoch number, or parseable date string to epoch ms.
 * @param {Date|number|string} value
 * @returns {number} Finite epoch milliseconds, or NaN when unparseable.
 */
export function toEpochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

/** `toISOString()` for an epoch value, or null when it is not a real date. */
function isoStringOrNull(epochMs) {
  if (!Number.isFinite(epochMs)) return null;
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Epoch milliseconds to a UTC date string.
 * @param {number} epochMs
 * @returns {string} `'YYYY-MM-DD'`, or `''` for non-finite input.
 */
export function formatUtcDate(epochMs) {
  const iso = isoStringOrNull(epochMs);
  return iso === null ? '' : iso.slice(0, 10);
}

/**
 * Epoch milliseconds to a UTC time string.
 * @param {number} epochMs
 * @returns {string} `'HH:MM:SS'`, or `''` for non-finite input.
 */
export function formatUtcTime(epochMs) {
  const iso = isoStringOrNull(epochMs);
  return iso === null ? '' : iso.slice(11, 19);
}

/**
 * Epoch milliseconds to a UTC date-time string.
 * @param {number} epochMs
 * @returns {string} `'YYYY-MM-DD HH:MM UTC'`, or `''` for non-finite input.
 */
export function formatUtcDateTime(epochMs) {
  const iso = isoStringOrNull(epochMs);
  return iso === null ? '' : `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}
