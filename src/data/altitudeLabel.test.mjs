import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  altitudeDatumName,
  altitudeUnitName,
  formatAltitudeLabel,
  normalizeAltitudeDatum,
  normalizeAltitudeUnit,
} from './altitudeLabel.js';

test('known units render with their canonical code', () => {
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'ft', datum: 'msl' }),
    '5000 ft · MSL',
  );
  assert.equal(
    formatAltitudeLabel(120, { unit: 'm', datum: 'agl' }),
    '120 m · AGL',
  );
  assert.equal(
    formatAltitudeLabel(350, { unit: 'm', datum: 'ellipsoid' }),
    '350 m · above WGS 84 ellipsoid',
  );
  assert.equal(
    formatAltitudeLabel(8, { unit: 'km', datum: 'msl' }),
    '8 km · MSL',
  );
});

test('all three datums render their verified phrase', () => {
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'ft', datum: 'msl' }),
    '5000 ft · MSL',
  );
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'ft', datum: 'agl' }),
    '5000 ft · AGL',
  );
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'ft', datum: 'ellipsoid' }),
    '5000 ft · above WGS 84 ellipsoid',
  );
});

test('unit matching is case-insensitive, trims, and canonicalizes aliases', () => {
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'Feet', datum: 'msl' }),
    '5000 ft · MSL',
  );
  assert.equal(
    formatAltitudeLabel(5000, { unit: '  foot  ', datum: 'msl' }),
    '5000 ft · MSL',
  );
  assert.equal(
    formatAltitudeLabel(120, { unit: 'metres', datum: 'agl' }),
    '120 m · AGL',
  );
  assert.equal(
    formatAltitudeLabel(120, { unit: 'meters', datum: 'agl' }),
    '120 m · AGL',
  );
  assert.equal(
    formatAltitudeLabel(8, { unit: 'kilometers', datum: 'msl' }),
    '8 km · MSL',
  );
  assert.equal(
    formatAltitudeLabel(8, { unit: 'kilometres', datum: 'msl' }),
    '8 km · MSL',
  );
});

test('datum matching is case-insensitive, trims, and canonicalizes aliases', () => {
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'ft', datum: 'MSL' }),
    '5000 ft · MSL',
  );
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'ft', datum: '  amsl  ' }),
    '5000 ft · MSL',
  );
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'ft', datum: 'above mean sea level' }),
    '5000 ft · MSL',
  );
  assert.equal(
    formatAltitudeLabel(120, { unit: 'm', datum: 'above ground level' }),
    '120 m · AGL',
  );
  assert.equal(
    formatAltitudeLabel(350, { unit: 'm', datum: 'HAE' }),
    '350 m · above WGS 84 ellipsoid',
  );
  assert.equal(
    formatAltitudeLabel(350, { unit: 'm', datum: 'height above ellipsoid' }),
    '350 m · above WGS 84 ellipsoid',
  );
  assert.equal(
    formatAltitudeLabel(350, { unit: 'm', datum: 'WGS84' }),
    '350 m · above WGS 84 ellipsoid',
  );
});

test('unknown unit and datum render explicitly, never as defaults', () => {
  assert.equal(
    formatAltitudeLabel(5000, { unit: 'ft' }),
    '5000 ft (datum unknown)',
  );
  assert.equal(
    formatAltitudeLabel(120, { datum: 'msl' }),
    '120 (unit unknown) · MSL',
  );
  assert.equal(
    formatAltitudeLabel(120, {}),
    '120 (unit unknown, datum unknown)',
  );
  assert.equal(formatAltitudeLabel(120), '120 (unit unknown, datum unknown)');
  assert.equal(
    formatAltitudeLabel(120, null),
    '120 (unit unknown, datum unknown)',
  );
  assert.equal(
    formatAltitudeLabel(120, { unit: 'fathoms', datum: 'msl' }),
    '120 (unit unknown) · MSL',
  );
  assert.equal(
    formatAltitudeLabel(120, { unit: 'm', datum: 'barometric' }),
    '120 m (datum unknown)',
  );
  assert.equal(
    formatAltitudeLabel(120, { unit: 42, datum: 'msl' }),
    '120 (unit unknown) · MSL',
  );
});

test('flight levels are rejected, never laundered into feet', () => {
  assert.equal(
    formatAltitudeLabel(350, { unit: 'FL', datum: 'msl' }),
    '350 (unit unknown) · MSL',
  );
  assert.equal(
    formatAltitudeLabel('FL350', { unit: 'ft', datum: 'msl' }),
    'Altitude unknown',
  );
  assert.equal(
    formatAltitudeLabel(350, { unit: 'flight level', datum: 'msl' }),
    '350 (unit unknown) · MSL',
  );
});

test('invalid values render as Altitude unknown, never 0', () => {
  for (const bad of [
    null,
    undefined,
    '',
    '   ',
    true,
    false,
    {},
    [],
    NaN,
    Infinity,
    -Infinity,
    'abc',
  ]) {
    assert.equal(
      formatAltitudeLabel(bad, { unit: 'ft', datum: 'msl' }),
      'Altitude unknown',
    );
  }
});

test('zero and negatives are valid altitudes', () => {
  assert.equal(
    formatAltitudeLabel(0, { unit: 'm', datum: 'msl' }),
    '0 m · MSL',
  );
  assert.equal(
    formatAltitudeLabel(-430, { unit: 'm', datum: 'msl' }),
    '-430 m · MSL',
  );
  assert.equal(
    formatAltitudeLabel('-86', { unit: 'm', datum: 'msl' }),
    '-86 m · MSL',
  );
});

test('numeric strings coerce; decimals round to one place', () => {
  assert.equal(
    formatAltitudeLabel('5000', { unit: 'ft', datum: 'msl' }),
    '5000 ft · MSL',
  );
  assert.equal(
    formatAltitudeLabel(12.46, { unit: 'm', datum: 'agl' }),
    '12.5 m · AGL',
  );
  assert.equal(
    formatAltitudeLabel(12.44, { unit: 'm', datum: 'agl' }),
    '12.4 m · AGL',
  );
});

test('normalize helpers return canonical codes or null', () => {
  assert.equal(normalizeAltitudeUnit('FEET'), 'ft');
  assert.equal(normalizeAltitudeUnit('fathoms'), null);
  assert.equal(normalizeAltitudeUnit(null), null);
  assert.equal(normalizeAltitudeDatum('HAE'), 'ellipsoid');
  assert.equal(normalizeAltitudeDatum('barometric'), null);
  assert.equal(normalizeAltitudeDatum(undefined), null);
});

test('expanded names return verified phrases or null', () => {
  assert.equal(altitudeUnitName('feet'), 'feet');
  assert.equal(altitudeUnitName('m'), 'metres');
  assert.equal(altitudeUnitName('fathoms'), null);
  assert.equal(altitudeDatumName('MSL'), 'mean sea level');
  assert.equal(altitudeDatumName('AGL'), 'above ground level');
  assert.equal(altitudeDatumName('HAE'), 'above the WGS 84 ellipsoid');
  assert.equal(altitudeDatumName('barometric'), null);
});
