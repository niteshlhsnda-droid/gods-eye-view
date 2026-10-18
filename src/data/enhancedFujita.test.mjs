import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EF_UNKNOWN,
  ENHANCED_FUJITA_BY_KEY,
  ENHANCED_FUJITA_SCALE,
  ENHANCED_FUJITA_UNITS,
  KMH_PER_MPH,
  MS_PER_MPH,
  VIOLENT_TORNADO_MIN_EF,
  classifyEnhancedFujita,
  isViolentTornado,
} from './enhancedFujita.js';

/**
 * External anchors. Every expected value below is a table entry from
 * the primary sources, not a computation:
 * - NOAA / NWS, \"The Enhanced Fujita Scale (EF Scale)\"
 *   (weather.gov/oun/efscale): EF0 65-85, EF1 86-110, EF2 111-135,
 *   EF3 136-165, EF4 166-200, EF5 over 200 mph, 3-second gust;
 *   operational 2007-02-01; rating from Damage Indicators /
 *   Degrees of Damage; EF winds are damage-based estimates, not
 *   measurements.
 * - NOAA / NWS SPC, Fujita Tornado Damage Scale (original F Scale,
 *   no longer used in the U.S.): F0 <73, F1 73-112, F2 113-157,
 *   F3 158-206, F4 207-260, F5 261-318 mph — the F bands are NOT
 *   the EF bands; same digit, different wind range.
 * - NWS character words: EF0-EF1 Weak, EF2-EF3 Strong, EF4-EF5
 *   Violent (per the NWS EF Scale page's character column).
 * - Damage words per level: Light / Moderate / Considerable /
 *   Severe / Devastating / Incredible.
 */

test('scale table has 6 entries in weakest-first order with frozen entries', () => {
  assert.deepEqual(
    ENHANCED_FUJITA_SCALE.map((entry) => entry.key),
    ['EF0', 'EF1', 'EF2', 'EF3', 'EF4', 'EF5'],
  );
  assert.deepEqual(
    ENHANCED_FUJITA_SCALE.map((entry) => entry.efNumber),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    ENHANCED_FUJITA_SCALE.map((entry) => entry.intensity),
    ['Weak', 'Weak', 'Strong', 'Strong', 'Violent', 'Violent'],
  );
  assert.ok(Object.isFrozen(ENHANCED_FUJITA_SCALE));
  for (const entry of ENHANCED_FUJITA_SCALE) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.bands));
    assert.ok(Object.isFrozen(entry.bands.mph));
  }
  assert.deepEqual([...ENHANCED_FUJITA_UNITS], ['mph', 'kmh', 'ms']);
  assert.equal(VIOLENT_TORNADO_MIN_EF, 4);
  assert.equal(KMH_PER_MPH, 1.609344);
  assert.equal(MS_PER_MPH, 0.44704);
});

test('mph bands tile [65, +inf) with no gaps or overlaps', () => {
  let expectedMin = 65;
  for (const entry of ENHANCED_FUJITA_SCALE) {
    const [min, max] = entry.bands.mph;
    assert.equal(min, expectedMin, `${entry.key} mph min`);
    if (max !== null) {
      assert.ok(max >= min, `${entry.key} mph max >= min`);
      expectedMin = max + 1;
    } else {
      assert.equal(entry.key, 'EF5', 'only EF5 may be open-ended');
      expectedMin = Infinity;
    }
  }
  assert.equal(expectedMin, Infinity, 'mph bands must run to +inf');
});

test('published mph band edges classify to the published rating', () => {
  const cases = [
    [65, 'EF0'],
    [85, 'EF0'],
    [86, 'EF1'],
    [110, 'EF1'],
    [111, 'EF2'],
    [135, 'EF2'],
    [136, 'EF3'],
    [165, 'EF3'],
    [166, 'EF4'],
    [200, 'EF4'],
    [201, 'EF5'],
    [300, 'EF5'],
  ];
  for (const [gust, key] of cases) {
    assert.equal(classifyEnhancedFujita(gust).key, key, `${gust} mph`);
  }
});

test('fractional gusts follow the upper-inclusive band ceilings', () => {
  // 85.5 is above EF0's 85 ceiling -> EF1; 200.5 is over 200 -> EF5.
  assert.equal(classifyEnhancedFujita(85.5).key, 'EF1');
  assert.equal(classifyEnhancedFujita(200.5).key, 'EF5');
  assert.equal(classifyEnhancedFujita(64.9), null);
});

test('below-scale gusts return null, never EF0', () => {
  assert.equal(classifyEnhancedFujita(0), null);
  assert.equal(classifyEnhancedFujita(64), null);
  assert.equal(classifyEnhancedFujita(64.999), null);
});

test('kmh and ms inputs convert exactly to mph before classification', () => {
  // 105 km/h = 65.24 mph -> EF0; 321 km/h = 199.45 mph -> EF4;
  // 322 km/h = 200.07 mph -> EF5 (over 200).
  assert.equal(classifyEnhancedFujita(105, 'kmh').key, 'EF0');
  assert.equal(classifyEnhancedFujita(321, 'kmh').key, 'EF4');
  assert.equal(classifyEnhancedFujita(322, 'kmh').key, 'EF5');
  // 29.1 m/s = 65.13 mph -> EF0; 90 m/s = 201.34 mph -> EF5.
  assert.equal(classifyEnhancedFujita(29.1, 'ms').key, 'EF0');
  assert.equal(classifyEnhancedFujita(90, 'ms').key, 'EF5');
  // Default unit is mph.
  assert.equal(classifyEnhancedFujita(100).key, 'EF1');
});

test('invalid inputs throw TypeError', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, -1, '100', null]) {
    assert.throws(
      () => classifyEnhancedFujita(bad),
      TypeError,
      `gust ${String(bad)}`,
    );
  }
  assert.throws(() => classifyEnhancedFujita(100, 'kt'), TypeError);
  assert.throws(() => classifyEnhancedFujita(100, 'knots'), TypeError);
});

test('EFU exists, is not in the scale, and never comes from the classifier', () => {
  assert.equal(EF_UNKNOWN.key, 'EFU');
  assert.equal(EF_UNKNOWN.name, 'EF-Unknown');
  assert.equal(EF_UNKNOWN.efNumber, null);
  assert.equal(EF_UNKNOWN.intensity, 'Unknown');
  assert.ok(Object.isFrozen(EF_UNKNOWN));
  assert.ok(!ENHANCED_FUJITA_SCALE.includes(EF_UNKNOWN));
  assert.equal(ENHANCED_FUJITA_BY_KEY.EFU, undefined);
  assert.deepEqual(Object.keys(ENHANCED_FUJITA_BY_KEY), [
    'EF0',
    'EF1',
    'EF2',
    'EF3',
    'EF4',
    'EF5',
  ]);
  // No gust maps to EFU — unrated tornadoes are represented by the
  // caller passing EF_UNKNOWN, not by classification.
  assert.notEqual(classifyEnhancedFujita(100).key, 'EFU');
});

test('isViolentTornado: EF4+ true, EF0-EF3 / EFU / null false', () => {
  for (const key of ['EF0', 'EF1', 'EF2', 'EF3']) {
    assert.equal(isViolentTornado(key), false, key);
    assert.equal(
      isViolentTornado(ENHANCED_FUJITA_BY_KEY[key]),
      false,
      `${key} entry`,
    );
  }
  for (const key of ['EF4', 'EF5']) {
    assert.equal(isViolentTornado(key), true, key);
    assert.equal(
      isViolentTornado(ENHANCED_FUJITA_BY_KEY[key]),
      true,
      `${key} entry`,
    );
  }
  assert.equal(isViolentTornado('EFU'), false);
  assert.equal(isViolentTornado(EF_UNKNOWN), false);
  assert.equal(isViolentTornado(null), false);
  assert.equal(
    isViolentTornado(classifyEnhancedFujita(150)),
    false,
    'classified EF3',
  );
  assert.equal(
    isViolentTornado(classifyEnhancedFujita(180)),
    true,
    'classified EF4',
  );
  assert.throws(() => isViolentTornado('EF6'), TypeError);
  assert.throws(() => isViolentTornado({}), TypeError);
});

test('damage glosses carry the NWS damage word per level', () => {
  const words = [
    'Light',
    'Moderate',
    'Considerable',
    'Severe',
    'Devastating',
    'Incredible',
  ];
  for (let i = 0; i < ENHANCED_FUJITA_SCALE.length; i++) {
    assert.match(
      ENHANCED_FUJITA_SCALE[i].damage,
      new RegExp(`^${words[i]} damage`),
      ENHANCED_FUJITA_SCALE[i].key,
    );
  }
});
