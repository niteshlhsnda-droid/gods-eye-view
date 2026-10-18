import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  firmsCohortLabel,
  FIRMS_COHORT_LIMIT,
  FIRMS_COHORT_WHY,
} from './firmsCohortLabel.js';
import { FIRMS_AMBIENT_COHORT_LIMIT } from './firmsLabels.js';

test('cap matches the shipped FIRMS ambient cohort limit', () => {
  assert.equal(FIRMS_COHORT_LIMIT, FIRMS_AMBIENT_COHORT_LIMIT);
  assert.equal(FIRMS_COHORT_LIMIT, 18);
});

test('shown < total reports truncation with hasMore', () => {
  const label = firmsCohortLabel({ shown: 18, total: 1204 });
  assert.deepEqual(label, {
    shown: 18,
    total: 1204,
    hasMore: true,
    text: 'showing 18 of 1,204 (truncated)',
  });
});

test('shown == total reports the complete cohort with hasMore false', () => {
  assert.deepEqual(firmsCohortLabel({ shown: 18, total: 18 }), {
    shown: 18,
    total: 18,
    hasMore: false,
    text: 'showing 18 of 18',
  });
  assert.deepEqual(firmsCohortLabel({ shown: 3, total: 3 }), {
    shown: 3,
    total: 3,
    hasMore: false,
    text: 'showing 3 of 3',
  });
});

test('empty cohort is a plain statement, not a truncation', () => {
  assert.deepEqual(firmsCohortLabel({ shown: 0, total: 0 }), {
    shown: 0,
    total: 0,
    hasMore: false,
    text: 'No active fires detected',
  });
});

test('total unknown uses the + form without claiming more exist', () => {
  assert.deepEqual(firmsCohortLabel({ shown: 18, total: null }), {
    shown: 18,
    total: null,
    hasMore: false,
    text: 'showing 18+ (total unavailable)',
  });
  const omitted = firmsCohortLabel({ shown: 5 });
  assert.equal(omitted.text, 'showing 5+ (total unavailable)');
  assert.equal(omitted.hasMore, false);
});

test('unknown total with nothing shown is invalid', () => {
  assert.equal(firmsCohortLabel({ shown: 0, total: null }), null);
});

test('invalid inputs return null, never throw', () => {
  const invalid = [
    undefined,
    null,
    {},
    { shown: '18', total: 20 },
    { shown: 18, total: '20' },
    { shown: -1, total: 20 },
    { shown: 18, total: -5 },
    { shown: 1.5, total: 20 },
    { shown: 18, total: 2.5 },
    { shown: NaN, total: 20 },
    { shown: 18, total: NaN },
    { shown: Infinity, total: 20 },
    { shown: 19, total: 18 }, // shown cannot exceed total
  ];
  for (const input of invalid) {
    assert.equal(firmsCohortLabel(input), null, JSON.stringify(input));
  }
});

test('why-note states the cap and the bypass rule', () => {
  assert.match(FIRMS_COHORT_WHY, /18/);
  assert.match(FIRMS_COHORT_WHY, /select/i);
});
