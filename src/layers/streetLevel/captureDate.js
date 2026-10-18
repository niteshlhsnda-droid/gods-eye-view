/**
 * Display-only capture-date labels for street-level photos.
 *
 * A street-level photo is a snapshot of one moment, and that moment can be
 * years before today. The capture date already travels with the open image
 * (`state.street.capturedAt`, plus `capturedAtPrecision` — 'day' for
 * Mapillary/KartaView, 'month' for Google, whose Street View dates are
 * YYYY-MM). Nothing renders it, so an old photo reads as "now".
 *
 * These helpers are the single source of truth for turning that stored
 * date into a human-readable label. They are display-only: they never
 * feed filters, cache keys, or queries.
 *
 * Honesty rules, enforced here so no call site can get them wrong:
 * - Never invent a day. Month-precision dates render as "Mar 2024", never
 *   as the 1st of the month (the stored epoch for a Google date is the
 *   1st, but the 1st is a storage artifact, not the capture day).
 * - Never claim a future capture. A date after `nowMs` (clock skew, bad
 *   data) renders as unknown, mirroring the TLE future-epoch rule.
 * - Never print a date for a missing or malformed value. Unknown renders
 *   as "Capture date unknown", never as a blank or an epoch date.
 * - Dates render in UTC. A capture date is a calendar date, and the
 *   viewer's local timezone must not shift it across a day boundary.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAY_MS = 86_400_000;

/** Epoch ms for a usable capture date, or null when it must read unknown. */
function usableCaptureMs(capturedAt, nowMs) {
  const ms = Number(capturedAt);
  if (!Number.isFinite(ms) || ms <= 0 || ms > nowMs) return null;
  return ms;
}

function plural(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'} ago`;
}

/**
 * "Captured 12 Mar 2024" (day precision), "Captured Mar 2024" (month
 * precision), or "Capture date unknown" when the value is missing,
 * malformed, or in the future. `nowMs` defaults to now and exists so
 * tests can pin the future boundary.
 */
export function formatCaptureDate(
  capturedAt,
  precision = 'day',
  { nowMs = Date.now() } = {},
) {
  const ms = usableCaptureMs(capturedAt, nowMs);
  if (ms === null) return 'Capture date unknown';
  const date = new Date(ms);
  const month = MONTHS[date.getUTCMonth()];
  if (precision === 'month')
    return `Captured ${month} ${date.getUTCFullYear()}`;
  return `Captured ${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/**
 * Relative age of a capture date: "today" / "this month" for a current
 * one, "N day(s)/month(s)/year(s) ago" otherwise, null when the date is
 * unknown or in the future. Month-precision dates never yield a
 * day-granular age — the stored day is a placeholder, not data.
 * Calendar-based (UTC year/month/day), so "1 month ago" means the same
 * calendar month last month, not a 30-day approximation.
 */
export function captureAgeLabel(
  capturedAt,
  { precision = 'day', nowMs = Date.now() } = {},
) {
  const ms = usableCaptureMs(capturedAt, nowMs);
  if (ms === null) return null;
  const captured = new Date(ms);
  const now = new Date(nowMs);
  const yearDiff = now.getUTCFullYear() - captured.getUTCFullYear();
  const monthDiff =
    yearDiff * 12 + (now.getUTCMonth() - captured.getUTCMonth());

  if (precision === 'month') {
    if (monthDiff <= 0) return 'this month';
    if (monthDiff < 12) return plural(monthDiff, 'month');
    const years = Math.floor(monthDiff / 12);
    return plural(years, 'year');
  }

  if (
    captured.getUTCFullYear() === now.getUTCFullYear() &&
    captured.getUTCMonth() === now.getUTCMonth() &&
    captured.getUTCDate() === now.getUTCDate()
  ) {
    return 'today';
  }
  const dayDiff = Math.floor((nowMs - ms) / DAY_MS);
  if (dayDiff < 30) return plural(Math.max(dayDiff, 1), 'day');
  // Completed calendar years: the anniversary must have passed, or the
  // age is still months (19 Oct 2025 -> 18 Oct 2026 is 11 months, not
  // "1 year ago").
  const anniversaryPassed =
    now.getUTCMonth() > captured.getUTCMonth() ||
    (now.getUTCMonth() === captured.getUTCMonth() &&
      now.getUTCDate() >= captured.getUTCDate());
  const completedYears = anniversaryPassed ? yearDiff : yearDiff - 1;
  if (completedYears >= 1) return plural(completedYears, 'year');
  const months =
    now.getUTCDate() < captured.getUTCDate()
      ? Math.max(monthDiff - 1, 1)
      : monthDiff;
  return plural(months, 'month');
}

/**
 * The full panel label: "Captured 12 Mar 2024 · 2 years ago", or
 * "Capture date unknown" when the date is unusable. The age is omitted
 * only when it is unknown — a bare date with no age still invites the
 * reader to do the subtraction and get it wrong.
 */
export function captureLabel(
  capturedAt,
  precision = 'day',
  { nowMs = Date.now() } = {},
) {
  const date = formatCaptureDate(capturedAt, precision, { nowMs });
  if (date === 'Capture date unknown') return date;
  const age = captureAgeLabel(capturedAt, { precision, nowMs });
  return age === null ? date : `${date} · ${age}`;
}
