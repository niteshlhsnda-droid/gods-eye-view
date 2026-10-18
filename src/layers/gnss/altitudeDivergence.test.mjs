import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALTITUDE_DIVERGENCE_CONSISTENT_FT,
  ALTITUDE_DIVERGENCE_DIVERGENT_FT,
  ALTITUDE_DIVERGENCE_INTERPRETATION,
  altitudeDivergenceCheck,
  summarizeAltitudeDivergence,
} from './altitudeDivergence.js';

const aircraft = (overrides = {}) => ({
  altBaro: 35000,
  altGeom: 35000,
  ...overrides,
});

test('identical altitudes are consistent with a zero signed split', () => {
  assert.deepEqual(altitudeDivergenceCheck(aircraft()), {
    divergenceFt: 0,
    absDivergenceFt: 0,
    band: 'consistent',
    reason: null,
    interpretation: null,
  });
});

test('a split inside the consistent band keeps its sign', () => {
  assert.equal(
    altitudeDivergenceCheck(aircraft({ altGeom: 35400 })).divergenceFt,
    400,
  );
  assert.equal(
    altitudeDivergenceCheck(aircraft({ altGeom: 34600 })).divergenceFt,
    -400,
  );
  assert.equal(
    altitudeDivergenceCheck(aircraft({ altGeom: 34600 })).band,
    'consistent',
  );
});

test('band edges are inclusive at the consistent and watch ceilings', () => {
  assert.equal(
    altitudeDivergenceCheck(
      aircraft({
        altGeom: 35000 + ALTITUDE_DIVERGENCE_CONSISTENT_FT,
      }),
    ).band,
    'consistent',
  );
  assert.equal(
    altitudeDivergenceCheck(
      aircraft({
        altGeom: 35000 + ALTITUDE_DIVERGENCE_CONSISTENT_FT + 1,
      }),
    ).band,
    'watch',
  );
  assert.equal(
    altitudeDivergenceCheck(
      aircraft({
        altGeom: 35000 + ALTITUDE_DIVERGENCE_DIVERGENT_FT,
      }),
    ).band,
    'watch',
  );
  assert.equal(
    altitudeDivergenceCheck(
      aircraft({
        altGeom: 35000 + ALTITUDE_DIVERGENCE_DIVERGENT_FT + 1,
      }),
    ).band,
    'divergent',
  );
});

test('only a divergent split carries the suspected-altitude-error interpretation', () => {
  const divergent = altitudeDivergenceCheck(aircraft({ altGeom: 38000 }));
  assert.equal(divergent.band, 'divergent');
  assert.equal(
    divergent.interpretation,
    ALTITUDE_DIVERGENCE_INTERPRETATION,
  );
  const watch = altitudeDivergenceCheck(aircraft({ altGeom: 36000 }));
  assert.equal(watch.band, 'watch');
  assert.equal(watch.interpretation, null);
});

test('a missing or non-finite altitude is insufficient, never consistent', () => {
  for (const entry of [
    aircraft({ altBaro: undefined }),
    aircraft({ altGeom: undefined }),
    aircraft({ altBaro: null, altGeom: null }),
    aircraft({ altBaro: Number.NaN }),
    aircraft({ altGeom: '35000' }),
    {},
    undefined,
  ]) {
    assert.deepEqual(altitudeDivergenceCheck(entry), {
      divergenceFt: null,
      absDivergenceFt: null,
      band: 'insufficient',
      reason: 'missing-altitude',
      interpretation: null,
    });
  }
});

test('on-ground fixes are insufficient even with valid altitudes', () => {
  assert.deepEqual(
    altitudeDivergenceCheck(aircraft({ altGeom: 38000, onGround: true })),
    {
      divergenceFt: null,
      absDivergenceFt: null,
      band: 'insufficient',
      reason: 'on-ground',
      interpretation: null,
    },
  );
  // An explicit false still judges the split.
  assert.equal(
    altitudeDivergenceCheck(aircraft({ altGeom: 38000, onGround: false }))
      .band,
    'divergent',
  );
});

test('altitudes outside the plausible envelope are bad decodes, not evidence', () => {
  for (const entry of [
    aircraft({ altGeom: 80000 }),
    aircraft({ altBaro: 80000 }),
    aircraft({ altGeom: -2500 }),
    aircraft({ altBaro: -2500 }),
  ]) {
    const result = altitudeDivergenceCheck(entry);
    assert.equal(result.band, 'insufficient');
    assert.equal(result.reason, 'out-of-envelope');
    assert.equal(result.divergenceFt, null);
  }
});

test('the summary counts every band and lists divergent hexes in order', () => {
  const summary = summarizeAltitudeDivergence([
    { hex: 'aaaaaa', ...aircraft() },
    { hex: 'bbbbbb', ...aircraft({ altGeom: 36000 }) },
    { hex: 'cccccc', ...aircraft({ altGeom: 38000 }) },
    { hex: 'dddddd', ...aircraft({ altGeom: 32000 }) },
    { hex: 'eeeeee', ...aircraft({ altGeom: undefined }) },
    { ...aircraft({ altGeom: 39000 }) },
    null,
  ]);
  assert.deepEqual(summary, {
    total: 7,
    assessed: 5,
    consistent: 1,
    watch: 1,
    divergent: 3,
    insufficient: 2,
    divergentHexes: ['cccccc', 'dddddd'],
  });
});

test('the summary deduplicates hexes and caps the divergent list', () => {
  const summary = summarizeAltitudeDivergence(
    [
      { hex: 'aaaaaa', ...aircraft({ altGeom: 38000 }) },
      { hex: 'aaaaaa', ...aircraft({ altGeom: 39000 }) },
      { hex: 'bbbbbb', ...aircraft({ altGeom: 38000 }) },
      { hex: '', ...aircraft({ altGeom: 38000 }) },
    ],
    { maxDivergentHexes: 1 },
  );
  assert.equal(summary.divergent, 4);
  assert.deepEqual(summary.divergentHexes, ['aaaaaa']);
});

test('an empty snapshot summarizes to zero without throwing', () => {
  assert.deepEqual(summarizeAltitudeDivergence([]), {
    total: 0,
    assessed: 0,
    consistent: 0,
    watch: 0,
    divergent: 0,
    insufficient: 0,
    divergentHexes: [],
  });
  assert.deepEqual(summarizeAltitudeDivergence(), {
    total: 0,
    assessed: 0,
    consistent: 0,
    watch: 0,
    divergent: 0,
    insufficient: 0,
    divergentHexes: [],
  });
});
