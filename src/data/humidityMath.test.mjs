import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  absoluteHumidityGm3,
  dewPointFromTempRh,
  frostPointFromTempRh,
  humidex,
  relativeHumidityFromDewPoint,
  saturationVapourPressureHpa,
  vapourPressureDeficitHpa,
  vapourPressureHpa,
  wetBulbCelsiusStull,
} from './humidityMath.js';

/** Assert `actual` is within `tolerance` of `expected`. */
const closeTo = (actual, expected, tolerance) => {
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test('saturationVapourPressureHpa: textbook Magnus values over water', () => {
  closeTo(saturationVapourPressureHpa(0), 6.112, 0.001);
  closeTo(saturationVapourPressureHpa(20), 23.37, 0.05);
  closeTo(saturationVapourPressureHpa(30), 42.46, 0.05);
  // Saturation pressure rises with temperature.
  assert.ok(
    saturationVapourPressureHpa(30) > saturationVapourPressureHpa(20),
  );
});

test('saturationVapourPressureHpa: ice surface below freezing, rejects >0C', () => {
  closeTo(saturationVapourPressureHpa(-10, 'ice'), 2.6, 0.05);
  // Over ice, saturation is lower than over (supercooled) water.
  assert.ok(
    saturationVapourPressureHpa(-10, 'ice') <
      saturationVapourPressureHpa(-10, 'water'),
  );
  assert.equal(saturationVapourPressureHpa(5, 'ice'), null);
  assert.equal(saturationVapourPressureHpa(20, 'steam'), null);
});

test('saturationVapourPressureHpa: rejects invalid and out-of-range input', () => {
  assert.equal(saturationVapourPressureHpa(NaN), null);
  assert.equal(saturationVapourPressureHpa('20'), null);
  assert.equal(saturationVapourPressureHpa(undefined), null);
  assert.equal(saturationVapourPressureHpa(61), null);
  assert.equal(saturationVapourPressureHpa(-46), null);
  assert.equal(saturationVapourPressureHpa(-81, 'ice'), null);
});

test('vapourPressureHpa: RH fraction of saturation, exact endpoints', () => {
  closeTo(vapourPressureHpa(20, 50), 11.68, 0.05);
  assert.equal(vapourPressureHpa(20, 0), 0);
  closeTo(vapourPressureHpa(20, 100), 23.37, 0.05);
  assert.equal(vapourPressureHpa(20, 101), null);
  assert.equal(vapourPressureHpa(20, -1), null);
  assert.equal(vapourPressureHpa(NaN, 50), null);
});

test('dewPointFromTempRh: textbook values, saturated air, round-trip', () => {
  closeTo(dewPointFromTempRh(20, 50), 9.27, 0.05);
  closeTo(dewPointFromTempRh(30, 70), 23.94, 0.05);
  assert.equal(dewPointFromTempRh(20, 100), 20);
  // Dew point never exceeds the air temperature.
  assert.ok(dewPointFromTempRh(20, 50) < 20);
  // Round-trip: dew point back through RH recovers the input RH.
  closeTo(
    relativeHumidityFromDewPoint(20, dewPointFromTempRh(20, 50)),
    50,
    0.001,
  );
});

test('dewPointFromTempRh: rejects 0% RH and invalid input', () => {
  assert.equal(dewPointFromTempRh(20, 0), null);
  assert.equal(dewPointFromTempRh(20, 101), null);
  assert.equal(dewPointFromTempRh(NaN, 50), null);
  assert.equal(dewPointFromTempRh(20, NaN), null);
  assert.equal(dewPointFromTempRh(61, 50), null);
});

test('relativeHumidityFromDewPoint: textbook values, rejects supersaturation', () => {
  closeTo(relativeHumidityFromDewPoint(20, 9.27), 50, 0.05);
  assert.equal(relativeHumidityFromDewPoint(20, 20), 100);
  assert.equal(relativeHumidityFromDewPoint(20, 21), null);
  assert.equal(relativeHumidityFromDewPoint(NaN, 10), null);
  assert.equal(relativeHumidityFromDewPoint(20, '10'), null);
});

test('frostPointFromTempRh: above dew point below freezing, null when warm', () => {
  const dew = dewPointFromTempRh(-10, 50);
  const frost = frostPointFromTempRh(-10, 50);
  closeTo(frost, -16.53, 0.05);
  assert.ok(frost > dew);
  // Frost point is only defined below freezing: saturated warm air -> null.
  assert.equal(frostPointFromTempRh(20, 100), null);
  assert.equal(frostPointFromTempRh(20, 50), null);
  assert.equal(frostPointFromTempRh(-10, 0), null);
  assert.equal(frostPointFromTempRh(-10, 101), null);
});

test('absoluteHumidityGm3: textbook value, saturated air, dry air', () => {
  closeTo(absoluteHumidityGm3(20, 50), 8.64, 0.05);
  closeTo(absoluteHumidityGm3(30, 100), 30.35, 0.05);
  assert.equal(absoluteHumidityGm3(20, 0), 0);
  assert.equal(absoluteHumidityGm3(20, 101), null);
  assert.equal(absoluteHumidityGm3(NaN, 50), null);
});

test('vapourPressureDeficitHpa: half-saturation halves the deficit', () => {
  closeTo(vapourPressureDeficitHpa(20, 50), 11.68, 0.05);
  assert.equal(vapourPressureDeficitHpa(20, 100), 0);
  closeTo(vapourPressureDeficitHpa(20, 0), 23.37, 0.05);
  // es - e identity: VPD + vapour pressure = saturation pressure.
  closeTo(
    vapourPressureDeficitHpa(25, 40) + vapourPressureHpa(25, 40),
    saturationVapourPressureHpa(25),
    0.000001,
  );
  assert.equal(vapourPressureDeficitHpa(20, -5), null);
});

test('wetBulbCelsiusStull: textbook values, always below dry-bulb', () => {
  closeTo(wetBulbCelsiusStull(20, 50), 13.7, 0.15);
  closeTo(wetBulbCelsiusStull(30, 70), 25.6, 0.15);
  closeTo(wetBulbCelsiusStull(35, 40), 24.51, 0.15);
  assert.ok(wetBulbCelsiusStull(20, 50) < 20);
  assert.ok(wetBulbCelsiusStull(30, 70) < 30);
});

test('wetBulbCelsiusStull: rejects input outside the Stull validity box', () => {
  assert.equal(wetBulbCelsiusStull(-21, 50), null);
  assert.equal(wetBulbCelsiusStull(51, 50), null);
  assert.equal(wetBulbCelsiusStull(20, 4), null);
  assert.equal(wetBulbCelsiusStull(20, 100), null);
  assert.equal(wetBulbCelsiusStull(NaN, 50), null);
});

test('humidex: warm humid air feels hotter, dry air feels cooler', () => {
  closeTo(humidex(30, 50), 36.24, 0.05);
  closeTo(humidex(20, 100), 27.43, 0.05);
  assert.ok(humidex(30, 50) > 30);
  assert.ok(humidex(30, 0) < 30);
  assert.equal(humidex(30, 101), null);
  assert.equal(humidex('30', 50), null);
});

test('never throws or returns NaN on hostile input', () => {
  const hostile = [NaN, Infinity, -Infinity, '20', null, undefined, {}, []];
  for (const bad of hostile) {
    for (const fn of [
      saturationVapourPressureHpa,
      vapourPressureHpa,
      dewPointFromTempRh,
      relativeHumidityFromDewPoint,
      frostPointFromTempRh,
      absoluteHumidityGm3,
      vapourPressureDeficitHpa,
      wetBulbCelsiusStull,
      humidex,
    ]) {
      const result = fn(bad, 50);
      assert.ok(result === null || Number.isFinite(result));
    }
  }
});
