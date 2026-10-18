import test from 'node:test';
import assert from 'node:assert/strict';

import { createQueries } from './queries.js';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

/** Minimal harness: only the getStats() fresh branch is exercised. */
function statsFor({ fires, lastUpdate, ambientCohortShown }) {
  const { methods } = createQueries({
    layerState: {
      _loading: false,
      _keyRequired: false,
      _stale: false,
      _error: null,
      _fires: fires,
      _count: fires.length,
      _cellCount: 0,
      _lastUpdate: lastUpdate,
      _ambientCohortShown: ambientCohortShown ?? null,
    },
    services: {},
    // getStats() builds the stale text eagerly, so the model stub must
    // exist even though the fresh branch never renders it.
    components: { model: { formatAge: () => '<1h' } },
    config: { id: 'firms', name: 'Fires', icon: '', source: '' },
    feed: {},
  });
  return methods.getStats();
}

test('fresh FIRMS label headlines observation age, not the refetch', () => {
  const now = Date.now();
  const { loadingLabel } = statsFor({
    fires: [{ acqMs: now - 5 * HOUR }],
    lastUpdate: now - 30 * 1000,
  });
  assert.match(loadingLabel, /CONTINUOUS · observed 5h ago · fetched <1m ago/);
});

test('fresh FIRMS label without a refetch gap needs no fetched suffix', () => {
  const now = Date.now();
  const { loadingLabel } = statsFor({
    fires: [{ acqMs: now - 3 * MIN }],
    lastUpdate: now - MIN,
  });
  assert.match(loadingLabel, /CONTINUOUS · observed \dm ago/);
  assert.doesNotMatch(loadingLabel, /fetched/);
});

test('fresh FIRMS label with no detections says the observation age is unknown', () => {
  const now = Date.now();
  const { loadingLabel } = statsFor({ fires: [], lastUpdate: now - 30 * 1000 });
  assert.match(
    loadingLabel,
    /CONTINUOUS · fetched .* · observation age unknown/,
  );
});

test('getStats countLabel is the canonical truncated-cohort text', () => {
  const now = Date.now();
  const fires = Array.from({ length: 1204 }, (_, i) => ({
    acqMs: now - 5 * HOUR,
    index: i,
  }));
  const { countLabel } = statsFor({
    fires,
    lastUpdate: now - 30 * 1000,
    ambientCohortShown: 18,
  });
  assert.equal(countLabel, 'showing 18 of 1,204 (truncated)');
});

test('getStats countLabel says the whole cohort when nothing is truncated', () => {
  const now = Date.now();
  const fires = [
    { acqMs: now - 3 * MIN, index: 0 },
    { acqMs: now - 3 * MIN, index: 1 },
  ];
  const { countLabel } = statsFor({
    fires,
    lastUpdate: now - MIN,
    ambientCohortShown: 2,
  });
  assert.equal(countLabel, 'showing 2 of 2');
});

test('getStats countLabel is null before any cohort rebuild', () => {
  const now = Date.now();
  const { countLabel, count } = statsFor({
    fires: [{ acqMs: now - 5 * HOUR, index: 0 }],
    lastUpdate: now - 30 * 1000,
  });
  assert.equal(countLabel, null);
  assert.equal(count, 1);
});
