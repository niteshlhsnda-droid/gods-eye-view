import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add,
  angleBetween,
  cross,
  distance,
  distanceSquared,
  dot,
  equals,
  isVector,
  lerp,
  magnitude,
  magnitudeSquared,
  negate,
  normalize,
  project,
  scale,
  subtract,
  zeroVector,
} from './vectorMath.js';

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

function assertVectorNear(actual, expected, tolerance, label) {
  assert.ok(
    Array.isArray(actual),
    `${label}: expected an array, got ${actual}`,
  );
  assert.equal(actual.length, expected.length, `${label}: length`);
  actual.forEach((component, index) => {
    assertNear(component, expected[index], tolerance, `${label}[${index}]`);
  });
}

test('isVector: accepts finite vectors, rejects the rest', () => {
  assert.equal(isVector([1, 2]), true);
  assert.equal(isVector([0, 0, 0]), true);
  assert.equal(isVector([]), false);
  assert.equal(isVector([1, NaN]), false);
  assert.equal(isVector([1, Infinity]), false);
  assert.equal(isVector([1, '2']), false);
  assert.equal(isVector('12'), false);
  assert.equal(isVector(null), false);
  assert.equal(isVector(undefined), false);
});

test('add / subtract / negate / scale: component-wise, inputs unmutated', () => {
  const a = [1, 2, 3];
  const b = [4, -5, 6];
  assert.deepEqual(add(a, b), [5, -3, 9]);
  assert.deepEqual(subtract(a, b), [-3, 7, -3]);
  assert.deepEqual(negate(a), [-1, -2, -3]);
  assert.deepEqual(scale(a, 2), [2, 4, 6]);
  assert.deepEqual(scale(a, 0), [0, 0, 0]);
  assert.deepEqual(a, [1, 2, 3]);
  assert.deepEqual(b, [4, -5, 6]);
  assert.equal(add(a, [1, 2]), null);
  assert.equal(subtract(a, [1, 2]), null);
  assert.equal(add(a, [1, NaN, 3]), null);
  assert.equal(scale(a, Infinity), null);
  assert.equal(scale([1, 'x'], 2), null);
  assert.equal(negate([]), null);
});

test('dot / magnitude / magnitudeSquared: canonical values', () => {
  assert.equal(dot([1, 2, 3], [4, -5, 6]), 12);
  assert.equal(dot([3, 4], [3, 4]), 25);
  assert.equal(magnitude([3, 4]), 5);
  assert.equal(magnitude([1, 2, 2]), 3);
  assert.equal(magnitude([0, 0]), 0);
  assert.equal(magnitudeSquared([3, 4]), 25);
  assert.ok(Number.isNaN(dot([1, 2], [1, 2, 3])));
  assert.ok(Number.isNaN(dot([1, NaN], [1, 2])));
  assert.ok(Number.isNaN(magnitude([])));
  assert.ok(Number.isNaN(magnitudeSquared('ab')));
});

test('normalize: unit length, zero vector is null', () => {
  assertVectorNear(normalize([3, 4]), [0.6, 0.8], 1e-12, 'normalize([3,4])');
  assert.equal(magnitude(normalize([1, 2, 2, 3])), 1);
  assert.equal(normalize([0, 0, 0]), null);
  assert.equal(normalize([1, Infinity]), null);
  assert.equal(normalize([]), null);
});

test('distance / distanceSquared: canonical values', () => {
  assert.equal(distance([0, 0], [3, 4]), 5);
  assert.equal(distance([1, 2, 3], [1, 2, 3]), 0);
  assert.equal(distanceSquared([0, 0], [3, 4]), 25);
  assert.ok(Number.isNaN(distance([1, 2], [1, 2, 3])));
  assert.ok(Number.isNaN(distanceSquared([1, NaN], [1, 2])));
});

test('cross: right-hand rule, 3D only', () => {
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.deepEqual(cross([0, 1, 0], [1, 0, 0]), [0, 0, -1]);
  assert.deepEqual(cross([1, 2, 3], [1, 2, 3]), [0, 0, 0]);
  assert.deepEqual(cross([2, 3, 4], [5, 6, 7]), [-3, 6, -3]);
  assert.equal(cross([1, 2], [3, 4]), null);
  assert.equal(cross([1, 2, 3, 4], [5, 6, 7, 8]), null);
  assert.equal(cross([1, NaN, 3], [4, 5, 6]), null);
});

test('angleBetween: 0, right angle, straight angle, zero vector is NaN', () => {
  assertNear(angleBetween([1, 0], [1, 0]), 0, 1e-12, 'parallel');
  assertNear(angleBetween([1, 0], [0, 1]), Math.PI / 2, 1e-12, 'perpendicular');
  assertNear(angleBetween([1, 0], [-1, 0]), Math.PI, 1e-12, 'opposite');
  assertNear(angleBetween([1, 1], [1, 0]), Math.PI / 4, 1e-12, 'diagonal');
  // Nearly parallel: floating-point rounding must not leak NaN.
  assert.ok(Number.isFinite(angleBetween([1, 1e-12], [1, 0])));
  assert.ok(Number.isNaN(angleBetween([0, 0], [1, 0])));
  assert.ok(Number.isNaN(angleBetween([1, 2], [1, 2, 3])));
});

test('lerp: endpoints, midpoint, extrapolation, invalid t', () => {
  assert.deepEqual(lerp([0, 0], [10, 20], 0), [0, 0]);
  assert.deepEqual(lerp([0, 0], [10, 20], 1), [10, 20]);
  assert.deepEqual(lerp([0, 0], [10, 20], 0.5), [5, 10]);
  assert.deepEqual(lerp([0, 0], [10, 20], 2), [20, 40]);
  assert.deepEqual(lerp([0, 0], [10, 20], -1), [-10, -20]);
  assert.equal(lerp([0, 0], [10, 20], NaN), null);
  assert.equal(lerp([0, 0], [10, 20], Infinity), null);
  assert.equal(lerp([0, 0], [10], 0.5), null);
});

test('project: onto an axis, onto itself, onto zero is null', () => {
  assert.deepEqual(project([3, 4], [1, 0]), [3, 0]);
  assert.deepEqual(project([3, 4], [0, 1]), [0, 4]);
  assert.deepEqual(project([2, 2], [1, 1]), [2, 2]);
  assertVectorNear(project([1, 0], [1, 1]), [0.5, 0.5], 1e-12, 'diagonal');
  assert.equal(project([1, 2], [0, 0]), null);
  assert.equal(project([1, 2], [1, 2, 3]), null);
});

test('equals: exact, within epsilon, outside epsilon, invalid', () => {
  assert.equal(equals([1, 2], [1, 2]), true);
  assert.equal(equals([1, 2], [1, 2 + 1e-10]), true);
  assert.equal(equals([1, 2], [1, 2 + 1e-8]), false);
  assert.equal(equals([1, 2], [1, 2 + 0.5], 1), true);
  assert.equal(equals([1, 2], [1, 2, 3]), false);
  assert.equal(equals([1, NaN], [1, NaN]), false);
  assert.equal(equals([1, 2], [1, 2], -1), false);
  assert.equal(equals([1, 2], [1, 2], NaN), false);
});

test('zeroVector: dimensions and invalid dims', () => {
  assert.deepEqual(zeroVector(), [0, 0, 0]);
  assert.deepEqual(zeroVector(2), [0, 0]);
  assert.deepEqual(zeroVector(1), [0]);
  assert.equal(zeroVector(0), null);
  assert.equal(zeroVector(-1), null);
  assert.equal(zeroVector(2.5), null);
  assert.equal(zeroVector('3'), null);
});
