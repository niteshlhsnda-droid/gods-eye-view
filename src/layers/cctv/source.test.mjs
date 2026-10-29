import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCctvSource,
  createCctvLayer,
  mapWindyWebcam,
  fetchWindyCameras,
} from './index.js';

const camera = {
  id: 'pack/camera ?x',
  name: 'Camera & road',
  city: 'Austin',
  lat: 30.267,
  lon: -97.744,
  headingDeg: 45,
  fovDeg: 60,
  pitchDeg: -12,
};

test('camera catalog and health use fixed source routes and caller cancellation', async () => {
  const calls = [];
  const source = createCctvSource({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return new Response(
        JSON.stringify(
          path.endsWith('/sources') ? { sources: [] } : { cameras: [] },
        ),
      );
    },
  });
  const controller = new AbortController();
  await source.getCatalog({ signal: controller.signal });
  await source.getHealth({ signal: controller.signal });
  assert.deepEqual(
    calls.map((call) => call.path),
    ['/api/cctv/sources', '/api/cctv/health'],
  );
  for (const { options } of calls) {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.cache, 'no-store');
  }
});

test('camera sources reject malformed snapshots and failures', async () => {
  for (const method of ['getCatalog', 'getHealth']) {
    const malformed = createCctvSource({
      fetchImpl: async () => new Response('{}'),
    });
    await assert.rejects(malformed[method](), /Malformed camera/);
    const denied = createCctvSource({
      fetchImpl: async () => new Response('', { status: 403 }),
    });
    await assert.rejects(denied[method](), /HTTP 403/);
  }
});

test('cancellation while reading a camera response body prevents publication', async () => {
  const controller = new AbortController();
  const source = createCctvSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        controller.abort();
        return { sources: [] };
      },
    }),
  });
  await assert.rejects(source.getCatalog({ signal: controller.signal }), {
    name: 'AbortError',
  });
});

test('frame and media URLs preserve registered camera identity and encoded metadata', () => {
  const source = createCctvSource();
  const frame = new URL(source.getFrameUrl(camera), 'https://example.test');
  const media = new URL(source.getMediaUrl(camera), 'https://example.test');
  assert.equal(
    frame.pathname,
    '/api/cctv/frame/' + encodeURIComponent(camera.id),
  );
  assert.equal(
    media.pathname,
    '/api/cctv/media/' + encodeURIComponent(camera.id),
  );
  assert.equal(frame.searchParams.get('label'), camera.name);
  assert.equal(frame.searchParams.get('city'), camera.city);
  assert.equal(frame.searchParams.get('lat'), '30.267000');
  assert.equal(frame.searchParams.get('lon'), '-97.744000');
  assert.equal(frame.searchParams.get('heading'), '45');
  assert.equal(frame.searchParams.get('pitch'), '-12');
  assert.deepEqual([...media.searchParams.keys()], ['ts']);
});

test('camera construction is inert and destruction cancels a pending catalog and its visibility listener', async (t) => {
  const original = globalThis.document;
  const listeners = new Set();
  globalThis.document = {
    addEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.delete(handler);
    },
  };
  t.after(() => {
    globalThis.document = original;
  });
  const noop = () => {};
  const services = {
    overlays: {
      clearOverlaySource: noop,
      hitTestWorldOverlay: noop,
      setOverlayEntries: noop,
      setOverlaySourceVisible: noop,
    },
    sprites: { registerSpriteCollection: noop },
    activation: {},
    locations: {},
    picking: { unregisterPickOwner: noop },
    terrain: {},
    ground: {},
    mesh: {},
    focus: {},
    render: { releaseContinuousRender: noop },
  };
  let resolveCatalog;
  let signal;
  const source = {
    ...createCctvSource(),
    getCatalog(options) {
      signal = options.signal;
      return new Promise((resolve) => {
        resolveCatalog = resolve;
      });
    },
  };
  const a = createCctvLayer({ services, source });
  const b = createCctvLayer({ services, source });
  assert.equal(listeners.size, 0);
  const viewer = {
    scene: { primitives: { add: (value) => value, remove: () => true } },
  };
  const initializing = a.init(viewer);
  assert.equal(listeners.size, 1);
  assert.equal(signal.aborted, false);
  a.destroy(viewer);
  assert.equal(listeners.size, 0);
  assert.equal(signal.aborted, true);
  resolveCatalog({ sources: [] });
  await assert.rejects(initializing, { name: 'AbortError' });
  assert.equal(a.getStats().count, 0);
  assert.equal(b.getStats().count, 0);
});

test('frames are read through the registered frame endpoint', async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const requested = [];
  const source = createCctvSource({
    fetchImpl: async (url, init) => {
      requested.push({ url, cache: init.cache });
      return new Response(png, {
        headers: { 'Content-Type': 'Image/PNG; charset=binary' },
      });
    },
  });
  const frame = await source.getFrame(camera);
  assert.equal(frame.contentType, 'image/png');
  assert.deepEqual([...frame.bytes], [...png]);
  assert.equal(
    requested[0].url.split('?')[0],
    '/api/cctv/frame/pack%2Fcamera%20%3Fx',
  );
  assert.equal(requested[0].cache, 'no-store');
  const failing = createCctvSource({
    fetchImpl: async () => new Response(null, { status: 502 }),
  });
  await assert.rejects(failing.getFrame(camera), /Camera frame HTTP 502/);
});

test('camera catalog falls back to the static snapshot when the proxy 404s', async () => {
  const snapshot = {
    sources: [
      {
        id: 'austin-1',
        feedType: 'image',
        url: 'https://example.test/a.jpg',
        snapshotUrl: '',
      },
      {
        id: 'deldot-1',
        feedType: 'hls',
        url: 'https://example.test/live.m3u8',
        snapshotUrl: '',
      },
    ],
  };
  const requested = [];
  const source = createCctvSource({
    fetchImpl: async (path) => {
      requested.push(path);
      if (path === '/api/cctv/sources')
        return new Response('', { status: 404 });
      if (path === '/data/cctv-sources.json')
        return new Response(JSON.stringify(snapshot));
      if (path === '/data/cctv-opentraffic.json')
        return new Response(
          JSON.stringify({
            sources: [
              {
                id: 'otcm-1',
                feedType: 'image',
                url: 'https://example.test/otcm.jpg',
                snapshotUrl: 'https://example.test/otcm.jpg',
              },
            ],
          }),
        );
      throw new Error('unexpected fetch ' + path);
    },
  });
  const catalog = await source.getCatalog();
  assert.equal(catalog.sources.length, 3);
  assert.equal(catalog.opentrafficSources, 1);
  // No Windy key in tests: zero Windy cameras, status reported, no fetch.
  assert.equal(catalog.windyStatus, 'missing-key');
  assert.equal(catalog.windyCount, 0);
  assert.deepEqual(requested, [
    '/api/cctv/sources',
    '/data/cctv-sources.json',
    '/data/cctv-opentraffic.json',
  ]);
  assert.match(
    source.getFrameUrl({ ...camera, id: 'otcm-1' }),
    /^https:\/\/example\.test\/otcm\.jpg\?cctvTs=\d+$/,
  );
  assert.match(
    source.getFrameUrl({ ...camera, id: 'austin-1' }),
    /^https:\/\/example\.test\/a\.jpg\?cctvTs=\d+$/,
  );
  assert.match(
    source.getMediaUrl({ id: 'deldot-1' }),
    /^https:\/\/example\.test\/live\.m3u8\?cctvTs=\d+$/,
  );
  // A video camera without a snapshot still uses the proxy frame route.
  assert.match(
    source.getFrameUrl({ ...camera, id: 'deldot-1' }),
    /^\/api\/cctv\/frame\//,
  );
});

test('camera catalog falls back to the static snapshot on a network failure', async () => {
  const source = createCctvSource({
    fetchImpl: async (path) => {
      if (path === '/api/cctv/sources') throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ sources: [] }));
    },
  });
  const catalog = await source.getCatalog();
  assert.deepEqual(catalog.sources, []);
});

test('camera frame and media URLs stay on the proxy when the catalog came from it', async () => {
  const source = createCctvSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ sources: [], cameras: [] })),
  });
  await source.getCatalog();
  assert.match(
    source.getFrameUrl(camera),
    /^\/api\/cctv\/frame\/pack%2Fcamera%20%3Fx\?/,
  );
  assert.match(
    source.getMediaUrl(camera),
    /^\/api\/cctv\/media\/pack%2Fcamera%20%3Fx\?ts=\d+$/,
  );
});

const windyWebcam = {
  webcamId: 1401795663,
  status: 'active',
  title: 'Times Square',
  viewCount: 42,
  lastUpdatedOn: '2026-10-29T10:00:00.000Z',
  images: {
    current: {
      preview: 'https://images.windy.com/preview.jpg?token=abc',
      icon: 'https://images.windy.com/icon.jpg?token=abc',
    },
  },
  location: {
    city: 'New York',
    region: 'New York',
    country: 'United States',
    latitude: 40.758,
    longitude: -73.9855,
  },
  player: { day: 'https://windy.com/embed/day' },
  urls: { detail: 'https://windy.com/webcams/1401795663' },
};

test('Windy v3 webcams map to snapshot catalog entries, never live', () => {
  const mapped = mapWindyWebcam(windyWebcam);
  assert.equal(mapped.id, 'windy-1401795663');
  assert.equal(mapped.name, 'Times Square');
  assert.equal(mapped.city, 'New York');
  assert.equal(mapped.lat, 40.758);
  assert.equal(mapped.lon, -73.9855);
  // A refreshing snapshot is CONTINUOUS, never LIVE: feedType image.
  assert.equal(mapped.feedType, 'image');
  assert.equal(mapped.url, 'https://images.windy.com/preview.jpg?token=abc');
  assert.equal(mapped.snapshotUrl, mapped.url);
  assert.equal(mapped.provider, 'Windy');
  assert.equal(mapped.credit, 'Windy.com');
  assert.equal(mapped.sourceKind, 'windy');
  assert.equal(mapWindyWebcam({ ...windyWebcam, status: 'inactive' }), null);
  assert.equal(
    mapWindyWebcam({ ...windyWebcam, location: { city: 'Nowhere' } }),
    null,
  );
  assert.equal(mapWindyWebcam({ ...windyWebcam, images: {} }), null);
  // Thumbnail fallback when no preview size is present.
  const thumb = mapWindyWebcam({
    ...windyWebcam,
    images: { current: { thumbnail: 'https://images.windy.com/t.jpg' } },
  });
  assert.equal(thumb.url, 'https://images.windy.com/t.jpg');
});

test('Windy fetch without a key makes no request and reports missing-key', async () => {
  let calls = 0;
  const result = await fetchWindyCameras({
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}');
    },
    key: '',
    areas: [{ name: 'Nowhere', lat: 0, lon: 0, radiusKm: 10 }],
  });
  assert.deepEqual(result, { cameras: [], status: 'missing-key' });
  assert.equal(calls, 0);
});

test('Windy fetch dedupes across areas and degrades per area', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, key: init.headers['X-WINDY-API-KEY'] });
    if (url.includes('10%2C20')) return new Response('', { status: 500 });
    return new Response(JSON.stringify({ total: 1, webcams: [windyWebcam] }));
  };
  const result = await fetchWindyCameras({
    fetchImpl,
    key: 'test-key',
    areas: [
      { name: 'Failing', lat: 10, lon: 20, radiusKm: 50 },
      { name: 'New York', lat: 40.7, lon: -74, radiusKm: 100 },
      { name: 'New York again', lat: 40.7, lon: -74, radiusKm: 100 },
    ],
    limit: 5,
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.cameras.length, 1);
  assert.equal(result.cameras[0].id, 'windy-1401795663');
  assert.ok(seen.every((call) => call.key === 'test-key'));
  assert.ok(seen[1].url.includes('nearby=40.7%2C-74%2C100'));
  assert.ok(seen[1].url.includes('include=images'));
  const allFail = await fetchWindyCameras({
    fetchImpl: async () => new Response('', { status: 500 }),
    key: 'test-key',
    areas: [{ name: 'Failing', lat: 10, lon: 20, radiusKm: 50 }],
  });
  assert.deepEqual(allFail, { cameras: [], status: 'error' });
});

test('catalog appends Windy cameras per page load with direct frame URLs', async () => {
  const source = createCctvSource({
    windyApiKey: 'test-key',
    windyAreas: [{ name: 'New York', lat: 40.7, lon: -74, radiusKm: 100 }],
    fetchImpl: async (url) => {
      if (String(url).startsWith('https://api.windy.com/'))
        return new Response(
          JSON.stringify({ total: 1, webcams: [windyWebcam] }),
        );
      return new Response(JSON.stringify({ sources: [] }));
    },
  });
  const catalog = await source.getCatalog();
  assert.equal(catalog.windyStatus, 'ok');
  assert.equal(catalog.windyCount, 1);
  assert.equal(catalog.sources.length, 1);
  assert.equal(catalog.sources[0].id, 'windy-1401795663');
  // Tokenised Windy URLs are remembered direct, so cards use them as-is.
  assert.match(
    source.getFrameUrl({ ...camera, id: 'windy-1401795663' }),
    /^https:\/\/images\.windy\.com\/preview\.jpg\?token=abc&cctvTs=\d+$/,
  );
});
