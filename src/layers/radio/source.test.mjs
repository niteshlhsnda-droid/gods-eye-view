import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadioSource, createRadioLayer } from './index.js';

const id = '00000000-0000-4000-8000-000000000001';

test('radio source confines directory and click requests to their existing routes', async () => {
  const calls = [];
  const body = { stations: [], stale: false };
  const source = createRadioSource({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return new Response(JSON.stringify(body));
    },
  });
  const controller = new AbortController();
  assert.deepEqual(
    await source.getDirectory({ signal: controller.signal }),
    body,
  );
  await source.recordClick(id, { signal: controller.signal });
  assert.deepEqual(
    calls.map((call) => call.path),
    ['/api/radio/stations', `/api/radio/click/${id}`],
  );
  assert.equal(calls[1].options.method, 'POST');
  assert.ok(calls.every((call) => call.options.signal === controller.signal));
  for (const invalid of [
    '../stations',
    'https://example.com',
    '',
    null,
    `${id}?x=1`,
  ])
    await assert.rejects(
      source.recordClick(invalid),
      /Invalid radio station id/,
    );
  assert.equal(calls.length, 2);
});

test('radio source propagates denial and cancels completed body parsing', async () => {
  const denied = createRadioSource({
    fetchImpl: async () => new Response('', { status: 403 }),
  });
  await assert.rejects(denied.getDirectory(), /403/);
  await assert.rejects(denied.recordClick(id), /403/);
  const controller = new AbortController();
  const source = createRadioSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        controller.abort();
        return { stations: [] };
      },
    }),
  });
  await assert.rejects(source.getDirectory({ signal: controller.signal }), {
    name: 'AbortError',
  });
  let called = false;
  const idle = createRadioSource({
    fetchImpl: async () => {
      called = true;
    },
  });
  await assert.rejects(idle.recordClick(id, { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(called, false);
});

test('radio factories keep settings and subscriptions independent without fetching or audio startup', () => {
  let requested = false;
  const source = {
    getDirectory() {
      requested = true;
    },
    recordClick() {
      requested = true;
    },
  };
  const services = {
    ground: {},
    picking: { unregisterPickOwner() {} },
    globe: {},
    render: { governorRequestRender() {} },
    overlays: {
      clearOverlaySource() {},
      setOverlaySourceVisible() {},
      setOverlayEntries() {},
    },
  };
  const first = createRadioLayer({ source, services });
  const second = createRadioLayer({ source, services });
  let changes = 0;
  const off = second.subscribeToRadio(() => changes++);
  const initialChanges = changes;
  first.setRadioParams({ volume: 0.3 });
  assert.equal(first.getRadioParams().volume, 0.3);
  assert.equal(second.getRadioParams().volume, 0.8);
  assert.equal(changes, initialChanges);
  assert.equal(requested, false);
  off();
  first.destroy();
  assert.equal(second.getRadioParams().volume, 0.8);
  second.destroy();
});

/* Static-hosting direct Radio Browser path (gap-fix). */

import {
  isStaticHosting,
  probeApiAvailable,
  resetStaticHostingProbe,
} from '../../sources/staticHosting.js';
import {
  RADIO_BROWSER_CATALOG_INSTANCE,
  RADIO_BROWSER_CATEGORY_TAGS,
  RADIO_BROWSER_DIRECTORY_LIMIT,
  RADIO_BROWSER_FALLBACK_BASE,
  RADIO_BROWSER_SERVERS_URL,
  RADIO_BROWSER_TAG_LIMIT,
  RADIO_DIRECTORY_ATTRIBUTION,
} from './policy.js';

const validStationRow = (overrides = {}) => ({
  stationuuid: '11111111-1111-4111-8111-111111111111',
  name: 'Test FM Patna',
  url: 'http://example.test/stream.mp3',
  url_resolved: 'https://example.test/stream.mp3',
  homepage: 'https://example.test/',
  tags: 'news,talk',
  country: 'India',
  countrycode: 'IN',
  state: 'Bihar',
  language: 'hindi',
  votes: 10,
  codec: 'MP3',
  bitrate: 128,
  lastcheckok: 1,
  hls: 0,
  clickcount: 42,
  geo_lat: 25.5941,
  geo_long: 85.1356,
  ...overrides,
});

/** Become "static hosting" for the duration of one test. */
async function asStaticHosting() {
  resetStaticHostingProbe();
  const available = await probeApiAvailable({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(available, false);
  assert.equal(isStaticHosting(), true);
}

function radioBrowserFetchImpl({ broadRows, tagRows = [], servers } = {}) {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (url === RADIO_BROWSER_SERVERS_URL)
        return { ok: true, json: async () => servers };
      const parsed = new URL(url);
      if (parsed.pathname === '/json/stations/search')
        return { ok: true, json: async () => broadRows };
      if (parsed.pathname.startsWith('/json/stations/bytag/'))
        return { ok: true, json: async () => tagRows };
      return { ok: false, status: 404 };
    } finally {
      active -= 1;
    }
  };
  return { fetchImpl, calls, maxActive: () => maxActive };
}

test('static radio directory bootstraps the server list and queries directly', async () => {
  await asStaticHosting();
  try {
    const servers = [{ name: 'de1.api.radio-browser.info' }];
    const broadRows = [
      validStationRow(),
      validStationRow({
        stationuuid: '22222222-2222-4222-8222-222222222222',
        name: 'Broken stream station',
        url_resolved: 'http://example.test/broken.mp3',
      }),
      { stationuuid: 'not-a-uuid', name: 'Malformed row' },
    ];
    const tagRows = [
      validStationRow({
        stationuuid: '33333333-3333-4333-8333-333333333333',
        name: 'News tag station',
      }),
      validStationRow(),
    ];
    const { fetchImpl, calls, maxActive } = radioBrowserFetchImpl({
      broadRows,
      tagRows,
      servers,
    });
    const source = createRadioSource({ fetchImpl });
    const before = Date.now();
    const body = await source.getDirectory();
    // Malformed + non-HTTPS rows dropped, duplicate id deduped.
    assert.deepEqual(
      body.stations.map((station) => station.id),
      [
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
      ],
    );
    for (const station of body.stations) {
      assert.ok(station.streamUrl.startsWith('https://'));
      assert.ok(Number.isFinite(station.lat));
      assert.ok(Number.isFinite(station.lon));
    }
    // Strict ingestion body shape.
    assert.equal(typeof body.updatedAt, 'string');
    assert.ok(Number.isFinite(Date.parse(body.updatedAt)));
    assert.ok(Date.parse(body.updatedAt) >= before - 60_000);
    assert.equal(body.stale, false);
    assert.equal(body.degraded, false);
    assert.equal(body.acceptedGeneration, 1);
    assert.equal(body.catalogInstance, RADIO_BROWSER_CATALOG_INSTANCE);
    // Bootstrap + broad + one query per category tag, bounded concurrency.
    assert.equal(calls[0].url, RADIO_BROWSER_SERVERS_URL);
    const searchCalls = calls.filter((call) =>
      new URL(call.url).pathname.startsWith('/json/stations/'),
    );
    assert.equal(searchCalls.length, 1 + RADIO_BROWSER_CATEGORY_TAGS.length);
    const broadCall = new URL(searchCalls[0].url);
    assert.equal(
      broadCall.searchParams.get('limit'),
      String(RADIO_BROWSER_DIRECTORY_LIMIT),
    );
    assert.equal(broadCall.searchParams.get('has_geo_info'), 'true');
    assert.equal(broadCall.searchParams.get('is_https'), 'true');
    for (const tag of RADIO_BROWSER_CATEGORY_TAGS) {
      const tagCall = calls.find((call) =>
        new URL(call.url).pathname.endsWith(`/bytag/${tag}`),
      );
      assert.ok(tagCall, `tag query for ${tag}`);
      assert.equal(
        new URL(tagCall.url).searchParams.get('limit'),
        String(RADIO_BROWSER_TAG_LIMIT),
      );
    }
    assert.ok(
      maxActive() <= 3,
      `directory queries bounded to 3 concurrent (saw ${maxActive()})`,
    );
    assert.ok(
      calls
        .filter((call) => call.url !== RADIO_BROWSER_SERVERS_URL)
        .every((call) =>
          call.url.startsWith('https://de1.api.radio-browser.info'),
        ),
      'queries go to the bootstrapped server',
    );
  } finally {
    resetStaticHostingProbe();
  }
});

test('static radio directory falls back to de1 when the bootstrap fails', async () => {
  await asStaticHosting();
  try {
    const calls = [];
    const source = createRadioSource({
      fetchImpl: async (url) => {
        calls.push(url);
        if (url === RADIO_BROWSER_SERVERS_URL)
          throw new TypeError('bootstrap unreachable');
        return { ok: true, json: async () => [validStationRow()] };
      },
    });
    const body = await source.getDirectory();
    assert.equal(body.stations.length, 1);
    assert.ok(
      calls.every(
        (call) =>
          call === RADIO_BROWSER_SERVERS_URL ||
          call.startsWith(`${RADIO_BROWSER_FALLBACK_BASE}/json/`),
      ),
      'all directory queries use the fallback base',
    );
    assert.ok(
      !calls.some(
        (call) =>
          typeof call === 'string' &&
          call.includes('de.radio-browser.info/json'),
      ),
      'never uses de.radio-browser.info',
    );
  } finally {
    resetStaticHostingProbe();
  }
});

test('static radio directory marks degraded when tag queries fail', async () => {
  await asStaticHosting();
  try {
    const source = createRadioSource({
      fetchImpl: async (url) => {
        if (url === RADIO_BROWSER_SERVERS_URL)
          return {
            ok: true,
            json: async () => [{ name: 'de1.api.radio-browser.info' }],
          };
        const parsed = new URL(url);
        if (parsed.pathname === '/json/stations/search')
          return { ok: true, json: async () => [validStationRow()] };
        return { ok: false, status: 500 };
      },
    });
    const body = await source.getDirectory();
    assert.equal(body.stations.length, 1);
    assert.equal(body.degraded, true);
    assert.equal(body.stale, false);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static radio directory errors when no station is usable', async () => {
  await asStaticHosting();
  try {
    const source = createRadioSource({
      fetchImpl: async (url) => {
        if (url === RADIO_BROWSER_SERVERS_URL)
          return {
            ok: true,
            json: async () => [{ name: 'de1.api.radio-browser.info' }],
          };
        return { ok: true, json: async () => [{ stationuuid: 'junk' }] };
      },
    });
    await assert.rejects(source.getDirectory(), /no usable stations/);
  } finally {
    resetStaticHostingProbe();
  }
});

test('recordClick is a static no-op that still validates ids', async () => {
  await asStaticHosting();
  try {
    let calls = 0;
    const source = createRadioSource({
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, json: async () => ({}) };
      },
    });
    await source.recordClick(id);
    assert.equal(calls, 0);
    await assert.rejects(
      source.recordClick('junk'),
      /Invalid radio station id/,
    );
  } finally {
    resetStaticHostingProbe();
  }
});

test('radio directory attribution constant', () => {
  assert.equal(
    RADIO_DIRECTORY_ATTRIBUTION,
    'Station data by radio-browser.info',
  );
});
