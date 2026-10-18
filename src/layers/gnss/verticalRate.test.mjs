import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERT_RATE_MAX_INTERVAL_MS,
  VERT_RATE_CORROBORATION_WINDOW_MS,
  VERT_RATE_CORROBORATION_MIN_AIRCRAFT,
  VERT_RATE_SIGNAL,
  VERT_RATE_INTERPRETATION,
  VERT_RATE_DEFAULT_ACCURACY_MPS,
  VERT_RATE_DEFAULT_ALT_QUANTIZATION_M,
  VERT_RATE_MIN_TOLERANCE_MPS,
  VERT_RATE_FPM_PER_MPS,
  checkVerticalRate,
  detectVerticalRateEvents,
  summarizeVerticalRateEvents,
} from './verticalRate.js';

const DT_MS = 60_000;

/** Fix at altitude `altM` with reported vertical rate `rateMps`. */
const fix = (altM, rateMps, overrides = {}) => ({
  altM,
  vertRateMps: rateMps,
  atMs: 0,
  ...overrides,
});

/** Later fix (DT_MS on) at altitude `altM` with rate `rateMps`. */
const later = (altM, rateMps, overrides = {}) =>
  fix(altM, rateMps, { atMs: DT_MS, ...overrides });

/** Default tolerance at DT_MS: accuracy 2.0 + quantization 7.62/60. */
const DEFAULT_TOLERANCE = 2 + 7.62 / 60;

test('constants match the documented defaults', () => {
  assert.equal(VERT_RATE_MAX_INTERVAL_MS, 60_000);
  assert.equal(VERT_RATE_CORROBORATION_WINDOW_MS, 300_000);
  assert.equal(VERT_RATE_CORROBORATION_MIN_AIRCRAFT, 2);
  assert.equal(VERT_RATE_DEFAULT_ACCURACY_MPS, 2.0);
  assert.equal(VERT_RATE_DEFAULT_ALT_QUANTIZATION_M, 7.62);
  assert.equal(VERT_RATE_MIN_TOLERANCE_MPS, 1.0);
  assert.ok(Math.abs(VERT_RATE_FPM_PER_MPS - 196.8503937) < 1e-7);
});

test('level flight is consistent', () => {
  const verdict = checkVerticalRate(fix(1000, 0), later(1000, 0));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.deepEqual(verdict.signals, []);
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.reason, null);
  assert.equal(verdict.dtS, 60);
  assert.equal(verdict.derivedRateMps, 0);
  assert.equal(verdict.meanReportedRateMps, 0);
  assert.equal(verdict.discrepancyMps, 0);
  assert.equal(verdict.accuracyAllowanceMps, 2.0);
  assert.ok(Math.abs(verdict.quantizationAllowanceMps - 7.62 / 60) < 1e-12);
  assert.equal(verdict.altAccuracyAllowanceMps, 0);
  assert.ok(Math.abs(verdict.toleranceMps - DEFAULT_TOLERANCE) < 1e-12);
  assert.equal(verdict.prevVertRateMps, 0);
  assert.equal(verdict.currVertRateMps, 0);
});

test('a steady climb is consistent', () => {
  // +600 m over 60 s = 10 m/s derived; both rates report 10 m/s.
  const verdict = checkVerticalRate(fix(1000, 10), later(1600, 10));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.derivedRateMps, 10);
  assert.equal(verdict.discrepancyMps, 0);
});

test('a climb entry is consistent: constant acceleration cancels in the mean', () => {
  // Rate 0 -> 10 m/s over 60 s at constant acceleration covers
  // mean-rate x time = 5 x 60 = 300 m. An endpoint-only comparison
  // would see |10 - 5| = 5 and false-positive; the mean sees 0.
  const verdict = checkVerticalRate(fix(1000, 0), later(1300, 10));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.derivedRateMps, 5);
  assert.equal(verdict.meanReportedRateMps, 5);
  assert.equal(verdict.discrepancyMps, 0);
});

test('a level-off is consistent for the same reason', () => {
  // Rate 10 -> 0 m/s over 60 s covers 300 m.
  const verdict = checkVerticalRate(fix(1000, 10), later(1300, 0));
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.discrepancyMps, 0);
});

test('a steady descent is consistent (negative rates)', () => {
  const verdict = checkVerticalRate(fix(2000, -5), later(1700, -5));
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.derivedRateMps, -5);
});

test('reporting a climb while descending is anomalous', () => {
  // Derived -5 m/s, mean reported +10 m/s, discrepancy 15.
  const verdict = checkVerticalRate(fix(1000, 10), later(700, 10));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, true);
  assert.deepEqual(verdict.signals, [VERT_RATE_SIGNAL]);
  // Per-pair verdicts never carry an interpretation.
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.derivedRateMps, -5);
  assert.equal(verdict.meanReportedRateMps, 10);
  assert.equal(verdict.discrepancyMps, 15);
  assert.ok(Math.abs(verdict.toleranceMps - DEFAULT_TOLERANCE) < 1e-12);
});

test('reporting level while descending is anomalous', () => {
  const verdict = checkVerticalRate(fix(1000, 0), later(700, 0));
  assert.equal(verdict.anomalous, true);
  assert.equal(verdict.discrepancyMps, 5);
});

test('a stale previous rate is caught: the mean, not the current rate, is judged', () => {
  // Current rate alone (10) matches the derived rate (10) exactly,
  // but the previous rate is stale at 0, so the mean (5) is off by 5.
  const verdict = checkVerticalRate(fix(1000, 0), later(1600, 10));
  assert.equal(verdict.anomalous, true);
  assert.equal(verdict.meanReportedRateMps, 5);
  assert.equal(verdict.derivedRateMps, 10);
  assert.equal(verdict.discrepancyMps, 5);
});

test('a discrepancy exactly at the tolerance is consistent (strict comparison)', () => {
  const verdict = checkVerticalRate(
    fix(1000, DEFAULT_TOLERANCE),
    later(1000, DEFAULT_TOLERANCE),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.ok(Math.abs(verdict.discrepancyMps - verdict.toleranceMps) < 1e-12);
});

test('a discrepancy just above the tolerance is anomalous', () => {
  const verdict = checkVerticalRate(
    fix(1000, DEFAULT_TOLERANCE + 0.001),
    later(1000, DEFAULT_TOLERANCE + 0.001),
  );
  assert.equal(verdict.anomalous, true);
  assert.ok(
    Math.abs(verdict.discrepancyMps - verdict.toleranceMps - 0.001) < 1e-9,
  );
});

test('claimed accuracy widens the bound', () => {
  const prev = fix(1000, 4, { vertRateAccuracyMps: 5 });
  const curr = later(1000, 4, { vertRateAccuracyMps: 5 });
  const verdict = checkVerticalRate(prev, curr);
  assert.equal(verdict.accuracyAllowanceMps, 5);
  assert.ok(Math.abs(verdict.toleranceMps - (5 + 7.62 / 60)) < 1e-12);
  assert.equal(verdict.anomalous, false);
  // The same 4 m/s discrepancy fails under the default accuracy.
  const strict = checkVerticalRate(fix(1000, 4), later(1000, 4));
  assert.equal(strict.anomalous, true);
});

test('asymmetric claimed accuracies average, they do not sum', () => {
  const verdict = checkVerticalRate(
    fix(1000, 0, { vertRateAccuracyMps: 1 }),
    later(1000, 0, { vertRateAccuracyMps: 3 }),
  );
  assert.equal(verdict.accuracyAllowanceMps, 2);
});

test('feed-level accuracy option fills in for fixes without a claim', () => {
  const verdict = checkVerticalRate(fix(1000, 0), later(1000, 0), {
    vertRateAccuracyMps: 0.5,
  });
  assert.equal(verdict.accuracyAllowanceMps, 0.5);
  // Raw tolerance 0.5 + 0.127 = 0.627, but the floor binds at 1.0.
  assert.equal(verdict.toleranceMps, 1.0);
});

test('a per-fix claim beats the feed-level option', () => {
  const verdict = checkVerticalRate(
    fix(1000, 0, { vertRateAccuracyMps: 4 }),
    later(1000, 0),
    { vertRateAccuracyMps: 0.5 },
  );
  // Mean of per-fix 4 and option-fed 0.5.
  assert.equal(verdict.accuracyAllowanceMps, 2.25);
});

test('the tolerance floor binds under over-tight claimed accuracy', () => {
  const verdict = checkVerticalRate(
    fix(1000, 0, { vertRateAccuracyMps: 0.1 }),
    later(1000, 0, { vertRateAccuracyMps: 0.1 }),
  );
  assert.equal(verdict.accuracyAllowanceMps, 0.1);
  assert.equal(verdict.toleranceMps, 1.0);
});

test('a short window inflates the quantization term', () => {
  const prev = fix(1000, 0);
  const curr = fix(1000, 0, { atMs: 5000 });
  const verdict = checkVerticalRate(prev, curr);
  assert.equal(verdict.dtS, 5);
  assert.ok(Math.abs(verdict.quantizationAllowanceMps - 7.62 / 5) < 1e-12);
  assert.ok(Math.abs(verdict.toleranceMps - (2 + 7.62 / 5)) < 1e-12);
});

test('a coarser altitude quantization widens the bound', () => {
  const verdict = checkVerticalRate(fix(1000, 0), later(1000, 0), {
    altQuantizationM: 30.48,
  });
  assert.ok(Math.abs(verdict.quantizationAllowanceMps - 30.48 / 60) < 1e-12);
  assert.ok(Math.abs(verdict.toleranceMps - (2 + 30.48 / 60)) < 1e-12);
});

test('supplied altitude accuracies add their sum over dtS', () => {
  const verdict = checkVerticalRate(
    fix(1000, 0, { altAccuracyM: 45 }),
    later(1000, 0, { altAccuracyM: 45 }),
  );
  assert.equal(verdict.altAccuracyAllowanceMps, 90 / 60);
  assert.ok(Math.abs(verdict.toleranceMps - (2 + 7.62 / 60 + 90 / 60)) < 1e-12);
});

test('a one-sided altitude accuracy contributes only its own bound', () => {
  const verdict = checkVerticalRate(
    fix(1000, 0, { altAccuracyM: 45 }),
    later(1000, 0),
  );
  assert.equal(verdict.altAccuracyAllowanceMps, 45 / 60);
});

test('missing altitude is missing-altitude, NaN altitude is invalid-altitude', () => {
  const missing = checkVerticalRate(
    { vertRateMps: 0, atMs: 0 },
    later(1000, 0),
  );
  assert.equal(missing.judged, false);
  assert.equal(missing.reason, 'missing-altitude');
  const invalid = checkVerticalRate(fix(Number.NaN, 0), later(1000, 0));
  assert.equal(invalid.reason, 'invalid-altitude');
});

test('missing rate is missing-rate, NaN rate is invalid-rate', () => {
  const missing = checkVerticalRate({ altM: 1000, atMs: 0 }, later(1000, 0));
  assert.equal(missing.reason, 'missing-rate');
  const invalid = checkVerticalRate(fix(1000, Number.NaN), later(1000, 0));
  assert.equal(invalid.reason, 'invalid-rate');
});

test('invalid accuracy fields are invalid-accuracy', () => {
  const negative = checkVerticalRate(
    fix(1000, 0, { vertRateAccuracyMps: -1 }),
    later(1000, 0),
  );
  assert.equal(negative.reason, 'invalid-accuracy');
  const nan = checkVerticalRate(
    fix(1000, 0),
    later(1000, 0, { altAccuracyM: Number.NaN }),
  );
  assert.equal(nan.reason, 'invalid-accuracy');
  const string = checkVerticalRate(
    fix(1000, 0, { vertRateAccuracyMps: '2' }),
    later(1000, 0),
  );
  assert.equal(string.reason, 'invalid-accuracy');
});

test('invalid options are invalid-option, never a NaN tolerance', () => {
  assert.equal(
    checkVerticalRate(fix(1000, 0), later(1000, 0), {
      maxIntervalMs: -1,
    }).reason,
    'invalid-option',
  );
  assert.equal(
    checkVerticalRate(fix(1000, 0), later(1000, 0), {
      maxIntervalMs: Number.NaN,
    }).reason,
    'invalid-option',
  );
  assert.equal(
    checkVerticalRate(fix(1000, 0), later(1000, 0), {
      altQuantizationM: -1,
    }).reason,
    'invalid-option',
  );
  assert.equal(
    checkVerticalRate(fix(1000, 0), later(1000, 0), {
      minToleranceMps: -1,
    }).reason,
    'invalid-option',
  );
  assert.equal(
    checkVerticalRate(fix(1000, 0), later(1000, 0), {
      vertRateAccuracyMps: Number.NaN,
    }).reason,
    'invalid-option',
  );
});

test('invalid timestamps and intervals are unjudged', () => {
  const noTime = checkVerticalRate(
    fix(1000, 0, { atMs: undefined }),
    later(1000, 0),
  );
  assert.equal(noTime.reason, 'invalid-time');
  const negative = checkVerticalRate(
    fix(1000, 0),
    fix(1000, 0, { atMs: -1000 }),
  );
  assert.equal(negative.reason, 'negative-dt');
  const zero = checkVerticalRate(fix(1000, 0), fix(1000, 0));
  assert.equal(zero.reason, 'zero-dt');
  const tooLong = checkVerticalRate(
    fix(1000, 0),
    fix(1000, 0, { atMs: VERT_RATE_MAX_INTERVAL_MS + 1 }),
  );
  assert.equal(tooLong.reason, 'interval-too-long');
  assert.equal(tooLong.derivedRateMps, 0);
  const atMax = checkVerticalRate(
    fix(1000, 0),
    fix(1000, 0, { atMs: VERT_RATE_MAX_INTERVAL_MS }),
  );
  assert.equal(atMax.judged, true);
});

test('negative altitudes are allowed (below-sea-level terrain)', () => {
  const verdict = checkVerticalRate(fix(-400, 0), later(-400, 0));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
});

test('check throws TypeError on null or non-object fixes', () => {
  assert.throws(() => checkVerticalRate(null, later(1000, 0)), TypeError);
  assert.throws(() => checkVerticalRate(fix(1000, 0), 'nope'), TypeError);
});

test('detect with fewer than two fixes yields no events', () => {
  assert.deepEqual(detectVerticalRateEvents([]), []);
  assert.deepEqual(detectVerticalRateEvents([fix(1000, 10)]), []);
});

test('detect emits one event per violating pair, in timestamp order', () => {
  const fixes = [
    later(700, 10, { atMs: DT_MS, hex: 'abc' }),
    fix(1000, 10, { hex: 'abc' }),
    later(400, 10, { atMs: 2 * DT_MS, hex: 'abc' }),
  ];
  const events = detectVerticalRateEvents(fixes);
  assert.equal(events.length, 2);
  assert.equal(events[0].atMs, DT_MS);
  assert.equal(events[0].hex, 'abc');
  assert.equal(events[0].derivedRateMps, -5);
  assert.equal(events[0].meanReportedRateMps, 10);
  assert.equal(events[0].discrepancyMps, 15);
  assert.equal(events[0].signal, VERT_RATE_SIGNAL);
  // Events carry NO interpretation: that judgment is summary-level only.
  assert.ok(!('interpretation' in events[0]));
  assert.equal(events[1].atMs, 2 * DT_MS);
  assert.equal(events[1].discrepancyMps, 15);
});

test('detect skips unjudged pairs and uses the fallback hex', () => {
  const fixes = [
    fix(1000, 10, { vertRateMps: undefined }),
    later(700, 10),
    later(400, 10, { atMs: 2 * DT_MS }),
  ];
  const events = detectVerticalRateEvents(fixes, { hex: 'fallback' });
  assert.equal(events.length, 1);
  assert.equal(events[0].hex, 'fallback');
  assert.equal(events[0].discrepancyMps, 15);
});

test('detect throws TypeError on a non-array or invalid options', () => {
  assert.throws(() => detectVerticalRateEvents(null), TypeError);
  assert.throws(
    () => detectVerticalRateEvents([], { maxIntervalMs: -1 }),
    TypeError,
  );
  assert.throws(
    () => detectVerticalRateEvents([], { vertRateAccuracyMps: Number.NaN }),
    TypeError,
  );
});

test('summarize: empty and lone events never corroborate', () => {
  const empty = summarizeVerticalRateEvents([]);
  assert.deepEqual(empty, {
    count: 0,
    aircraftCount: 0,
    corroborated: false,
    windowMs: VERT_RATE_CORROBORATION_WINDOW_MS,
    firstAtMs: null,
    lastAtMs: null,
    interpretation: null,
  });
  const lone = summarizeVerticalRateEvents([{ hex: 'a1', atMs: 1000 }]);
  assert.equal(lone.corroborated, false);
  assert.equal(lone.interpretation, null);
  assert.equal(lone.aircraftCount, 1);
});

test('summarize: two distinct aircraft inside the window corroborate', () => {
  const summary = summarizeVerticalRateEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a2', atMs: 2000 },
  ]);
  assert.equal(summary.corroborated, true);
  assert.equal(summary.interpretation, VERT_RATE_INTERPRETATION);
  assert.equal(summary.aircraftCount, 2);
  assert.equal(summary.firstAtMs, 1000);
  assert.equal(summary.lastAtMs, 2000);
});

test('summarize: two events from one aircraft never corroborate', () => {
  const summary = summarizeVerticalRateEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a1', atMs: 2000 },
  ]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize: two aircraft outside the window do not corroborate', () => {
  const summary = summarizeVerticalRateEvents([
    { hex: 'a1', atMs: 0 },
    { hex: 'a2', atMs: VERT_RATE_CORROBORATION_WINDOW_MS + 1 },
  ]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize ignores events without a finite timestamp', () => {
  const summary = summarizeVerticalRateEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a2' },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.corroborated, false);
});

test('summarize throws TypeError on invalid corroboration options', () => {
  assert.throws(
    () => summarizeVerticalRateEvents([], { windowMs: Number.NaN }),
    TypeError,
  );
  assert.throws(
    () => summarizeVerticalRateEvents([], { windowMs: -1 }),
    TypeError,
  );
  assert.throws(
    () => summarizeVerticalRateEvents([], { minAircraft: 0 }),
    TypeError,
  );
  assert.throws(
    () => summarizeVerticalRateEvents([], { minAircraft: 1.5 }),
    TypeError,
  );
});
