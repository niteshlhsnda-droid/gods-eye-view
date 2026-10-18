import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UV_INDEX_BY_KEY,
  UV_INDEX_PROTECTION_THRESHOLD,
  UV_INDEX_SCALE,
  classifyUvIndex,
  requiresProtection,
} from './uvIndex.js';

/**
 * External anchors. Every expected value below is a table entry from
 * the primary sources, not a computation:
 * - WHO / WMO / UNEP / ICNIRP, "Global Solar UV Index: A Practical
 *   Guide" (2002): 0-2 Low green; 3-5 Moderate yellow; 6-7 High
 *   orange; 8-10 Very High red; 11+ Extreme violet.
 * - WHO, "Radiation: The ultraviolet (UV) index" (Q&A): below a UVI
 *   of 2 no protective measures are needed under normal
 *   circumstances; when protection is required it should include all
 *   protective means (clothing, hat, sunglasses, shade, sunscreen);
 *   action bands 0-2 / 3-7 / 8+.
 *   https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index
 * - WHO INTERSUN, "The UV index sun protection table": the
 *   international colour code for UVI values.
 *   https://www.who.int/publications/m/item/the-uv-index-sun-protection-table/
 */

test('scale table has 5 entries in weakest-first order with frozen entries', () => {
  assert.deepEqual(
    UV_INDEX_SCALE.map((entry) => entry.key),
    ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH', 'EXTREME'],
  );
  assert.ok(Object.isFrozen(UV_INDEX_SCALE));
  for (const entry of UV_INDEX_SCALE) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.range));
  }
  assert.deepEqual(
    UV_INDEX_SCALE.map((entry) => entry.name),
    ['Low', 'Moderate', 'High', 'Very High', 'Extreme'],
  );
  assert.deepEqual(
    UV_INDEX_SCALE.map((entry) => entry.color),
    ['green', 'yellow', 'orange', 'red', 'violet'],
  );
  assert.equal(UV_INDEX_PROTECTION_THRESHOLD, 3);
});

test('scale ranges tile [0, +inf) with Extreme open-ended', () => {
  assert.deepEqual(
    UV_INDEX_SCALE.map((entry) => entry.range),
    [
      [0, 2],
      [3, 5],
      [6, 7],
      [8, 10],
      [11, null],
    ],
  );
});

test('only Low has protectionRequired false', () => {
  assert.deepEqual(
    UV_INDEX_SCALE.map((entry) => entry.protectionRequired),
    [false, true, true, true, true],
  );
  for (const entry of UV_INDEX_SCALE) {
    assert.equal(typeof entry.protection, 'string');
    assert.ok(entry.protection.length > 0);
  }
});

test('classifyUvIndex maps integer boundaries to the WHO categories', () => {
  const cases = [
    [0, 'LOW'],
    [2, 'LOW'],
    [3, 'MODERATE'],
    [5, 'MODERATE'],
    [6, 'HIGH'],
    [7, 'HIGH'],
    [8, 'VERY_HIGH'],
    [10, 'VERY_HIGH'],
    [11, 'EXTREME'],
  ];
  for (const [uvi, key] of cases) {
    assert.equal(classifyUvIndex(uvi).key, key, `UVI ${uvi}`);
  }
});

test('classifyUvIndex accepts fractional forecasts in half-open bands', () => {
  assert.equal(classifyUvIndex(2.9).key, 'LOW');
  assert.equal(classifyUvIndex(3.0).key, 'MODERATE');
  assert.equal(classifyUvIndex(5.9).key, 'MODERATE');
  assert.equal(classifyUvIndex(7.9).key, 'HIGH');
  assert.equal(classifyUvIndex(10.9).key, 'VERY_HIGH');
  assert.equal(classifyUvIndex(11.0).key, 'EXTREME');
});

test('classifyUvIndex leaves Extreme open-ended (no clamp at 11)', () => {
  assert.equal(classifyUvIndex(15).key, 'EXTREME');
  assert.equal(classifyUvIndex(21.5).key, 'EXTREME');
});

test('classifyUvIndex returns the frozen table entry, not a copy', () => {
  assert.equal(classifyUvIndex(4), UV_INDEX_BY_KEY.MODERATE);
  assert.equal(classifyUvIndex(9), UV_INDEX_BY_KEY.VERY_HIGH);
});

test('classifyUvIndex rejects non-finite, negative, and non-numeric input', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, -1, -0.5]) {
    assert.throws(() => classifyUvIndex(bad), TypeError, `UVI ${bad}`);
  }
  for (const bad of ['5', null, undefined, {}, [], true]) {
    assert.throws(() => classifyUvIndex(bad), TypeError, `UVI ${bad}`);
  }
});

test('requiresProtection accepts entries and keys, false only for Low', () => {
  assert.equal(requiresProtection('LOW'), false);
  assert.equal(requiresProtection('MODERATE'), true);
  assert.equal(requiresProtection(UV_INDEX_BY_KEY.LOW), false);
  for (const key of ['MODERATE', 'HIGH', 'VERY_HIGH', 'EXTREME']) {
    assert.equal(requiresProtection(key), true, key);
    assert.equal(requiresProtection(UV_INDEX_BY_KEY[key]), true, key);
  }
});

test('requiresProtection rejects unknown keys and malformed entries', () => {
  assert.throws(() => requiresProtection('BURNING'), TypeError);
  assert.throws(() => requiresProtection(''), TypeError);
  assert.throws(() => requiresProtection({}), TypeError);
  assert.throws(() => requiresProtection(null), TypeError);
  assert.throws(
    () => requiresProtection({ protectionRequired: 'yes' }),
    TypeError,
  );
});
