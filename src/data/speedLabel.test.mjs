import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSpeedLabel,
  normalizeSpeedBasis,
  normalizeSpeedUnit,
  speedBasisName,
  speedUnitName,
} from './speedLabel.js';

test('known units render with their canonical code', () => {
  assert.equal(
    formatSpeedLabel(120, { unit: 'kn', basis: 'ground' }),
    '120 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(100, { unit: 'km/h', basis: 'ground' }),
    '100 km/h · ground speed',
  );
  assert.equal(
    formatSpeedLabel(25, { unit: 'm/s', basis: 'wind' }),
    '25 m/s · wind speed',
  );
  assert.equal(
    formatSpeedLabel(60, { unit: 'mph', basis: 'air' }),
    '60 mph · airspeed',
  );
});

test('all four bases render their verified phrase', () => {
  assert.equal(
    formatSpeedLabel(120, { unit: 'kn', basis: 'ground' }),
    '120 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(120, { unit: 'kn', basis: 'air' }),
    '120 kn · airspeed',
  );
  assert.equal(
    formatSpeedLabel(8, { unit: 'kn', basis: 'water' }),
    '8 kn · water speed',
  );
  assert.equal(
    formatSpeedLabel(25, { unit: 'kn', basis: 'wind' }),
    '25 kn · wind speed',
  );
});

test('unit matching is case-insensitive, trims, and canonicalizes aliases', () => {
  assert.equal(
    formatSpeedLabel(120, { unit: 'KNOTS', basis: 'ground' }),
    '120 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(120, { unit: ' kts ', basis: 'ground' }),
    '120 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(120, { unit: 'kt', basis: 'ground' }),
    '120 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(100, { unit: 'kph', basis: 'ground' }),
    '100 km/h · ground speed',
  );
  assert.equal(
    formatSpeedLabel(25, { unit: 'mps', basis: 'wind' }),
    '25 m/s · wind speed',
  );
  assert.equal(
    formatSpeedLabel(60, { unit: 'mi/h', basis: 'air' }),
    '60 mph · airspeed',
  );
  assert.equal(normalizeSpeedUnit('KNOTS'), 'kn');
  assert.equal(normalizeSpeedUnit('kph'), 'km/h');
  assert.equal(normalizeSpeedUnit('mps'), 'm/s');
  assert.equal(normalizeSpeedUnit('mi/hr'), 'mph');
});

test('basis matching canonicalizes feed spellings (SOG, TAS, STW)', () => {
  assert.equal(
    formatSpeedLabel(120, { unit: 'kn', basis: 'SOG' }),
    '120 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(120, { unit: 'kn', basis: 'TAS' }),
    '120 kn · airspeed',
  );
  assert.equal(
    formatSpeedLabel(120, { unit: 'kn', basis: 'IAS' }),
    '120 kn · airspeed',
  );
  assert.equal(
    formatSpeedLabel(8, { unit: 'kn', basis: 'STW' }),
    '8 kn · water speed',
  );
  assert.equal(
    formatSpeedLabel(120, { unit: 'kn', basis: ' Ground Speed ' }),
    '120 kn · ground speed',
  );
  assert.equal(normalizeSpeedBasis('SOG'), 'ground');
  assert.equal(normalizeSpeedBasis('TAS'), 'air');
  assert.equal(normalizeSpeedBasis('STW'), 'water');
});

test('missing or unverified unit reads unit unknown, never bare or defaulted', () => {
  for (const unit of [null, undefined, '', '   ', 5, {}, [], 'furlongs']) {
    assert.equal(
      formatSpeedLabel(120, { unit, basis: 'ground' }),
      '120 (unit unknown) · ground speed',
      `unit: ${String(unit)}`,
    );
    assert.equal(normalizeSpeedUnit(unit), null);
  }
  // Never a bare number, and never a defaulted-to-knots label.
  assert.notEqual(formatSpeedLabel(120, { basis: 'ground' }), '120');
  assert.notEqual(
    formatSpeedLabel(120, { basis: 'ground' }),
    '120 kn · ground speed',
  );
});

test('missing or unverified basis reads basis unknown, never assumed', () => {
  for (const basis of [null, undefined, '', '   ', 5, {}, [], 'banana']) {
    assert.equal(
      formatSpeedLabel(120, { unit: 'kn', basis }),
      '120 kn (basis unknown)',
      `basis: ${String(basis)}`,
    );
    assert.equal(normalizeSpeedBasis(basis), null);
  }
  // A unit-only label must not invite a basis assumption.
  assert.notEqual(
    formatSpeedLabel(120, { unit: 'kn' }),
    '120 kn · ground speed',
  );
});

test('both unknown composes into one unknown parenthetical', () => {
  assert.equal(formatSpeedLabel(120, {}), '120 (unit unknown, basis unknown)');
  assert.equal(formatSpeedLabel(120), '120 (unit unknown, basis unknown)');
  assert.equal(
    formatSpeedLabel(120, { unit: 'furlongs', basis: 'banana' }),
    '120 (unit unknown, basis unknown)',
  );
  assert.equal(
    formatSpeedLabel(120, null),
    '120 (unit unknown, basis unknown)',
  );
});

test('bad speeds read Speed unknown, never a fake zero', () => {
  for (const value of [
    null,
    undefined,
    '',
    '   ',
    'banana',
    NaN,
    Infinity,
    -Infinity,
    -5,
    -0.1,
    true,
    false,
    {},
    [],
  ]) {
    assert.equal(
      formatSpeedLabel(value, { unit: 'kn', basis: 'ground' }),
      'Speed unknown',
      `value: ${String(value)}`,
    );
  }
});

test('zero is a real speed; integers stay whole, others round to one decimal', () => {
  assert.equal(
    formatSpeedLabel(0, { unit: 'kn', basis: 'ground' }),
    '0 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(12.5, { unit: 'kn', basis: 'ground' }),
    '12.5 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(12.34, { unit: 'kn', basis: 'ground' }),
    '12.3 kn · ground speed',
  );
  assert.equal(
    formatSpeedLabel(12.56, { unit: 'kn', basis: 'ground' }),
    '12.6 kn · ground speed',
  );
});

test('numeric strings coerce like the magnitude module', () => {
  assert.equal(
    formatSpeedLabel('120', { unit: 'kn', basis: 'ground' }),
    '120 kn · ground speed',
  );
});

test('verified expanded names resolve; unverified return null', () => {
  assert.equal(speedUnitName('kn'), 'knots');
  assert.equal(speedUnitName('knots'), 'knots');
  assert.equal(speedUnitName('km/h'), 'kilometres per hour');
  assert.equal(speedUnitName('m/s'), 'metres per second');
  assert.equal(speedUnitName('mph'), 'miles per hour');
  assert.equal(speedUnitName('furlongs'), null);
  assert.equal(speedUnitName(null), null);
  assert.equal(speedBasisName('ground'), 'ground speed');
  assert.equal(speedBasisName('SOG'), 'ground speed');
  assert.equal(speedBasisName('air'), 'airspeed');
  assert.equal(speedBasisName('water'), 'water speed');
  assert.equal(speedBasisName('wind'), 'wind speed');
  assert.equal(speedBasisName('banana'), null);
  assert.equal(speedBasisName(null), null);
});
