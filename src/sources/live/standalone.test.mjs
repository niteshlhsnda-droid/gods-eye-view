import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFlightSource,
  createMilitarySource,
  createVesselSource,
} from './standalone.js';
import { NEEDS_DESKTOP_SERVER_CODE } from '../needsDesktopServer.js';
import {
  probeApiAvailable,
  resetStaticHostingProbe,
} from '../staticHosting.js';

async function asStaticHosting() {
  resetStaticHostingProbe();
  await probeApiAvailable({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
}

async function asDesktop() {
  resetStaticHostingProbe();
  await probeApiAvailable({
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
}

const okJson = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => payload,
});

test('static hosting: flight snapshot throws the honest error before any fetch', async () => {
  await asStaticHosting();
  try {
    let calls = 0;
    const source = createFlightSource({
      fetchImpl: async () => {
        calls += 1;
        return okJson({ states: [] });
      },
    });
    const error = await source.getSnapshot({}).catch((e) => e);
    assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
    assert.match(error.message, /Live flights/);
    assert.match(error.message, /needs the desktop server/);
    assert.equal(calls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static hosting: flight track and enrichment throw before any fetch', async () => {
  await asStaticHosting();
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return okJson({});
    };
    const source = createFlightSource({ fetchImpl });
    for (const call of [
      () => source.getTrack('abc123'),
      () => source.getEnrichment({ kind: 'type', id: 'abc123' }),
    ]) {
      const error = await call().catch((e) => e);
      assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
    }
    assert.equal(calls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static hosting: military snapshot and identities throw before any fetch', async () => {
  await asStaticHosting();
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return okJson({ aircraft: [] });
    };
    const source = createMilitarySource({ fetchImpl });
    for (const call of [
      () => source.getSnapshot({}),
      () => source.getIdentities({}),
      () => source.getTrack('abc123'),
    ]) {
      const error = await call().catch((e) => e);
      assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
      assert.match(error.message, /Military flights/);
    }
    assert.equal(calls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static hosting: vessel snapshot and track throw before any fetch', async () => {
  await asStaticHosting();
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return okJson({ vessels: [] });
    };
    const source = createVesselSource({ fetchImpl });
    for (const call of [
      () => source.getSnapshot({}),
      () => source.getTrack('123456789'),
    ]) {
      const error = await call().catch((e) => e);
      assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
      assert.match(error.message, /Live vessels/);
    }
    assert.equal(calls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});

test('desktop: flight snapshot still fetches /api/flights', async () => {
  await asDesktop();
  try {
    const seen = [];
    const source = createFlightSource({
      fetchImpl: async (url) => {
        seen.push(url);
        return okJson({ states: [] });
      },
    });
    const snapshot = await source.getSnapshot({ latitude: 1, longitude: 2 });
    assert.ok(Array.isArray(snapshot.records));
    assert.equal(seen.length, 1);
    assert.match(seen[0], /\/api\/flights/);
  } finally {
    resetStaticHostingProbe();
  }
});

test('desktop: military and vessel snapshots still fetch their /api routes', async () => {
  await asDesktop();
  try {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return okJson({
        ac: [{ hex: 'abc123', lat: 30.1, lon: -97.7 }],
        rows: [],
      });
    };
    await createMilitarySource({ fetchImpl }).getSnapshot({});
    await createVesselSource({ fetchImpl }).getSnapshot({});
    assert.deepEqual(seen, [
      '/api/military',
      'http://localhost/api/vessels?maxRows=12000',
    ]);
  } finally {
    resetStaticHostingProbe();
  }
});
