import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  diffCalendarBreakdown,
  diffInCalendarDays,
  endOfDayUtc,
  formatCalendarAge,
  formatDuration,
  formatIsoDate,
  formatIsoDateTime,
  isLeapYear,
  isSameDayUtc,
  parseIso8601,
  startOfDayUtc,
  startOfMonthUtc,
  startOfYearUtc,
} from './dateMath.js';

const utc = (...args) => Date.UTC(...args);

test('isLeapYear: Gregorian rules, rejects non-integers', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(2024.5), false);
  assert.equal(isLeapYear(NaN), false);
  assert.equal(isLeapYear('2024'), false);
});

test('daysInMonth: month lengths, leap February, invalid month', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 0), null);
  assert.equal(daysInMonth(2026, 13), null);
  assert.equal(daysInMonth(2026.5, 2), null);
  assert.equal(daysInMonth(2026, 2.5), null);
});

test('parseIso8601: date-only, Z, offsets, fractional seconds', () => {
  assert.equal(parseIso8601('2026-10-18'), utc(2026, 9, 18));
  assert.equal(parseIso8601('2026-10-18T00:00:00Z'), utc(2026, 9, 18));
  assert.equal(parseIso8601('2026-10-18T10:30:00Z'), utc(2026, 9, 18, 10, 30));
  assert.equal(parseIso8601('2026-10-18T10:30Z'), utc(2026, 9, 18, 10, 30));
  assert.equal(
    parseIso8601('2026-10-18T12:00:00+02:00'),
    utc(2026, 9, 18, 10, 0),
  );
  assert.equal(
    parseIso8601('2026-10-18T12:00:00-05:30'),
    utc(2026, 9, 18, 17, 30),
  );
  assert.equal(
    parseIso8601('2026-10-18T10:00:00.5Z'),
    utc(2026, 9, 18, 10, 0, 0, 500),
  );
  assert.equal(
    parseIso8601('2026-10-18T10:00:00,25Z'),
    utc(2026, 9, 18, 10, 0, 0, 250),
  );
  assert.equal(parseIso8601('2026-10-18t10:00:00z'), utc(2026, 9, 18, 10, 0));
});

test('parseIso8601: rejects calendar-impossible and non-strict input', () => {
  for (const bad of [
    '2026-02-30',
    '2024-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-01-32',
    '2026-10-18T25:00:00Z',
    '2026-10-18T10:60:00Z',
    '2026-10-18T10:00:60Z',
    '2026-10-18T10:00:00',
    '2026-10-18 10:00:00Z',
    '2026-W42-7',
    '2026-291',
    '2026-2-3',
    '2026-10-18T10:00:00.123456Z',
    '2026-10-18T10:00:00+24:00',
    '2026-10-18T10:00:00+10:60',
    ' 2026-10-18',
    '2026-10-18 ',
    'not a date',
    '',
    null,
    undefined,
    {},
    [],
    true,
    NaN,
    Infinity,
  ]) {
    assert.equal(parseIso8601(bad), null, `expected null for ${String(bad)}`);
  }
  assert.equal(parseIso8601(new Date(NaN)), null);
});

test('parseIso8601: Date and epoch-number passthrough', () => {
  const epoch = utc(2026, 9, 18, 10, 30);
  assert.equal(parseIso8601(new Date(epoch)), epoch);
  assert.equal(parseIso8601(epoch), epoch);
  assert.equal(parseIso8601(0), 0);
  assert.equal(parseIso8601(1e20), null);
});

test('formatIsoDate / formatIsoDateTime: round-trip, invalid -> null', () => {
  const epoch = utc(2026, 9, 18, 10, 30, 5);
  assert.equal(formatIsoDate(epoch), '2026-10-18');
  assert.equal(formatIsoDateTime(epoch), '2026-10-18T10:30:05Z');
  assert.equal(formatIsoDate(parseIso8601('2026-10-18')), '2026-10-18');
  assert.equal(formatIsoDate(NaN), null);
  assert.equal(formatIsoDate(Infinity), null);
  assert.equal(formatIsoDate('2026-10-18'), null);
  assert.equal(formatIsoDateTime(NaN), null);
});

test('addDays: whole UTC days, negative, invalid -> null', () => {
  const base = utc(2026, 9, 18, 10, 0);
  assert.equal(addDays(base, 1), utc(2026, 9, 19, 10, 0));
  assert.equal(addDays(base, -1), utc(2026, 9, 17, 10, 0));
  assert.equal(addDays(base, 0), base);
  assert.equal(addDays(utc(2026, 0, 31), 1), utc(2026, 1, 1));
  assert.equal(addDays(base, 1.5), null);
  assert.equal(addDays(NaN, 1), null);
  assert.equal(addDays(base, NaN), null);
});

test('addMonths: clamps to target month end, preserves time-of-day', () => {
  assert.equal(addMonths(utc(2026, 0, 31, 12, 0), 1), utc(2026, 1, 28, 12, 0));
  assert.equal(addMonths(utc(2024, 0, 31, 12, 0), 1), utc(2024, 1, 29, 12, 0));
  assert.equal(addMonths(utc(2026, 2, 31), -1), utc(2026, 1, 28));
  assert.equal(addMonths(utc(2026, 11, 15), 2), utc(2027, 1, 15));
  assert.equal(addMonths(utc(2026, 0, 15), -1), utc(2025, 11, 15));
  assert.equal(addMonths(utc(2026, 0, 31), 0), utc(2026, 0, 31));
  assert.equal(addMonths(utc(2026, 0, 15), 1.5), null);
  assert.equal(addMonths(NaN, 1), null);
});

test('addYears: Feb 29 clamps in non-leap targets', () => {
  assert.equal(addYears(utc(2024, 1, 29), 1), utc(2025, 1, 28));
  assert.equal(addYears(utc(2024, 1, 29), 4), utc(2028, 1, 29));
  assert.equal(addYears(utc(2026, 5, 15), -2), utc(2024, 5, 15));
  assert.equal(addYears(utc(2026, 5, 15), 1.5), null);
  assert.equal(addYears(NaN, 1), null);
});

test('start/end of day/month/year (UTC)', () => {
  const moment = utc(2026, 9, 18, 23, 59, 59, 999);
  assert.equal(startOfDayUtc(moment), utc(2026, 9, 18));
  assert.equal(startOfMonthUtc(moment), utc(2026, 9, 1));
  assert.equal(startOfYearUtc(moment), utc(2026, 0, 1));
  assert.equal(endOfDayUtc(moment), utc(2026, 9, 18, 23, 59, 59, 999));
  assert.equal(startOfDayUtc(NaN), null);
  assert.equal(startOfMonthUtc(NaN), null);
  assert.equal(startOfYearUtc(NaN), null);
  assert.equal(endOfDayUtc(NaN), null);
});

test('diffInCalendarDays: day-boundary based, signed', () => {
  assert.equal(
    diffInCalendarDays(utc(2026, 9, 18, 23, 0), utc(2026, 9, 19, 0, 30)),
    1,
  );
  assert.equal(
    diffInCalendarDays(utc(2026, 9, 18, 0, 0), utc(2026, 9, 18, 23, 59)),
    0,
  );
  assert.equal(diffInCalendarDays(utc(2026, 9, 19), utc(2026, 9, 18)), -1);
  assert.equal(diffInCalendarDays(utc(2026, 0, 1), utc(2026, 1, 1)), 31);
  assert.equal(diffInCalendarDays(NaN, utc(2026, 0, 1)), null);
  assert.equal(diffInCalendarDays(utc(2026, 0, 1), NaN), null);
});

test('isSameDayUtc: same day true, across midnight false, invalid false', () => {
  assert.equal(
    isSameDayUtc(utc(2026, 9, 18, 0, 0), utc(2026, 9, 18, 23, 59)),
    true,
  );
  assert.equal(
    isSameDayUtc(utc(2026, 9, 18, 23, 59), utc(2026, 9, 19, 0, 0)),
    false,
  );
  assert.equal(isSameDayUtc(NaN, utc(2026, 9, 18)), false);
});

test('diffCalendarBreakdown: calendar years/months/days', () => {
  assert.deepEqual(diffCalendarBreakdown(utc(2026, 0, 15), utc(2026, 9, 18)), {
    years: 0,
    months: 9,
    days: 3,
    hours: 0,
    minutes: 0,
    seconds: 0,
    negative: false,
  });
  assert.deepEqual(diffCalendarBreakdown(utc(2024, 1, 29), utc(2025, 1, 28)), {
    years: 1,
    months: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    negative: false,
  });
  assert.deepEqual(diffCalendarBreakdown(utc(2026, 0, 31), utc(2026, 2, 1)), {
    years: 0,
    months: 1,
    days: 1,
    hours: 0,
    minutes: 0,
    seconds: 0,
    negative: false,
  });
  assert.deepEqual(
    diffCalendarBreakdown(
      utc(2026, 9, 18, 10, 0),
      utc(2026, 9, 18, 12, 30, 45),
    ),
    {
      years: 0,
      months: 0,
      days: 0,
      hours: 2,
      minutes: 30,
      seconds: 45,
      negative: false,
    },
  );
  assert.deepEqual(diffCalendarBreakdown(utc(2026, 9, 18), utc(2026, 9, 18)), {
    years: 0,
    months: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    negative: false,
  });
});

test('diffCalendarBreakdown: negative spans carry the flag', () => {
  assert.deepEqual(diffCalendarBreakdown(utc(2026, 9, 18), utc(2026, 0, 15)), {
    years: 0,
    months: 9,
    days: 3,
    hours: 0,
    minutes: 0,
    seconds: 0,
    negative: true,
  });
  assert.equal(diffCalendarBreakdown(NaN, utc(2026, 0, 1)), null);
});

test('formatDuration: multi-unit compact form', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(500), '0s');
  assert.equal(formatDuration(45 * 1000), '45s');
  assert.equal(formatDuration(90 * 1000), '1m 30s');
  assert.equal(formatDuration(90 * 1000, { maxUnits: 1 }), '1m');
  assert.equal(formatDuration(2 * DAY_MS + 3 * 60 * 60 * 1000), '2d 3h');
  assert.equal(formatDuration(25 * 60 * 60 * 1000), '1d 1h');
  assert.equal(
    formatDuration(86400 * 1000 + 3600 * 1000 + 60 * 1000 + 1000, {
      maxUnits: 4,
    }),
    '1d 1h 1m 1s',
  );
  assert.equal(
    formatDuration(86400 * 1000 + 3600 * 1000 + 60 * 1000 + 1000),
    '1d 1h',
  );
  assert.equal(formatDuration(-1), null);
  assert.equal(formatDuration(NaN), null);
  assert.equal(formatDuration(Infinity), null);
  assert.equal(formatDuration(1000, { maxUnits: 0 }), null);
  assert.equal(formatDuration(1000, { maxUnits: 5 }), null);
  assert.equal(formatDuration(1000, { maxUnits: 1.5 }), null);
  assert.equal(formatDuration(1000, null), null);
  assert.equal(formatDuration(1000, []), null);
});

test('formatCalendarAge: calendar ages, sub-day fallback, future -> null', () => {
  assert.equal(formatCalendarAge(utc(2024, 0, 15), utc(2026, 9, 18)), '2y 9mo');
  assert.equal(formatCalendarAge(utc(2026, 0, 15), utc(2026, 9, 18)), '9mo 3d');
  assert.equal(formatCalendarAge(utc(2026, 9, 10), utc(2026, 9, 18)), '8d');
  assert.equal(
    formatCalendarAge(utc(2026, 9, 18, 5, 0), utc(2026, 9, 18, 10, 30)),
    '5h 30m',
  );
  assert.equal(formatCalendarAge(utc(2026, 9, 18), utc(2026, 9, 18)), '0s');
  assert.equal(formatCalendarAge(utc(2026, 9, 19), utc(2026, 9, 18)), null);
  assert.equal(formatCalendarAge(NaN, utc(2026, 9, 18)), null);
  assert.equal(formatCalendarAge(utc(2026, 9, 18), NaN), null);
});
