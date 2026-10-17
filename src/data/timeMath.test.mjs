import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  SECOND_MS,
  WEEK_MS,
  elapsedMs,
  formatAge,
  formatAgo,
  formatDurationMs,
  formatUtcDate,
  formatUtcDateTime,
  formatUtcTime,
  isStale,
  toEpochMs,
} from './timeMath.js';

test('unit constants relate by 60 / 24 / 7', () => {
  assert.equal(MINUTE_MS, 60 * SECOND_MS);
  assert.equal(HOUR_MS, 60 * MINUTE_MS);
  assert.equal(DAY_MS, 24 * HOUR_MS);
  assert.equal(WEEK_MS, 7 * DAY_MS);
  assert.equal(SECOND_MS, 1000);
});

test('elapsedMs is the plain difference and NaN on bad input', () => {
  assert.equal(elapsedMs(1000, 2500), 1500);
  assert.equal(elapsedMs(2500, 1000), -1500);
  assert.ok(Number.isNaN(elapsedMs(NaN, 1000)));
  assert.ok(Number.isNaN(elapsedMs(1000, Infinity)));
});

test('isStale is strict at the TTL boundary', () => {
  assert.equal(isStale(0, 1000, 1000), false);
  assert.equal(isStale(0, 1000, 1001), true);
  assert.equal(isStale(0, 1000, 999), false);
  assert.equal(isStale(2000, 1000, 1000), false);
});

test('isStale never reports stale for bad input', () => {
  assert.equal(isStale(NaN, 1000, 2000), false);
  assert.equal(isStale(0, NaN, 2000), false);
  assert.equal(isStale(0, -1, 2000), false);
  assert.equal(isStale(0, 1000, NaN), false);
});

test('formatAge scale: <1m, floored minutes, rounded hours, rounded days', () => {
  assert.equal(formatAge(0), '<1m');
  assert.equal(formatAge(59 * SECOND_MS), '<1m');
  assert.equal(formatAge(MINUTE_MS), '1m');
  assert.equal(formatAge(59 * MINUTE_MS + 59 * SECOND_MS), '59m');
  assert.equal(formatAge(HOUR_MS), '1h');
  assert.equal(formatAge(90 * MINUTE_MS), '2h');
  assert.equal(formatAge(47 * HOUR_MS), '47h');
  assert.equal(formatAge(48 * HOUR_MS), '2d');
  assert.equal(formatAge(36 * HOUR_MS), '36h');
  assert.equal(formatAge(10 * DAY_MS), '10d');
});

test('formatAge rejects bad input with an empty string', () => {
  assert.equal(formatAge(NaN), '');
  assert.equal(formatAge(Infinity), '');
  assert.equal(formatAge(-1), '');
  assert.equal(formatAge(undefined), '');
});

test('formatAgo appends ago and falls back to just now', () => {
  assert.equal(formatAgo(0), '<1m ago');
  assert.equal(formatAgo(5 * MINUTE_MS), '5m ago');
  assert.equal(formatAgo(90 * MINUTE_MS), '2h ago');
  assert.equal(formatAgo(3 * DAY_MS), '3d ago');
  assert.equal(formatAgo(NaN), 'just now');
  assert.equal(formatAgo(-1), 'just now');
});

test('formatDurationMs is M:SS under an hour and H:MM:SS above', () => {
  assert.equal(formatDurationMs(0), '0:00');
  assert.equal(formatDurationMs(61 * SECOND_MS), '1:01');
  assert.equal(formatDurationMs(59 * MINUTE_MS + 59 * SECOND_MS), '59:59');
  assert.equal(formatDurationMs(HOUR_MS), '1:00:00');
  assert.equal(formatDurationMs(HOUR_MS + MINUTE_MS + 5 * SECOND_MS), '1:01:05');
  assert.equal(formatDurationMs(1500), '0:01');
  assert.equal(formatDurationMs(NaN), '');
  assert.equal(formatDurationMs(-1), '');
});

test('toEpochMs accepts Date, number, and ISO string', () => {
  const epoch = Date.UTC(2026, 0, 2, 3, 4, 5);
  assert.equal(toEpochMs(new Date(epoch)), epoch);
  assert.equal(toEpochMs(epoch), epoch);
  assert.equal(toEpochMs('2026-01-02T03:04:05.000Z'), epoch);
  assert.ok(Number.isNaN(toEpochMs('not a date')));
  assert.ok(Number.isNaN(toEpochMs(null)));
  assert.ok(Number.isNaN(toEpochMs(undefined)));
});

test('UTC formatters slice a fixed instant and reject bad input', () => {
  const epoch = Date.UTC(2026, 0, 2, 3, 4, 5);
  assert.equal(formatUtcDate(epoch), '2026-01-02');
  assert.equal(formatUtcTime(epoch), '03:04:05');
  assert.equal(formatUtcDateTime(epoch), '2026-01-02 03:04 UTC');
  assert.equal(formatUtcDate(NaN), '');
  assert.equal(formatUtcTime(Infinity), '');
  assert.equal(formatUtcDateTime(undefined), '');
  assert.equal(formatUtcDate(1e300), '');
  assert.equal(formatUtcTime(1e300), '');
  assert.equal(formatUtcDateTime(1e300), '');
});
