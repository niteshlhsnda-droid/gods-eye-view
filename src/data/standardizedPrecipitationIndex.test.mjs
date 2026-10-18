import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPI_BY_CODE,
  SPI_SCALE,
  classifySpi,
  isDrought,
} from './standardizedPrecipitationIndex.js';

/**
 * External anchors. Every expected value below is a table entry from
 * the primary source, not a computation:
 * - WMO-No. 1090, "Standardized Precipitation Index User Guide",
 *   Table 2.1 ("SPI values and the associated drought categories"):
 *   >= 2.00 Extremely wet; 1.50 to 1.99 Very wet;
 *   1.00 to 1.49 Moderately wet; -0.99 to 0.99 Near normal;
 *   -1.00 to -1.49 Moderately dry; -1.50 to -1.99 Severely dry;
 *   <= -2.00 Extremely dry.
 *   https://www.wamis.org/agm/pubs/SPI/WMO_1090_EN.pdf
 * - McKee et al. (1993), adopted in WMO-No. 1090: a drought event
 *   persists while SPI <= -1 — the threshold `isDrought` encodes.
 */

test('scale table has 7 entries driest-first with frozen entries and codes', () => {
  assert.deepEqual(
    SPI_SCALE.map((entry) => entry.code),
    ['ED', 'SD', 'MD', 'NN', 'MW', 'VW', 'EW'],
  );
  assert.deepEqual(
    SPI_SCALE.map((entry) => entry.label),
    [
      'Extremely dry',
      'Severely dry',
      'Moderately dry',
      'Near normal',
      'Moderately wet',
      'Very wet',
      'Extremely wet',
    ],
  );
  assert.ok(Object.isFrozen(SPI_SCALE));
  assert.ok(Object.isFrozen(SPI_BY_CODE));
  for (const entry of SPI_SCALE) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.band));
    assert.equal(SPI_BY_CODE[entry.code], entry);
  }
});

test('bands store the verbatim published edges', () => {
  const bands = Object.fromEntries(
    SPI_SCALE.map((entry) => [entry.code, [...entry.band]]),
  );
  assert.deepEqual(bands.ED, [null, -2.0]);
  assert.deepEqual(bands.SD, [-1.99, -1.5]);
  assert.deepEqual(bands.MD, [-1.49, -1.0]);
  assert.deepEqual(bands.NN, [-0.99, 0.99]);
  assert.deepEqual(bands.MW, [1.0, 1.49]);
  assert.deepEqual(bands.VW, [1.5, 1.99]);
  assert.deepEqual(bands.EW, [2.0, null]);
});

test('band edges classify to the published category (incl. integers)', () => {
  const cases = [
    [-10, 'ED'],
    [-3.5, 'ED'],
    [-2, 'ED'],
    [-1.99, 'SD'],
    [-1.5, 'SD'],
    [-1.49, 'MD'],
    [-1, 'MD'],
    [-0.99, 'NN'],
    [0, 'NN'],
    [0.99, 'NN'],
    [1, 'MW'],
    [1.49, 'MW'],
    [1.5, 'VW'],
    [1.99, 'VW'],
    [2, 'EW'],
    [3.7, 'EW'],
  ];
  for (const [spi, code] of cases) {
    assert.equal(classifySpi(spi).code, code, `SPI ${spi}`);
  }
});

test('open ends swallow extremes: -inf side is ED, +inf side is EW', () => {
  assert.equal(classifySpi(-1000).code, 'ED');
  assert.equal(classifySpi(1000).code, 'EW');
});

test('in-between values land in the lower-adjacent band (half-open convention)', () => {
  assert.equal(classifySpi(0.995).code, 'NN');
  assert.equal(classifySpi(-1.995).code, 'ED');
});

test('unknown inputs return null and never throw', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '1.5', {}]) {
    assert.equal(classifySpi(bad), null, `classifySpi(${String(bad)})`);
  }
});

test('returned entry is the frozen table object, not a copy', () => {
  const entry = classifySpi(-1.2);
  assert.ok(Object.isFrozen(entry));
  assert.equal(entry, SPI_BY_CODE.MD);
});

test('isDrought flags Moderately dry and drier only (McKee -1 threshold)', () => {
  assert.equal(isDrought('ED'), true);
  assert.equal(isDrought('SD'), true);
  assert.equal(isDrought('MD'), true);
  assert.equal(isDrought('NN'), false);
  assert.equal(isDrought('MW'), false);
  assert.equal(isDrought('VW'), false);
  assert.equal(isDrought('EW'), false);
  assert.equal(isDrought(classifySpi(-1.0)), true);
  assert.equal(isDrought(classifySpi(-0.99)), false);
  assert.equal(isDrought(classifySpi(2.0)), false);
});

test('isDrought rejects unknown entries and codes', () => {
  assert.throws(() => isDrought('XX'), TypeError);
  assert.throws(() => isDrought(null), TypeError);
  assert.throws(() => isDrought({}), TypeError);
});
