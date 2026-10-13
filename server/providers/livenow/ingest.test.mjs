/**
 * Tests for server/providers/livenow/ingest.js
 * Source adapters normalize upstream data to LiveEvent[] + feed-health entries.
 * All network access is injected via fetchImpl — tests never hit the wire.
 * Run: node --test server/providers/livenow/
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractKeywords,
  pullAviation,
  pullCyclones,
  pullFires,
  pullMaritime,
  pullNews,
  pullQuakes,
  pullWeather,
  runIngestCycle,
  stableEventId,
} from './ingest.js';

const NOW = Date.parse('2026-10-13T14:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () =>
      typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

function checkLiveEvent(event) {
  assert.ok(event.id && typeof event.id === 'string', 'id');
  assert.ok(
    ['cyclone', 'quake', 'fire', 'news', 'aviation', 'maritime', 'space', 'weather'].includes(event.type),
    `type ${event.type}`,
  );
  assert.ok(event.title.length > 0 && event.title.length <= 90, `title len ${event.title.length}`);
  assert.ok(event.summary.length <= 200, `summary len ${event.summary.length}`);
  assert.ok(Number.isFinite(event.lat) && Number.isFinite(event.lon), 'coords');
  assert.ok(event.severity >= 1 && event.severity <= 5, 'severity');
  assert.ok(!Number.isNaN(Date.parse(event.startedAt)), 'startedAt');
  assert.ok(!Number.isNaN(Date.parse(event.updatedAt)), 'updatedAt');
  assert.ok(Array.isArray(event.sources) && event.sources.length >= 1, 'sources');
  assert.ok(['verified', 'reported', 'unconfirmed'].includes(event.confidence), 'confidence');
  assert.ok(Array.isArray(event.links) && event.links.length >= 1, 'links');
  assert.ok(Array.isArray(event.keywords) && event.keywords.length >= 1, 'keywords');
}

describe('extractKeywords', () => {
  it('drops stopwords and keeps significant tokens', () => {
    const keys = extractKeywords('Cyclone Remal makes landfall in West Bengal');
    assert.ok(keys.includes('cyclone'), keys.join(','));
    assert.ok(keys.includes('remal'), keys.join(','));
    assert.ok(!keys.includes('in'), 'stopword removed');
    assert.ok(!keys.includes('makes'), 'short/weak token removed');
  });
  it('returns [] for empty input', () => {
    assert.deepEqual(extractKeywords(''), []);
    assert.deepEqual(extractKeywords(null), []);
  });
});

describe('stableEventId', () => {
  it('is stable and has the type:geohash5:hash shape', () => {
    const a = stableEventId('quake', 42.6, -5.6, ['earthquake', 'spain']);
    const b = stableEventId('quake', 42.61, -5.61, ['spain', 'earthquake']);
    assert.equal(a, b, 'order-independent keywords');
    assert.match(a, /^quake:[0-9a-z]{5}:[0-9a-f]{8}$/);
  });
});

describe('pullQuakes', () => {
  const usgs = {
    type: 'FeatureCollection',
    features: [
      {
        id: 'us7000xyz',
        properties: { mag: 6.2, place: '84 km SE of Kandrian, Papua New Guinea', time: NOW - 3600_000, url: 'https://earthquake.usgs.gov/a' },
        geometry: { coordinates: [149.5, -6.2, 35] },
      },
      {
        id: 'us7000abc',
        properties: { mag: 4.4, place: 'offshore', time: NOW - 7200_000, url: 'https://earthquake.usgs.gov/b' },
        geometry: { coordinates: [10, 10, 10] },
      },
      // six small clustered events -> swarm
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `sw${i}`,
        properties: { mag: 3.1 + i * 0.1, place: 'Reykjanes Ridge', time: NOW - (i + 1) * 3600_000, url: 'https://earthquake.usgs.gov/c' },
        geometry: { coordinates: [-32.0 + i * 0.02, 55.0 + i * 0.02, 10] },
      })),
    ],
  };
  it('emits M>=5.5 individual events and swarm events', async () => {
    const { events, health } = await pullQuakes({
      fetchImpl: async () => jsonResponse(usgs),
      nowMs: NOW,
    });
    assert.equal(health.state, 'nominal');
    const big = events.find((e) => e.severity === 5);
    assert.ok(big, 'M6.2 event present');
    assert.ok(big.title.includes('6.2'), `title: ${big.title}`);
    const swarm = events.find((e) => e.keywords.includes('swarm'));
    assert.ok(swarm, 'swarm event present');
    assert.ok(!events.some((e) => e.title.includes('4.4')), 'M4.4 lone quake skipped');
    for (const e of events) checkLiveEvent(e);
  });
  it('degrades gracefully on upstream failure', async () => {
    const { events, health } = await pullQuakes({
      fetchImpl: async () => { throw new Error('down'); },
      nowMs: NOW,
    });
    assert.deepEqual(events, []);
    assert.equal(health.state, 'unavailable');
  });
});

describe('pullCyclones', () => {
  const nhc = {
    activeStorms: [
      {
        id: 'al052026',
        name: 'REMAL',
        classification: 'Hurricane',
        latitudeNumeric: 21.5,
        longitudeNumeric: 89.2,
        lastUpdate: iso(NOW - 3600_000),
        intensity: 100,
        pressure: 965,
        movementDir: 350,
        movementSpeed: 8,
        forecastAdvisory: { issuance: iso(NOW - 3600_000), advNum: '12A', url: 'https://www.nhc.noaa.gov/refresh/graphics_at1+shtml/123456.shtml?cone' },
      },
    ],
  };
  it('maps a Cat-3 storm to severity 5 with advisory links', async () => {
    const { events, health } = await pullCyclones({
      fetchImpl: async () => jsonResponse(nhc),
      nowMs: NOW,
    });
    assert.equal(health.state, 'nominal');
    assert.equal(events.length, 1);
    const e = events[0];
    assert.equal(e.severity, 5);
    assert.ok(e.title.includes('Remal'), e.title);
    assert.ok(e.links.some((l) => l.url.includes('nhc.noaa.gov')), 'advisory link');
    checkLiveEvent(e);
  });
  it('returns empty (not failed) when no storms are active', async () => {
    const { events, health } = await pullCyclones({
      fetchImpl: async () => jsonResponse({ activeStorms: [] }),
      nowMs: NOW,
    });
    assert.deepEqual(events, []);
    assert.equal(health.state, 'nominal');
  });
});

describe('pullFires', () => {
  const header = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight';
  const day = '2026-10-13';
  const rows = Array.from({ length: 60 }, (_, i) =>
    `40.1${i % 10},22.9${i % 10},320.5,0.4,0.4,${day},1200,N,VIIRS,h,2.0NRT,290.1,12.5,D`,
  ).join('\n');
  it('clusters hotspots and maps >50 to severity 4', async () => {
    const { events, health } = await pullFires({
      fetchImpl: async () => jsonResponse(`${header}\n${rows}`),
      nowMs: NOW,
      mapKey: 'TESTKEY',
    });
    assert.equal(health.state, 'nominal');
    assert.equal(events.length, 1);
    assert.equal(events[0].severity, 4);
    assert.ok(events[0].keywords.includes('fire'), events[0].keywords.join(','));
    checkLiveEvent(events[0]);
  });
  it('is unavailable without a FIRMS map key (no silent fetch)', async () => {
    let called = false;
    const { events, health } = await pullFires({
      fetchImpl: async () => { called = true; return jsonResponse(''); },
      nowMs: NOW,
      mapKey: null,
    });
    assert.deepEqual(events, []);
    assert.equal(health.state, 'unavailable');
    assert.equal(called, false, 'upstream never touched without a key');
  });
});

describe('pullWeather', () => {
  const nws = {
    features: [
      {
        properties: {
          event: 'Tornado Warning',
          headline: 'Tornado Warning issued October 13 for Dallas County',
          areaDesc: 'Dallas County',
          effective: iso(NOW - 1800_000),
          expires: iso(NOW + 3600_000),
          severity: 'Extreme',
          certainty: 'Observed',
          geometry: null,
        },
        geometry: { type: 'Point', coordinates: [-96.8, 32.8] },
      },
      {
        properties: {
          event: 'Dense Fog Advisory',
          headline: 'Dense Fog Advisory',
          areaDesc: 'Somewhere',
          effective: iso(NOW - 1800_000),
          expires: iso(NOW + 3600_000),
        },
        geometry: { type: 'Point', coordinates: [-90, 30] },
      },
    ],
  };
  it('keeps only severe alert types and maps Tornado Warning to 5', async () => {
    const { events, health } = await pullWeather({
      fetchImpl: async () => jsonResponse(nws),
      nowMs: NOW,
    });
    assert.equal(health.state, 'nominal');
    assert.equal(events.length, 1);
    assert.equal(events[0].severity, 5);
    assert.ok(events[0].title.includes('Tornado Warning'), events[0].title);
    checkLiveEvent(events[0]);
  });
});

describe('pullNews', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>Cyclone Remal batters West Bengal coast</title><link>https://a.example/1</link><pubDate>Mon, 13 Oct 2026 10:00:00 GMT</pubDate><source url="https://a.example">Outlet A</source></item>
    <item><title>Remal landfall: West Bengal on high alert</title><link>https://b.example/2</link><pubDate>Mon, 13 Oct 2026 11:00:00 GMT</pubDate><source url="https://b.example">Outlet B</source></item>
    <item><title>Local football club wins friendly match</title><link>https://c.example/3</link><pubDate>Mon, 13 Oct 2026 11:30:00 GMT</pubDate><source url="https://c.example">Outlet C</source></item>
  </channel></rss>`;
  it('clusters articles by shared keywords and attaches GDELT attention', async () => {
    const { events, health } = await pullNews({
      fetchImpl: async () => jsonResponse(rss),
      attentionImpl: async () => 42,
      nowMs: NOW,
    });
    assert.equal(health.state, 'nominal');
    const cluster = events.find((e) => e.keywords.includes('remal'));
    assert.ok(cluster, 'remal cluster formed');
    assert.equal(cluster.sources.length, 2, 'two outlets merged');
    assert.equal(cluster.mediaAttention, 42);
    assert.equal(cluster.confidence, 'reported');
    for (const e of events) checkLiveEvent(e);
  });
  it('falls back to GDELT artlist when RSS fails', async () => {
    let mode = null;
    const { events, health } = await pullNews({
      fetchImpl: async (url) => {
        mode = String(url).includes('api.gdeltproject.org') ? 'gdelt' : 'rss';
        if (mode === 'rss') throw new Error('rss blocked');
        return jsonResponse({
          articles: [
            { url: 'https://d.example/4', title: 'Cyclone Remal batters West Bengal coast', seendate: '20261013T100000Z', domain: 'd.example', sourcecountry: 'India' },
          ],
        });
      },
      attentionImpl: async () => 10,
      nowMs: NOW,
    });
    assert.equal(mode, 'gdelt');
    assert.equal(health.state, 'degraded', 'RSS path failed, fallback used');
    assert.ok(events.length >= 1);
  });
});

describe('pullAviation', () => {
  const adsb = {
    ac: [
      { hex: 'a1b2c3', flight: 'UAL123 ', squawk: '7700', lat: 41.9, lon: -87.6, alt_baro: 12000 },
      { hex: 'd4e5f6', flight: 'DAL456 ', squawk: '2000', lat: 33.9, lon: -118.4, alt_baro: 9000 },
    ],
  };
  it('emits squawk 7700 as severity-5 with no casualty speculation', async () => {
    const { events, health } = await pullAviation({
      fetchImpl: async () => jsonResponse(adsb),
      nowMs: NOW,
    });
    assert.equal(health.state, 'nominal');
    assert.equal(events.length, 1);
    const e = events[0];
    assert.equal(e.severity, 5);
    assert.ok(e.title.includes('7700'), e.title);
    assert.ok(!/casualt|crash|death/i.test(e.title + e.summary), 'no speculation');
    checkLiveEvent(e);
  });
});

describe('pullMaritime', () => {
  it('reports unavailable when the in-process AIS store is empty', async () => {
    const { events, health } = await pullMaritime({ nowMs: NOW });
    assert.deepEqual(events, []);
    assert.ok(['unavailable', 'stale'].includes(health.state));
  });
});

describe('runIngestCycle', () => {
  it('assembles events + feed-health snapshot and never rejects', async () => {
    const payload = await runIngestCycle({
      nowMs: NOW,
      mapKey: null,
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('earthquake.usgs.gov')) {
          return jsonResponse({ type: 'FeatureCollection', features: [] });
        }
        if (u.includes('nhc.noaa.gov')) return jsonResponse({ activeStorms: [] });
        if (u.includes('api.weather.gov')) return jsonResponse({ features: [] });
        if (u.includes('news.google.com')) return jsonResponse('<rss><channel></channel></rss>');
        if (u.includes('api.adsb.lol')) return jsonResponse({ ac: [] });
        throw new Error(`unexpected url ${u}`);
      },
      attentionImpl: async () => 0,
    });
    assert.ok(payload.generatedAt, 'generatedAt');
    assert.ok(Array.isArray(payload.events), 'events array');
    assert.ok(payload.feedHealth, 'feedHealth snapshot');
    assert.equal(payload.feedHealth.contract, 'gev/feed-health');
    assert.ok(Array.isArray(payload.feedHealth.feeds), 'feeds list');
    assert.ok(payload.feedHealth.feeds.length >= 5, 'all sources report health');
    assert.ok(Array.isArray(payload.staleSources), 'staleSources list');
    for (const e of payload.events) checkLiveEvent(e);
  });
});
