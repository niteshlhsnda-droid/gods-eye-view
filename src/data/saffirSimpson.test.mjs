import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAJOR_HURRICANE_MIN_CATEGORY,
  SAFFIR_SIMPSON_BY_KEY,
  SAFFIR_SIMPSON_SCALE,
  SAFFIR_SIMPSON_UNITS,
  classifySaffirSimpson,
  isMajorHurricane,
} from './saffirSimpson.js';

/**
 * External anchors. Every expected value below is a table entry from
 * the primary sources, not a computation:
 * - NOAA AOML Tropical Cyclone FAQ D1 (Landsea, NHC): Cat 1 74-95 mph
 *   / 33-42 m/s / 64-82 kt; Cat 2 96-110 / 43-49 / 83-95; Cat 3
 *   111-129 / 50-58 / 96-112; Cat 4 130-156 / 59-69 / 113-136;
 *   Cat 5 >= 157 / >= 70 / >= 137. http://www.aoml.noaa.gov/hrd/tcfaq/D1.html
 * - NHC tropical-cyclone definitions: TD <= 33 kt, TS 34-63 kt,
 *   hurricane >= 64 kt; the mph / km/h / m/s TD/TS edges (38/73 mph,
 *   62/118 km/h, 17/32 m/s) are the same thresholds converted and
 *   rounded per NHC practice (kn -> mph/km/h rounded to nearest 5).
 * - NHC: Categories 3+ are major hurricanes; the scale is wind-only
 *   (no surge / rainfall / tornadoes).
 */

test('scale table has 7 entries in weakest-first order with frozen entries', () => {
  assert.deepEqual(
    SAFFIR_SIMPSON_SCALE.map((entry) => entry.key),
    ['TD', 'TS', 'C1', 'C2', 'C3', 'C4', 'C5'],
  );
  assert.ok(Object.isFrozen(SAFFIR_SIMPSON_SCALE));
  for (const entry of SAFFIR_SIMPSON_SCALE) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.bands));
  }
  assert.deepEqual([...SAFFIR_SIMPSON_UNITS], ['kt', 'mph', 'kmh', 'ms']);
  assert.equal(MAJOR_HURRICANE_MIN_CATEGORY, 3);
});

test('bands tile [0, +inf) with no gaps or overlaps, in every unit', () => {
  for (const unit of SAFFIR_SIMPSON_UNITS) {
    let expectedMin = 0;
    for (const entry of SAFFIR_SIMPSON_SCALE) {
      const [min, max] = entry.bands[unit];
      assert.equal(min, expectedMin, `${entry.key} ${unit} min`);
      if (max !== null) {
        assert.ok(max >= min, `${entry.key} ${unit} max >= min`);
        expectedMin = max + 1;
      } else {
        assert.equal(entry.key, 'C5', 'only C5 may be open-ended');
        expectedMin = Infinity;
      }
    }
    assert.equal(expectedMin, Infinity, `${unit} must run to +inf`);
  }
});

test('knot band edges classify to the published category (canonical unit)', () => {
  const cases = [
    [0, 'TD'],
    [33, 'TD'],
    [34, 'TS'],
    [63, 'TS'],
    [64, 'C1'],
    [82, 'C1'],
    [83, 'C2'],
    [95, 'C2'],
    [96, 'C3'],
    [112, 'C3'],
    [113, 'C4'],
    [136, 'C4'],
    [137, 'C5'],
    [200, 'C5'],
  ];
  for (const [kt, key] of cases) {
    assert.equal(classifySaffirSimpson(kt, 'kt').key, key, `${kt} kt`);
    assert.equal(classifySaffirSimpson(kt).key, key, `${kt} default unit`);
  }
});

test('mph band edges classify against the published mph table', () => {
  const cases = [
    [0, 'TD'],
    [38, 'TD'],
    [39, 'TS'],
    [73, 'TS'],
    [74, 'C1'],
    [95, 'C1'],
    [96, 'C2'],
    [110, 'C2'],
    [111, 'C3'],
    [129, 'C3'],
    [130, 'C4'],
    [156, 'C4'],
    [157, 'C5'],
    [200, 'C5'],
  ];
  for (const [mph, key] of cases) {
    assert.equal(classifySaffirSimpson(mph, 'mph').key, key, `${mph} mph`);
  }
});

test('km/h band edges classify against the published km/h table', () => {
  const cases = [
    [0, 'TD'],
    [62, 'TD'],
    [63, 'TS'],
    [118, 'TS'],
    [119, 'C1'],
    [153, 'C1'],
    [154, 'C2'],
    [177, 'C2'],
    [178, 'C3'],
    [208, 'C3'],
    [209, 'C4'],
    [251, 'C4'],
    [252, 'C5'],
    [300, 'C5'],
  ];
  for (const [kmh, key] of cases) {
    assert.equal(classifySaffirSimpson(kmh, 'kmh').key, key, `${kmh} km/h`);
  }
});

test('m/s band edges classify against the published m/s table (AOML)', () => {
  const cases = [
    [0, 'TD'],
    [17, 'TD'],
    [18, 'TS'],
    [32, 'TS'],
    [33, 'C1'],
    [42, 'C1'],
    [43, 'C2'],
    [49, 'C2'],
    [50, 'C3'],
    [58, 'C3'],
    [59, 'C4'],
    [69, 'C4'],
    [70, 'C5'],
    [100, 'C5'],
  ];
  for (const [ms, key] of cases) {
    assert.equal(classifySaffirSimpson(ms, 'ms').key, key, `${ms} m/s`);
  }
});

test('per-unit bands avoid conversion-rounding drift at the 95 mph edge', () => {
  // 95 mph converts to ~82.6 kt, just above the 82 kt C1 ceiling —
  // classifying converted knots would wrongly say C2. The published
  // mph table puts 95 mph in C1, and this module honors each unit's
  // own published edges.
  assert.equal(classifySaffirSimpson(95, 'mph').key, 'C1');
  assert.equal(classifySaffirSimpson(95, 'mph').name, 'Category 1');
});

test('fractional speeds classify (NHC assigns in 5-kt steps; module takes any value)', () => {
  assert.equal(classifySaffirSimpson(63.9, 'kt').key, 'TS');
  assert.equal(classifySaffirSimpson(64.1, 'kt').key, 'C1');
  assert.equal(classifySaffirSimpson(136.9, 'kt').key, 'C4');
  assert.equal(classifySaffirSimpson(137.1, 'kt').key, 'C5');
  // Cross-unit consistency at a rounded edge: 95 mph ≈ 82.6 kt, and
  // both now classify Category 1 (half-open intervals, not the
  // stored integer max).
  assert.equal(classifySaffirSimpson(82.6, 'kt').key, 'C1');
  assert.equal(classifySaffirSimpson(95.9, 'mph').key, 'C1');
});

test('major-hurricane flag: C3+ only; isMajorHurricane takes entry or key', () => {
  assert.deepEqual(
    SAFFIR_SIMPSON_SCALE.map((entry) => entry.isMajor),
    [false, false, false, false, true, true, true],
  );
  assert.deepEqual(
    SAFFIR_SIMPSON_SCALE.map((entry) => entry.isHurricane),
    [false, false, true, true, true, true, true],
  );
  assert.deepEqual(
    SAFFIR_SIMPSON_SCALE.map((entry) => entry.category),
    [null, null, 1, 2, 3, 4, 5],
  );
  for (const entry of SAFFIR_SIMPSON_SCALE) {
    assert.equal(isMajorHurricane(entry), entry.isMajor, entry.key);
    assert.equal(isMajorHurricane(entry.key), entry.isMajor, entry.key);
  }
  assert.equal(isMajorHurricane('C3'), true);
  assert.equal(isMajorHurricane('C2'), false);
  assert.throws(() => isMajorHurricane('C6'), TypeError);
  assert.throws(() => isMajorHurricane(null), TypeError);
});

test('BY_KEY lookup covers every table entry', () => {
  assert.deepEqual(Object.keys(SAFFIR_SIMPSON_BY_KEY).sort(), [
    'C1',
    'C2',
    'C3',
    'C4',
    'C5',
    'TD',
    'TS',
  ]);
  for (const entry of SAFFIR_SIMPSON_SCALE) {
    assert.equal(SAFFIR_SIMPSON_BY_KEY[entry.key], entry);
  }
});

test('invalid inputs throw TypeError', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, -1, -0.5]) {
    assert.throws(() => classifySaffirSimpson(bad, 'kt'), TypeError);
  }
  for (const bad of ['64', null, undefined, {}, []]) {
    assert.throws(() => classifySaffirSimpson(bad, 'kt'), TypeError);
  }
  for (const badUnit of ['knots', 'kts', 'KTS', '', null, 64]) {
    assert.throws(() => classifySaffirSimpson(64, badUnit), TypeError);
  }
});

test('damage glosses quote the NHC first-sentence statements', () => {
  assert.equal(
    SAFFIR_SIMPSON_BY_KEY.C1.damage,
    'Very dangerous winds will produce some damage.',
  );
  assert.equal(
    SAFFIR_SIMPSON_BY_KEY.C2.damage,
    'Extremely dangerous winds will cause extensive damage.',
  );
  assert.equal(
    SAFFIR_SIMPSON_BY_KEY.C3.damage,
    'Devastating damage will occur.',
  );
  assert.equal(
    SAFFIR_SIMPSON_BY_KEY.C4.damage,
    'Catastrophic damage will occur.',
  );
  assert.equal(
    SAFFIR_SIMPSON_BY_KEY.C5.damage,
    'Catastrophic damage will occur.',
  );
});
