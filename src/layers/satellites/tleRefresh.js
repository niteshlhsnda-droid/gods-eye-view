import { tleEpochMs, tleIsStale } from '../../sources/tle.js';
import {
  TLE_MAX_AGE_MS,
  TLE_REFRESH_MIN_INTERVAL_MS,
  TLE_REFRESH_STALE_INTERVAL_MS,
} from './policy.js';

/**
 * TLE refresh scheduling for the satellites layer.
 *
 * SGP4 propagation error grows with TLE epoch age, so the layer tracks the
 * newest sampled TLE epoch after every successful catalog load and exposes a
 * scheduler the app's update loop can consult: `nextRefreshAt()` returns the
 * earliest time a re-fetch is allowed. Fresh catalogs wait out the normal
 * minimum interval; stale catalogs are allowed back sooner so the next update
 * tick recovers without hammering CelesTrak on a fixed short loop.
 *
 * The factory returns the methods both flat and under `methods`, matching
 * this layer's parts convention (see controls.js). Internal calls use direct
 * closure references — never `this` — so the functions stay correct when
 * re-exported onto the layer object (e.g. `getTleFreshness`).
 */
export function createTleRefresh({ state: layerState }) {
  /**
   * Record TLE epochs from a freshly parsed catalog. Entries are
   * `{ line1 }` (e.g. the output of parseTLE).
   */
  function sampleTleEpochs(entries) {
    let newest = null;
    let oldest = null;
    let count = 0;
    for (const entry of entries) {
      const epoch = tleEpochMs(entry.line1);
      if (epoch == null) continue;
      count += 1;
      if (newest == null || epoch > newest) newest = epoch;
      if (oldest == null || epoch < oldest) oldest = epoch;
    }
    layerState._tleSample = { newest, oldest, count };
    layerState._tleRefreshDueLogged = false;
    return layerState._tleSample;
  }

  /** Freshness of the loaded catalog at `nowMs`. */
  function freshness(nowMs = Date.now()) {
    const sample = layerState._tleSample;
    if (!sample || sample.count === 0)
      return { status: 'unknown', maxAgeMs: null, count: 0 };
    const maxAgeMs = nowMs - sample.newest;
    const stale = sample.newest == null || maxAgeMs > TLE_MAX_AGE_MS;
    return {
      status: stale ? 'stale' : 'fresh',
      maxAgeMs: sample.newest == null ? null : maxAgeMs,
      count: sample.count,
    };
  }

  /**
   * Earliest timestamp (ms) at which a catalog re-fetch should run.
   * Stale catalogs may refresh after the short stale interval; fresh ones
   * respect the minimum interval from the last completed update.
   */
  function nextRefreshAt(nowMs = Date.now()) {
    const lastUpdate = layerState._lastUpdate;
    if (!lastUpdate) return nowMs; // nothing loaded yet — fetch now
    const stale = freshness(nowMs).status === 'stale';
    const interval = stale
      ? TLE_REFRESH_STALE_INTERVAL_MS
      : TLE_REFRESH_MIN_INTERVAL_MS;
    return lastUpdate + interval;
  }

  /** True when the catalog is loaded and a re-fetch is currently due. */
  function refreshDue(nowMs = Date.now()) {
    return layerState._lastUpdate != null && nowMs >= nextRefreshAt(nowMs);
  }

  /** Count sampled TLEs older than `maxAgeMs` (diagnostics). */
  function staleSampleCount(entries, { maxAgeMs = TLE_MAX_AGE_MS } = {}) {
    let stale = 0;
    let total = 0;
    for (const entry of entries) {
      total += 1;
      if (tleIsStale(entry.line1, { maxAgeMs })) stale += 1;
    }
    return { stale, total };
  }

  const methods = {
    sampleTleEpochs,
    freshness,
    nextRefreshAt,
    refreshDue,
    staleSampleCount,
  };
  return { ...methods, methods };
}
