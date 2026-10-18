import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRACK_MAX_PLAUSIBLE_SPEED_MPS,
  TRACK_PLAUSIBILITY_INTERPRETATION,
  TRACK_SIGNAL_JUMP_ENDPOINT,
  TRACK_SIGNAL_SEGMENT_FAST,
  TRACK_SIGNAL_SPIKE,
  TRACK_SIGNAL_SPIKE_NEIGHBOR_CONSISTENT,
  judgeTrackPlausibility,
  summarizeTrackPlausibility,
} from './trackPlausibility.js';

/**
 * Reports on the equator/prime meridian. One degree of longitude is
 * ~111,195 m, so 0.01 degrees in 10 s is 1,112 m at ~111 m/s, and
 * 1.0 degrees in 60 s is 111,195 m at ~1,853 m/s — far past the
 * 700 m/s edge.
 */
const report = (overrides = {}) => ({
  lat: 0,
  lon: 0,
  atMs: 0,
  ...overrides,
});
const steadyTrack = () => [
  report({ atMs: 0 }),
  report({ lon: 0.01, atMs: 10_000 }),
  report({ lon: 0.02, atMs: 20_000 }),
];
/** A(0,0) -> B(0,1°) -> C(0,0.001°): jump out and (nearly) back. */
const spikeTrack = () => [
  report({ atMs: 0 }),
  report({ lon: 1.0, atMs: 60_000 }),
  report({ lon: 0.001, atMs: 120_000 }),
];

test('steady flight has no flags and no interpretation', () => {
  const result = judgeTrackPlausibility(steadyTrack());
  assert.equal(result.judged, true);
  assert.equal(result.reason, null);
  assert.equal(result.reportCount, 3);
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.reportSignals, [[], [], []]);
  assert.deepEqual(result.implausible, [false, false, false]);
  assert.deepEqual(result.implausibleIndexes, []);
  assert.equal(result.interpretation, null);
  assert.ok(Math.abs(result.segments[0].speedMps - 111.2) < 0.5);
});

test('spike attributes the middle report and corroborates with neighbors', () => {
  const result = judgeTrackPlausibility(spikeTrack());
  assert.equal(result.segments[0].implausible, true);
  assert.equal(result.segments[1].implausible, true);
  assert.ok(Math.abs(result.segments[0].speedMps - 1853.2) < 1);
  assert.deepEqual(result.implausible, [false, true, false]);
  assert.deepEqual(result.implausibleIndexes, [1]);
  assert.deepEqual(result.reportSignals[1], [
    TRACK_SIGNAL_SEGMENT_FAST,
    TRACK_SIGNAL_SPIKE,
    TRACK_SIGNAL_SPIKE_NEIGHBOR_CONSISTENT,
  ]);
  assert.deepEqual(result.reportSignals[0], [TRACK_SIGNAL_SEGMENT_FAST]);
  assert.deepEqual(result.reportSignals[2], [TRACK_SIGNAL_SEGMENT_FAST]);
  assert.equal(result.interpretation, TRACK_PLAUSIBILITY_INTERPRETATION);
});

test('spike without close neighbors omits the neighbor-consistent signal', () => {
  // A(0,0) -> B(0,1°) -> C(0,3°): both legs fast, but the flankers are
  // 3° apart, so the jump is not "inconsistent with neighbors".
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ lon: 1.0, atMs: 60_000 }),
    report({ lon: 3.0, atMs: 120_000 }),
  ]);
  assert.deepEqual(result.implausibleIndexes, [1]);
  assert.deepEqual(result.reportSignals[1], [
    TRACK_SIGNAL_SEGMENT_FAST,
    TRACK_SIGNAL_SPIKE,
  ]);
});

test('fast segment beside a plausible one attributes the far report', () => {
  // A(0,1°) is corrupt: B and C agree with each other.
  const result = judgeTrackPlausibility([
    report({ lon: 1.0, atMs: 0 }),
    report({ atMs: 60_000 }),
    report({ lon: 0.001, atMs: 120_000 }),
  ]);
  assert.equal(result.segments[0].implausible, true);
  assert.equal(result.segments[1].implausible, false);
  assert.deepEqual(result.implausibleIndexes, [0]);
  assert.deepEqual(result.reportSignals[0], [
    TRACK_SIGNAL_SEGMENT_FAST,
    TRACK_SIGNAL_JUMP_ENDPOINT,
  ]);
  assert.deepEqual(result.reportSignals[2], []);
  assert.equal(result.interpretation, TRACK_PLAUSIBILITY_INTERPRETATION);
});

test('jump endpoint attributes the far report in the other direction', () => {
  // C(0,1°) is corrupt: A and B agree with each other.
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ lon: 0.001, atMs: 60_000 }),
    report({ lon: 1.0, atMs: 120_000 }),
  ]);
  assert.equal(result.segments[0].implausible, false);
  assert.equal(result.segments[1].implausible, true);
  assert.deepEqual(result.implausibleIndexes, [2]);
  assert.deepEqual(result.reportSignals[2], [
    TRACK_SIGNAL_SEGMENT_FAST,
    TRACK_SIGNAL_JUMP_ENDPOINT,
  ]);
});

test('fast segment between two plausible flanks stays unattributed', () => {
  // B->C is fast but A,B agree AND C,D agree: positions alone cannot say
  // whether B or C is corrupt, so neither gets a verdict.
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ lon: 0.001, atMs: 60_000 }),
    report({ lon: 1.0, atMs: 120_000 }),
    report({ lon: 1.001, atMs: 180_000 }),
  ]);
  assert.equal(result.segments[1].implausible, true);
  assert.deepEqual(result.implausibleIndexes, []);
  assert.deepEqual(result.reportSignals[0], []);
  assert.deepEqual(result.reportSignals[1], [TRACK_SIGNAL_SEGMENT_FAST]);
  assert.deepEqual(result.reportSignals[2], [TRACK_SIGNAL_SEGMENT_FAST]);
  assert.deepEqual(result.reportSignals[3], []);
  assert.equal(result.interpretation, null);
});

test('a two-report fast segment surfaces facts but no verdict', () => {
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ lon: 1.0, atMs: 60_000 }),
  ]);
  assert.equal(result.judged, true);
  assert.equal(result.segments[0].implausible, true);
  assert.deepEqual(result.implausibleIndexes, []);
  assert.deepEqual(result.reportSignals[0], [TRACK_SIGNAL_SEGMENT_FAST]);
  assert.deepEqual(result.reportSignals[1], [TRACK_SIGNAL_SEGMENT_FAST]);
  assert.equal(result.interpretation, null);
});

test('just under the 700 m/s edge stays plausible', () => {
  // 0.3776° in 60 s is ~699.8 m/s: the edge is a strict `>`.
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ lon: 0.3776, atMs: 60_000 }),
    report({ lon: 0.3776, atMs: 120_000 }),
  ]);
  assert.ok(result.segments[0].speedMps < TRACK_MAX_PLAUSIBLE_SPEED_MPS);
  assert.equal(result.segments[0].implausible, false);
  assert.deepEqual(result.implausibleIndexes, []);
});

test('just over the 700 m/s edge flags the fast segment', () => {
  // 0.3778° in 60 s is ~700.2 m/s.
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ lon: 0.3778, atMs: 60_000 }),
    report({ lon: 0.3778, atMs: 120_000 }),
  ]);
  assert.ok(result.segments[0].speedMps > TRACK_MAX_PLAUSIBLE_SPEED_MPS);
  assert.equal(result.segments[0].implausible, true);
  // B and C agree with each other, so A is attributed as the jump origin.
  assert.deepEqual(result.implausibleIndexes, [0]);
  assert.deepEqual(result.reportSignals[0], [
    TRACK_SIGNAL_SEGMENT_FAST,
    TRACK_SIGNAL_JUMP_ENDPOINT,
  ]);
  assert.deepEqual(result.reportSignals[1], [TRACK_SIGNAL_SEGMENT_FAST]);
  assert.equal(result.interpretation, TRACK_PLAUSIBILITY_INTERPRETATION);
});

test('a single report is not judged', () => {
  const result = judgeTrackPlausibility([report({ atMs: 0 })]);
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'single-report');
  assert.equal(result.reportCount, 1);
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.implausibleIndexes, []);
  assert.equal(result.interpretation, null);
});

test('an empty track is not judged', () => {
  const result = judgeTrackPlausibility([]);
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'empty-track');
  assert.deepEqual(result.implausibleIndexes, []);
});

test('duplicate timestamps leave the segment unjudged', () => {
  const result = judgeTrackPlausibility([
    report({ atMs: 60_000 }),
    report({ lon: 0.01, atMs: 60_000 }),
  ]);
  assert.equal(result.judged, true);
  assert.equal(result.segments[0].judged, false);
  assert.equal(result.segments[0].unjudgedReason, 'duplicate-timestamp');
  assert.equal(result.segments[0].speedMps, null);
  assert.deepEqual(result.implausibleIndexes, []);
});

test('reordered timestamps leave the segment unjudged', () => {
  const result = judgeTrackPlausibility([
    report({ atMs: 60_000 }),
    report({ lon: 0.01, atMs: 0 }),
  ]);
  assert.equal(result.segments[0].judged, false);
  assert.equal(result.segments[0].unjudgedReason, 'reordered-timestamps');
  assert.equal(result.segments[0].dtMs, -60_000);
  assert.deepEqual(result.implausibleIndexes, []);
});

test('zero distance yields zero speed and stays plausible', () => {
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ atMs: 60_000 }),
  ]);
  assert.equal(result.segments[0].judged, true);
  assert.equal(result.segments[0].distanceM, 0);
  assert.equal(result.segments[0].speedMps, 0);
  assert.equal(result.segments[0].implausible, false);
  assert.deepEqual(result.implausibleIndexes, []);
});

test('a sub-second interval is not judged despite huge implied speed', () => {
  // 1° in 500 ms would read ~222,000 m/s, but whole-second timestamp
  // quantization dominates at this spacing, so it is timing noise.
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ lon: 1.0, atMs: 500 }),
  ]);
  assert.equal(result.segments[0].judged, false);
  assert.equal(result.segments[0].unjudgedReason, 'interval-too-short');
  assert.deepEqual(result.implausibleIndexes, []);
  assert.equal(result.interpretation, null);
});

test('an antimeridian crossing is measured the short way', () => {
  // 179.9° to -179.9° is 0.2° the short way (~22 km), not 359.8° around.
  const result = judgeTrackPlausibility([
    report({ lon: 179.9, atMs: 0 }),
    report({ lon: -179.9, atMs: 60_000 }),
    report({ lon: -179.8, atMs: 120_000 }),
  ]);
  assert.ok(Math.abs(result.segments[0].distanceM - 22_239) < 50);
  assert.equal(result.segments[0].implausible, false);
  assert.deepEqual(result.implausibleIndexes, []);
});

test('sustained impossible speed flags every interior report', () => {
  const result = judgeTrackPlausibility([
    report({ atMs: 0 }),
    report({ lon: 1.0, atMs: 60_000 }),
    report({ lon: 2.0, atMs: 120_000 }),
    report({ lon: 3.0, atMs: 180_000 }),
  ]);
  assert.ok(result.segments.every((segment) => segment.implausible));
  assert.deepEqual(result.implausibleIndexes, [1, 2]);
  assert.deepEqual(result.reportSignals[1], [
    TRACK_SIGNAL_SEGMENT_FAST,
    TRACK_SIGNAL_SPIKE,
  ]);
  assert.deepEqual(result.reportSignals[0], [TRACK_SIGNAL_SEGMENT_FAST]);
  assert.equal(result.interpretation, TRACK_PLAUSIBILITY_INTERPRETATION);
});

test('malformed input throws', () => {
  assert.throws(() => judgeTrackPlausibility('nope'), TypeError);
  assert.throws(() => judgeTrackPlausibility(null), TypeError);
  assert.throws(() => judgeTrackPlausibility([null]), TypeError);
  assert.throws(
    () => judgeTrackPlausibility([report({ lat: 91 })]),
    RangeError,
  );
  assert.throws(
    () => judgeTrackPlausibility([report({ lon: 181 })]),
    RangeError,
  );
  assert.throws(
    () => judgeTrackPlausibility([report({ atMs: Number.NaN })]),
    TypeError,
  );
  assert.throws(() => judgeTrackPlausibility([{ lat: 0, lon: 0 }]), TypeError);
});

test('the result graph is frozen', () => {
  const result = judgeTrackPlausibility(spikeTrack());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.segments));
  assert.ok(Object.isFrozen(result.segments[0]));
  assert.ok(Object.isFrozen(result.reportSignals));
  assert.ok(Object.isFrozen(result.reportSignals[1]));
  assert.ok(Object.isFrozen(result.implausible));
  assert.ok(Object.isFrozen(result.implausibleIndexes));
});

test('the summarizer counts judged, unjudged and implausible tracks', () => {
  const summary = summarizeTrackPlausibility([
    { hex: 'C1', reports: steadyTrack() },
    { hex: 'A1B2C3', reports: spikeTrack() },
    { hex: 'BAD', reports: [{ lat: 91, lon: 0, atMs: 0 }] },
    { hex: 'SINGLE', reports: [report({ atMs: 0 })] },
    { reports: spikeTrack() },
  ]);
  assert.equal(summary.total, 5);
  assert.equal(summary.judged, 3);
  assert.equal(summary.unjudged, 2);
  assert.equal(summary.tracksWithImplausible, 2);
  assert.equal(summary.implausibleReports, 2);
  assert.deepEqual(summary.implausibleHexes, ['A1B2C3']);
});

test('the summarizer caps listed hexes without dropping counts', () => {
  const tracks = [
    { hex: 'H1', reports: spikeTrack() },
    { hex: 'H2', reports: spikeTrack() },
  ];
  const summary = summarizeTrackPlausibility(tracks, {
    maxImplausibleHexes: 1,
  });
  assert.deepEqual(summary.implausibleHexes, ['H1']);
  assert.equal(summary.tracksWithImplausible, 2);
  assert.equal(summary.implausibleReports, 2);
});
