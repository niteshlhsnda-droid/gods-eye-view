/**
 * Tests for server/providers/livenow/rank.js
 * Dedupe + transparent scoring per spec live-now.md §4.3.
 * Run: node --test server/providers/livenow/
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeEvents,
  encodeGeohash,
  rankLiveEvents,
  scoreEvent,
  severityFor,
} from './rank.js';

const NOW = Date.parse('2026-10-13T14:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

function makeEvent(overrides = {}) {
  return {
    id: 'quake:ezs42:deadbeef',
    type: 'quake',
    title: 'M6.2 earthquake — test',
    summary: 'Test event summary.',
    lat: 42.6,
    lon: -5.6,
    severity: 5,
    startedAt: iso(NOW - 60 * 60 * 1000),
    updatedAt: iso(NOW - 30 * 60 * 1000),
    sources: [{ name: 'USGS', url: 'https://example.com/1' }],
    confidence: 'verified',
    links: [{ label: 'USGS', url: 'https://example.com/1' }],
    keywords: ['earthquake', 'magnitude'],
    ...overrides,
  };
}

describe('encodeGeohash', () => {
  it('encodes the Wikipedia reference point (42.6, -5.6) to ezs42', () => {
    assert.equal(encodeGeohash(42.6, -5.6, 5), 'ezs42');
  });
  it('produces stable precision-5 buckets for nearby points', () => {
    assert.equal(
      encodeGeohash(42.61, -5.59, 5),
      encodeGeohash(42.62, -5.61, 5),
    );
  });
  it('clamps out-of-range coordinates', () => {
    assert.equal(encodeGeohash(95, 200, 5).length, 5);
  });
});

describe('severityFor (severity.json data table)', () => {
  it('quake M>=6 -> 5', () => {
    assert.equal(severityFor('quake', { magnitude: 6.2 }), 5);
    assert.equal(severityFor('quake', { magnitude: 6.0 }), 5);
  });
  it('squawk 7700 -> 5, 7600 -> 3', () => {
    assert.equal(severityFor('aviation', { squawk: '7700' }), 5);
    assert.equal(severityFor('aviation', { squawk: '7500' }), 5);
    assert.equal(severityFor('aviation', { squawk: '7600' }), 3);
  });
  it('Cat-3+ cyclone -> 5', () => {
    assert.equal(severityFor('cyclone', { category: 3 }), 5);
    assert.equal(severityFor('cyclone', { category: 5 }), 5);
    assert.equal(severityFor('cyclone', { category: 1 }), 3);
  });
  it('FIRMS cluster >50 hotspots -> 4, >200 -> 5', () => {
    assert.equal(severityFor('fire', { hotspotCount: 60 }), 4);
    assert.equal(severityFor('fire', { hotspotCount: 250 }), 5);
    assert.equal(severityFor('fire', { hotspotCount: 12 }), 3);
  });
  it('unknown signals fall back to the per-type default', () => {
    assert.equal(severityFor('quake', {}), 1);
    assert.equal(severityFor('weather', { alertName: 'Dense Fog Advisory' }), 2);
  });
});

describe('scoreEvent', () => {
  it('fresh severity-5, 2 sources, 100 attention -> 100', () => {
    const score = scoreEvent(
      makeEvent({
        startedAt: iso(NOW),
        severity: 5,
        sources: [
          { name: 'A', url: 'https://a.example' },
          { name: 'B', url: 'https://b.example' },
        ],
        mediaAttention: 100,
      }),
      NOW,
    );
    assert.equal(score, 100);
  });
  it('recency decays linearly: 40 at t=0, 0 at 24h', () => {
    const at0 = scoreEvent(makeEvent({ startedAt: iso(NOW), severity: 1, sources: [] }), NOW);
    const at24 = scoreEvent(
      makeEvent({ startedAt: iso(NOW - 24 * 3600_000), severity: 1, sources: [] }),
      NOW,
    );
    // severity 1 -> 6, mediaAttention 0 -> 0; only recency differs
    assert.equal(at0 - at24, 40);
  });
  it('single source gets partial sourceCount credit (8), two sources full (20)', () => {
    const one = scoreEvent(makeEvent({ sources: [{ name: 'A', url: 'https://a.example' }] }), NOW);
    const two = scoreEvent(
      makeEvent({
        sources: [
          { name: 'A', url: 'https://a.example' },
          { name: 'B', url: 'https://b.example' },
        ],
      }),
      NOW,
    );
    assert.equal(two - one, 12);
  });
  it('mediaAttention maps 0-100 to 0-10', () => {
    const none = scoreEvent(makeEvent({}), NOW);
    const full = scoreEvent(makeEvent({ mediaAttention: 100 }), NOW);
    assert.equal(full - none, 10);
  });
  it('score is always within 0-100', () => {
    for (const severity of [1, 2, 3, 4, 5]) {
      const s = scoreEvent(makeEvent({ severity, mediaAttention: 55 }), NOW);
      assert.ok(s >= 0 && s <= 100, `severity ${severity} -> ${s}`);
    }
  });
});

describe('dedupeEvents', () => {
  it('merges same type + geohash-5 + overlapping keywords within 6h', () => {
    const a = makeEvent({
      id: 'quake:ezs42:aaaa',
      startedAt: iso(NOW - 5 * 3600_000),
      keywords: ['earthquake', 'spain'],
      sources: [{ name: 'USGS', url: 'https://usgs.example/a' }],
    });
    const b = makeEvent({
      id: 'quake:ezs42:bbbb',
      startedAt: iso(NOW - 1 * 3600_000),
      updatedAt: iso(NOW - 30 * 60_000),
      keywords: ['spain', 'tremor'],
      sources: [{ name: 'EMSC', url: 'https://emsc.example/b' }],
      severity: 3,
    });
    const out = dedupeEvents([a, b], NOW);
    assert.equal(out.length, 1);
    const merged = out[0];
    assert.equal(merged.startedAt, a.startedAt, 'keeps earliest startedAt');
    assert.equal(merged.updatedAt, b.updatedAt, 'keeps latest updatedAt');
    assert.equal(merged.sources.length, 2, 'unions sources');
    assert.equal(merged.severity, 5, 'keeps max severity');
    assert.ok(merged.keywords.includes('tremor'), 'unions keywords');
  });
  it('does not merge when startedAt is more than 6h apart', () => {
    const a = makeEvent({ startedAt: iso(NOW - 10 * 3600_000), keywords: ['earthquake', 'spain'] });
    const b = makeEvent({ startedAt: iso(NOW - 1 * 3600_000), keywords: ['earthquake', 'spain'] });
    assert.equal(dedupeEvents([a, b], NOW).length, 2);
  });
  it('does not merge across types or geohash buckets', () => {
    const a = makeEvent({ type: 'quake', keywords: ['storm'] });
    const b = makeEvent({ type: 'cyclone', keywords: ['storm'], lat: 10, lon: 80 });
    assert.equal(dedupeEvents([a, b], NOW).length, 2);
  });
  it('does not merge without overlapping keywords', () => {
    const a = makeEvent({ keywords: ['earthquake', 'spain'] });
    const b = makeEvent({ keywords: ['volcano', 'italy'] });
    assert.equal(dedupeEvents([a, b], NOW).length, 2);
  });
  it('dedupes identical source urls during merge', () => {
    const url = 'https://usgs.example/same';
    const a = makeEvent({ keywords: ['x', 'y'], sources: [{ name: 'USGS', url }] });
    const b = makeEvent({ keywords: ['y', 'z'], sources: [{ name: 'USGS', url }] });
    const merged = dedupeEvents([a, b], NOW)[0];
    assert.equal(merged.sources.length, 1);
  });
  it('unconfirmed never outranks verified confidence on merge', () => {
    const a = makeEvent({ keywords: ['x', 'y'], confidence: 'unconfirmed' });
    const b = makeEvent({ keywords: ['y', 'z'], confidence: 'verified' });
    const merged = dedupeEvents([a, b], NOW)[0];
    assert.equal(merged.confidence, 'verified');
  });
});

describe('rankLiveEvents', () => {
  it('drops events older than 48h', () => {
    const fresh = makeEvent({ startedAt: iso(NOW - 3600_000) });
    const old = makeEvent({
      id: 'quake:ezs42:old',
      startedAt: iso(NOW - 49 * 3600_000),
      updatedAt: iso(NOW - 49 * 3600_000),
    });
    const out = rankLiveEvents([fresh, old], { nowMs: NOW });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, fresh.id);
  });
  it('returns at most 12, sorted by score desc', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent({
        id: `quake:ezs42:e${i}`,
        lat: 42.6 + i * 0.5, // spread across geohash buckets so nothing dedupes
        startedAt: iso(NOW - i * 3600_000),
        severity: (i % 5) + 1,
        keywords: [`quake-${i}`, `region-${i}`],
      }),
    );
    const out = rankLiveEvents(events, { nowMs: NOW });
    assert.equal(out.length, 12);
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i - 1].score >= out[i].score, 'sorted desc by score');
    }
  });
  it('attaches a numeric score to every returned event', () => {
    const out = rankLiveEvents([makeEvent()], { nowMs: NOW });
    assert.equal(typeof out[0].score, 'number');
  });
  it('drops events with a future startedAt (clock garbage)', () => {
    const future = makeEvent({ startedAt: iso(NOW + 3600_000) });
    assert.equal(rankLiveEvents([future], { nowMs: NOW }).length, 0);
  });
});
