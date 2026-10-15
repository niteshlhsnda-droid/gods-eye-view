import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { tilesForBounds } from '../../data/tomtomTiles.js';
import { installationFeedback } from '../../data/installationFeedback.js';
import {
  createInstallationSource,
  installationAnchorBox,
  installationTileZoom,
  MILITARY_TILE_MAX,
  MILITARY_TILE_MIN_ZOOM,
} from './source.js';
import {
  decodeOpenFreeMapMilitaryTile,
  decodeOpenFreeMapTile,
} from '../../sources/openFreeMap.js';

const box = { south: 30.1, west: -97.9, north: 30.3, east: -97.6 };
test('a wide-view pack failure names the unavailable data without an API fallback', async () => {
  const source = createInstallationSource({
    fetchImpl: async () => assert.fail('no API request for bundled names'),
    loadNames: async () => {
      throw new Error('asset unavailable');
    },
  });
  await assert.rejects(
    source.getMappedSites({ south: 20, west: -130, north: 60, east: -60 }),
    (error) => {
      assert.equal(error.failureReason, 'names_unavailable');
      assert.equal(
        installationFeedback({
          status: 'unavailable',
          failureReason: error.failureReason,
        }),
        'Mapped names temporarily unavailable',
      );
      return true;
    },
  );
});
test('mapped-site sources validate viewport bounds and preserve the exact retry key', async () => {
  const calls = [];
  const source = createInstallationSource({
    fetchImpl: async (url) => {
      calls.push(new URL(url, 'https://example.test'));
      return new Response(JSON.stringify({ elements: [], status: 'stale' }));
    },
  });
  for (const invalid of [
    null,
    { ...box, east: Infinity },
    { ...box, north: 91 },
    { ...box, south: 31 },
  ])
    await assert.rejects(
      source.getMappedSites(invalid),
      /bounded installation viewport/,
    );
  assert.equal(calls.length, 0);
  const payload = await source.getMappedSites(box, { exact: true });
  assert.equal(payload.status, 'stale');
  assert.equal(calls[0].pathname, '/api/military-installations');
  assert.equal(calls[0].searchParams.get('exact'), '1');
  assert.equal(calls[0].searchParams.get('south'), '30.10000');
});
test('malformed installation and place snapshots are never accepted as empty success', async () => {
  const source = createInstallationSource({
    fetchImpl: async () => new Response('{}'),
  });
  await assert.rejects(
    source.getMappedSites(box),
    /Malformed installation snapshot/,
  );
  await assert.rejects(
    source.searchNearby({ latitude: 30.2, longitude: -97.7, radiusM: 1000 }),
    /Malformed nearby-place snapshot/,
  );
});
test('installation response parsing respects cancellation before any follow-on search', async () => {
  const controller = new AbortController();
  const source = createInstallationSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        controller.abort();
        return { elements: [] };
      },
    }),
  });
  await assert.rejects(
    source.getMappedSites(box, { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('mapped-site sources normalize records and derive saturation from legacy cache metadata', async () => {
  const source = createInstallationSource({
    fetchImpl: async () =>
      Response.json({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 30.2,
            lon: -97.7,
            tags: { military: 'airfield', name: 'Fixture Field' },
          },
        ],
        elementCap: 1,
        status: 'stale',
        retrievedAt: '2026-01-01T00:00:00Z',
      }),
  });
  const payload = await source.getMappedSites(box);
  assert.equal(payload.records[0].name, 'Fixture Field');
  assert.equal(payload.records[0].latitude, 30.2);
  assert.equal(payload.records[0].retrievedAt, '2026-01-01T00:00:00Z');
  assert.equal(payload.saturated, true);
  assert.equal(payload.status, 'stale');
  assert.equal('elements' in payload, false);
});

test('installation tiles never drop below z9, where military areas exist', () => {
  // OpenMapTiles omits landuse=military below z9; a z6-z8 view used to read as
  // an empty, "Mapped sites loaded" area in Cockpit and wide follow views.
  assert.equal(
    installationTileZoom({
      south: 30.3,
      west: -97.8,
      north: 30.33,
      east: -97.74,
    }),
    12,
  );
  assert.equal(
    installationTileZoom({ south: 30, west: -98, north: 31, east: -97 }),
    10,
  );
  assert.equal(
    installationTileZoom({ south: 30, west: -98.2, north: 31.4, east: -96.8 }),
    9,
  );
  assert.equal(
    installationTileZoom({ south: 28, west: -100, north: 32, east: -96 }),
    null,
  );
});

test('a Contacts window fits the tile cap at z9 from the tropics to the Arctic', () => {
  for (const latitude of [0, 30.3125, 51.5, 60, 70]) {
    const box = installationAnchorBox({ latitude, longitude: -97.765 });
    assert.ok(box, `window at ${latitude}`);
    assert.ok(
      tilesForBounds(box, MILITARY_TILE_MIN_ZOOM, { maxTiles: 64 }).length <=
        MILITARY_TILE_MAX,
    );
    assert.ok(box.south < latitude && box.north > latitude);
  }
  assert.equal(
    installationAnchorBox({ latitude: 30.3125, longitude: -97.765 }).radiusM,
    100_000,
  );
  assert.ok(
    installationAnchorBox({ latitude: 60, longitude: 10 }).radiusM < 100_000,
  );
  assert.equal(
    installationAnchorBox({ latitude: Number.NaN, longitude: 0 }),
    null,
  );
});

test('too-wide tile views use bundled named points without requesting tiles', async () => {
  const fetched = [];
  const source = createInstallationSource({
    fetchImpl: async () =>
      Response.json({ code: 'OVERPASS_NOT_CONFIGURED', retryable: false }),
    mapTiles: {
      clear() {},
      async fetchBounds(box, { zoom }) {
        fetched.push(zoom);
        return { tiles: [], partial: false };
      },
    },
  });
  const wide = await source.getMappedSites({
    south: 28,
    west: -100,
    north: 32,
    east: -96,
  });
  assert.equal(wide.wide, true);
  assert.equal(wide.status, 'ready');
  assert.ok(wide.records.some((r) => r.name === 'Fort Hood'));
  assert.ok(wide.records.every((r) => r.namedArea));
  assert.deepEqual(
    fetched,
    [],
    'no tile request for a view the tiles cannot answer',
  );
  await source.getMappedSites({
    south: 30,
    west: -98.2,
    north: 31.4,
    east: -96.8,
  });
  assert.deepEqual(fetched, [9]);
});

test('the military-only decoder keeps Camp Mabry and skips road geometry', () => {
  const bytes = readFileSync(
    new URL(
      '../../data/fixtures/ofm-camp-mabry-12-935-1685.pbf',
      import.meta.url,
    ),
  );
  const full = decodeOpenFreeMapTile(bytes, 12, 935, 1685);
  const military = decodeOpenFreeMapMilitaryTile(bytes, 12, 935, 1685);
  assert.ok(full.roads.length > 0);
  assert.equal(military.roads.length, 0);
  assert.deepEqual(
    military.military.map((record) => record.id),
    full.military.map((record) => record.id),
  );
});

test('installation API transports never receive vector-tile URLs', async (t) => {
  const calls = [];
  const tileFetch = async (url) => {
    calls.push(url);
    return url.endsWith('/planet')
      ? Response.json({
          tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'],
        })
      : new Response(
          readFileSync(
            new URL(
              '../../data/fixtures/ofm-camp-mabry-12-935-1685.pbf',
              import.meta.url,
            ),
          ),
        );
  };
  t.mock.method(globalThis, 'fetch', tileFetch);
  for (const tileFetchImpl of [undefined, tileFetch]) {
    const source = createInstallationSource({
      tileFetchImpl,
      fetchImpl: async (url) => {
        assert.ok(url.startsWith('/api/'));
        return Response.json({
          code: 'OVERPASS_NOT_CONFIGURED',
          retryable: false,
        });
      },
    });
    const data = await source.getMappedSites({
      south: 30.3,
      west: -97.77,
      north: 30.32,
      east: -97.75,
    });
    assert.ok(data.records.length);
  }
  assert.ok(calls.length >= 4);
});

test('static hosting: mapped sites query Overpass directly with the verbatim proxy query', async () => {
  const { probeApiAvailable, resetStaticHostingProbe } =
    await import('../../sources/staticHosting.js');
  const { OVERPASS_DIRECT_URL } = await import('../alpr/policy.js');
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const calls = [];
    const elements = [
      {
        type: 'node',
        id: 424242,
        lat: 30.2,
        lon: -97.8,
        tags: { landuse: 'military', name: 'Test Base' },
      },
    ];
    const source = createInstallationSource({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ elements }) };
      },
      loadNames: async () => [],
    });
    const payload = await source.getMappedSites(box);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, OVERPASS_DIRECT_URL);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(
      calls[0].init.headers['Content-Type'],
      'application/x-www-form-urlencoded',
    );
    const body = decodeURIComponent(calls[0].init.body.replace(/^data=/, ''));
    assert.match(body, /\[out:json\]\[timeout:20\]/);
    assert.match(
      body,
      /\["military"~\"\^\(airfield\|naval_base\|range\|barracks\|base\)\$\"\]/,
    );
    assert.match(body, /\["landuse"="military"\]/);
    assert.match(body, /\(30\.1,-97\.9,30\.3,-97\.6\)/);
    assert.match(body, /out center tags geom 700/);
    assert.equal(payload.status, 'ready');
    assert.equal(payload.saturated, false);
    assert.equal(payload.records.length, 1);
    assert.equal(payload.records[0].name, 'Test Base');
    assert.equal(payload.records[0].class, 'military_land');
  } finally {
    resetStaticHostingProbe();
  }
});

test('static hosting: an overloaded direct endpoint falls back to the mirror', async () => {
  const { probeApiAvailable, resetStaticHostingProbe } =
    await import('../../sources/staticHosting.js');
  const { OVERPASS_DIRECT_URL, OVERPASS_MIRROR_URL } =
    await import('../alpr/policy.js');
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const calls = [];
    const elements = [
      {
        type: 'node',
        id: 777,
        lat: 30.2,
        lon: -97.8,
        tags: { military: 'barracks', name: 'Mirror Base' },
      },
    ];
    const source = createInstallationSource({
      fetchImpl: async (url) => {
        calls.push(url);
        if (url === OVERPASS_DIRECT_URL)
          return { ok: false, status: 504, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ elements }) };
      },
      loadNames: async () => [],
    });
    const payload = await source.getMappedSites(box);
    assert.deepEqual(calls, [OVERPASS_DIRECT_URL, OVERPASS_MIRROR_URL]);
    assert.equal(payload.records.length, 1);
    assert.equal(payload.records[0].name, 'Mirror Base');
  } finally {
    resetStaticHostingProbe();
  }
});

test('static hosting: a dead direct endpoint falls back to tiles, never an empty all-clear', async () => {
  const { probeApiAvailable, resetStaticHostingProbe } =
    await import('../../sources/staticHosting.js');
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const source = createInstallationSource({
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
      loadNames: async () => [],
      mapTiles: {
        fetchBounds: async () => ({ tiles: [], partial: false }),
        clear() {},
      },
    });
    const payload = await source.getMappedSites(box);
    assert.equal(payload.tileSource, true);
    assert.deepEqual(payload.records, []);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static hosting: Google text search gets the honest state, never a doomed fetch', async () => {
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
    const source = createInstallationSource({
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => ({ places: [] }) };
      },
    });
    const error = await source
      .searchNearby({ latitude: 30.2, longitude: -97.8, radiusM: 5000 })
      .catch((e) => e);
    assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
    assert.match(error.message, /Google Places text search/);
    assert.match(error.message, /needs the desktop server/);
    assert.equal(calls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});
