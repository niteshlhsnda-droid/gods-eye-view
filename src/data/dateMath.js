/**
 * Shared calendar-date math: strict ISO-8601 parsing, UTC calendar
 * arithmetic, and calendar-aware duration/age formatting.
 *
 * Non-overlap with `src/data/timeMath.js` (Cycle 5, `idea/gemini-…`):
 * timeMath owns ELAPSED-time helpers — millisecond deltas, staleness,
 * `formatAge`/`formatAgo` bucket labels, the `M:SS` / `H:MM:SS` clock
 * formatter, and UTC slice formatters. This module owns CALENDAR
 * arithmetic instead: validating that a date exists on the calendar
 * (`2026-02-30` is rejected, not rolled over to March), adding months
 * with end-of-month clamping (Jan 31 + 1 month -> Feb 28/29, never
 * Mar 3), whole-UTC-calendar-day differences, calendar breakdowns
 * (years/months/days via the calendar, not fixed 365/30-day buckets),
 * and calendar ages (`2y 3mo`, not an elapsed bucket).
 *
 * Canonical semantics (standalone — no call sites re-pointed):
 * - Pure: no DOM, no Cesium, no imports. All inputs/outputs are plain
 *   numbers, strings, booleans, or plain objects.
 * - UTC only. Every operation is computed in UTC, so daylight-saving
 *   transitions can never shift a result. There is intentionally no
 *   local-time API here.
 * - Error values: `null` on invalid input — never a throw, never `NaN`.
 *   Boolean-returning functions return `false` on invalid input.
 *   `parseIso8601` returns epoch milliseconds or `null`; numeric
 *   helpers (`daysInMonth`, `addDays`, `diffInCalendarDays`, …) return
 *   `null` on invalid input; string formatters return `null` on
 *   invalid input (this differs from timeMath's `''` convention).
 * - `parseIso8601` is STRICT: the string must be a full ISO-8601
 *   calendar date (`YYYY-MM-DD`) with an optional `T` time part, and a
 *   datetime MUST carry a timezone (`Z` or `±HH:MM`). Missing timezones,
 *   space separators, week dates (`YYYY-Www-D`), ordinal dates
 *   (`YYYY-DDD`), leap seconds (`:60`), and calendar-impossible dates
 *   (`2026-02-30`, month 13, day 00) all return `null`. Fractional
 *   seconds are limited to millisecond precision (1–3 digits).
 * - Month arithmetic clamps: `addMonths` keeps the time-of-day and
 *   clamps the day to the target month's last day.
 * - `formatDuration` is the multi-unit compact form (`2d 3h`,
 *   `1m 30s`) — NOT timeMath's clock form (`M:SS` / `H:MM:SS`).
 * - `formatCalendarAge` is a calendar age (`2y 3mo`, `9mo 3d`); for
 *   ages under one day it falls back to `formatDuration` (`5h 30m`).
 *
 * Adoption follow-up (NOT done here): migrating a call site means adding
 * this file to every boundary group that owns the importing module
 * (`scripts/package-boundaries.json` rejects unowned transitive imports),
 * so migration is a separate, per-group change — no call site is
 * re-pointed in this commit.
 *
 * @module data/dateMath
 */

/** Milliseconds in one second. */
export const SECOND_MS = 1000;
/** Milliseconds in one minute. */
export const MINUTE_MS = 60 * SECOND_MS;
/** Milliseconds in one hour. */
export const HOUR_MS = 60 * MINUTE_MS;
/** Milliseconds in one day. */
export const DAY_MS = 24 * HOUR_MS;

/** True when `value` is a finite number whose Date is valid. */
function isValidEpochMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * True when `year` is a Gregorian leap year. Returns `false` for
 * non-integer or otherwise invalid input.
 * @param {number} year Full year (e.g. 2026).
 * @returns {boolean}
 */
export function isLeapYear(year) {
  if (!Number.isInteger(year)) return false;
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Days in a calendar month.
 * @param {number} year Full year (e.g. 2026).
 * @param {number} month Month, 1–12.
 * @returns {number|null} 28–31, or `null` for invalid input.
 */
export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  const monthLengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return monthLengths[month - 1];
}

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?([Zz]|[+-]\d{2}:\d{2}))?$/;

/**
 * Strictly parse an ISO-8601 calendar date/datetime to epoch ms.
 *
 * Accepts a string (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM[:SS[.sss]]` plus a
 * mandatory `Z` / `±HH:MM` timezone when a time part is present), a
 * `Date`, or a finite epoch-millisecond number. Anything else — or any
 * calendar-impossible, mistyped, or timezone-less value — returns
 * `null`.
 * @param {string|Date|number} value
 * @returns {number|null} Epoch milliseconds, or `null` when invalid.
 */
export function parseIso8601(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'number') {
    return isValidEpochMs(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const match = ISO_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLength = daysInMonth(year, month);
  if (monthLength === null || day < 1 || day > monthLength) return null;
  const hasTime = match[4] !== undefined;
  const hour = hasTime ? Number(match[4]) : 0;
  const minute = hasTime ? Number(match[5]) : 0;
  const second = match[6] === undefined ? 0 : Number(match[6]);
  // Fractional seconds: right-pad to milliseconds (`.5` means 500ms).
  const millisecond =
    match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'));
  if (hour > 23 || minute > 59 || second > 59) return null;
  const zone = match[8];
  let offsetMs = 0;
  if (zone !== undefined && zone !== 'Z' && zone !== 'z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMs = sign * (offsetHour * HOUR_MS + offsetMinute * MINUTE_MS);
  }
  // Build via setUTCFullYear so years 0–99 are literal, not 1900-based.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  const epochMs = date.getTime() - offsetMs;
  if (!isValidEpochMs(epochMs)) return null;
  // Round-trip check: the components must survive the conversion.
  const check = new Date(epochMs + offsetMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second ||
    check.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }
  return epochMs;
}

/** Zero-pad `value` to `width` digits (no truncation for large values). */
function pad(value, width) {
  return String(value).padStart(width, '0');
}

/**
 * Epoch milliseconds to an ISO-8601 UTC calendar date.
 * @param {number} epochMs
 * @returns {string|null} `'YYYY-MM-DD'`, or `null` for invalid input.
 */
export function formatIsoDate(epochMs) {
  if (!isValidEpochMs(epochMs)) return null;
  const date = new Date(epochMs);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/**
 * Epoch milliseconds to an ISO-8601 UTC datetime (`Z` suffix).
 * @param {number} epochMs
 * @returns {string|null} `'YYYY-MM-DDTHH:MM:SSZ'`, or `null` for
 *   invalid input.
 */
export function formatIsoDateTime(epochMs) {
  if (!isValidEpochMs(epochMs)) return null;
  const date = new Date(epochMs);
  return `${formatIsoDate(epochMs)}T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}Z`;
}

/**
 * Add whole days (UTC calendar days) to a timestamp.
 * @param {number} epochMs
 * @param {number} days Integer number of days (may be negative).
 * @returns {number|null} Result epoch ms, or `null` for invalid input.
 */
export function addDays(epochMs, days) {
  if (!isValidEpochMs(epochMs) || !Number.isInteger(days)) return null;
  const result = epochMs + days * DAY_MS;
  return isValidEpochMs(result) ? result : null;
}

/**
 * Add calendar months to a timestamp, clamping the day to the target
 * month's last day (Jan 31 + 1 month -> Feb 28, or Feb 29 in a leap
 * year). The time-of-day is preserved.
 * @param {number} epochMs
 * @param {number} months Integer number of months (may be negative).
 * @returns {number|null} Result epoch ms, or `null` for invalid input.
 */
export function addMonths(epochMs, months) {
  if (!isValidEpochMs(epochMs) || !Number.isInteger(months)) return null;
  const date = new Date(epochMs);
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths - targetYear * 12;
  const targetLength = daysInMonth(targetYear, targetMonth + 1);
  if (targetLength === null) return null;
  const day = Math.min(date.getUTCDate(), targetLength);
  const result = new Date(0);
  result.setUTCFullYear(targetYear, targetMonth, day);
  result.setUTCHours(
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
  if (
    result.getUTCFullYear() !== targetYear ||
    result.getUTCMonth() !== targetMonth ||
    result.getUTCDate() !== day
  ) {
    return null;
  }
  return result.getTime();
}

/**
 * Add calendar years to a timestamp. Feb 29 clamps to Feb 28 in a
 * non-leap target year. The time-of-day is preserved.
 * @param {number} epochMs
 * @param {number} years Integer number of years (may be negative).
 * @returns {number|null} Result epoch ms, or `null` for invalid input.
 */
export function addYears(epochMs, years) {
  if (!Number.isInteger(years)) return null;
  if (!Number.isSafeInteger(years * 12)) return null;
  return addMonths(epochMs, years * 12);
}

/**
 * Start of the UTC calendar day containing `epochMs` (00:00:00.000Z).
 * @param {number} epochMs
 * @returns {number|null} Result epoch ms, or `null` for invalid input.
 */
export function startOfDayUtc(epochMs) {
  if (!isValidEpochMs(epochMs)) return null;
  const date = new Date(epochMs);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Start of the UTC calendar month containing `epochMs`.
 * @param {number} epochMs
 * @returns {number|null} Result epoch ms, or `null` for invalid input.
 */
export function startOfMonthUtc(epochMs) {
  if (!isValidEpochMs(epochMs)) return null;
  const date = new Date(epochMs);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Start of the UTC calendar year containing `epochMs`.
 * @param {number} epochMs
 * @returns {number|null} Result epoch ms, or `null` for invalid input.
 */
export function startOfYearUtc(epochMs) {
  if (!isValidEpochMs(epochMs)) return null;
  const date = new Date(epochMs);
  date.setUTCMonth(0, 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Last millisecond of the UTC calendar day containing `epochMs`
 * (23:59:59.999Z).
 * @param {number} epochMs
 * @returns {number|null} Result epoch ms, or `null` for invalid input.
 */
export function endOfDayUtc(epochMs) {
  const start = startOfDayUtc(epochMs);
  if (start === null) return null;
  const result = start + DAY_MS - 1;
  return isValidEpochMs(result) ? result : null;
}

/**
 * Whole UTC calendar days from `fromMs` to `toMs` (signed: negative
 * when `toMs` is earlier). Day-boundary based, not a 24-hour division
 * of the raw delta — two timestamps 1 hour apart across midnight differ
 * by 1 calendar day.
 * @param {number} fromMs Earlier reference timestamp.
 * @param {number} toMs Later reference timestamp.
 * @returns {number|null} Signed whole calendar days, or `null` for
 *   invalid input.
 */
export function diffInCalendarDays(fromMs, toMs) {
  const fromStart = startOfDayUtc(fromMs);
  const toStart = startOfDayUtc(toMs);
  if (fromStart === null || toStart === null) return null;
  return Math.round((toStart - fromStart) / DAY_MS);
}

/**
 * Whether two timestamps fall on the same UTC calendar day.
 * @param {number} aMs
 * @param {number} bMs
 * @returns {boolean} `false` for invalid input.
 */
export function isSameDayUtc(aMs, bMs) {
  const aStart = startOfDayUtc(aMs);
  const bStart = startOfDayUtc(bMs);
  if (aStart === null || bStart === null) return false;
  return aStart === bStart;
}

/**
 * Calendar-aware breakdown of the span from `fromMs` to `toMs`.
 * Years/months come from the calendar (month lengths and leap years
 * honoured via `addMonths`); the remainder is whole days, then
 * hours/minutes/seconds, with sub-second remainders dropped.
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {{years:number,months:number,days:number,hours:number,minutes:number,seconds:number,negative:boolean}|null}
 *   Non-negative components plus a `negative` flag (true when `toMs`
 *   precedes `fromMs`), or `null` for invalid input.
 */
export function diffCalendarBreakdown(fromMs, toMs) {
  if (!isValidEpochMs(fromMs) || !isValidEpochMs(toMs)) return null;
  const negative = toMs < fromMs;
  const start = negative ? toMs : fromMs;
  const end = negative ? fromMs : toMs;
  const startDate = new Date(start);
  const endDate = new Date(end);
  let totalMonths =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth());
  let anchor = addMonths(start, totalMonths);
  if (anchor === null || anchor > end) {
    totalMonths -= 1;
    anchor = addMonths(start, totalMonths);
    if (anchor === null) return null;
  }
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths - years * 12;
  let remainder = end - anchor;
  const days = Math.floor(remainder / DAY_MS);
  remainder -= days * DAY_MS;
  const hours = Math.floor(remainder / HOUR_MS);
  remainder -= hours * HOUR_MS;
  const minutes = Math.floor(remainder / MINUTE_MS);
  remainder -= minutes * MINUTE_MS;
  const seconds = Math.floor(remainder / SECOND_MS);
  return { years, months, days, hours, minutes, seconds, negative };
}

/**
 * Millisecond duration to a compact multi-unit label (`2d 3h`,
 * `1m 30s`). Unlike timeMath's clock formatter, this keeps the
 * largest units and drops the rest.
 * @param {number} durationMs Non-negative duration in milliseconds.
 * @param {{maxUnits?: number}} [options] Max units to show (1–4,
 *   default 2).
 * @returns {string|null} e.g. `'2d 3h'`, `'1m 30s'`, `'0s'` for a zero
 *   duration, or `null` for invalid input.
 */
export function formatDuration(durationMs, options = {}) {
  if (
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    return null;
  }
  const maxUnits = options.maxUnits === undefined ? 2 : options.maxUnits;
  if (!Number.isInteger(maxUnits) || maxUnits < 1 || maxUnits > 4) {
    return null;
  }
  let remainder = Math.floor(durationMs / SECOND_MS);
  const days = Math.floor(remainder / 86400);
  remainder -= days * 86400;
  const hours = Math.floor(remainder / 3600);
  remainder -= hours * 3600;
  const minutes = Math.floor(remainder / 60);
  const seconds = remainder - minutes * 60;
  const parts = [
    [days, 'd'],
    [hours, 'h'],
    [minutes, 'm'],
    [seconds, 's'],
  ].filter(([value]) => value > 0);
  if (parts.length === 0) return '0s';
  return parts
    .slice(0, maxUnits)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ');
}

/**
 * Calendar age of `birthMs` at `nowMs`, as the two largest calendar
 * units (`2y 3mo`, `9mo 3d`, `12d`). Ages under one day fall back to
 * `formatDuration` (`5h 30m`).
 * @param {number} birthMs Birth/start timestamp.
 * @param {number} [nowMs=Date.now()] Reference timestamp.
 * @returns {string|null} Calendar age label, or `null` for invalid
 *   input or a birth timestamp after `nowMs`.
 */
export function formatCalendarAge(birthMs, nowMs = Date.now()) {
  if (!isValidEpochMs(birthMs) || !isValidEpochMs(nowMs)) return null;
  if (birthMs > nowMs) return null;
  if (nowMs - birthMs < DAY_MS) return formatDuration(nowMs - birthMs);
  const breakdown = diffCalendarBreakdown(
    startOfDayUtc(birthMs),
    startOfDayUtc(nowMs),
  );
  if (breakdown === null) return null;
  const parts = [
    [breakdown.years, 'y'],
    [breakdown.months, 'mo'],
    [breakdown.days, 'd'],
  ].filter(([value]) => value > 0);
  if (parts.length === 0) return '0s';
  return parts
    .slice(0, 2)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ');
}
