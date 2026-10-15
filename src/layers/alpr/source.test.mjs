import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  alprDetailZoom,
  createAlprPrecisionCache,
  createAlprTileSource,
  createOverpassAlprSource,
  createAlprRuntimeSource,
  buildOverpassQuery,
} from './source.js';
import {
  resolveOverpassUrl,
  OVERPASS_URL,
  OVERPASS_DIRECT_URL,
  OVERPASS_MIRROR_URL,
  OVERPASS_RETRY_PAUSE_MS,
} from './policy.js';
import {
  probeApiAvailable,
  resetStaticHostingProbe,
} from '../../sources/staticHosting.js';
import { validateAlprSnapshot, alprCreditMarkup } from './model.js';
const box = { south: 30, west: -98, north: 30.1, east: -97.9 };
test('the source rejects invalid and unbounded queries before fetching', async () => {
  let calls = 0;
  const source = createAlprTileSource({
    tileFetchImpl() {
      calls++;
    },
  });
  for (const bad of [
    null,
    { ...box, west: '0);out;' },
    { ...box, north: 90 },
    { ...box, east: -99 },
    { ...box, south: NaN },
  ]) {
    await assert.rejects(source.fetch(bad), /bounded city viewport/);
  }
  assert.equal(calls, 0);
});
const fixture = readFileSync(
  new URL(
    '../../data/fixtures/osm-alpr-austin-11-467-843.pbf',
    import.meta.url,
  ),
);
const metadata = (country) => ({
  tiles: [
    `https://tiles.dontgetflocked.com/cameras-${country}-hourly/{z}/{x}/{y}.mvt`,
  ],
  bounds: country === 'ca' ? [-124, 42, -63, 54] : [-160, 17, -64, 59],
});
const austin = { south: 30.2, north: 30.35, west: -97.85, east: -97.65 };

test('cancellation while reading TileJSON is preserved even if fetch ignores it', async () => {
  const abort = new AbortController();
  const source = createAlprTileSource({
    tileFetchImpl: async () => ({
      ok: true,
      headers: new Headers(),
      async text() {
        abort.abort();
        return JSON.stringify(metadata('us'));
      },
    }),
  });
  await assert.rejects(source.fetch(austin, abort.signal), {
    name: 'AbortError',
  });
});

test('extract detail tiles map OSM records and repeated pans reuse decoded tiles', async () => {
  const calls = [];
  const source = createAlprTileSource({
    tileFetchImpl: async (url) => {
      calls.push(url);
      return url.endsWith('.json')
        ? Response.json(metadata(url.includes('-ca-') ? 'ca' : 'us'))
        : new Response(fixture);
    },
  });
  const snapshot = await source.fetch(austin);
  assert.ok(snapshot.records.length > 0);
  const record = snapshot.records[0];
  assert.match(record.id, /^alpr:/);
  assert.equal(record.manufacturer, 'Flock Safety');
  assert.equal(record.lastVerified, null);
  assert.ok(record.osmTimestamp);
  assert.equal(snapshot.stale, false);
  assert.equal('elements' in snapshot, false);
  const fetched = calls.length;
  await source.fetch(austin);
  assert.equal(calls.length, fetched);
  assert.ok(calls.every((url) => !url.includes('overpass')));
  assert.doesNotMatch(JSON.stringify(source.attribution), /flock/i);
});

test('outside extract coverage is an explicit no-data state without Overpass', async () => {
  const source = createAlprTileSource({
    tileFetchImpl: () => assert.fail('no network expected in Europe'),
  });
  assert.deepEqual(
    await source.fetch({ south: 51, north: 51.1, west: 0, east: 0.1 }),
    { records: [], stale: false, saturated: false, noCoverage: true },
  );
});

test('an unsuccessful source response releases its body before reporting an error', async () => {
  let cancelled = 0;
  const source = createAlprTileSource({
    tileFetchImpl: async () => ({
      ok: false,
      status: 429,
      body: {
        async cancel() {
          cancelled++;
        },
      },
    }),
  });
  await assert.rejects(source.fetch(box), /unavailable/);
  assert.equal(cancelled, 1);
});

test('source snapshots reject malformed coordinates and duplicate identities', () => {
  const record = { id: 'camera:1', latitude: 30, longitude: -98 };
  for (const records of [
    [{ ...record, latitude: NaN }],
    [record, record],
    [{ ...record, id: '' }],
  ]) {
    assert.throws(
      () => validateAlprSnapshot({ records, stale: false, saturated: false }),
      /invalid record/,
    );
  }
  assert.throws(
    () => validateAlprSnapshot({ elements: [] }),
    /invalid snapshot/,
  );
});

test('provider attribution escapes markup and rejects executable links', () => {
  assert.equal(alprCreditMarkup(null), null);
  assert.throws(
    () => alprCreditMarkup({ text: 'test', href: 'javascript:alert(1)' }),
    /HTTPS/,
  );
  const html = alprCreditMarkup({
    text: '<img onerror=alert(1)>',
    href: 'https://example.org/?a=1&b=2',
  });
  assert.ok(html.includes('&lt;img onerror=alert(1)&gt;'));
  assert.ok(html.includes('?a=1&amp;b=2'));
  assert.ok(!html.includes('<img'));
});

test('wide detail view returns zoom guidance before any fetch and can retry a smaller view', async () => {
  let calls = 0;
  const source = createAlprTileSource({
    tileFetchImpl: async () => {
      calls++;
      return Response.json({
        tiles: ['https://tiles.dontgetflocked.com/{z}/{x}/{y}.pbf'],
        bounds: [-180, 17, -50, 84],
      });
    },
  });
  const wide = await source.fetch({
    south: 29,
    north: 32,
    west: -99,
    east: -96,
  });
  assert.equal(wide.zoomIn, true);
  assert.equal(calls, 0);
  await source
    .fetch({ south: 30.267, north: 30.268, west: -97.744, east: -97.743 })
    .catch(() => {});
  assert.ok(calls > 0);
});

test('each view reads the finest attributed extract zoom that fits 16 tiles', () => {
  // Field report: a z11-only read refused whole-city views. Attributed detail
  // exists from z9, so a city reads a few z9/z10 tiles and a street z12.
  assert.equal(
    alprDetailZoom({ south: 30.29, north: 30.31, west: -97.78, east: -97.75 }),
    12,
  );
  assert.equal(
    alprDetailZoom({ south: 30.17, north: 30.36, west: -97.85, east: -97.63 }),
    12,
  );
  assert.equal(
    alprDetailZoom({ south: 29.7, north: 30.7, west: -98.25, east: -97.25 }),
    10,
  );
  assert.equal(
    alprDetailZoom({ south: 29.2, north: 31.2, west: -98.75, east: -96.75 }),
    9,
  );
  assert.equal(
    alprDetailZoom({ south: 29, north: 32, west: -99, east: -96 }),
    null,
  );
});

test('a whole-city view loads cameras and reports the tiles it covers', async () => {
  const urls = [];
  const source = createAlprTileSource({
    tileFetchImpl: async (url) => {
      urls.push(url);
      return url.endsWith('.json')
        ? Response.json(metadata(url.includes('-ca-') ? 'ca' : 'us'))
        : new Response(fixture);
    },
  });
  const city = { south: 29.95, north: 30.55, west: -98.05, east: -97.45 };
  const snapshot = await source.fetch(city);
  assert.equal(snapshot.zoomIn, undefined);
  assert.equal(snapshot.zoom, 10);
  assert.ok(snapshot.records.length > 0);
  assert.ok(urls.some((url) => url.includes('/10/')));
  for (const key of ['south', 'west'])
    assert.ok(snapshot.coverage[key] <= city[key]);
  for (const key of ['north', 'east'])
    assert.ok(snapshot.coverage[key] >= city[key]);
});

test('coarser tiles never move a camera a finer tile already placed', () => {
  const cache = createAlprPrecisionCache(2);
  const fine = {
    id: 'alpr:1',
    latitude: 30.30001,
    longitude: -97.76001,
    operator: 'A',
  };
  assert.equal(cache.apply(fine, 12), fine);
  const coarse = {
    ...fine,
    latitude: 30.3001,
    longitude: -97.7602,
    operator: 'B',
  };
  const kept = cache.apply(coarse, 9);
  assert.equal(kept.latitude, fine.latitude);
  assert.equal(kept.longitude, fine.longitude);
  assert.equal(kept.operator, 'B', 'attributes still refresh');
  const finer = { ...fine, latitude: 30.300012 };
  assert.equal(cache.apply(finer, 13), finer);
  cache.apply({ id: 'alpr:2', latitude: 1, longitude: 1 }, 12);
  cache.apply({ id: 'alpr:3', latitude: 1, longitude: 1 }, 12);
  assert.equal(cache.size(), 2, 'bounded');
});

test('the explicit Overpass factory posts the unchanged query to its API transport', async () => {
  const calls = [];
  const source = createOverpassAlprSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({
        elements: [
          {
            type: 'node',
            id: 42,
            lat: 30.05,
            lon: -97.95,
            tags: { 'surveillance:type': 'ALPR', operator: 'Test' },
          },
        ],
      });
    },
  });
  const result = await source.fetch(box);
  assert.equal(result.records.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/overpass');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(
    new URLSearchParams(calls[0].options.body).get('data'),
    buildOverpassQuery(box.south, box.west, box.north, box.east),
  );
});

test('the tile adapter never passes public URLs through an injected API transport', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    return url.endsWith('.json')
      ? Response.json(metadata('us'))
      : new Response(fixture);
  });
  const source = createAlprTileSource({
    fetchImpl: () => assert.fail('API transport must not receive tile URLs'),
  });
  const result = await source.fetch(austin);
  assert.ok(result.records.length);
  assert.ok(urls.length > 1);
  assert.ok(urls.every((url) => url.startsWith('https://tiles.')));
});

test('overpass endpoint resolves direct on static hosting, proxy on desktop', async () => {
  resetStaticHostingProbe();
  try {
    assert.equal(resolveOverpassUrl(), OVERPASS_URL);
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    assert.equal(resolveOverpassUrl(), OVERPASS_DIRECT_URL);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static 429 pauses per the wiki rule, then falls back to the mirror', async () => {
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const calls = [];
    const slept = [];
    const source = createOverpassAlprSource({
      fetchImpl: async (url) => {
        calls.push(url);
        if (url === OVERPASS_DIRECT_URL)
          return { ok: false, status: 429, body: { cancel: async () => {} } };
        return Response.json({ elements: [] });
      },
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });
    const result = await source.fetch(box);
    assert.deepEqual(result.records, []);
    assert.deepEqual(calls, [OVERPASS_DIRECT_URL, OVERPASS_MIRROR_URL]);
    assert.deepEqual(slept, [OVERPASS_RETRY_PAUSE_MS]);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static 504 tries the mirror without the 30s pause', async () => {
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const calls = [];
    let slept = 0;
    const source = createOverpassAlprSource({
      fetchImpl: async (url) => {
        calls.push(url);
        if (url === OVERPASS_DIRECT_URL)
          return { ok: false, status: 504, body: { cancel: async () => {} } };
        return Response.json({ elements: [] });
      },
      sleepImpl: async () => {
        slept += 1;
      },
    });
    await source.fetch(box);
    assert.deepEqual(calls, [OVERPASS_DIRECT_URL, OVERPASS_MIRROR_URL]);
    assert.equal(slept, 0);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static double-429 surfaces the rate-limited taxonomy', async () => {
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const source = createOverpassAlprSource({
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        body: { cancel: async () => {} },
      }),
      sleepImpl: async () => {},
    });
    await assert.rejects(source.fetch(box), /Overpass rate-limited/);
  } finally {
    resetStaticHostingProbe();
  }
});

test('desktop 429 keeps the single-proxy behavior: no mirror, no pause', async () => {
  resetStaticHostingProbe();
  try {
    const calls = [];
    let slept = 0;
    const source = createOverpassAlprSource({
      fetchImpl: async (url) => {
        calls.push(url);
        return { ok: false, status: 429, body: { cancel: async () => {} } };
      },
      sleepImpl: async () => {
        slept += 1;
      },
    });
    await assert.rejects(source.fetch(box), /Overpass rate-limited/);
    assert.deepEqual(calls, ['/api/overpass']);
    assert.equal(slept, 0);
  } finally {
    resetStaticHostingProbe();
  }
});

test('runtime source uses direct Overpass on static, tiles on desktop', async () => {
  const overpassPayload = {
    elements: [
      {
        type: 'node',
        id: 42,
        lat: 30.05,
        lon: -97.95,
        tags: { 'surveillance:type': 'ALPR', operator: 'Test' },
      },
    ],
  };
  // Static: the runtime source enriches via direct Overpass.
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const calls = [];
    const source = createAlprRuntimeSource({
      fetchImpl: async (url) => {
        calls.push(url);
        return Response.json(overpassPayload);
      },
      tileFetchImpl: () => assert.fail('tiles must not be used on static'),
      sleepImpl: async () => {},
    });
    const result = await source.fetch(box);
    assert.equal(result.records.length, 1);
    assert.deepEqual(calls, [OVERPASS_DIRECT_URL]);
    assert.match(source.label, /OpenStreetMap/);
  } finally {
    resetStaticHostingProbe();
  }
  // Desktop (unprobed): the runtime source stays on the tile extract.
  resetStaticHostingProbe();
  try {
    let overpassCalls = 0;
    const source = createAlprRuntimeSource({
      fetchImpl: () => {
        overpassCalls += 1;
        return assert.fail('overpass must not be used on desktop');
      },
      tileFetchImpl: () => assert.fail('no network expected in Europe'),
    });
    const result = await source.fetch({
      south: 51,
      north: 51.1,
      west: 0,
      east: 0.1,
    });
    assert.equal(result.noCoverage, true);
    assert.equal(overpassCalls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});
