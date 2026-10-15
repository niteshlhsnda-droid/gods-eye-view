#!/usr/bin/env node
/**
 * Validate a Live Now snapshot before it ships to GitHub Pages.
 *
 * Fails when:
 * - the file is missing, unparsable, or violates the frozen client schema
 *   (`gev/live-now` v1, see src/livenow/service.js);
 * - `feedHealth.feeds` is missing or empty (the panel renders per-feed
 *   health from it, so a payload without it is not deployable);
 * - every feed is `stale` or `unavailable` — an all-dead snapshot must
 *   never deploy as if it were a live world view;
 * - `generatedAt` is older than the SLO (default 30 minutes). The live API
 *   targets ≤10 minutes, but the static snapshot also absorbs ingest +
 *   build + deploy time, so the deploy gate allows 30; the panel itself
 *   always shows the payload age.
 *
 * Usage: node scripts/validate-live-now.mjs [path] [--slo-minutes N]
 * Exit 0 on a deployable snapshot, 1 otherwise. Never throws on bad input.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateLiveNowPayload } from '../src/livenow/service.js';

export const LIVE_NOW_DEPLOY_SLO_MINUTES = 30;
/** Feed states that still count as "the world is being observed". */
export const LIVE_NOW_HEALTHY_FEED_STATES = Object.freeze([
  'nominal',
  'loading',
  'degraded',
  'partial',
  'fallback',
]);
/** Feed states that mean "this source contributed nothing usable". */
export const LIVE_NOW_DEAD_FEED_STATES = Object.freeze([
  'stale',
  'unavailable',
]);

/**
 * Validate a decoded Live Now payload for deployment.
 * @param {unknown} payload
 * @param {{nowMs?: number, sloMinutes?: number}} [options]
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateLiveNowSnapshot(
  payload,
  { nowMs = Date.now(), sloMinutes = LIVE_NOW_DEPLOY_SLO_MINUTES } = {},
) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['payload is not an object'] };
  }
  const schema = validateLiveNowPayload(payload);
  if (!schema.ok) errors.push(...schema.errors);

  const feeds = payload.feedHealth?.feeds;
  if (!Array.isArray(feeds) || feeds.length === 0) {
    errors.push('feedHealth.feeds must be a non-empty array');
  } else {
    const healthy = feeds.filter((feed) =>
      LIVE_NOW_HEALTHY_FEED_STATES.includes(feed?.state),
    );
    if (healthy.length === 0) {
      const states = feeds.map(
        (feed) => `${feed?.id ?? '?'}:${feed?.state ?? '?'}`,
      );
      errors.push(
        `all feeds stale/unavailable (${states.join(', ')}) — refusing to deploy an all-dead snapshot`,
      );
    }
    for (const feed of feeds) {
      if (
        feed?.state &&
        !LIVE_NOW_HEALTHY_FEED_STATES.includes(feed.state) &&
        !LIVE_NOW_DEAD_FEED_STATES.includes(feed.state)
      ) {
        errors.push(
          `feedHealth.feeds[].state has unknown state: ${feed.state}`,
        );
      }
    }
  }

  const generated = Date.parse(payload.generatedAt);
  if (Number.isFinite(generated)) {
    const ageMinutes = (nowMs - generated) / 60000;
    if (ageMinutes < 0) {
      errors.push('generatedAt is in the future');
    } else if (ageMinutes > sloMinutes) {
      errors.push(
        `generatedAt is ${ageMinutes.toFixed(1)} min old, older than the ${sloMinutes} min deploy SLO`,
      );
    }
  }
  // A missing/unparsable generatedAt is already reported by the schema check.

  return { ok: errors.length === 0, errors };
}

/**
 * Read and validate a snapshot file.
 * @returns {{ok: boolean, errors: string[], payload: Object|null}}
 */
export function validateLiveNowFile(filePath, options = {}) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return {
      ok: false,
      errors: [`cannot read snapshot file: ${filePath}`],
      payload: null,
    };
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      errors: [`snapshot file is not valid JSON: ${filePath}`],
      payload: null,
    };
  }
  const result = validateLiveNowSnapshot(payload, options);
  return { ...result, payload };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (import.meta.url === invokedPath) {
  const args = process.argv.slice(2);
  const fileArg = args.find((arg) => !arg.startsWith('--'));
  const sloIndex = args.indexOf('--slo-minutes');
  const sloMinutes =
    sloIndex >= 0 && args[sloIndex + 1]
      ? Number(args[sloIndex + 1])
      : LIVE_NOW_DEPLOY_SLO_MINUTES;
  const filePath = fileArg
    ? path.resolve(fileArg)
    : path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        'public',
        'data',
        'live-now.json',
      );
  const { ok, errors, payload } = validateLiveNowFile(filePath, {
    sloMinutes,
  });
  if (ok) {
    const feeds = payload.feedHealth.feeds
      .map((feed) => `${feed.id}:${feed.state}`)
      .join(', ');
    console.log(
      `Live Now snapshot OK: ${payload.events.length} events, generatedAt=${payload.generatedAt}, feeds={${feeds}}`,
    );
  } else {
    console.error(`Live Now snapshot FAILED validation (${filePath}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  }
}
