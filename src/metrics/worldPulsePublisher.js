/**
 * @module metrics/worldPulsePublisher
 * @description Bridges live layer feed state to the `window.__feedHealth`
 * contract consumed by the World Pulse dashboard (`public/pulse.html`).
 *
 * The app opts in with one call:
 *
 * ```js
 * import { startFeedHealthPublishing } from './metrics/worldPulsePublisher.js';
 * const stop = startFeedHealthPublishing({
 *   getLayers: () => [
 *     { id: 'flights', label: 'Flights (ADS-B)', stats: flightsLayer.getStats() },
 *     { id: 'vessels', label: 'Vessels (AIS)', stats: vesselsLayer.getStats() },
 *   ],
 * });
 * ```
 *
 * Every `intervalMs` the publisher normalizes each layer's stats through
 * `layerFeedState()` (the same normalizer the layer chips use, so the
 * dashboard can never disagree with the app UI), builds a contract snapshot,
 * and writes it to `window.__feedHealth` + `localStorage`.
 *
 * The Grok lane owns the deeper feed-health data model; this adapter only
 * speaks the shared contract (`feedHealthContract.js`), so either lane's
 * producer can feed the same dashboard.
 */

import {
  createFeedEntry,
  createFeedSnapshot,
  gradeFromState,
  normalizeFeedState,
  publishFeedHealth,
} from './feedHealthContract.js';
import { layerFeedState } from '../data/feedState.js';

/** Default publish cadence (30 s). */
export const FEED_HEALTH_PUBLISH_MS = 30_000;

/**
 * Convert one layer's `getStats()` result into a contract feed entry.
 * @param {object} layer `{ id, label, stats }`
 * @returns {object} Normalized feed entry.
 */
export function layerStatsToFeedEntry(layer = {}) {
  const stats =
    layer.stats && typeof layer.stats === 'object' ? layer.stats : {};
  const state = normalizeFeedState(layerFeedState(stats));
  const { grade, score } = gradeFromState(state);
  const lastUpdate =
    typeof stats.lastUpdate === 'string' && stats.lastUpdate
      ? stats.lastUpdate
      : null;
  const messageCount =
    typeof stats.count === 'number' && Number.isFinite(stats.count)
      ? stats.count
      : typeof stats.acceptedRowCount === 'number' &&
          Number.isFinite(stats.acceptedRowCount)
        ? stats.acceptedRowCount
        : null;
  return {
    ...createFeedEntry({
      id: layer.id || 'unknown',
      label: layer.label || layer.id || 'unknown',
      state,
      lastUpdate,
      messageCount,
      latencyMs: null,
      note:
        typeof stats.loadingLabel === 'string' && stats.loadingLabel
          ? stats.loadingLabel
          : null,
    }),
    grade,
    score,
  };
}

/**
 * Collect + publish a feed-health snapshot from the supplied layers.
 * @param {object} options
 * @param {() => Array<object>} options.getLayers Layer descriptors.
 * @param {object} [options.host] Defaults to `globalThis`.
 * @param {object|null} [options.storage] Storage-like; defaults to localStorage when present.
 * @returns {{snapshot: object, published: object}}
 */
export function publishLayerFeedHealth({
  getLayers,
  host = typeof globalThis !== 'undefined' ? globalThis : null,
  storage = null,
} = {}) {
  let layers = [];
  try {
    layers = getLayers() || [];
  } catch {
    layers = [];
  }
  const feeds = layers.map(layerStatsToFeedEntry);
  const snapshot = createFeedSnapshot(feeds);
  const resolvedStorage =
    storage ||
    (typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : null);
  const published = publishFeedHealth(snapshot, {
    host,
    storage: resolvedStorage,
  });
  return { snapshot, published };
}

/**
 * Start periodic feed-health publishing. Returns a stop function.
 * @param {object} options
 * @param {() => Array<object>} options.getLayers
 * @param {number} [options.intervalMs=FEED_HEALTH_PUBLISH_MS]
 * @param {object} [options.host]
 * @param {object|null} [options.storage]
 * @returns {() => void} Stop publishing.
 */
export function startFeedHealthPublishing({
  getLayers,
  intervalMs = FEED_HEALTH_PUBLISH_MS,
  host,
  storage,
} = {}) {
  const publishOnce = () =>
    publishLayerFeedHealth({ getLayers, host, storage });
  publishOnce();
  const timer = setInterval(publishOnce, Math.max(5000, intervalMs));
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
