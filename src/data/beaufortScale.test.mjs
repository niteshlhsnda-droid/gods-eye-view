import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEAUFORT_SCALE,
  GALE_FORCE,
  beaufortFromKilometresPerHour,
  beaufortFromKnots,
  beaufortFromMetersPerSecond,
  beaufortFromMilesPerHour,
  isGaleForce,
} from './beaufortScale.js';

/**
 * External anchors: NOAA SPC's Beaufort table
 * (https://www.spc.noaa.gov/faq/tornado/beaufort.html) for the knot
 * bands, WMO names, and sea/land effects, cross-checked against
 * NOAA JetStream's table
 * (https://www.noaa.gov/jetstream/ocean/waves/jetstream-max-wind-and-sea-scales)
 * for the mph / km/h ranges and mean speeds. Both fetched 2026-10-17.
 */

test('table has 13 frozen forces 0-12 in order', () => {
  assert.equal(BEAUFORT_SCALE.length, 13);
  assert.ok(Object.isFrozen(BEAUFORT_SCALE));
  BEAUFORT_SCALE.forEach((entry, index) => {
    assert.equal(entry.force, index);
    assert.ok(Object.isFrozen(entry));
  });
});

test('names follow the NOAA SPC WMO classifications', () => {
  assert.deepEqual(
    BEAUFORT_SCALE.map((entry) => entry.name),
    [
      'Calm',
      'Light Air',
      'Light Breeze',
      'Gentle Breeze',
      'Moderate Breeze',
      'Fresh Breeze',
      'Strong Breeze',
      'Near Gale',
      'Gale',
      'Strong Gale',
      'Storm',
      'Violent Storm',
      'Hurricane',
    ],
  );
});

test('knot bands are contiguous half-open intervals, open-ended at 12', () => {
  for (let index = 0; index < BEAUFORT_SCALE.length - 1; index += 1) {
    assert.equal(
      BEAUFORT_SCALE[index].knotsMax,
      BEAUFORT_SCALE[index + 1].knotsMin,
    );
  }
  const last = BEAUFORT_SCALE[BEAUFORT_SCALE.length - 1];
  assert.equal(last.knotsMin, 64);
  assert.equal(last.knotsMax, null);
});

test('knot boundaries take the higher force', () => {
  const cases = [
    [0, 0],
    [0.99, 0],
    [1, 1],
    [3.99, 1],
    [4, 2],
    [6.99, 2],
    [7, 3],
    [10.99, 3],
    [11, 4],
    [16.99, 4],
    [17, 5],
    [21.99, 5],
    [22, 6],
    [27.99, 6],
    [28, 7],
    [33.99, 7],
    [34, 8],
    [40.99, 8],
    [41, 9],
    [47.99, 9],
    [48, 10],
    [55.99, 10],
    [56, 11],
    [63.99, 11],
    [64, 12],
    [200, 12],
  ];
  for (const [knots, force] of cases) {
    assert.equal(beaufortFromKnots(knots).force, force, `${knots} kt`);
  }
});

test('classifier returns the frozen table entry', () => {
  assert.equal(beaufortFromKnots(19), BEAUFORT_SCALE[5]);
  assert.equal(beaufortFromKnots(19).name, 'Fresh Breeze');
});

test('m/s converts through knots: 10 m/s is Force 5, 33 m/s is Force 12', () => {
  assert.equal(beaufortFromMetersPerSecond(0).force, 0);
  // 10 m/s = 19.44 kt -> Fresh Breeze.
  assert.equal(beaufortFromMetersPerSecond(10).force, 5);
  // 0.5 m/s = 0.97 kt -> still Calm; 0.52 m/s = 1.01 kt -> Light Air.
  assert.equal(beaufortFromMetersPerSecond(0.5).force, 0);
  assert.equal(beaufortFromMetersPerSecond(0.52).force, 1);
  // 33 m/s = 64.14 kt -> Hurricane force.
  assert.equal(beaufortFromMetersPerSecond(33).force, 12);
});

test('mph and km/h agree with the knot bands', () => {
  // 10 mph = 8.69 kt -> Gentle Breeze.
  assert.equal(beaufortFromMilesPerHour(10).force, 3);
  // 100 mph = 86.90 kt -> Hurricane force.
  assert.equal(beaufortFromMilesPerHour(100).force, 12);
  // 50 km/h = 27.0 kt -> Strong Breeze.
  assert.equal(beaufortFromKilometresPerHour(50).force, 6);
  // 120 km/h = 64.8 kt -> Hurricane force.
  assert.equal(beaufortFromKilometresPerHour(120).force, 12);
});

test('sea and land effects come from the NOAA SPC table', () => {
  assert.equal(BEAUFORT_SCALE[0].sea, 'Sea surface smooth and mirror-like');
  assert.equal(BEAUFORT_SCALE[0].land, 'Calm, smoke rises vertically');
  assert.match(BEAUFORT_SCALE[8].land, /Twigs breaking off trees/);
  assert.match(BEAUFORT_SCALE[12].sea, /sea completely white/);
});

test('mean speeds match NOAA JetStream', () => {
  assert.deepEqual(
    BEAUFORT_SCALE.map((entry) => entry.meanKnots),
    [0, 2, 5, 9, 13, 19, 24, 30, 37, 44, 52, 60, 68],
  );
});

test('gale threshold is Force 8', () => {
  assert.equal(GALE_FORCE, 8);
  assert.equal(isGaleForce(7), false);
  assert.equal(isGaleForce(8), true);
  assert.equal(isGaleForce(12), true);
});

test('invalid speeds throw', () => {
  for (const bad of [Number.NaN, Infinity, '10', undefined, null]) {
    assert.throws(() => beaufortFromKnots(bad), TypeError, String(bad));
    assert.throws(
      () => beaufortFromMetersPerSecond(bad),
      TypeError,
      String(bad),
    );
    assert.throws(() => beaufortFromMilesPerHour(bad), TypeError, String(bad));
    assert.throws(
      () => beaufortFromKilometresPerHour(bad),
      TypeError,
      String(bad),
    );
  }
  assert.throws(() => beaufortFromKnots(-0.5), RangeError);
  assert.throws(() => isGaleForce(-1), RangeError);
  assert.throws(() => isGaleForce(13), RangeError);
  assert.throws(() => isGaleForce(7.5), RangeError);
});
