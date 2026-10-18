import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMagnitudeLabel,
  magnitudeTypeName,
  normalizeMagType,
} from './magnitudeType.js';

test('known magnitude types render with their canonical code', () => {
  assert.equal(formatMagnitudeLabel(5.2, 'Mw'), 'M5.2 (Mw)');
  assert.equal(formatMagnitudeLabel(5.2, 'Ml'), 'M5.2 (Ml)');
  assert.equal(formatMagnitudeLabel(5.2, 'Mb'), 'M5.2 (Mb)');
  assert.equal(formatMagnitudeLabel(5.2, 'Ms'), 'M5.2 (Ms)');
  assert.equal(formatMagnitudeLabel(5.2, 'Md'), 'M5.2 (Md)');
  assert.equal(formatMagnitudeLabel(7.8, 'Mww'), 'M7.8 (Mww)');
  assert.equal(formatMagnitudeLabel(7.8, 'Mwc'), 'M7.8 (Mwc)');
  assert.equal(formatMagnitudeLabel(7.8, 'Mwb'), 'M7.8 (Mwb)');
  assert.equal(formatMagnitudeLabel(7.8, 'Mwr'), 'M7.8 (Mwr)');
  assert.equal(formatMagnitudeLabel(7.8, 'Mwp'), 'M7.8 (Mwp)');
  assert.equal(formatMagnitudeLabel(5.2, 'mb_Lg'), 'M5.2 (mb_Lg)');
});

test('type matching is case-insensitive and trims whitespace', () => {
  assert.equal(formatMagnitudeLabel(5.2, 'mw'), 'M5.2 (Mw)');
  assert.equal(formatMagnitudeLabel(5.2, 'ML'), 'M5.2 (Ml)');
  assert.equal(formatMagnitudeLabel(5.2, 'MWW'), 'M5.2 (Mww)');
  assert.equal(formatMagnitudeLabel(5.2, ' Mw '), 'M5.2 (Mw)');
});

test('USGS alias spellings canonicalize to one code', () => {
  assert.equal(formatMagnitudeLabel(5.2, 'Mi'), 'M5.2 (Mwp)');
  assert.equal(formatMagnitudeLabel(5.2, 'mb_lg'), 'M5.2 (mb_Lg)');
  assert.equal(formatMagnitudeLabel(5.2, 'MLg'), 'M5.2 (mb_Lg)');
  assert.equal(normalizeMagType('Mi'), 'Mwp');
  assert.equal(normalizeMagType('MLg'), 'mb_Lg');
});

test('missing or non-string type reads scale unknown, never bare', () => {
  for (const type of [null, undefined, '', '   ', 5, {}, []]) {
    assert.equal(
      formatMagnitudeLabel(5.2, type),
      'M5.2 (scale unknown)',
      `type: ${String(type)}`,
    );
    assert.equal(normalizeMagType(type), null);
  }
});

test('unlisted but shape-valid M-codes are quoted verbatim, never expanded', () => {
  assert.equal(formatMagnitudeLabel(5.2, 'Mlv'), 'M5.2 (Mlv)');
  assert.equal(formatMagnitudeLabel(5.2, 'Mh'), 'M5.2 (Mh)');
  assert.equal(normalizeMagType('Mlv'), 'Mlv');
  // Quoting is not endorsement: no verified name exists for these.
  assert.equal(magnitudeTypeName('Mlv'), null);
  assert.equal(magnitudeTypeName('Mh'), null);
});

test('garbage codes are rejected outright, never rendered', () => {
  for (const type of ['banana', 'Richter', 'M', 'M5.2', 'Mwwwww', 'M-1']) {
    assert.equal(
      formatMagnitudeLabel(5.2, type),
      'M5.2 (scale unknown)',
      `type: ${type}`,
    );
    assert.equal(normalizeMagType(type), null);
  }
});

test('missing, non-numeric, or non-finite magnitude reads Magnitude unknown', () => {
  for (const mag of [null, undefined, NaN, Infinity, -Infinity, 'abc', '']) {
    assert.equal(formatMagnitudeLabel(mag, 'Mw'), 'Magnitude unknown');
  }
  // Number(null) and Number('') are both 0 — the coercion trap.
  assert.equal(formatMagnitudeLabel(null, 'Mw'), 'Magnitude unknown');
  assert.equal(formatMagnitudeLabel('', 'Mw'), 'Magnitude unknown');
  assert.equal(formatMagnitudeLabel(false, 'Mw'), 'Magnitude unknown');
});

test('magnitude renders to one decimal, matching the overlay title', () => {
  assert.equal(formatMagnitudeLabel(5.24, 'Mw'), 'M5.2 (Mw)');
  assert.equal(formatMagnitudeLabel(5.26, 'Mw'), 'M5.3 (Mw)');
  assert.equal(formatMagnitudeLabel('5.2', 'Mw'), 'M5.2 (Mw)');
});

test('negative magnitudes format, never clamp', () => {
  assert.equal(formatMagnitudeLabel(-1.2, 'Ml'), 'M-1.2 (Ml)');
});

test('verified names exist for the known table and nothing else', () => {
  assert.equal(magnitudeTypeName('Mw'), 'Moment magnitude');
  assert.equal(magnitudeTypeName('mw'), 'Moment magnitude');
  assert.equal(magnitudeTypeName('Ml'), 'Local magnitude');
  assert.equal(magnitudeTypeName('Mb'), 'Body-wave magnitude');
  assert.equal(magnitudeTypeName('Ms'), 'Surface-wave magnitude');
  assert.equal(magnitudeTypeName('Md'), 'Duration magnitude');
  assert.equal(magnitudeTypeName('Mww'), 'Moment magnitude (W-phase)');
  assert.equal(
    magnitudeTypeName('Mwc'),
    'Moment magnitude (centroid, long-period surface waves)',
  );
  assert.equal(
    magnitudeTypeName('Mwb'),
    'Moment magnitude (centroid, long-period body waves)',
  );
  assert.equal(
    magnitudeTypeName('Mwr'),
    'Moment magnitude (regional, whole seismogram)',
  );
  assert.equal(magnitudeTypeName('Mwp'), 'Moment magnitude (P-wave integral)');
  assert.equal(magnitudeTypeName('Mi'), 'Moment magnitude (P-wave integral)');
  assert.equal(magnitudeTypeName('mb_Lg'), 'Lg-wave magnitude');
  assert.equal(magnitudeTypeName(null), null);
  assert.equal(magnitudeTypeName('banana'), null);
});

test('no label ever calls a magnitude Richter', () => {
  assert.equal(formatMagnitudeLabel(5.2, 'Ml').includes('Richter'), false);
  assert.equal(magnitudeTypeName('Ml').includes('Richter'), false);
  assert.equal(formatMagnitudeLabel(6.5, 'Mw').includes('Richter'), false);
});
