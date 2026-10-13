/**
 * @module providers/livenow/cache
 * @description Atomic cache for the Live Now payload: writes
 * `public/data/live-now.json` (≤200 KB target) via tmp-file + rename so
 * readers never see a partial file, and serves it back to /api/live-now.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** Cache file name inside the public data dir. */
export const CACHE_FILE = 'live-now.json';
/** Size target for the served JSON (spec §4.2: ≤200 KB). */
export const MAX_CACHE_BYTES = 200 * 1024;

export function cacheDir(cwd = process.cwd()) {
  return path.join(cwd, 'public', 'data');
}

function serialize(payload) {
  return JSON.stringify(payload);
}

/** Drop lowest-scored events until the payload fits the size target. */
export function trimPayloadToFit(payload) {
  let trimmed = false;
  let working = payload;
  let bytes = Buffer.byteLength(serialize(working));
  while (bytes > MAX_CACHE_BYTES && working.events.length > 0) {
    trimmed = true;
    working = { ...working, events: working.events.slice(0, -1) };
    bytes = Buffer.byteLength(serialize(working));
  }
  return { payload: working, bytes, trimmed };
}

/**
 * Atomically write the Live Now payload to the cache file.
 * @returns {{path: string, bytes: number, trimmed: boolean}}
 */
export function writeLiveNowCache(payload, { dir = cacheDir() } = {}) {
  mkdirSync(dir, { recursive: true });
  const { payload: fitted, bytes, trimmed } = trimPayloadToFit(payload);
  const target = path.join(dir, CACHE_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, serialize(fitted), 'utf8');
  renameSync(tmp, target);
  return { path: target, bytes, trimmed };
}

/** Read the cached payload; null when missing or corrupt. */
export function readLiveNowCache({ dir = cacheDir() } = {}) {
  const target = path.join(dir, CACHE_FILE);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** True when the payload's generatedAt is within maxAgeMs of nowMs. */
export function isCacheFresh(payload, maxAgeMs, nowMs = Date.now()) {
  const generated = Date.parse(payload?.generatedAt);
  if (!Number.isFinite(generated)) return false;
  const age = nowMs - generated;
  return age >= 0 && age <= maxAgeMs;
}
