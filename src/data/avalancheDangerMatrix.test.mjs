import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREQUENCY_CLASSES,
  SIZE_CLASSES,
  STABILITY_CLASSES,
  avalancheDangerMatrix,
} from './avalancheDangerMatrix.js';

/**
 * External anchors. Every expected level below is the published
 * D1 (primary, Matrix-suggested) value from the EAWS Matrix
 * (Muller, Techel & Mitterer, NHESS 25, 4503-4521, 2025,
 * Part A, Fig. 3b), independent of this module's table:
 *
 * Worked examples from the paper's section 6.2:
 * - very poor-many-size 1 -> 2 (paper: "D1=2, D2=3")
 * - poor-many-size 2 -> 3 (paper: "D=3")
 * - very poor-some-size 2 -> 3 and very poor-some-size 3 -> 3
 *   (paper: "D=3 or D1=3, D2=4")
 * - very poor-some-size 3 -> D1=3 (paper sect. 6: "the Matrix
 *   shows D1=3 and D2=4")
 *
 * High-agreement cells stated in the paper (sect. 4.3):
 * - fair-a few-size 1 -> 1 (97% of forecasters)
 * - very poor-many-size 5 -> 5 (99%)
 * - very poor-many-size 3 -> 4 (85%)
 * - poor-some-size 3 -> 3 (84%)
 *
 * Boundary/transition cells decoded from the published matrix:
 * - very poor-a few-size 1 -> 1 (the lowest cell of the
 *   very-poor panel)
 * - fair-a few-size 2 -> 1 (transition to level 2 at size 3)
 * - fair-many-size 5 -> 4 (highest cell of the fair panel)
 * - poor-a few-size 5 -> 3
 * - poor-some-size 2 -> 2 (spans 2-3 in the survey)
 * - fair-some-size 3 -> 2
 * - poor-many-size 3 -> 4
 * - very poor-some-size 5 -> 5
 */

test('paper worked examples resolve to the published D1 levels', () => {
  assert.equal(
    avalancheDangerMatrix({
      stability: 'very poor',
      frequency: 'many',
      size: 1,
    }),
    2,
  );
  assert.equal(
    avalancheDangerMatrix({ stability: 'poor', frequency: 'many', size: 2 }),
    3,
  );
  assert.equal(
    avalancheDangerMatrix({
      stability: 'very poor',
      frequency: 'some',
      size: 2,
    }),
    3,
  );
  assert.equal(
    avalancheDangerMatrix({
      stability: 'very poor',
      frequency: 'some',
      size: 3,
    }),
    3,
  );
});

test('high-agreement anchor cells match the paper', () => {
  assert.equal(
    avalancheDangerMatrix({ stability: 'fair', frequency: 'a few', size: 1 }),
    1,
  );
  assert.equal(
    avalancheDangerMatrix({
      stability: 'very poor',
      frequency: 'many',
      size: 5,
    }),
    5,
  );
  assert.equal(
    avalancheDangerMatrix({
      stability: 'very poor',
      frequency: 'many',
      size: 3,
    }),
    4,
  );
  assert.equal(
    avalancheDangerMatrix({ stability: 'poor', frequency: 'some', size: 3 }),
    3,
  );
});

test('boundary and transition cells match the published matrix', () => {
  const cases = [
    ['very poor', 'a few', 1, 1],
    ['very poor', 'a few', 5, 4],
    ['very poor', 'some', 5, 5],
    ['poor', 'many', 3, 4],
    ['poor', 'some', 2, 2],
    ['poor', 'some', 5, 4],
    ['poor', 'a few', 5, 3],
    ['fair', 'many', 5, 4],
    ['fair', 'some', 3, 2],
    ['fair', 'a few', 2, 1],
    ['fair', 'a few', 5, 3],
  ];
  for (const [stability, frequency, size, expected] of cases) {
    assert.equal(
      avalancheDangerMatrix({ stability, frequency, size }),
      expected,
      `${stability}/${frequency}/size ${size} should be ${expected}`,
    );
  }
});

test('every one of the 45 cells yields an integer level 1-5', () => {
  let count = 0;
  for (const stability of STABILITY_CLASSES) {
    for (const frequency of FREQUENCY_CLASSES) {
      for (const size of [1, 2, 3, 4, 5]) {
        const level = avalancheDangerMatrix({ stability, frequency, size });
        assert.ok(
          Number.isInteger(level) && level >= 1 && level <= 5,
          `${stability}/${frequency}/size ${size} gave ${level}`,
        );
        count += 1;
      }
    }
  }
  assert.equal(count, 45);
});

test('axis labels are normalized case-insensitively with whitespace trimmed', () => {
  assert.equal(
    avalancheDangerMatrix({
      stability: 'Very Poor',
      frequency: 'MANY',
      size: '3',
    }),
    4,
  );
  assert.equal(
    avalancheDangerMatrix({
      stability: ' poor ',
      frequency: ' Some ',
      size: 3,
    }),
    3,
  );
  assert.equal(
    avalancheDangerMatrix({ stability: 'FAIR', frequency: 'A Few', size: 1 }),
    1,
  );
});

test('workflow-only classes are not matrix cells: return null, never throw', () => {
  // "good" stability and "none or nearly none" frequency are
  // published EAWS workflow concepts (default to level 1 / skip to
  // the next panel), not Matrix panels or rows.
  assert.equal(
    avalancheDangerMatrix({ stability: 'good', frequency: 'many', size: 3 }),
    null,
  );
  assert.equal(
    avalancheDangerMatrix({
      stability: 'poor',
      frequency: 'none or nearly none',
      size: 3,
    }),
    null,
  );
});

test('invalid axis values return null, never throw', () => {
  const invalids = [
    { stability: 'excellent', frequency: 'many', size: 3 },
    { stability: 'poor', frequency: 'everywhere', size: 3 },
    { stability: 'poor', frequency: 'many', size: 0 },
    { stability: 'poor', frequency: 'many', size: 6 },
    { stability: 'poor', frequency: 'many', size: 'big' },
    { stability: 'poor', frequency: 'many', size: 2.5 },
    { stability: 'poor', frequency: 'many', size: NaN },
    { stability: 'poor', frequency: 'many', size: null },
    { stability: null, frequency: 'many', size: 3 },
    { stability: 42, frequency: 'many', size: 3 },
    {},
    { stability: 'poor' },
    { frequency: 'many', size: 3 },
  ];
  for (const args of invalids) {
    assert.equal(
      avalancheDangerMatrix(args),
      null,
      `expected null for ${JSON.stringify(args)}`,
    );
  }
  assert.equal(avalancheDangerMatrix(null), null);
  assert.equal(avalancheDangerMatrix(undefined), null);
  assert.equal(avalancheDangerMatrix('poor'), null);
  assert.equal(avalancheDangerMatrix([]), null);
  assert.equal(avalancheDangerMatrix(42), null);
});

test('published axis constants cover the three matrix panels, rows, and sizes', () => {
  assert.deepEqual([...STABILITY_CLASSES], ['very poor', 'poor', 'fair']);
  assert.deepEqual([...FREQUENCY_CLASSES], ['many', 'some', 'a few']);
  assert.equal(SIZE_CLASSES.length, 5);
  assert.deepEqual(
    SIZE_CLASSES.map((entry) => entry.size),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    SIZE_CLASSES.map((entry) => entry.label),
    ['Small', 'Medium', 'Large', 'Very large', 'Extremely large'],
  );
});
