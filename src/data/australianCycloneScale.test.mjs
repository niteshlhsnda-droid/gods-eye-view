import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUSTRALIAN_CYCLONE_BY_KEY,
  AUSTRALIAN_CYCLONE_SCALE,
  AUSTRALIAN_CYCLONE_UNITS,
  SEVERE_TROPICAL_CYCLONE_MIN_CATEGORY,
  classifyAustralianCyclone,
  isSevereTropicalCyclone,
} from './australianCycloneScale.js';

/**
 * External anchors. Every expected value below is a table entry from
 * the primary sources, not a computation:
 * - Bureau of Meteorology cyclone FAQ category table: Cat 1 sustained
 *   63-88 km/h (gusts below 125); Cat 2 89-117 (125-164); Cat 3
 *   118-159 (165-224); Cat 4 160-199 (225-279); Cat 5 over 200
 *   (over 280); Categories 3, 4 and 5 are severe tropical cyclones.
 *   https://reg.bom.gov.au/cyclone/faq/index.shtml
 * - NOAA AOML Tropical Cyclone FAQ D2 (Dorst): BoM scale in gusts /
 *   10-minute averaged wind speeds with indicative effects per
 *   category; Cat 5 averaged > 200 km/h, gusts > 279 km/h.
 *   http://www.aoml.noaa.gov/hrd/tcfaq/D2.html
 * - Australian-scale knot bands: C1 34-47, C2 48-63, C3 64-85,
 *   C4 86-107, C5 > 107 kt.
 */

test('scale table has 5 entries in weakest-first order with frozen entries', () => {
  assert.deepEqual(
    AUSTRALIAN_CYCLONE_SCALE.map((entry) => entry.key),
    ['C1', 'C2', 'C3', 'C4', 'C5'],
  );
  assert.ok(Object.isFrozen(AUSTRALIAN_CYCLONE_SCALE));
  for (const entry of AUSTRALIAN_CYCLONE_SCALE) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.bands));
    assert.ok(Object.isFrozen(entry.gusts));
  }
  assert.deepEqual([...AUSTRALIAN_CYCLONE_UNITS], ['kmh', 'kt']);
  assert.equal(SEVERE_TROPICAL_CYCLONE_MIN_CATEGORY, 3);
});

test('BY_KEY maps each key to its entry', () => {
  for (const entry of AUSTRALIAN_CYCLONE_SCALE) {
    assert.equal(AUSTRALIAN_CYCLONE_BY_KEY[entry.key], entry);
  }
});

test('classifies published km/h band edges (canonical unit)', () => {
  // BoM FAQ sustained bands: 63-88 / 89-117 / 118-159 / 160-199 / >200.
  const cases = [
    [63, 'C1'],
    [88, 'C1'],
    [89, 'C2'],
    [117, 'C2'],
    [118, 'C3'],
    [159, 'C3'],
    [160, 'C4'],
    [199, 'C4'],
    [200, 'C5'],
    [250, 'C5'],
  ];
  for (const [speed, key] of cases) {
    assert.equal(classifyAustralianCyclone(speed).key, key, `${speed} km/h`);
  }
  // Fractional speed lands in the band containing it: half-open
  // [min, next band's min), the same convention as saffirSimpson.js.
  assert.equal(classifyAustralianCyclone(88.5).key, 'C1');
  assert.equal(classifyAustralianCyclone(199.5).key, 'C4');
});

test('classifies published knot band edges', () => {
  // Published knot bands: 34-47 / 48-63 / 64-85 / 86-107 / >107.
  const cases = [
    [34, 'C1'],
    [47, 'C1'],
    [48, 'C2'],
    [63, 'C2'],
    [64, 'C3'],
    [85, 'C3'],
    [86, 'C4'],
    [107, 'C4'],
    [108, 'C5'],
    [140, 'C5'],
  ];
  for (const [speed, key] of cases) {
    assert.equal(
      classifyAustralianCyclone(speed, 'kt').key,
      key,
      `${speed} kt`,
    );
  }
});

test('returns null for unknown or out-of-range input, never throws or NaN', () => {
  for (const bad of [
    NaN,
    Infinity,
    -Infinity,
    -1,
    '100',
    null,
    undefined,
    {},
  ]) {
    assert.equal(classifyAustralianCyclone(bad), null, String(bad));
  }
  // Unknown unit.
  assert.equal(classifyAustralianCyclone(100, 'mph'), null);
  assert.equal(classifyAustralianCyclone(100, ''), null);
  // Below cyclone strength: the scale does not cover tropical lows.
  assert.equal(classifyAustralianCyclone(0), null);
  assert.equal(classifyAustralianCyclone(62.9), null);
  assert.equal(classifyAustralianCyclone(33, 'kt'), null);
  assert.equal(classifyAustralianCyclone(33.9, 'kt'), null);
});

test('severe flag matches BoM definition (Categories 3+)', () => {
  for (const key of ['C1', 'C2']) {
    assert.equal(AUSTRALIAN_CYCLONE_BY_KEY[key].isSevere, false);
    assert.equal(isSevereTropicalCyclone(key), false);
  }
  for (const key of ['C3', 'C4', 'C5']) {
    assert.equal(AUSTRALIAN_CYCLONE_BY_KEY[key].isSevere, true);
    assert.equal(isSevereTropicalCyclone(key), true);
  }
  // Accepts entries as well as keys.
  assert.equal(isSevereTropicalCyclone(classifyAustralianCyclone(180)), true);
  assert.equal(isSevereTropicalCyclone(classifyAustralianCyclone(70)), false);
  // Unknown keys / entries return null, never throw.
  assert.equal(isSevereTropicalCyclone('C6'), null);
  assert.equal(isSevereTropicalCyclone('TD'), null);
  assert.equal(isSevereTropicalCyclone(null), null);
  assert.equal(isSevereTropicalCyclone({}), null);
});

test('entries carry gust reference ranges and wind labels', () => {
  const c1 = AUSTRALIAN_CYCLONE_BY_KEY.C1;
  assert.deepEqual([c1.gusts.min, c1.gusts.max], [null, 124]);
  assert.equal(c1.windLabel, 'Damaging winds');
  const c2 = AUSTRALIAN_CYCLONE_BY_KEY.C2;
  assert.deepEqual([c2.gusts.min, c2.gusts.max], [125, 164]);
  assert.equal(c2.windLabel, 'Destructive winds');
  const c5 = AUSTRALIAN_CYCLONE_BY_KEY.C5;
  assert.deepEqual([c5.gusts.min, c5.gusts.max], [280, null]);
  assert.equal(c5.windLabel, 'Very destructive winds');
  for (const entry of AUSTRALIAN_CYCLONE_SCALE) {
    assert.ok(typeof entry.impacts === 'string' && entry.impacts.length > 0);
  }
});
