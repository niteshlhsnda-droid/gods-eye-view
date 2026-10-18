// src/data/coordinatePrecision.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accuracyLabel,
  coordinatePrecisionNote,
  formatCoordinate,
  formatLatLon,
  precisionDecimals,
} from './coordinatePrecision.js';

test('decimals follow the accuracy table at every boundary', () => {
  assert.equal(precisionDecimals(10_000), 1);
  assert.equal(precisionDecimals(10_001), 1);
  assert.equal(precisionDecimals(9_999), 2);
  assert.equal(precisionDecimals(1_000), 2);
  assert.equal(precisionDecimals(999), 3);
  assert.equal(precisionDecimals(100), 3);
  assert.equal(precisionDecimals(99), 4);
  assert.equal(precisionDecimals(10), 4);
  assert.equal(precisionDecimals(9), 5);
  assert.equal(precisionDecimals(1), 5);
  assert.equal(precisionDecimals(0.9), 6);
  assert.equal(precisionDecimals(0), 6);
});

test('unknown accuracy defaults to 3 decimals, never a precise claim', () => {
  assert.equal(precisionDecimals(null), 3);
  assert.equal(precisionDecimals(undefined), 3);
  assert.equal(formatCoordinate(12.345678, null), '12.346');
  assert.equal(formatCoordinate(12.345678), '12.346');
});

test('invalid accuracy throws instead of silently rounding', () => {
  for (const bad of [-1, -0.5, Number.NaN, Infinity, -Infinity])
    assert.throws(() => precisionDecimals(bad), TypeError, String(bad));
  assert.throws(() => accuracyLabel(-1), TypeError);
  assert.throws(() => coordinatePrecisionNote(Number.NaN), TypeError);
});

test('formatCoordinate rounds to justified decimals and rejects garbage', () => {
  // FIRMS-class ~1 km source: 2 decimals, not the raw 6.
  assert.equal(formatCoordinate(12.345678, 1000), '12.35');
  assert.equal(formatCoordinate(-77.123456, 100), '-77.123');
  assert.equal(formatCoordinate(12.345678, 0), '12.345678');
  assert.equal(formatCoordinate(Number.NaN, 100), null);
  assert.equal(formatCoordinate(Infinity, 100), null);
  assert.equal(formatCoordinate(null, 100), null);
});

test('formatLatLon pairs both coordinates or returns null', () => {
  assert.equal(formatLatLon(12.345678, 77.123456, 1000), '12.35, 77.12');
  assert.equal(formatLatLon(12.345678, Number.NaN, 1000), null);
  assert.equal(formatLatLon(Number.NaN, 77.123456, 1000), null);
});

test('accuracyLabel renders km, metres, and unknown', () => {
  assert.equal(accuracyLabel(null), 'accuracy unknown');
  assert.equal(accuracyLabel(undefined), 'accuracy unknown');
  assert.equal(accuracyLabel(1000), '≈1 km');
  assert.equal(accuracyLabel(1500), '≈1.5 km');
  assert.equal(accuracyLabel(250), '≈250 m');
  assert.equal(accuracyLabel(0.5), '≈0.5 m');
  assert.equal(accuracyLabel(0), '≈0 m');
});

test('the honesty note discloses the rounding and the accuracy', () => {
  const note = coordinatePrecisionNote(1000);
  assert.match(note, /2 decimal places/);
  assert.match(note, /≈1 km/);
  assert.match(note, /false precision/);
  const unknown = coordinatePrecisionNote(null);
  assert.match(unknown, /accuracy unknown/);
  assert.match(unknown, /3 decimal places/);
  const singular = coordinatePrecisionNote(25_000);
  assert.match(singular, /1 decimal place,/);
});
