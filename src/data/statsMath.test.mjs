import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interquartileRange,
  max,
  mean,
  median,
  min,
  percentile,
  stdDev,
  sum,
  variance,
} from './statsMath.js';

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

test('sum adds values and is 0 for an empty array', () => {
  assert.equal(sum([1, 2, 3, 4]), 10);
  assert.equal(sum([]), 0);
  assert.equal(sum([5]), 5);
});

test('sum returns NaN for a non-array or any non-finite element', () => {
  assert.ok(Number.isNaN(sum(null)));
  assert.ok(Number.isNaN(sum('abc')));
  assert.ok(Number.isNaN(sum([1, NaN, 3])));
  assert.ok(Number.isNaN(sum([1, Infinity])));
});

test('mean averages values and is NaN for an empty array', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(mean([7]), 7);
  assert.ok(Number.isNaN(mean([])));
  assert.ok(Number.isNaN(mean([1, NaN])));
  assert.ok(Number.isNaN(mean(null)));
});

test('median picks the middle value for odd counts', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([9]), 9);
});

test('median averages the two middles for even counts (flowMatch rule)', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  // NOT the spectrum.js upper median (which would return 3 here).
  assert.notEqual(median([1, 2, 3, 4]), 3);
});

test('median is the 50th percentile and is NaN for an empty array', () => {
  assert.equal(median([1, 2, 3, 4]), percentile([1, 2, 3, 4], 0.5));
  assert.ok(Number.isNaN(median([])));
});

test('median sorts numerically, not lexicographically', () => {
  // The contactPlayback.js copy calls bare .sort(), which orders
  // [2, 10] as [10, 2]. The canonical median of [2, 10] is 6.
  assert.equal(median([10, 2]), 6);
  assert.equal(median([100, 9, 25]), 25);
});

test('statistics never mutate the input array', () => {
  const values = [4, 1, 3, 2];
  median(values);
  percentile(values, 0.9);
  assert.deepEqual(values, [4, 1, 3, 2]);
});

test('min/max follow Math.min/Math.max empty-array semantics', () => {
  assert.equal(min([3, 1, 2]), 1);
  assert.equal(max([3, 1, 2]), 3);
  assert.equal(min([]), Infinity);
  assert.equal(max([]), -Infinity);
  assert.ok(Number.isNaN(min([1, NaN])));
  assert.ok(Number.isNaN(max([1, Infinity])));
  assert.ok(Number.isNaN(min(null)));
});

test('variance defaults to population variance', () => {
  // Classic example: mean 5, population variance 4.
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(variance(values), 4);
  assert.ok(Number.isNaN(variance([])));
  assert.ok(Number.isNaN(variance([1, NaN])));
});

test('variance with sample:true divides by n - 1', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  assertNear(variance(values, { sample: true }), 32 / 7, 1e-12, 'sample variance');
  assert.ok(Number.isNaN(variance([5], { sample: true })));
  assert.ok(Number.isNaN(variance([], { sample: true })));
});

test('stdDev is the square root of variance', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(stdDev(values), 2);
  assertNear(stdDev(values, { sample: true }), Math.sqrt(32 / 7), 1e-12, 'sample stdDev');
  assert.ok(Number.isNaN(stdDev([])));
});

test('percentile endpoints are min and max', () => {
  assert.equal(percentile([3, 1, 2], 0), 1);
  assert.equal(percentile([3, 1, 2], 1), 3);
  assert.equal(percentile([7], 0.37), 7);
});

test('percentile linearly interpolates between neighbours', () => {
  assert.equal(percentile([0, 10], 0.25), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([0, 10, 20], 0.5), 10);
});

test('percentile uses interpolation, NOT the nearest-rank rule', () => {
  // The in-base nearest-rank copies return 100 here; canonical is 95.
  assert.equal(percentile([0, 100], 0.95), 95);
  assert.notEqual(percentile([0, 100], 0.95), 100);
});

test('percentile returns NaN for p outside [0, 1] or bad input', () => {
  assert.ok(Number.isNaN(percentile([1, 2], -0.1)));
  assert.ok(Number.isNaN(percentile([1, 2], 1.1)));
  assert.ok(Number.isNaN(percentile([1, 2], 95)));
  assert.ok(Number.isNaN(percentile([1, 2], NaN)));
  assert.ok(Number.isNaN(percentile([], 0.5)));
  assert.ok(Number.isNaN(percentile([1, Infinity], 0.5)));
});

test('interquartileRange is Q3 minus Q1', () => {
  assert.equal(interquartileRange([1, 2, 3, 4]), 1.5);
  assert.equal(interquartileRange([5]), 0);
  assert.ok(Number.isNaN(interquartileRange([])));
  assert.ok(Number.isNaN(interquartileRange([1, NaN])));
});
