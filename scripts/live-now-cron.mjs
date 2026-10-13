#!/usr/bin/env node
/**
 * Live Now one-shot ingest for crontab / production static hosting.
 * Runs a single ingest cycle and writes public/data/live-now.json.
 *
 * Example crontab (every 10 minutes) — note: write the schedule as the
 * usual cron five-field form in your crontab, e.g.:
 *   0,10,20,30,40,50 * * * * cd /path/to/gods-eye-view/integration && node scripts/live-now-cron.mjs >> .gev-cache/live-now-cron.log 2>&1
 *
 * Exit 0 on a completed cycle (even with degraded sources); non-zero only
 * on a programming error. Needs FIRMS_MAP_KEY in the environment for the
 * fires source; everything else is keyless.
 */
import { runIngestCycle } from '../server/providers/livenow/ingest.js';
import { writeLiveNowCache } from '../server/providers/livenow/cache.js';

const started = Date.now();
try {
  const payload = await runIngestCycle({ mapKey: process.env.FIRMS_MAP_KEY });
  const { path, bytes, trimmed } = writeLiveNowCache(payload);
  const states = payload.feedHealth.feeds.map((f) => `${f.id}:${f.state}`).join(', ');
  console.log(
    `[live-now-cron] events=${payload.events.length} bytes=${bytes} trimmed=${trimmed} ` +
      `stale=[${payload.staleSources.join(',')}] feeds={${states}} ` +
      `path=${path} took=${Date.now() - started}ms`,
  );
} catch (error) {
  console.error('[live-now-cron] FATAL', error?.stack || error);
  process.exitCode = 1;
}
