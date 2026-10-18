import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angularDifference,
  normalizeHeading,
  wrapLongitude,
} from './angleMath.js';

const inRange = (value) => value >= -180 && value < 180;

test('wrapLongitude leaves in-range values exactly untouched', () => {
  assert.equal(wrapLongitude(0.0005), 0.0005);
  assert.equal(wrapLongitude(-179.999), -179.999);
  assert.equal(wrapLongitude(0), 0);
  assert.equal(wrapLongitude(-180), -180);
});

test('wrapLongitude maps 180 to -180 (the [-180, 180) convention)', () => {
  assert.equal(wrapLongitude(180), -180);
  assert.equal(wrapLongitude(540), -180);
  assert.equal(wrapLongitude(-540), -180);
  assert.equal(wrapLongitude(270), -90);
  assert.equal(wrapLongitude(-270), 90);
  assert.equal(wrapLongitude(720), 0);
});

test('wrapLongitude never returns -0', () => {
  assert.equal(Object.is(wrapLongitude(-0), -0), false);
  assert.equal(wrapLongitude(-0), 0);
  assert.equal(Object.is(wrapLongitude(180), -0), false);
});

test('wrapLongitude passes non-finite values through', () => {
  assert.ok(Number.isNaN(wrapLongitude(NaN)));
  assert.equal(wrapLongitude(Infinity), Infinity);
  assert.equal(wrapLongitude(-Infinity), -Infinity);
});

test('wrapLongitude stays in range for large inputs (O(1), unlike the ADS-B loop)', () => {
  assert.ok(inRange(wrapLongitude(1e9)));
  assert.ok(inRange(wrapLongitude(-1e9)));
  assert.ok(inRange(wrapLongitude(123_456_789)));
});

test('normalizeHeading maps into [0, 360)', () => {
  assert.equal(normalizeHeading(0), 0);
  assert.equal(normalizeHeading(360), 0);
  assert.equal(normalizeHeading(720), 0);
  assert.equal(normalizeHeading(-90), 270);
  assert.equal(normalizeHeading(-720), 0);
  assert.equal(normalizeHeading(45.5), 45.5);
  assert.equal(normalizeHeading(359.999), 359.999);
});

test('normalizeHeading returns 0 for non-finite input (cockpit semantics)', () => {
  assert.equal(normalizeHeading(NaN), 0);
  assert.equal(normalizeHeading(Infinity), 0);
  assert.equal(normalizeHeading(-Infinity), 0);
});

test('angularDifference takes the shortest arc', () => {
  assert.equal(angularDifference(0, 90), 90);
  assert.equal(angularDifference(0, -90), -90);
  assert.equal(angularDifference(350, 10), 20);
  assert.equal(angularDifference(10, 350), -20);
  // Across the antimeridian: 179 -> -179 is +2, not -358.
  assert.equal(angularDifference(179, -179), 2);
  assert.equal(angularDifference(-179, 179), -2);
});

test('angularDifference resolves the 180 tie to -180, like the inline copies', () => {
  assert.equal(angularDifference(0, 180), -180);
  assert.equal(angularDifference(0, -180), -180);
  assert.equal(angularDifference(0, 540), -180);
});

test('angularDifference matches the inline ((x + 540) % 360) - 180 copies on their valid domain', () => {
  const inline = (delta) => ((delta + 540) % 360) - 180;
  // The inline copies only ever see differences of two normalized angles,
  // so delta is in [-540, 540]; on that domain the two agree exactly.
  for (const delta of [
    -540, -360, -270, -180, -90, 0, 45, 90, 179, 180, 270, 360, 540,
  ]) {
    assert.equal(angularDifference(0, delta), inline(delta), `delta ${delta}`);
  }
});

test('angularDifference fixes the inline formula outside [-540, 540]', () => {
  // JS % keeps the sign, so ((x + 540) % 360) - 180 gives -360 for -720
  // instead of 0. The helper wraps correctly for any input.
  assert.equal(((-720 + 540) % 360) - 180, -360);
  assert.equal(angularDifference(0, -720), 0);
});

test('angularDifference preserves exact small deltas the inline formula corrupts', () => {
  // The inline formula pushes 0.0005 through modulo arithmetic and gets
  // 0.0004999999999881766; the shared helper returns it exactly.
  assert.equal(angularDifference(0, 0.0005), 0.0005);
  assert.notEqual(((0.0005 + 540) % 360) - 180, 0.0005);
});

test('angularDifference propagates NaN for non-finite input', () => {
  assert.ok(Number.isNaN(angularDifference(NaN, 10)));
  assert.ok(Number.isNaN(angularDifference(10, NaN)));
});
