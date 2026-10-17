import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INHG_TO_HPA,
  KILOMETERS_PER_MILE,
  KNOT_TO_KMH,
  KNOT_TO_MS,
  METERS_PER_FOOT,
  METERS_PER_MILE,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  feetToMeters,
  hpaToInHg,
  inHgToHpa,
  kmhToKnots,
  kmhToMs,
  kilometersToMiles,
  knotsToKmh,
  knotsToMs,
  metersToFeet,
  milesToKilometers,
  msToKmh,
  msToKnots,
} from './unitMath.js';

const ALL_CONVERTERS = [
  metersToFeet,
  feetToMeters,
  kilometersToMiles,
  milesToKilometers,
  knotsToKmh,
  kmhToKnots,
  knotsToMs,
  msToKnots,
  kmhToMs,
  msToKmh,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  hpaToInHg,
  inHgToHpa,
];

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

test('conversion constants are the exact canonical factors', () => {
  assert.equal(METERS_PER_FOOT, 0.3048);
  assert.equal(METERS_PER_MILE, 1609.344);
  assert.equal(KILOMETERS_PER_MILE, 1.609344);
  assert.equal(METERS_PER_MILE, KILOMETERS_PER_MILE * 1000);
  assert.equal(KNOT_TO_KMH, 1.852);
  assert.equal(KNOT_TO_MS, 1852 / 3600);
  assert.equal(INHG_TO_HPA, 3386.38866667 / 100);
  assertNear(INHG_TO_HPA, 33.8638866667, 1e-10, 'inHg factor');
});

test('length conversions hit exact anchors', () => {
  assert.equal(feetToMeters(1), 0.3048);
  assert.equal(metersToFeet(0.3048), 1);
  assert.equal(milesToKilometers(1), 1.609344);
  assert.equal(kilometersToMiles(1.609344), 1);
  assert.equal(metersToFeet(0), 0);
  assert.equal(feetToMeters(0), 0);
  assert.equal(milesToKilometers(0), 0);
  assertNear(metersToFeet(100), 328.0839895013123, 1e-9, '100 m in ft');
  assertNear(feetToMeters(5280), 1609.344, 1e-9, '5280 ft is one mile');
  assertNear(kilometersToMiles(100), 62.1371192237334, 1e-9, '100 km in mi');
});

test('converters return full precision, never rounded', () => {
  // A converter that rounded to 2 decimals would return 3.28 here.
  assert.equal(metersToFeet(1), 1 / 0.3048);
  assert.equal(metersToFeet(1), 3.280839895013123);
  assert.notEqual(metersToFeet(1), 3.28);
  assert.equal(kilometersToMiles(1), 1 / 1.609344);
  assert.equal(knotsToMs(1), 1852 / 3600);
  // The repeating-decimal knot factor must not be a truncated literal.
  assert.notEqual(knotsToMs(1), 0.5144);
  assertNear(knotsToMs(1), 0.5144444444444445, 1e-15, 'knot m/s full');
  assert.equal(hpaToInHg(1013.25), 1013.25 / 33.8638866667);
});

test('speed conversions hit exact anchors', () => {
  assert.equal(knotsToKmh(1), 1.852);
  assert.equal(kmhToKnots(1.852), 1);
  assert.equal(knotsToMs(1), 1852 / 3600);
  assert.equal(msToKnots(1852 / 3600), 1);
  assert.equal(kmhToMs(36), 10);
  assert.equal(msToKmh(10), 36);
  assert.equal(knotsToKmh(0), 0);
  assert.equal(kmhToMs(0), 0);
  assertNear(knotsToMs(10), 5.144444444444445, 1e-12, '10 kt in m/s');
  assertNear(kmhToKnots(100), 53.99568034557235, 1e-9, '100 km/h in kt');
  assertNear(msToKnots(10), 19.43844492440624, 1e-9, '10 m/s in kt');
});

test('temperature conversions hit exact anchors', () => {
  assert.equal(celsiusToFahrenheit(0), 32);
  assert.equal(celsiusToFahrenheit(100), 212);
  assert.equal(celsiusToFahrenheit(-40), -40);
  assert.equal(fahrenheitToCelsius(32), 0);
  assert.equal(fahrenheitToCelsius(212), 100);
  assert.equal(fahrenheitToCelsius(-40), -40);
  assertNear(celsiusToFahrenheit(37), 98.6, 1e-9, 'body temp');
  assertNear(fahrenheitToCelsius(98.6), 37, 1e-9, 'body temp back');
  assertNear(celsiusToFahrenheit(-17.77777777777778), 0, 1e-9, '0 F');
});

test('pressure conversions hit exact anchors', () => {
  assert.equal(inHgToHpa(1), 33.8638866667);
  assert.equal(hpaToInHg(33.8638866667), 1);
  assert.equal(hpaToInHg(0), 0);
  assert.equal(inHgToHpa(0), 0);
  // Standard atmosphere: 1013.25 hPa = 29.921252... inHg.
  assertNear(hpaToInHg(1013.25), 29.921255347112236, 1e-9, 'std atm');
  assertNear(inHgToHpa(29.92), 1013.207489067664, 1e-6, '29.92 inHg');
});

test('every pair round-trips within floating-point noise', () => {
  const pairs = [
    [metersToFeet, feetToMeters],
    [kilometersToMiles, milesToKilometers],
    [knotsToKmh, kmhToKnots],
    [knotsToMs, msToKnots],
    [kmhToMs, msToKmh],
    [celsiusToFahrenheit, fahrenheitToCelsius],
    [hpaToInHg, inHgToHpa],
  ];
  const samples = [0, 1, -1, 12.5, -273.15, 100, 1000, 1013.25, 12345.678];
  for (const [forward, back] of pairs) {
    for (const value of samples) {
      const roundTripped = back(forward(value));
      assertNear(
        roundTripped,
        value,
        Math.max(1e-9, Math.abs(value) * 1e-12),
        `round-trip ${forward.name}(${value})`,
      );
    }
  }
});

test('negative values are sign-preserved (delta semantics)', () => {
  assert.equal(metersToFeet(-1), -1 / 0.3048);
  assert.equal(feetToMeters(-100), -30.48);
  assert.equal(knotsToKmh(-10), -18.52);
  assert.equal(celsiusToFahrenheit(-40), -40);
  assert.equal(hpaToInHg(-1013.25), -1013.25 / 33.8638866667);
});

test('invalid input returns null for every converter', () => {
  const invalids = [NaN, Infinity, -Infinity, null, undefined, '1', {}, true];
  for (const convert of ALL_CONVERTERS) {
    for (const invalid of invalids) {
      assert.equal(
        convert(invalid),
        null,
        `${convert.name}(${String(invalid)}) should be null`,
      );
    }
  }
});
