/**
 * @module providers/livenow/plugin
 * @description Vite plugin wiring for Live Now: serves GET /api/live-now from
 * the atomic cache file and refreshes it on a 10-minute interval.
 *
 * A dead source degrades the panel (stale badge via the feedHealth block in
 * the payload), never kills the whole view: the endpoint keeps serving the
 * last good cache with its generatedAt timestamp.
 */
import { runIngestCycle } from './ingest.js';
import { isCacheFresh, readLiveNowCache, writeLiveNowCache } from './cache.js';

/** Default refresh cadence: 10 minutes (spec §4.2). */
export const LIVE_NOW_INTERVAL_MS = 10 * 60 * 1000;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * @param {object} [options]
 * @param {number} [options.intervalMs] Refresh cadence (default 10 min).
 * @param {boolean} [options.eager] Refresh on server start (default true).
 * @returns {import('vite').Plugin}
 */
export function liveNowProxy({
  intervalMs = LIVE_NOW_INTERVAL_MS,
  eager = true,
} = {}) {
  let timer = null;
  let inFlight = null;

  /** Single-flight refresh: concurrent triggers share one ingest cycle. */
  function refresh() {
    if (!inFlight) {
      inFlight = runIngestCycle({ mapKey: process.env.FIRMS_MAP_KEY })
        .then((payload) => writeLiveNowCache(payload))
        .catch((error) => {
          console.error(
            '[live-now] ingest cycle failed:',
            error?.message || error,
          );
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  function ensureTimer() {
    if (timer) return;
    if (eager) void refresh();
    timer = setInterval(() => void refresh(), Math.max(60_000, intervalMs));
    timer.unref?.();
  }

  async function handler(req, res) {
    try {
      let cached = readLiveNowCache();
      if (!cached || !isCacheFresh(cached, intervalMs)) {
        // Refresh in the background; serve the last good cache meanwhile.
        void refresh();
        if (!cached) {
          // No cache at all yet: wait briefly for the first cycle.
          await Promise.race([
            refresh(),
            new Promise((r) => setTimeout(r, 20_000)),
          ]);
          cached = readLiveNowCache();
        }
      }
      if (!cached) {
        json(res, 503, {
          error: 'live_now_unavailable',
          generatedAt: null,
          events: [],
        });
        return;
      }
      json(res, 200, cached);
    } catch (error) {
      json(res, 500, {
        error: 'live_now_error',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'live-now',
    configureServer({ middlewares }) {
      ensureTimer();
      middlewares.use('/api/live-now', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/live-now', handler);
    },
  };
}
