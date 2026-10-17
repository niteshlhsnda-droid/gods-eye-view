import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beaufort,
  beaufortLabel,
  beaufortSummary,
  compassPoint,
  kmhToMps,
  knotsToMps,
  mphToMps,
  mpsToKmh,
  mpsToKnots,
  mpsToMph,
  windComponents,
  windFromComponents,
} from './windMath.js';

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

test('windComponents: wind from the north blows south (v = -speed)', () => {
  const { u, v } = windComponents(10, 0);
  assertNear(u, 0, 1e-12, 'u');
  assert.equal(v, -10);
});

test('windComponents: cardinal directions follow the FROM convention', () => {
  const east = windComponents(10, 90);
  assert.equal(east.u, -10);
  assertNear(east.v, 0, 1e-12, 'east v');
  const south = windComponents(10, 180);
  assertNear(south.u, 0, 1e-12, 'south u');
  assert.equal(south.v, 10);
  const west = windComponents(10, 270);
  assertNear(west.u, 10, 1e-12, 'west u');
  assertNear(west.v, 0, 1e-12, 'west v');
});

test('windComponents: diagonal wind splits equally', () => {
  const { u, v } = windComponents(10, 45);
  assertNear(u, -10 / Math.SQRT2, 1e-12, 'u');
  assertNear(v, -10 / Math.SQRT2, 1e-12, 'v');
});

test('windComponents: 360 equals 0 and -90 equals 270', () => {
  assert.deepEqual(windComponents(10, 360), windComponents(10, 0));
  assert.deepEqual(windComponents(10, -90), windComponents(10, 270));
});

test('windComponents: zero speed is calm, negative or non-finite is NaN', () => {
  const calm = windComponents(0, 45);
  assertNear(calm.u, 0, 0, 'calm u');
  assertNear(calm.v, 0, 0, 'calm v');
  assert.ok(Number.isNaN(windComponents(-1, 45).u));
  assert.ok(Number.isNaN(windComponents(-1, 45).v));
  assert.ok(Number.isNaN(windComponents(NaN, 45).u));
  assert.ok(Number.isNaN(windComponents(10, Infinity).v));
});

test('windFromComponents: inverts windComponents on a round trip', () => {
  for (const [speed, direction] of [
    [10, 0],
    [10, 90],
    [5, 135],
    [12.5, 225],
    [3, 315],
    [7, 359],
  ]) {
    const { u, v } = windComponents(speed, direction);
    const back = windFromComponents(u, v);
    assertNear(back.speed, speed, 1e-9, `speed for ${direction}`);
    assertNear(back.directionDegrees, direction, 1e-9, `dir for ${direction}`);
  }
});

test('windFromComponents: zero vector is calm with direction 0', () => {
  assert.deepEqual(windFromComponents(0, 0), {
    speed: 0,
    directionDegrees: 0,
  });
});

test('windFromComponents: non-finite components are NaN', () => {
  const back = windFromComponents(NaN, 1);
  assert.ok(Number.isNaN(back.speed));
  assert.ok(Number.isNaN(back.directionDegrees));
});

test('beaufort: WMO lower-bound thresholds classify exactly', () => {
  assert.equal(beaufort(0), 0);
  assert.equal(beaufort(0.29), 0);
  assert.equal(beaufort(0.3), 1);
  assert.equal(beaufort(1.5), 1);
  assert.equal(beaufort(1.6), 2);
  assert.equal(beaufort(5.4), 3);
  assert.equal(beaufort(5.5), 4);
  assert.equal(beaufort(10.7), 5);
  assert.equal(beaufort(10.8), 6);
  assert.equal(beaufort(17.1), 7);
  assert.equal(beaufort(17.2), 8);
  assert.equal(beaufort(24.4), 9);
  assert.equal(beaufort(24.5), 10);
  assert.equal(beaufort(28.4), 10);
  assert.equal(beaufort(28.5), 11);
  assert.equal(beaufort(32.6), 11);
  assert.equal(beaufort(32.7), 12);
  assert.equal(beaufort(100), 12);
});

test('beaufort: negative, NaN, and Infinity are NaN', () => {
  assert.ok(Number.isNaN(beaufort(-0.1)));
  assert.ok(Number.isNaN(beaufort(NaN)));
  assert.ok(Number.isNaN(beaufort(Infinity)));
});

test('beaufortLabel: all 13 WMO descriptions', () => {
  assert.deepEqual(
    Array.from({ length: 13 }, (_, i) => beaufortLabel(i)),
    [
      'Calm',
      'Light air',
      'Light breeze',
      'Gentle breeze',
      'Moderate breeze',
      'Fresh breeze',
      'Strong breeze',
      'Near gale',
      'Gale',
      'Strong gale',
      'Storm',
      'Violent storm',
      'Hurricane force',
    ],
  );
});

test('beaufortLabel: invalid force numbers are null', () => {
  assert.equal(beaufortLabel(-1), null);
  assert.equal(beaufortLabel(13), null);
  assert.equal(beaufortLabel(5.5), null);
  assert.equal(beaufortLabel(NaN), null);
});

test('beaufortSummary: pairs force and label, null label when invalid', () => {
  assert.deepEqual(beaufortSummary(0.2), { force: 0, label: 'Calm' });
  assert.deepEqual(beaufortSummary(20), { force: 8, label: 'Gale' });
  assert.deepEqual(beaufortSummary(33), {
    force: 12,
    label: 'Hurricane force',
  });
  const invalid = beaufortSummary(-1);
  assert.ok(Number.isNaN(invalid.force));
  assert.equal(invalid.label, null);
});

test('compassPoint: 16-wind compass at cardinals and intercardinals', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(360), 'N');
  assert.equal(compassPoint(45), 'NE');
  assert.equal(compassPoint(90), 'E');
  assert.equal(compassPoint(135), 'SE');
  assert.equal(compassPoint(180), 'S');
  assert.equal(compassPoint(225), 'SW');
  assert.equal(compassPoint(270), 'W');
  assert.equal(compassPoint(315), 'NW');
});

test('compassPoint: half-step boundaries round up to the next point', () => {
  assert.equal(compassPoint(11.25), 'NNE');
  assert.equal(compassPoint(11.24), 'N');
  assert.equal(compassPoint(348.75), 'N');
  assert.equal(compassPoint(348.74), 'NNW');
  assert.equal(compassPoint(-45), 'NW');
});

test('compassPoint: non-finite input is null', () => {
  assert.equal(compassPoint(NaN), null);
  assert.equal(compassPoint(Infinity), null);
});

test('unit conversions: exact factors and round trips', () => {
  assertNear(mpsToKnots(1), 3600 / 1852, 1e-12, 'mpsToKnots');
  assertNear(knotsToMps(1), 1852 / 3600, 1e-15, 'knotsToMps');
  assert.equal(mpsToKmh(10), 36);
  assertNear(kmhToMps(36), 10, 1e-12, 'kmhToMps');
  assertNear(mpsToMph(1), 3600 / 1609.344, 1e-12, 'mpsToMph');
  assertNear(mphToMps(60), 26.8224, 1e-9, 'mphToMps');
  assertNear(knotsToMps(mpsToKnots(12.5)), 12.5, 1e-12, 'knot round trip');
  assertNear(mphToMps(mpsToMph(12.5)), 12.5, 1e-12, 'mph round trip');
});

test('unit conversions: non-finite input is NaN', () => {
  assert.ok(Number.isNaN(mpsToKnots(NaN)));
  assert.ok(Number.isNaN(knotsToMps(Infinity)));
  assert.ok(Number.isNaN(mpsToKmh(NaN)));
  assert.ok(Number.isNaN(kmhToMps(Infinity)));
  assert.ok(Number.isNaN(mpsToMph(NaN)));
  assert.ok(Number.isNaN(mphToMps(Infinity)));
});
