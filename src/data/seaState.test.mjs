import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METRE_PER_FOOT,
  SEA_STATE_BY_CODE,
  SEA_STATE_MAX_CODE,
  SEA_STATE_MIN_CODE,
  SEA_STATE_SCALE,
  classifySeaState,
  classifySeaStateFromFeet,
  seaStateByCode,
  seaStateForecastTerm,
} from './seaState.js';

/**
 * External anchors. Every expected value below is a table entry
 * from the primary sources, not a computation:
 * - Met Eireann, "Sea Area Forecast Terminology": Calm 0-0.1,
 *   Smooth (Wavelets) 0.1-0.5, Slight 0.5-1.25, Moderate
 *   1.25-2.5, Rough 2.5-4.0, Very rough 4.0-6.0, High 6.0-9.0,
 *   Very High 9.0-14.0, Phenomenal over 14.0 m; Hsig is "the
 *   average height of the highest one-third of the waves"; the
 *   highest wave is "about twice the significant height".
 * - UK Met Office, "Guide to marine forecasts": Smooth: wave
 *   height less than 0.5 m; Slight: 0.5 to 1.25 m; Moderate:
 *   1.25 to 2.5 m; Rough: 2.5 to 4.0 m; Very rough: 4.0 to
 *   6.0 m; High: 6.0 to 9.0 m; Very high: 9.0 to 14.0 m;
 *   Phenomenal: more than 14.0 m — the "< 0.5 m" wording is
 *   what puts exactly 0.5 m in Slight (code 3), not Smooth.
 * - WMO Code Table 3700 (State of the sea) is the code framework;
 *   the WMO code largely adopts the Douglas Sea Scale's wind-sea
 *   definition. The 0-9 numbering and the Calm (glassy) /
 *   Calm (rippled) / Smooth (wavelets) wording follow the WMO /
 *   Met Eireann table (code 0 is exactly 0 m).
 * Boundary rule under test: shared endpoints belong to the higher
 * code (0.1 -> 2, 0.5 -> 3, 14 -> 9); exact 0 m is code 0.
 */

test('scale table has 10 entries, codes 0-9, frozen, with published bands', () => {
  assert.deepEqual(
    SEA_STATE_SCALE.map((entry) => entry.code),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    SEA_STATE_SCALE.map((entry) => entry.descriptor),
    [
      'Calm (glassy)',
      'Calm (rippled)',
      'Smooth (wavelets)',
      'Slight',
      'Moderate',
      'Rough',
      'Very rough',
      'High',
      'Very high',
      'Phenomenal',
    ],
  );
  assert.deepEqual(
    SEA_STATE_SCALE.map((entry) => entry.threshold),
    [0, 0, 0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14],
  );
  assert.deepEqual(
    SEA_STATE_SCALE.map((entry) => entry.bandLabel),
    [
      '0 m',
      '0–0.1 m',
      '0.1–0.5 m',
      '0.5–1.25 m',
      '1.25–2.5 m',
      '2.5–4 m',
      '4–6 m',
      '6–9 m',
      '9–14 m',
      '> 14 m',
    ],
  );
  assert.equal(SEA_STATE_MIN_CODE, 0);
  assert.equal(SEA_STATE_MAX_CODE, 9);
  assert.ok(Object.isFrozen(SEA_STATE_SCALE));
  assert.ok(SEA_STATE_SCALE.every((entry) => Object.isFrozen(entry)));
  assert.ok(Object.isFrozen(SEA_STATE_BY_CODE));
});

test('table stores no colour code — WMO publishes none', () => {
  for (const entry of SEA_STATE_SCALE) {
    assert.ok(!('colour' in entry) && !('color' in entry));
  }
});

test('mid-band heights classify to their code', () => {
  assert.equal(classifySeaState(0).code, 0);
  assert.equal(classifySeaState(0.05).code, 1);
  assert.equal(classifySeaState(0.3).code, 2);
  assert.equal(classifySeaState(1).code, 3);
  assert.equal(classifySeaState(2).code, 4);
  assert.equal(classifySeaState(3.2).code, 5);
  assert.equal(classifySeaState(5).code, 6);
  assert.equal(classifySeaState(7.5).code, 7);
  assert.equal(classifySeaState(11).code, 8);
  assert.equal(classifySeaState(20).code, 9);
  assert.equal(classifySeaState(100).code, 9);
});

test('shared endpoints belong to the higher code (except exact zero)', () => {
  assert.equal(classifySeaState(0.1).code, 2);
  assert.equal(classifySeaState(0.5).code, 3);
  assert.equal(classifySeaState(1.25).code, 4);
  assert.equal(classifySeaState(2.5).code, 5);
  assert.equal(classifySeaState(4).code, 6);
  assert.equal(classifySeaState(6).code, 7);
  assert.equal(classifySeaState(9).code, 8);
  assert.equal(classifySeaState(14).code, 9);
});

test('just-below-boundary heights stay in the lower code', () => {
  assert.equal(classifySeaState(0.099).code, 1);
  assert.equal(classifySeaState(0.499).code, 2);
  assert.equal(classifySeaState(13.999).code, 8);
  assert.equal(classifySeaState(14.001).code, 9);
});

test('forecast terms merge codes 0-2 into Smooth', () => {
  assert.deepEqual(
    SEA_STATE_SCALE.map((entry) => entry.forecastTerm),
    [
      'Smooth',
      'Smooth',
      'Smooth',
      'Slight',
      'Moderate',
      'Rough',
      'Very rough',
      'High',
      'Very high',
      'Phenomenal',
    ],
  );
  assert.equal(seaStateForecastTerm(0), 'Smooth');
  assert.equal(seaStateForecastTerm(0.05), 'Smooth');
  assert.equal(seaStateForecastTerm(0.3), 'Smooth');
  assert.equal(seaStateForecastTerm(0.5), 'Slight');
  assert.equal(seaStateForecastTerm(2), 'Moderate');
  assert.equal(seaStateForecastTerm(3.2), 'Rough');
  assert.equal(seaStateForecastTerm(5), 'Very rough');
  assert.equal(seaStateForecastTerm(7.5), 'High');
  assert.equal(seaStateForecastTerm(11), 'Very high');
  assert.equal(seaStateForecastTerm(20), 'Phenomenal');
});

test('feet variant converts exactly (1 ft = 0.3048 m) then classifies', () => {
  assert.equal(METRE_PER_FOOT, 0.3048);
  assert.equal(classifySeaStateFromFeet(0).code, 0);
  // 1 ft = 0.3048 m -> code 2 (0.1-0.5 m).
  assert.equal(classifySeaStateFromFeet(1).code, 2);
  // 45.93 ft = 13.999464 m -> code 8; 45.94 ft = 14.002512 m -> 9.
  assert.equal(classifySeaStateFromFeet(45.93).code, 8);
  assert.equal(classifySeaStateFromFeet(45.94).code, 9);
  // 2 ft = 0.6096 m -> code 3; 10 ft = 3.048 m -> code 5.
  assert.equal(classifySeaStateFromFeet(2).code, 3);
  assert.equal(classifySeaStateFromFeet(10).code, 5);
});

test('seaStateByCode returns the entry, and rejects bad codes', () => {
  assert.equal(seaStateByCode(0).descriptor, 'Calm (glassy)');
  assert.equal(seaStateByCode(9).descriptor, 'Phenomenal');
  assert.equal(seaStateByCode(5), SEA_STATE_BY_CODE[5]);
  assert.throws(() => seaStateByCode(-1), TypeError);
  assert.throws(() => seaStateByCode(10), TypeError);
  assert.throws(() => seaStateByCode(2.5), TypeError);
  assert.throws(() => seaStateByCode('5'), TypeError);
  assert.throws(() => seaStateByCode(undefined), TypeError);
});

test('classifiers reject non-finite, negative, and non-numeric input', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, -1, -0.01]) {
    assert.throws(() => classifySeaState(bad), TypeError);
    assert.throws(() => classifySeaStateFromFeet(bad), TypeError);
    assert.throws(() => seaStateForecastTerm(bad), TypeError);
  }
  for (const bad of ['3', null, undefined, {}, []]) {
    assert.throws(() => classifySeaState(bad), TypeError);
    assert.throws(() => classifySeaStateFromFeet(bad), TypeError);
  }
});

test('classify returns the frozen table entry, never null', () => {
  assert.equal(classifySeaState(0), SEA_STATE_SCALE[0]);
  assert.equal(classifySeaState(3.2), SEA_STATE_SCALE[5]);
  assert.equal(classifySeaState(20), SEA_STATE_SCALE[9]);
  assert.equal(classifySeaStateFromFeet(10), SEA_STATE_SCALE[5]);
});
