/**
 * @module metrics/feedHealthContract
 * @description Portable `window.__feedHealth` data contract shared between the
 * live app, the World Pulse dashboard (`public/pulse.html`), and the Grok
 * lane's feed-health work.
 *
 * The contract is deliberately tiny and JSON-serializable so it can be
 * written to `window.__feedHealth`, to `localStorage` (`FEED_HEALTH_STORAGE_KEY`),
 * or to a static `feed-health.json` without modification:
 *
 * ```json
 * {
 *   "contract": "gev/feed-health",
 *   "version": 1,
 *   "generatedAt": "2026-10-12T18:00:00.000Z",
 *   "source": "gods-eye-view",
 *   "feeds": [
 *     {
 *       "id": "flights",
 *       "label": "Flights (ADS-B)",
 *       "state": "nominal",
 *       "grade": "A",
 *       "score": 100,
 *       "lastUpdate": "2026-10-12T17:59:31.000Z",
 *       "ageMs": 29000,
 *       "messageCount": 1234,
 *       "latencyMs": 412,
 *       "note": "adsb.lol fallback active"
 *     }
 *   ]
 * }
 * ```
 *
 * `state` uses the same vocabulary as `src/data/feedState.js`
 * (`layerFeedState`): nominal, loading, degraded, stale, partial, fallback,
 * unavailable. `grade` is the public A–F letter derived from the state.
 *
 * This module is intentionally portable: it never touches `window`,
 * `document`, or any other browser global. Callers pass a host object
 * (usually `globalThis`) and/or a storage object (usually
 * `window.localStorage`) explicitly.
 */

/** Contract identifier embedded in every published snapshot. */
export const FEED_HEALTH_CONTRACT = 'gev/feed-health';

/** Current contract version. Bump when the shape changes. */
export const FEED_HEALTH_CONTRACT_VERSION = 1;

/** localStorage key the app publisher writes snapshots to. */
export const FEED_HEALTH_STORAGE_KEY = 'gev:feed-health:v1';

/** The window property the live app publishes snapshots under. */
export const FEED_HEALTH_WINDOW_KEY = '__feedHealth';

/** All feed states recognised by this contract. */
export const FEED_STATES = Object.freeze([
  'nominal',
  'loading',
  'degraded',
  'stale',
  'partial',
  'fallback',
  'unavailable',
]);

/** Public letter grade per feed state; score is 0–100 for aggregation. */
const STATE_GRADES = Object.freeze({
  nominal: { grade: 'A', score: 100 },
  loading: { grade: 'B', score: 80 },
  partial: { grade: 'B', score: 75 },
  fallback: { grade: 'C', score: 60 },
  stale: { grade: 'C', score: 50 },
  degraded: { grade: 'D', score: 30 },
  unavailable: { grade: 'F', score: 0 },
});

/**
 * Normalize an arbitrary state string to the contract vocabulary.
 * Unknown states become 'unavailable' (fail closed, never flatter).
 * @param {unknown} state
 * @returns {string} One of FEED_STATES.
 */
export function normalizeFeedState(state) {
  const normalized = String(state || '')
    .trim()
    .toLowerCase();
  return FEED_STATES.includes(normalized) ? normalized : 'unavailable';
}

/**
 * Derive the public letter grade and numeric score for a feed state.
 * @param {unknown} state
 * @returns {{grade: string, score: number}}
 */
export function gradeFromState(state) {
  const normalized = normalizeFeedState(state);
  return STATE_GRADES[normalized];
}

/**
 * Build a single normalized feed entry. Missing optional fields stay null.
 * @param {object} [entry={}]
 * @param {string} entry.id Stable feed id, e.g. 'flights'.
 * @param {string} [entry.label] Human label; defaults to the id.
 * @param {unknown} [entry.state] Feed state; unknown → 'unavailable'.
 * @param {string|null} [entry.lastUpdate] ISO timestamp of last good data.
 * @param {number|null} [entry.messageCount] Records/messages in the last cycle.
 * @param {number|null} [entry.latencyMs] Last fetch latency in milliseconds.
 * @param {string|null} [entry.note] Short operator note (no secrets).
 * @returns {object} Normalized feed entry.
 */
export function createFeedEntry(entry = {}) {
  const state = normalizeFeedState(entry.state);
  const { grade, score } = gradeFromState(state);
  const lastUpdate =
    typeof entry.lastUpdate === 'string' && entry.lastUpdate
      ? entry.lastUpdate
      : null;
  const ageMs =
    lastUpdate === null
      ? null
      : Math.max(0, Date.now() - Date.parse(lastUpdate));
  const toFiniteNumber = (value) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    id: String(entry.id || 'unknown'),
    label: String(entry.label || entry.id || 'unknown'),
    state,
    grade,
    score,
    lastUpdate,
    ageMs,
    messageCount: toFiniteNumber(entry.messageCount),
    latencyMs: toFiniteNumber(entry.latencyMs),
    note:
      typeof entry.note === 'string' && entry.note.trim()
        ? entry.note.trim().slice(0, 280)
        : null,
  };
}

/**
 * Compute the overall snapshot grade: the worst feed grade wins (a single
 * dead feed must not hide behind healthy ones).
 * @param {Array<object>} feeds Normalized feed entries.
 * @returns {{grade: string, score: number}}
 */
export function aggregateGrade(feeds = []) {
  const list = Array.isArray(feeds) ? feeds : [];
  if (list.length === 0) return { grade: 'F', score: 0 };
  let worst = list[0];
  for (const feed of list) {
    if (feed.score < worst.score) worst = feed;
  }
  return { grade: worst.grade, score: worst.score };
}

/**
 * Build a publishable snapshot from feed entries.
 * @param {Array<object>} feeds Raw or normalized feed entries.
 * @param {object} [options={}]
 * @param {string} [options.source='gods-eye-view']
 * @param {string} [options.generatedAt] ISO timestamp; defaults to now.
 * @returns {object} Snapshot conforming to the contract.
 */
export function createFeedSnapshot(feeds = [], options = {}) {
  const normalized = (Array.isArray(feeds) ? feeds : []).map((entry) =>
    entry && typeof entry.grade === 'string' ? entry : createFeedEntry(entry),
  );
  return {
    contract: FEED_HEALTH_CONTRACT,
    version: FEED_HEALTH_CONTRACT_VERSION,
    generatedAt:
      typeof options.generatedAt === 'string'
        ? options.generatedAt
        : new Date().toISOString(),
    source: String(options.source || 'gods-eye-view'),
    overall: aggregateGrade(normalized),
    feeds: normalized,
  };
}

/**
 * Publish a snapshot on the host (e.g. `globalThis`) and/or storage
 * (e.g. `window.localStorage`).
 * @param {object} snapshot Snapshot from {@link createFeedSnapshot}.
 * @param {object} [options={}]
 * @param {object} [options.host] Object to receive `__feedHealth`.
 * @param {object|null} [options.storage] Storage-like with setItem().
 * @returns {{onHost: boolean, inStorage: boolean}}
 */
export function publishFeedHealth(
  snapshot,
  { host = null, storage = null } = {},
) {
  let onHost = false;
  let inStorage = false;
  if (host && typeof host === 'object') {
    host[FEED_HEALTH_WINDOW_KEY] = snapshot;
    onHost = true;
  }
  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(FEED_HEALTH_STORAGE_KEY, JSON.stringify(snapshot));
      inStorage = true;
    } catch {
      inStorage = false;
    }
  }
  return { onHost, inStorage };
}

/**
 * Read the latest snapshot: host first, then storage, else null.
 * @param {object} [options={}]
 * @param {object|null} [options.host] Object exposing `__feedHealth`.
 * @param {object|null} [options.storage] Storage-like with getItem().
 * @returns {object|null}
 */
export function readFeedHealth({ host = null, storage = null } = {}) {
  if (host && typeof host === 'object') {
    const live = host[FEED_HEALTH_WINDOW_KEY];
    if (live && typeof live === 'object') return live;
  }
  if (storage && typeof storage.getItem === 'function') {
    try {
      const raw = storage.getItem(FEED_HEALTH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}
