import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UPDATE_RATE_CORROBORATION_MIN_AIRCRAFT,
  UPDATE_RATE_CORROBORATION_WINDOW_MS,
  UPDATE_RATE_DEGRADED_MEDIAN_MS,
  UPDATE_RATE_INTERPRETATION,
  UPDATE_RATE_MIN_INTERVALS,
  UPDATE_RATE_SIGNAL,
  detectUpdateRateEvents,
  summarizeUpdateRateEvents,
  updateRateCheck,
} from './updateRate.js';

/** Fixes at the given timestamps; airborne by default. */
const fixesAt = (times, overrides = {}) =>
  times.map((atMs) => ({ atMs, ...overrides }));

/** `count` fixes spaced `stepMs` apart, starting at `startMs`. */
const cadence = (count, stepMs, startMs = 0, overrides = {}) =>
  fixesAt(
    Array.from({ length: count }, (_, i) => startMs + i * stepMs),
    overrides,
  );

test('healthy 1 Hz cadence is judged, not degraded', () => {
  const result = updateRateCheck(cadence(61, 1_000));
  assert.equal(result.judged, true);
  assert.equal(result.degraded, false);
  assert.deepEqual(result.signals, []);
  assert.equal(result.interpretation, null);
  assert.equal(result.reason, null);
  assert.equal(result.medianIntervalMs, 1_000);
  assert.equal(result.updateRateHz, 1);
  assert.equal(result.intervalCount, 60);
});

test('sustained 0.2 Hz cadence is a degraded-feed event', () => {
  const result = updateRateCheck(cadence(13, 5_000));
  assert.equal(result.judged, true);
  assert.equal(result.degraded, true);
  assert.deepEqual(result.signals, [UPDATE_RATE_SIGNAL]);
  assert.equal(result.interpretation, UPDATE_RATE_INTERPRETATION);
  assert.equal(result.medianIntervalMs, 5_000);
  assert.equal(result.updateRateHz, 0.2);
  assert.equal(result.intervalCount, 12);
});

test('a parked aircraft is excluded, never flagged', () => {
  const result = updateRateCheck(cadence(13, 5_000, 0, { onGround: true }));
  assert.equal(result.judged, false);
  assert.equal(result.degraded, false);
  assert.deepEqual(result.signals, []);
  assert.equal(result.reason, 'on-ground');
  assert.deepEqual(detectUpdateRateEvents(cadence(13, 5_000, 0, { onGround: true })), []);
});

test('a single update cannot judge a cadence', () => {
  const result = updateRateCheck([{ atMs: 0 }]);
  assert.equal(result.judged, false);
  assert.equal(result.degraded, false);
  assert.equal(result.reason, 'insufficient-data');
  assert.deepEqual(detectUpdateRateEvents([{ atMs: 0 }]), []);
});

test('an empty history is insufficient-data, never degraded', () => {
  assert.equal(updateRateCheck([]).reason, 'insufficient-data');
  assert.deepEqual(detectUpdateRateEvents([]), []);
});

test('a lone long gap is not a rate drop: too few intervals', () => {
  const result = updateRateCheck([
    { atMs: 0 },
    { atMs: 30_000 },
  ]);
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'insufficient-data');
  assert.equal(result.intervalCount, 1);
});

test('fewer than the minimum intervals is insufficient-data even when slow', () => {
  const result = updateRateCheck(cadence(UPDATE_RATE_MIN_INTERVALS, 5_000));
  assert.equal(result.intervalCount, UPDATE_RATE_MIN_INTERVALS - 1);
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'insufficient-data');
});

test('exactly the minimum intervals at 0.2 Hz is enough to judge', () => {
  const result = updateRateCheck(cadence(UPDATE_RATE_MIN_INTERVALS + 1, 5_000));
  assert.equal(result.judged, true);
  assert.equal(result.degraded, true);
});

test('a slow-moving AIRBORNE aircraft still flags: speed never excludes', () => {
  // Hovering / holding: ground speed zero, but explicitly airborne.
  const result = updateRateCheck(
    cadence(13, 5_000, 0, { onGround: false, groundSpeed: 0 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.degraded, true);
  assert.deepEqual(result.signals, [UPDATE_RATE_SIGNAL]);
});

test('fixes without an on-ground flag count as airborne', () => {
  const result = updateRateCheck(cadence(61, 1_000, 0, {}));
  assert.equal(result.judged, true);
  assert.equal(result.degraded, false);
});

test('ground fixes are dropped, so the parked gap never enters interval math', () => {
  const fixes = [
    { atMs: 0, onGround: true },
    ...cadence(7, 1_000, 60_000, { onGround: false }),
  ];
  const result = updateRateCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.degraded, false);
  assert.equal(result.medianIntervalMs, 1_000);
  assert.equal(result.intervalCount, 6);
});

test('jitter around 1 Hz stays healthy', () => {
  const times = [0];
  for (let i = 1; i <= 60; i += 1) {
    times.push(times[i - 1] + (i % 2 === 1 ? 800 : 1_200));
  }
  const result = updateRateCheck(fixesAt(times));
  assert.equal(result.judged, true);
  assert.equal(result.degraded, false);
  assert.equal(result.medianIntervalMs, 1_000);
});

test('one long gap among healthy updates does not move the median', () => {
  const times = [0];
  for (let i = 1; i <= 60; i += 1) {
    times.push(times[i - 1] + (i === 30 ? 30_000 : 1_000));
  }
  const result = updateRateCheck(fixesAt(times));
  assert.equal(result.judged, true);
  assert.equal(result.degraded, false);
  assert.equal(result.medianIntervalMs, 1_000);
});

test('duplicate timestamps are duplicate reports, not updates', () => {
  const fixes = [...cadence(61, 1_000, 0), { atMs: 30_000 }];
  const result = updateRateCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.degraded, false);
  assert.equal(result.medianIntervalMs, 1_000);
  assert.equal(result.intervalCount, 60);
});

test('median exactly at the degraded edge is not degraded', () => {
  // Alternating 1 s / 5 s intervals: sorted, the two middle values
  // average to exactly the 3 s edge.
  const times = [0];
  for (let i = 1; i <= 6; i += 1) {
    times.push(times[i - 1] + (i % 2 === 1 ? 1_000 : 5_000));
  }
  const result = updateRateCheck(fixesAt(times));
  assert.equal(result.medianIntervalMs, UPDATE_RATE_DEGRADED_MEDIAN_MS);
  assert.equal(result.degraded, false);
});

test('one millisecond past the degraded edge is degraded', () => {
  const result = updateRateCheck(
    cadence(UPDATE_RATE_MIN_INTERVALS + 1, UPDATE_RATE_DEGRADED_MEDIAN_MS + 1),
  );
  assert.equal(result.degraded, true);
});

test('the degraded edge honours an explicit option', () => {
  const fixes = cadence(13, 5_000);
  assert.equal(
    updateRateCheck(fixes, { degradedMedianMs: 6_000 }).degraded,
    false,
  );
  assert.equal(
    updateRateCheck(fixes, { degradedMedianMs: 4_000 }).degraded,
    true,
  );
});

test('out-of-order fixes are sorted before judging', () => {
  const ordered = cadence(61, 1_000);
  const shuffled = [...ordered].reverse();
  assert.deepEqual(updateRateCheck(shuffled), updateRateCheck(ordered));
});

test('fixes without timestamps are missing-timestamp, not degraded', () => {
  assert.equal(updateRateCheck([{}, {}]).reason, 'missing-timestamp');
  // One timestamp-less fix mixed with usable ones just drops out,
  // leaving too few intervals to judge.
  assert.equal(
    updateRateCheck([{}, { atMs: 1_000 }]).reason,
    'insufficient-data',
  );
});

test('updateRateCheck and detectUpdateRateEvents reject a non-array input', () => {
  assert.throws(() => updateRateCheck(null), TypeError);
  assert.throws(() => updateRateCheck('fixes'), TypeError);
  assert.throws(() => detectUpdateRateEvents(null), TypeError);
  assert.throws(() => detectUpdateRateEvents('fixes'), TypeError);
});

test('detectUpdateRateEvents finds one event for a sustained degraded feed', () => {
  const events = detectUpdateRateEvents(cadence(13, 5_000, 0, { hex: 'abc123' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].hex, 'abc123');
  assert.equal(events[0].medianIntervalMs, 5_000);
  assert.equal(events[0].updateRateHz, 0.2);
  assert.equal(events[0].signal, UPDATE_RATE_SIGNAL);
  assert.equal(events[0].interpretation, UPDATE_RATE_INTERPRETATION);
  assert.equal(events[0].windowEndMs, events[0].atMs);
});

test('detectUpdateRateEvents finds no event for a healthy feed', () => {
  assert.deepEqual(detectUpdateRateEvents(cadence(61, 1_000)), []);
});

test('detectUpdateRateEvents fires once per degrade-recover-degrade cycle', () => {
  const fixes = [
    ...cadence(60, 1_000, 0),
    ...cadence(13, 5_000, 64_000),
    ...cadence(60, 1_000, 125_000),
    ...cadence(13, 5_000, 189_000),
  ];
  const events = detectUpdateRateEvents(fixes, { hex: 'abc123' });
  assert.equal(events.length, 2);
  assert.ok(events[0].atMs < events[1].atMs);
  assert.equal(events[0].hex, 'abc123');
  assert.equal(events[1].hex, 'abc123');
  assert.equal(events[0].signal, UPDATE_RATE_SIGNAL);
});

test('detectUpdateRateEvents falls back to the option hex, then null', () => {
  const fixes = cadence(13, 5_000);
  assert.equal(detectUpdateRateEvents(fixes)[0].hex, null);
  assert.equal(
    detectUpdateRateEvents(fixes, { hex: 'abc123' })[0].hex,
    'abc123',
  );
});

test('summarizeUpdateRateEvents is empty-aware', () => {
  const summary = summarizeUpdateRateEvents([]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.count, 0);
  assert.equal(summary.aircraftCount, 0);
  assert.equal(summary.firstAtMs, null);
  assert.equal(summary.lastAtMs, null);
  assert.equal(summary.interpretation, null);
  assert.equal(summary.windowMs, UPDATE_RATE_CORROBORATION_WINDOW_MS);
});

test('two events from one aircraft never corroborate', () => {
  const summary = summarizeUpdateRateEvents([
    { hex: 'abc123', atMs: 0 },
    { hex: 'abc123', atMs: 60_000 },
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.aircraftCount, 1);
  assert.equal(summary.corroborated, false);
});

test('two aircraft degrading inside the window corroborate', () => {
  const summary = summarizeUpdateRateEvents([
    { hex: 'abc123', atMs: 0 },
    { hex: 'def456', atMs: 120_000 },
  ]);
  assert.equal(summary.corroborated, true);
  assert.equal(summary.aircraftCount, 2);
  assert.equal(summary.interpretation, UPDATE_RATE_INTERPRETATION);
});

test('two aircraft degrading outside the window do not corroborate', () => {
  const summary = summarizeUpdateRateEvents([
    { hex: 'abc123', atMs: 0 },
    {
      hex: 'def456',
      atMs: UPDATE_RATE_CORROBORATION_WINDOW_MS + 1,
    },
  ]);
  assert.equal(summary.corroborated, false);
});

test('corroboration honours a raised distinct-aircraft bar', () => {
  const events = [
    { hex: 'abc123', atMs: 0 },
    { hex: 'def456', atMs: 60_000 },
  ];
  assert.equal(
    summarizeUpdateRateEvents(events, {
      minAircraft: UPDATE_RATE_CORROBORATION_MIN_AIRCRAFT + 1,
    }).corroborated,
    false,
  );
});

test('summarizeUpdateRateEvents ignores events without a timestamp', () => {
  const summary = summarizeUpdateRateEvents([
    { hex: 'abc123', atMs: 0 },
    { hex: 'def456' },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.corroborated, false);
});
