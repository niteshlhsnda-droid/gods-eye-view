import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransitSource } from './source.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('the feed catalog is read from the public catalog route', async () => {
  const requested = [];
  const feeds = [
    {
      id: 'mbta',
      name: 'MBTA',
      center: { lat: 42.36, lon: -71.06 },
      loadRadiusKm: 60,
    },
  ];
  const source = createTransitSource({
    fetchImpl: async (url) => {
      requested.push(url);
      return json({ feeds });
    },
  });
  assert.deepEqual(await source.getFeeds(), feeds);
  assert.deepEqual(requested, ['/api/transit/feeds']);
});

test('feed catalog failures are reported', async () => {
  const failing = createTransitSource({ fetchImpl: async () => json({}, 503) });
  await assert.rejects(failing.getFeeds(), /Transit feeds HTTP 503/);
  const malformed = createTransitSource({
    fetchImpl: async () => json({ feeds: {} }),
  });
  await assert.rejects(malformed.getFeeds(), /Malformed transit feed catalog/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    createTransitSource({
      fetchImpl: async () => json({ feeds: [] }),
    }).getFeeds({ signal: aborted.signal }),
    (error) => error.name === 'AbortError',
  );
});

test('static hosting: feeds, snapshots and history throw the honest error before any fetch', async () => {
  const { probeApiAvailable, resetStaticHostingProbe } =
    await import('../../sources/staticHosting.js');
  const { NEEDS_DESKTOP_SERVER_CODE } =
    await import('../../sources/needsDesktopServer.js');
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    let calls = 0;
    const source = createTransitSource({
      fetchImpl: async () => {
        calls += 1;
        return json({ feeds: [] });
      },
    });
    for (const call of [
      () => source.getFeeds(),
      () => source.requestSnapshot('mbta'),
      () => source.getHistory('mbta', 'vehicle-1'),
    ]) {
      const error = await call().catch((e) => e);
      assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
      assert.match(error.message, /Transit feeds/);
      assert.match(error.message, /needs the desktop server/);
    }
    assert.equal(calls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});
