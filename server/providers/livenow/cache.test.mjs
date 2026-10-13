/**
 * Tests for server/providers/livenow/cache.js
 * Atomic writes of public/data/live-now.json with a 200 KB size target.
 * Run: node --test server/providers/livenow/
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CACHE_FILE,
  MAX_CACHE_BYTES,
  isCacheFresh,
  readLiveNowCache,
  writeLiveNowCache,
} from './cache.js';

function payloadWithEvents(count) {
  return {
    schema: 'gev/live-now',
    version: 1,
    generatedAt: '2026-10-13T14:00:00.000Z',
    events: Array.from({ length: count }, (_, i) => ({
      id: `quake:ezs42:e${i}`,
      type: 'quake',
      title: `M6.1 earthquake — test region ${i} `.padEnd(90, 'x'),
      summary: 'Summary with filler text to inflate the payload size. '.repeat(40),
      lat: 42.6,
      lon: -5.6,
      severity: 5,
      startedAt: '2026-10-13T13:00:00.000Z',
      updatedAt: '2026-10-13T13:30:00.000Z',
      sources: [{ name: 'USGS', url: 'https://example.com' }],
      confidence: 'verified',
      links: [{ label: 'USGS', url: 'https://example.com' }],
      keywords: ['earthquake'],
      score: 100 - i,
    })),
    feedHealth: { contract: 'gev/feed-health', version: 1, feeds: [] },
    staleSources: [],
  };
}

describe('writeLiveNowCache / readLiveNowCache', () => {
  it('round-trips a payload atomically (no partial file)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'livenow-'));
    const payload = payloadWithEvents(3);
    const result = writeLiveNowCache(payload, { dir });
    assert.ok(result.bytes > 0);
    assert.ok(result.bytes <= MAX_CACHE_BYTES);
    assert.ok(existsSync(path.join(dir, CACHE_FILE)));
    // No temp files left behind.
    const leftovers = [];
    for (const f of ['live-now.json.tmp', 'live-now.json.part']) {
      if (existsSync(path.join(dir, f))) leftovers.push(f);
    }
    assert.deepEqual(leftovers, []);
    const read = readLiveNowCache({ dir });
    assert.equal(read.events.length, 3);
    assert.equal(read.generatedAt, payload.generatedAt);
  });
  it('trims lowest-scored events to stay under 200 KB', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'livenow-'));
    const result = writeLiveNowCache(payloadWithEvents(200), { dir });
    assert.ok(result.trimmed, 'had to trim');
    assert.ok(result.bytes <= MAX_CACHE_BYTES, `bytes=${result.bytes}`);
    const read = readLiveNowCache({ dir });
    assert.ok(read.events.length < 200);
    // Highest-scored events survive the trim.
    assert.equal(read.events[0].score, 100);
  });
  it('returns null when no cache exists', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'livenow-'));
    assert.equal(readLiveNowCache({ dir }), null);
  });
  it('returns null on corrupt JSON instead of throwing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'livenow-'));
    writeFileSync(path.join(dir, CACHE_FILE), '{not json');
    assert.equal(readLiveNowCache({ dir }), null);
  });
});

describe('isCacheFresh', () => {
  it('is fresh within maxAgeMs, stale beyond', () => {
    const now = Date.parse('2026-10-13T14:00:00.000Z');
    const fresh = { generatedAt: new Date(now - 5 * 60_000).toISOString() };
    const stale = { generatedAt: new Date(now - 11 * 60_000).toISOString() };
    assert.equal(isCacheFresh(fresh, 10 * 60_000, now), true);
    assert.equal(isCacheFresh(stale, 10 * 60_000, now), false);
    assert.equal(isCacheFresh(null, 10 * 60_000, now), false);
  });
});
