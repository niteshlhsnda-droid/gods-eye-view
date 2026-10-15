import assert from 'node:assert/strict';
import test from 'node:test';
import { createBikeshareSource } from './source.js';
test('station source keeps upstream URLs behind the fixed GBFS endpoint', async () => {
  const calls = [];
  const source = createBikeshareSource({
    fetchImpl: async (...args) => {
      calls.push(args);
      return new Response('{"data":{"stations":[]}}');
    },
  });
  for (const url of [
    'file:///etc/passwd',
    'http://example.test/stations',
    'https://user:pass@example.test/stations',
  ])
    await assert.rejects(source.getStations(url), /HTTPS GBFS/);
  assert.equal(calls.length, 0);
  await source.getStations('https://example.test/stations.json');
  const url = new URL(calls[0][0], 'https://app.example');
  assert.equal(url.search, '');
  assert.equal(
    decodeURIComponent(url.pathname.replace(/^\/api\/gbfs\//, '')),
    'https://example.test/stations.json',
  );
});
test('cancelled station parsing never publishes the response', async () => {
  const controller = new AbortController();
  const source = createBikeshareSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        controller.abort();
        return { data: { stations: [] } };
      },
    }),
  });
  await assert.rejects(
    source.getStations('https://example.test/stations', {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
});

/* Static-hosting direct GBFS path (gap-fix). */

import {
  isStaticHosting,
  probeApiAvailable,
  resetStaticHostingProbe,
} from '../../sources/staticHosting.js';
import {
  GBFS_DIRECT_CORS_HOSTS,
  GBFS_NEEDS_DESKTOP_SERVER_CODE,
  gbfsStaticNeedsServerMessage,
  isGbfsDirectHostAllowed,
} from './directFetch.js';
import { GBFS_DIRECT_CORS_HOSTS as POLICY_HOSTS } from './policy.js';

/** Become "static hosting" for the duration of one test. */
async function asStaticHosting() {
  resetStaticHostingProbe();
  const available = await probeApiAvailable({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(available, false);
  assert.equal(isStaticHosting(), true);
}

test('static GBFS fetches allowlisted hosts directly, never via /api/gbfs/', async () => {
  await asStaticHosting();
  try {
    const calls = [];
    const payload = { data: { stations: [] } };
    const source = createBikeshareSource({
      fetchImpl: async (...args) => {
        calls.push(args);
        return new Response(JSON.stringify(payload));
      },
    });
    const url =
      'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json';
    assert.deepEqual(await source.getStations(url), payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], url);
    assert.ok(!String(calls[0][0]).includes('/api/gbfs/'));
    assert.equal(calls[0][1].headers.Accept, 'application/json');
    const denied = createBikeshareSource({
      fetchImpl: async () => new Response('', { status: 403 }),
    });
    await assert.rejects(denied.getStations(url), /GBFS HTTP 403/);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static GBFS refuses non-allowlisted hosts with a needs-server error', async () => {
  await asStaticHosting();
  try {
    let calls = 0;
    const source = createBikeshareSource({
      fetchImpl: async () => {
        calls += 1;
        return new Response('{}');
      },
    });
    const url =
      'https://gbfs.cogobikeshare.com/gbfs/2.3/en/station_information.json';
    const error = await source.getStations(url).catch((e) => e);
    assert.equal(error.code, GBFS_NEEDS_DESKTOP_SERVER_CODE);
    assert.match(error.message, /needs the desktop server/);
    assert.match(error.message, /gbfs\.cogobikeshare\.com/);
    assert.equal(calls, 0);
    // Malformed payloads are still rejected on the direct path.
    const malformed = createBikeshareSource({
      fetchImpl: async () => new Response('42'),
    });
    await assert.rejects(
      malformed.getStations(
        'https://gbfs.bcycle.com/bcycle_boulder/station_information.json',
      ),
      /Malformed GBFS payload/,
    );
  } finally {
    resetStaticHostingProbe();
  }
});

test('static GBFS keeps the HTTPS-only validation', async () => {
  await asStaticHosting();
  try {
    let calls = 0;
    const source = createBikeshareSource({
      fetchImpl: async () => {
        calls += 1;
        return new Response('{}');
      },
    });
    for (const url of [
      'file:///etc/passwd',
      'http://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json',
      'https://user:pass@gbfs.lyft.com/stations',
    ])
      await assert.rejects(source.getStations(url), /HTTPS GBFS/);
    assert.equal(calls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});

test('GBFS direct-fetch allowlist covers the dossier hosts and registry hosts', () => {
  for (const host of [
    'gbfs.citibikenyc.com',
    'gbfs.capitalbikeshare.com',
    'gbfs.lyftbikes.com',
    'gbfs.divvybikes.com',
    'gbfs.nextbike.net',
    'gbfs.bcycle.com',
    'gbfs.api.ridedott.com',
    'api.cyclocity.fr',
    'gbfs.lyft.com',
    'gbfs.bluebikes.com',
    'gbfs.biketownpdx.com',
    'austin.publicbikesystem.net',
  ]) {
    assert.ok(isGbfsDirectHostAllowed(host), host);
    assert.ok(GBFS_DIRECT_CORS_HOSTS.has(host), host);
  }
  assert.equal(isGbfsDirectHostAllowed('GBFS.LYFT.COM'), true);
  assert.equal(isGbfsDirectHostAllowed('gbfs.cogobikeshare.com'), false);
  assert.equal(isGbfsDirectHostAllowed('data.lime.bike'), false);
  assert.equal(POLICY_HOSTS, GBFS_DIRECT_CORS_HOSTS);
  assert.match(
    gbfsStaticNeedsServerMessage('example.test'),
    /needs the desktop server/,
  );
});
