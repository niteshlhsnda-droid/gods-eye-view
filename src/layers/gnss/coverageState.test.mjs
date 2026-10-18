import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GNSS_COVERAGE_ANOMALY,
  GNSS_COVERAGE_COVERED,
  GNSS_COVERAGE_INSUFFICIENT,
  GNSS_COVERAGE_INTERPRETATION,
  GNSS_COVERAGE_NOMINAL,
  gnssCoverageState,
} from './coverageState.js';

test('zero aircraft is insufficient data, never nominal', () => {
  const state = gnssCoverageState({ aircraft: 0, degraded: 0 });
  assert.equal(state.coverage, GNSS_COVERAGE_INSUFFICIENT);
  assert.equal(state.state, GNSS_COVERAGE_INSUFFICIENT);
  assert.equal(state.percentDegraded, null);
  assert.equal(state.level, null);
  assert.equal(state.interpretation, null);
  assert.match(state.reason, /not enough ADS-B/);
});

test('fewer than the minimum is insufficient even when all reports are degraded', () => {
  const state = gnssCoverageState({ aircraft: 2, degraded: 2 });
  assert.equal(state.coverage, GNSS_COVERAGE_INSUFFICIENT);
  assert.equal(state.state, GNSS_COVERAGE_INSUFFICIENT);
});

test('a covered healthy cell is nominal with the gpsjam discounted percentage', () => {
  // 1 degraded of 100: (1 - 1) / 100 = 0% after the first-report discount.
  const state = gnssCoverageState({ aircraft: 100, degraded: 1 });
  assert.equal(state.coverage, GNSS_COVERAGE_COVERED);
  assert.equal(state.percentDegraded, 0);
  assert.equal(state.level, 'low');
  assert.equal(state.state, GNSS_COVERAGE_NOMINAL);
  assert.equal(state.interpretation, null);
});

test('the 2% band edge is medium, below it is low', () => {
  // 2 degraded of 50: (2 - 1) / 50 = 2% — the medium band starts here.
  assert.equal(
    gnssCoverageState({ aircraft: 50, degraded: 2 }).level,
    'medium',
  );
  // 2 degraded of 100: (2 - 1) / 100 = 1% — still low.
  assert.equal(gnssCoverageState({ aircraft: 100, degraded: 2 }).level, 'low');
});

test('the 10% band edge stays medium, above it is high', () => {
  // 11 degraded of 100: (11 - 1) / 100 = 10% — medium stops here.
  assert.equal(
    gnssCoverageState({ aircraft: 100, degraded: 11 }).level,
    'medium',
  );
  // 12 degraded of 100: 11% — high.
  assert.equal(
    gnssCoverageState({ aircraft: 100, degraded: 12 }).level,
    'high',
  );
});

test('medium and high cells are anomalies with the unvalidated interpretation', () => {
  for (const state of [
    gnssCoverageState({ aircraft: 50, degraded: 2 }),
    gnssCoverageState({ aircraft: 100, degraded: 12 }),
  ]) {
    assert.equal(state.state, GNSS_COVERAGE_ANOMALY);
    assert.equal(state.interpretation, GNSS_COVERAGE_INTERPRETATION);
  }
});

test('degraded above aircraft is clamped, never over 100%', () => {
  const state = gnssCoverageState({ aircraft: 3, degraded: 99 });
  assert.equal(state.percentDegraded, 66.7);
  assert.equal(state.level, 'high');
});

test('a custom minimum is honoured', () => {
  assert.equal(
    gnssCoverageState({ aircraft: 4, degraded: 0, minAircraft: 5 }).coverage,
    GNSS_COVERAGE_INSUFFICIENT,
  );
  assert.equal(
    gnssCoverageState({ aircraft: 4, degraded: 0, minAircraft: 4 }).coverage,
    GNSS_COVERAGE_COVERED,
  );
});

test('non-finite or negative counts throw', () => {
  for (const counts of [
    { aircraft: NaN },
    { aircraft: -1 },
    { aircraft: 3, degraded: Infinity },
    { aircraft: 3, minAircraft: -1 },
  ])
    assert.throws(() => gnssCoverageState(counts), TypeError);
});
