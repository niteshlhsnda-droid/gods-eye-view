import { GUIDANCE_STATUSES } from '../loadingFeedback.js';

/**
 * Normalize heterogeneous layer stats into one honest control-chip state.
 * @param {object|null} stats Layer getStats() result.
 * @returns {'nominal'|'loading'|'degraded'|'stale'|'partial'|'fallback'|'unavailable'} Feed state.
 */
export function layerFeedState(stats = {}) {
  const state = stats || {};
  const status =
    typeof state.status === 'string' ? state.status.toLowerCase() : '';
  const source = `${state.source || ''} ${state.coverage || ''}`;
  const hasExplicitFallback = typeof state.fallback === 'boolean';
  const hasPriorData = Number(state.count) > 0 || Boolean(state.lastUpdate);
  const presentedError =
    state.error || state.lastError || state.managerRefreshError;
  if (['unavailable', 'offline', 'down', 'error'].includes(status))
    return 'unavailable';
  if (
    (presentedError ||
      state.unavailable === true ||
      state.available === false) &&
    !hasPriorData &&
    !GUIDANCE_STATUSES.includes(status)
  ) {
    return 'unavailable';
  }
  if (state.loading) return 'loading';
  // Guidance states ask the user to act (zoom in, run a search) — normal
  // operation, not feed faults. One honesty carve-out: layers keep their
  // rendered records through the guidance state, so a genuinely stale cache
  // still reads STALE; a guidance prompt alone never reads DEGRADED.
  if (GUIDANCE_STATUSES.includes(status)) {
    return state.stale ? 'stale' : 'nominal';
  }
  if (
    state.fallback === true ||
    status === 'fallback' ||
    state.mode === 'sim' ||
    /\bfallback\b/i.test(source) ||
    (!hasExplicitFallback && /\badsb\.lol\b/i.test(source))
  ) {
    return 'fallback';
  }
  if (state.stale || status === 'stale') return 'stale';
  if (
    state.degraded ||
    presentedError ||
    state.unavailable === true ||
    state.available === false
  )
    return 'degraded';
  if (state.partial === true) return 'partial';
  return 'nominal';
}

/**
 * How many recent fetch durations we keep per layer. A small fixed window is
 * enough for an operator to see jitter or a creeping slowdown; the history is
 * in-memory only (client-side, nothing is persisted or sent anywhere).
 */
export const FEED_LATENCY_WINDOW = 16;

const feedLatencySamples = new Map();

/**
 * Record one successful layer fetch duration. Layers opt in by timing their
 * own fetch and calling this — e.g. `timedLayerFetch('earthquakes', () =>
 * source.getSnapshot({ signal }))`. Non-finite durations are dropped silently
 * so a bad measurement can never poison the history.
 */
export function recordFeedLatency(layerId, durationMs) {
  const id = String(layerId || '').trim();
  const ms = Number(durationMs);
  if (!id || !Number.isFinite(ms) || ms < 0) return;
  let samples = feedLatencySamples.get(id);
  if (!samples) {
    samples = [];
    feedLatencySamples.set(id, samples);
  }
  samples.push(ms);
  if (samples.length > FEED_LATENCY_WINDOW) samples.shift();
}

/**
 * Time an async fetch and record its duration on success. Rejects exactly as
 * the wrapped call would; failed fetches are not recorded (their error state
 * already surfaces through the feed-state badge).
 */
export async function timedLayerFetch(layerId, fetchFn) {
  const started = Date.now();
  const result = await fetchFn();
  recordFeedLatency(layerId, Date.now() - started);
  return result;
}

/** Clear a layer's latency history (tests and explicit operator resets). */
export function clearFeedLatency(layerId) {
  feedLatencySamples.delete(String(layerId || '').trim());
}

/**
 * Summarize one layer's recent fetch latency, or null when nothing has been
 * recorded yet.
 */
export function feedLatencyStats(layerId) {
  const samples = feedLatencySamples.get(String(layerId || '').trim());
  if (!samples || !samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, ms) => total + ms, 0);
  return {
    samples: sorted.length,
    avgMs: Math.round(sum / sorted.length),
    p50Ms: sorted[Math.floor(sorted.length / 2)],
    maxMs: sorted[sorted.length - 1],
    lastMs: samples[samples.length - 1],
  };
}

/**
 * One-line latency summary for the layer switcher, e.g.
 * "avg 640ms · p50 590ms · 12 samples". Null when no history exists so the
 * UI shows nothing rather than inventing a number.
 */
export function summarizeFeedLatency(layerId) {
  const stats = feedLatencyStats(layerId);
  if (!stats) return null;
  return `avg ${stats.avgMs}ms · p50 ${stats.p50Ms}ms · ${stats.samples} sample${stats.samples === 1 ? '' : 's'}`;
}
