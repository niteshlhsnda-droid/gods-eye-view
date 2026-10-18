import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTleRefresh } from './tleRefresh.js';
import { createIngestion } from './ingestion.js';
import {
  tleAgeMs,
  tleEpochMs,
  tleIsStale,
} from '../../sources/tle.js';
import {
  TLE_MAX_AGE_MS,
  TLE_REFRESH_MIN_INTERVAL_MS,
  TLE_REFRESH_STALE_INTERVAL_MS,
} from './policy.js';

// Fixed probe clock: 2026-10-17 12:00:00 UTC.
const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 3600_000;

/** Build a TLE line 1 carrying the given epoch token (cols 19-32). */
function line1WithToken(token) {
  return `1 25544U 98067A   ${token}  .00016717  00000-0  30676-3 0  9993`;
}

/** Build a TLE line 1 whose epoch is `epochMs` (2-digit year + day-of-year). */
function line1ForEpoch(epochMs) {
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1);
  const dayOfYear = (epochMs - startOfYear) / 86400000 + 1;
  const token = `${String(year % 100).padStart(2, '0')}${dayOfYear
    .toFixed(8)
    .padStart(12, '0')}`;
  return line1WithToken(token);
}

/** Fresh refresh scheduler over `state`, pre-sampled with `entries`. */
function sampledRefresh(state, entries) {
  const refresh = createTleRefresh({ state });
  refresh.sampleTleEpochs(entries);
  return refresh;
}

describe('sampleTleEpochs', () => {
  it('tracks newest/oldest/count across entries', () => {
    const state = {};
    const refresh = createTleRefresh({ state });
    const entries = [
      { line1: line1ForEpoch(T0 - 3 * HOUR) },
      { line1: line1ForEpoch(T0 - HOUR) },
      { line1: line1ForEpoch(T0 - 2 * HOUR) },
    ];
    const sample = refresh.sampleTleEpochs(entries);
    assert.equal(sample.count, 3);
    assert.equal(sample.newest, tleEpochMs(entries[1].line1));
    assert.equal(sample.oldest, tleEpochMs(entries[0].line1));
    assert.equal(state._tleSample, sample);
  });

  it('skips malformed epochs without dropping the valid ones', () => {
    const state = {};
    const refresh = createTleRefresh({ state });
    const valid = { line1: line1ForEpoch(T0) };
    const sample = refresh.sampleTleEpochs([
      { line1: 'garbage' },
      {},
      { line1: null },
      { line1: 12345 },
      valid,
    ]);
    assert.equal(sample.count, 1);
    assert.equal(sample.newest, tleEpochMs(valid.line1));
    assert.equal(sample.oldest, tleEpochMs(valid.line1));
  });

  it('empty input yields an unknown sample, not a throw', () => {
    const state = {};
    const refresh = createTleRefresh({ state });
    assert.deepEqual(refresh.sampleTleEpochs([]), {
      newest: null,
      oldest: null,
      count: 0,
    });
  });

  it('all-malformed input yields an unknown sample', () => {
    const state = {};
    const refresh = createTleRefresh({ state });
    assert.deepEqual(refresh.sampleTleEpochs([{ line1: 'garbage' }]), {
      newest: null,
      oldest: null,
      count: 0,
    });
  });

  it('resampling replaces the previous sample and clears the due-logged flag', () => {
    const state = { _tleRefreshDueLogged: true };
    const refresh = createTleRefresh({ state });
    refresh.sampleTleEpochs([{ line1: line1ForEpoch(T0) }]);
    refresh.sampleTleEpochs([{ line1: line1ForEpoch(T0 - 100 * HOUR) }]);
    assert.equal(state._tleSample.count, 1);
    assert.equal(
      state._tleSample.newest,
      tleEpochMs(line1ForEpoch(T0 - 100 * HOUR)),
    );
    assert.equal(state._tleRefreshDueLogged, false);
  });

  it('exposes the same methods flat and under .methods', () => {
    const refresh = createTleRefresh({ state: {} });
    assert.equal(refresh.methods.refreshDue, refresh.refreshDue);
    assert.equal(refresh.methods.nextRefreshAt, refresh.nextRefreshAt);
    assert.equal(refresh.methods.freshness, refresh.freshness);
    assert.equal(
      refresh.methods.sampleTleEpochs,
      refresh.sampleTleEpochs,
    );
    assert.equal(
      refresh.methods.staleSampleCount,
      refresh.staleSampleCount,
    );
  });
});

describe('freshness', () => {
  it('is unknown before any sample', () => {
    const refresh = createTleRefresh({ state: {} });
    assert.deepEqual(refresh.freshness(T0), {
      status: 'unknown',
      maxAgeMs: null,
      count: 0,
    });
  });

  it('is unknown after an empty or all-malformed sample, even once loaded', () => {
    const state = { _lastUpdate: T0 };
    const refresh = createTleRefresh({ state });
    refresh.sampleTleEpochs([]);
    assert.equal(refresh.freshness(T0).status, 'unknown');
    refresh.sampleTleEpochs([{ line1: 'garbage' }]);
    assert.deepEqual(refresh.freshness(T0), {
      status: 'unknown',
      maxAgeMs: null,
      count: 0,
    });
  });

  it('is fresh within the max age, with the exact age', () => {
    const line1 = line1ForEpoch(T0);
    const refresh = sampledRefresh({}, [{ line1 }]);
    const epoch = tleEpochMs(line1);
    assert.deepEqual(refresh.freshness(epoch + HOUR), {
      status: 'fresh',
      maxAgeMs: HOUR,
      count: 1,
    });
  });

  it('is stale once the newest epoch passes the max age', () => {
    const line1 = line1ForEpoch(T0);
    const refresh = sampledRefresh({}, [{ line1 }]);
    assert.equal(
      refresh.freshness(tleEpochMs(line1) + 73 * HOUR).status,
      'stale',
    );
  });

  it('exactly at the max age is still fresh (strict > boundary)', () => {
    const line1 = line1ForEpoch(T0);
    const refresh = sampledRefresh({}, [{ line1 }]);
    const epoch = tleEpochMs(line1);
    assert.equal(
      refresh.freshness(epoch + TLE_MAX_AGE_MS).status,
      'fresh',
    );
    assert.equal(
      refresh.freshness(epoch + TLE_MAX_AGE_MS + 1).status,
      'stale',
    );
  });

  it('a future epoch is fresh with a negative age (clock skew / bad epoch)', () => {
    const line1 = line1ForEpoch(T0 + HOUR);
    const refresh = sampledRefresh({}, [{ line1 }]);
    const result = refresh.freshness(T0);
    assert.equal(result.status, 'fresh');
    assert.equal(result.maxAgeMs, T0 - tleEpochMs(line1));
    assert.ok(result.maxAgeMs < 0);
  });

  it('a backwards clock (nowMs before the epoch) stays fresh', () => {
    const line1 = line1ForEpoch(T0);
    const refresh = sampledRefresh({}, [{ line1 }]);
    const result = refresh.freshness(0);
    assert.equal(result.status, 'fresh');
    assert.ok(result.maxAgeMs < 0);
  });
});

describe('nextRefreshAt / refreshDue boundaries', () => {
  it('cold layer fetches now and is never due', () => {
    const refresh = createTleRefresh({ state: {} });
    assert.equal(refresh.nextRefreshAt(T0), T0);
    assert.equal(refresh.refreshDue(T0), false);
  });

  it('fresh catalog waits the full minimum interval', () => {
    const state = { _lastUpdate: T0 };
    const refresh = sampledRefresh(state, [{ line1: line1ForEpoch(T0) }]);
    assert.equal(
      refresh.nextRefreshAt(T0),
      T0 + TLE_REFRESH_MIN_INTERVAL_MS,
    );
    assert.equal(
      refresh.refreshDue(T0 + TLE_REFRESH_MIN_INTERVAL_MS - 1),
      false,
    );
    assert.equal(
      refresh.refreshDue(T0 + TLE_REFRESH_MIN_INTERVAL_MS),
      true,
    );
    assert.equal(
      refresh.refreshDue(T0 + TLE_REFRESH_MIN_INTERVAL_MS + 1),
      true,
    );
  });

  it('stale catalog waits only the short stale interval', () => {
    const state = { _lastUpdate: T0 };
    const refresh = sampledRefresh(state, [
      { line1: line1ForEpoch(T0 - 73 * HOUR) },
    ]);
    assert.equal(
      refresh.nextRefreshAt(T0),
      T0 + TLE_REFRESH_STALE_INTERVAL_MS,
    );
    assert.equal(
      refresh.refreshDue(T0 + TLE_REFRESH_STALE_INTERVAL_MS - 1),
      false,
    );
    assert.equal(
      refresh.refreshDue(T0 + TLE_REFRESH_STALE_INTERVAL_MS),
      true,
    );
    assert.equal(
      refresh.refreshDue(T0 + TLE_REFRESH_STALE_INTERVAL_MS + 1),
      true,
    );
  });

  it('unknown catalog waits the minimum interval (unknown is not stale)', () => {
    const state = { _lastUpdate: T0 };
    const refresh = createTleRefresh({ state });
    refresh.sampleTleEpochs([]);
    assert.equal(
      refresh.nextRefreshAt(T0),
      T0 + TLE_REFRESH_MIN_INTERVAL_MS,
    );
    assert.equal(refresh.refreshDue(T0 + 2 * MINUTE), false);
    assert.equal(
      refresh.refreshDue(T0 + TLE_REFRESH_MIN_INTERVAL_MS),
      true,
    );
  });

  it('stale sample with no _lastUpdate is never due (nothing loaded yet)', () => {
    const refresh = sampledRefresh({}, [
      { line1: line1ForEpoch(T0 - 100 * HOUR) },
    ]);
    assert.equal(refresh.nextRefreshAt(T0), T0);
    assert.equal(refresh.refreshDue(T0), false);
  });

  it('crossing the staleness boundary makes a refresh due before the minimum interval elapses', () => {
    const state = { _lastUpdate: T0 };
    const refresh = sampledRefresh(state, [
      // 71h55m old at load: fresh now, stale 5 min later.
      { line1: line1ForEpoch(T0 - TLE_MAX_AGE_MS + 5 * MINUTE) },
    ]);
    assert.equal(refresh.freshness(T0 + 4 * MINUTE).status, 'fresh');
    assert.equal(refresh.refreshDue(T0 + 4 * MINUTE), false);
    assert.equal(refresh.freshness(T0 + 6 * MINUTE).status, 'stale');
    assert.equal(refresh.refreshDue(T0 + 6 * MINUTE), true);
  });

  it('a backwards clock (nowMs before _lastUpdate) is never due', () => {
    const state = { _lastUpdate: T0 + 10 * MINUTE };
    const refresh = sampledRefresh(state, [{ line1: line1ForEpoch(T0) }]);
    assert.equal(refresh.refreshDue(T0), false);
    assert.equal(
      refresh.nextRefreshAt(T0),
      T0 + 10 * MINUTE + TLE_REFRESH_MIN_INTERVAL_MS,
    );
  });
});

describe('tleAgeMs / tleIsStale', () => {
  it('tleAgeMs returns null for a malformed epoch', () => {
    assert.equal(tleAgeMs('garbage', T0), null);
    assert.equal(tleAgeMs('short', T0), null);
  });

  it('tleAgeMs is negative for a future epoch', () => {
    const line1 = line1ForEpoch(T0 + HOUR);
    assert.equal(tleAgeMs(line1, T0), T0 - tleEpochMs(line1));
    assert.ok(tleAgeMs(line1, T0) < 0);
  });

  it('tleIsStale treats malformed epochs as stale', () => {
    assert.equal(tleIsStale('garbage', { nowMs: T0 }), true);
    assert.equal(
      tleIsStale('garbage', { nowMs: T0, maxAgeMs: Number.POSITIVE_INFINITY }),
      true,
    );
  });

  it('tleIsStale boundary is strict >', () => {
    const line1 = line1ForEpoch(T0);
    const epoch = tleEpochMs(line1);
    assert.equal(tleIsStale(line1, { nowMs: epoch + TLE_MAX_AGE_MS }), false);
    assert.equal(
      tleIsStale(line1, { nowMs: epoch + TLE_MAX_AGE_MS + 1 }),
      true,
    );
  });

  it('tleIsStale honours a custom maxAgeMs', () => {
    const line1 = line1ForEpoch(T0);
    const nowMs = tleEpochMs(line1) + 10 * MINUTE;
    assert.equal(tleIsStale(line1, { nowMs, maxAgeMs: 5 * MINUTE }), true);
    assert.equal(tleIsStale(line1, { nowMs, maxAgeMs: 15 * MINUTE }), false);
  });
});

describe('tleEpochMs', () => {
  it('rejects day-of-year 0 and 368', () => {
    assert.equal(tleEpochMs(line1WithToken('24000.00000000')), null);
    assert.equal(tleEpochMs(line1WithToken('24368.00000000')), null);
  });

  it('accepts day-of-year 367, rolling into the next year', () => {
    // Documents the current inclusive upper bound: day 367 has no calendar
    // meaning (max 366 in a leap year) but the parser accepts it.
    assert.equal(
      tleEpochMs(line1WithToken('24367.00000000')),
      Date.UTC(2025, 0, 1),
    );
  });

  it('year pivot: 56 -> 20xx, 57 -> 19xx', () => {
    assert.equal(
      tleEpochMs(line1WithToken('56001.00000000')),
      Date.UTC(2056, 0, 1),
    );
    assert.equal(
      tleEpochMs(line1WithToken('57001.00000000')),
      Date.UTC(1957, 0, 1),
    );
    assert.equal(
      tleEpochMs(line1WithToken('00001.00000000')),
      Date.UTC(2000, 0, 1),
    );
    assert.equal(
      tleEpochMs(line1WithToken('99001.00000000')),
      Date.UTC(1999, 0, 1),
    );
  });

  it('a 1999 epoch is stale at a modern now', () => {
    assert.equal(
      tleIsStale(line1WithToken('99001.00000000'), { nowMs: T0 }),
      true,
    );
  });
});

describe('staleSampleCount', () => {
  it('counts stale + malformed, totals everything', () => {
    const refresh = createTleRefresh({ state: {} });
    // staleSampleCount ages against the real clock, so epochs stay relative
    // to Date.now() rather than the fixed probe clock T0.
    const now = Date.now();
    assert.deepEqual(
      refresh.staleSampleCount(
        [
          { line1: line1ForEpoch(now - HOUR) },
          { line1: line1ForEpoch(now - 100 * HOUR) },
          { line1: 'garbage' },
        ],
        { maxAgeMs: TLE_MAX_AGE_MS },
      ),
      { stale: 2, total: 3 },
    );
  });

  it('empty input is zero/zero', () => {
    const refresh = createTleRefresh({ state: {} });
    assert.deepEqual(refresh.staleSampleCount([]), { stale: 0, total: 0 });
  });

  it('honours a custom maxAgeMs', () => {
    const refresh = createTleRefresh({ state: {} });
    // staleSampleCount ages against the real clock: 10-minute-old entries.
    const entries = [
      { line1: line1ForEpoch(Date.now() - 10 * MINUTE) },
      { line1: line1ForEpoch(Date.now() - 10 * MINUTE) },
    ];
    assert.deepEqual(
      refresh.staleSampleCount(entries, { maxAgeMs: 5 * MINUTE }),
      { stale: 2, total: 2 },
    );
    assert.deepEqual(
      refresh.staleSampleCount(entries, { maxAgeMs: 15 * MINUTE }),
      { stale: 0, total: 2 },
    );
  });
});

describe('ingestion total-outage guard (failed refresh keeps the previous catalog)', () => {
  // Minimal state for the all-groups-failed early return: the update must
  // bail BEFORE clearing anything, without stamping _lastUpdate.
  function makeFailedRefreshState() {
    const catalog = new Map([[25544, { name: 'ISS (ZARYA)' }]]);
    const points = new Map([[25544, { id: 25544 }]]);
    const calls = { catalogClear: 0, pointsClear: 0, removeAll: 0 };
    catalog.clear = () => {
      calls.catalogClear += 1;
    };
    points.clear = () => {
      calls.pointsClear += 1;
    };
    const state = {
      _trackingRefreshEpoch: 0,
      _lastTrackingRefreshOutcome: null,
      _activeUpdateControllers: new Set(),
      _lastError: null,
      _catalog: catalog,
      _points: points,
      _orbitPaths: new Map(),
      _detectionObjects: new Map(),
      _pointCollection: {
        removeAll() {
          calls.removeAll += 1;
        },
      },
      _count: 1,
      _lastUpdate: T0,
      _tleSample: { newest: T0, oldest: T0, count: 1 },
      _params: { catalog: 'core' },
    };
    return { state, calls };
  }

  // A failed refresh never parses anything: no fresh text was fetched.
  const parts = {
    orbits: {
      parseTLE() {
        throw new Error('parseTLE must not run on failed groups');
      },
    },
  };

  it('all groups !ok keeps the previous catalog and does not stamp _lastUpdate', async () => {
    const { state, calls } = makeFailedRefreshState();
    const source = {
      readGroup: async () => ({ ok: false, status: 502, text: '' }),
    };
    const ingestion = createIngestion({ state, services: {}, parts, source });
    await ingestion.methods.update({});

    assert.equal(state._catalog.size, 1);
    assert.equal(state._catalog.get(25544).name, 'ISS (ZARYA)');
    assert.equal(state._points.size, 1);
    assert.equal(calls.catalogClear, 0);
    assert.equal(calls.pointsClear, 0);
    assert.equal(calls.removeAll, 0);
    assert.equal(state._count, 1);
    assert.equal(state._lastUpdate, T0);
    assert.deepEqual(state._tleSample, { newest: T0, oldest: T0, count: 1 });
    assert.equal(state._lastError, 'CelesTrak unreachable');
    assert.equal(state._lastTrackingRefreshOutcome.status, 'source-unavailable');
    assert.equal(state._activeUpdateControllers.size, 0);
    // Scheduling stays anchored at the last GOOD update, not the failed one.
    const refresh = createTleRefresh({ state });
    assert.equal(
      refresh.nextRefreshAt(T0 + MINUTE),
      T0 + TLE_REFRESH_MIN_INTERVAL_MS,
    );
  });

  it('all groups throwing keeps the previous catalog', async () => {
    const { state, calls } = makeFailedRefreshState();
    const source = {
      readGroup: async () => {
        throw new Error('boom');
      },
    };
    const ingestion = createIngestion({ state, services: {}, parts, source });
    await ingestion.methods.update({});

    assert.equal(state._catalog.size, 1);
    assert.equal(state._catalog.get(25544).name, 'ISS (ZARYA)');
    assert.equal(calls.catalogClear, 0);
    assert.equal(calls.pointsClear, 0);
    assert.equal(calls.removeAll, 0);
    assert.equal(state._lastUpdate, T0);
    assert.equal(state._lastError, 'CelesTrak unreachable');
    assert.equal(state._lastTrackingRefreshOutcome.status, 'source-unavailable');
  });
});
