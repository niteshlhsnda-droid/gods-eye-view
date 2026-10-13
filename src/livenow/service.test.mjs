import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchLiveNow,
  validateLiveNowPayload,
  minutesSinceGenerated,
  hasFreshCriticalEvent,
  LIVE_NOW_CACHE_KEY,
} from './service.js';
import { makeStorage } from './testdom.mjs';

/** The frozen contract's real example response (CONTRACT.md). */
function exampleEvent() {
  return {
    id: 'quake:7xfjw:cb1d7d9f',
    type: 'quake',
    title: 'M6.9 earthquake — central Mid-Atlantic Ridge',
    summary:
      'Magnitude 6.9 earthquake central Mid-Atlantic Ridge. Reported by USGS.',
    lat: -0.4016,
    lon: -19.4151,
    severity: 5,
    startedAt: '2026-10-13T12:23:07.383Z',
    updatedAt: '2026-10-13T12:23:07.383Z',
    sources: [
      {
        name: 'USGS',
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u214',
      },
    ],
    confidence: 'verified',
    links: [
      {
        label: 'USGS event page',
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u214',
      },
    ],
    keywords: ['earthquake', 'central', 'atlantic', 'ridge'],
    score: 75,
  };
}

function examplePayload() {
  return {
    schema: 'gev/live-now',
    version: 1,
    generatedAt: '2026-10-13T14:18:46.295Z',
    events: [exampleEvent()],
    feedHealth: { contract: 'gev/feed-health', version: 1 },
    staleSources: ['fires', 'weather', 'maritime'],
  };
}

const okResponse = (payload) => ({
  ok: true,
  json: async () => payload,
});

test('validateLiveNowPayload accepts the frozen contract example', () => {
  const { ok, errors } = validateLiveNowPayload(examplePayload());
  assert.equal(ok, true, errors.join('; '));
});

test('validateLiveNowPayload rejects bad schema, version, oversize, bad events', () => {
  const base = examplePayload();
  assert.equal(validateLiveNowPayload({ ...base, schema: 'nope' }).ok, false);
  assert.equal(validateLiveNowPayload({ ...base, version: 2 }).ok, false);
  assert.equal(
    validateLiveNowPayload({
      ...base,
      events: new Array(13).fill(exampleEvent()),
    }).ok,
    false,
  );
  assert.equal(
    validateLiveNowPayload({
      ...base,
      events: [{ ...exampleEvent(), sources: [] }],
    }).ok,
    false,
  );
  assert.equal(
    validateLiveNowPayload({
      ...base,
      events: [{ ...exampleEvent(), severity: 9 }],
    }).ok,
    false,
  );
  assert.equal(validateLiveNowPayload(null).ok, false);
});

test('fetchLiveNow uses the API, caches, and falls back to static JSON', async () => {
  const payload = examplePayload();
  const storage = makeStorage();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === '/api/live-now') throw new Error('boom');
    return okResponse(payload);
  };
  const result = await fetchLiveNow({ fetchImpl, storage });
  assert.equal(result.fresh, true);
  assert.equal(result.fromCache, false);
  assert.deepEqual(calls, ['/api/live-now', '/data/live-now.json']);
  assert.equal(storage.getItem(LIVE_NOW_CACHE_KEY) !== null, true);
});

test('fetchLiveNow serves the last good cache when the network dies', async () => {
  const payload = examplePayload();
  const storage = makeStorage({
    [LIVE_NOW_CACHE_KEY]: JSON.stringify(payload),
  });
  const fetchImpl = async () => {
    throw new Error('down');
  };
  const result = await fetchLiveNow({ fetchImpl, storage });
  assert.equal(result.fresh, false);
  assert.equal(result.fromCache, true);
  assert.equal(result.payload.events.length, 1);
});

test('fetchLiveNow reports unavailable when nothing works', async () => {
  const storage = makeStorage();
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const result = await fetchLiveNow({ fetchImpl, storage });
  assert.equal(result.payload, null);
  assert.equal(result.error, 'live-now-unavailable');
});

test('fetchLiveNow rejects malformed payloads from the wire', async () => {
  const storage = makeStorage();
  const fetchImpl = async () =>
    okResponse({ schema: 'gev/live-now', version: 1 });
  const result = await fetchLiveNow({ fetchImpl, storage });
  assert.equal(result.payload, null);
});

test('hasFreshCriticalEvent: severity-5 within 6h only', () => {
  const now = Date.parse('2026-10-13T15:00:00.000Z');
  const fresh = { ...exampleEvent(), startedAt: '2026-10-13T12:23:07.383Z' }; // ~2.6h
  const old = { ...exampleEvent(), startedAt: '2026-10-13T08:00:00.000Z' }; // 7h
  const mild = { ...exampleEvent(), severity: 3 };
  assert.equal(hasFreshCriticalEvent([fresh], now), true);
  assert.equal(hasFreshCriticalEvent([old], now), false);
  assert.equal(hasFreshCriticalEvent([mild], now), false);
  assert.equal(hasFreshCriticalEvent([], now), false);
});

test('minutesSinceGenerated rounds from generatedAt', () => {
  const payload = examplePayload();
  assert.equal(
    minutesSinceGenerated(payload, Date.parse('2026-10-13T14:48:46.295Z')),
    30,
  );
  assert.equal(
    minutesSinceGenerated({ generatedAt: 'bogus' }, Date.now()),
    null,
  );
});
