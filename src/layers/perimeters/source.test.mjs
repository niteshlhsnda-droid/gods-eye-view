import test from 'node:test';
import assert from 'node:assert/strict';
import { createWfigsPerimeterSource, WFIGS_QUERY_URL } from './source.js';
import { normalizeFirePerimeterSnapshot } from './records.js';
import {
  probeApiAvailable,
  resetStaticHostingProbe,
} from '../../sources/staticHosting.js';
import { firePerimetersProxy } from '../../../server/providers/firePerimeters.js';

const ring = [
  [-108.1, 35.2],
  [-108.0, 35.2],
  [-108.0, 35.3],
  [-108.1, 35.2],
];
const validPayload = {
  features: [
    {
      id: 1,
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { attr_UniqueFireIdentifier: '2026-NMGNF-000123' },
    },
  ],
};

test('a successful response yields normalized perimeter rows', async () => {
  let requested;
  const source = createWfigsPerimeterSource({
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json({
        rows: normalizeFirePerimeterSnapshot(validPayload),
      });
    },
  });
  const rows = await source.getSnapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stableId, '2026-NMGNF-000123');
  assert.equal(requested, '/api/fire-perimeters');
});

test('a truncated response pages until the feed is complete', async () => {
  const pageRing = (id) => ({
    id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { attr_UniqueFireIdentifier: `fire-${id}` },
  });
  const requests = [];
  let handler;
  const plugin = firePerimetersProxy({
    fetchImpl: async (url) => {
      requests.push(new URL(String(url)).searchParams.get('resultOffset'));
      const page = requests.length;
      return Response.json({
        features: [pageRing(page)],
        properties: { exceededTransferLimit: page < 3 },
      });
    },
  });
  plugin.configureServer({
    middlewares: {
      use: (_path, callback) => {
        handler = callback;
      },
    },
  });
  let payload;
  await handler(
    { url: '/', method: 'GET' },
    {
      writeHead(status) {
        assert.equal(status, 200);
      },
      end(body) {
        payload = JSON.parse(body);
      },
    },
  );
  const rows = payload.rows;
  assert.deepEqual(
    rows.map((row) => row.stableId),
    ['fire-1', 'fire-2', 'fire-3'],
  );
  assert.deepEqual(requests, [null, '1', '2']);
});

test('an upstream failure surfaces its HTTP status', async () => {
  const source = createWfigsPerimeterSource({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(source.getSnapshot(), /WFIGS HTTP 503/);
});

test('a malformed successful response is never accepted as an empty snapshot', async () => {
  for (const payload of [{}, { rows: null }, { rows: {} }]) {
    const source = createWfigsPerimeterSource({
      fetchImpl: async () => Response.json(payload),
    });
    await assert.rejects(source.getSnapshot(), /Malformed perimeter snapshot/);
  }
});

test('response-body completion honors cancellation without replacing records', async () => {
  const abort = new AbortController();
  const source = createWfigsPerimeterSource({
    fetchImpl: async () => ({
      ok: true,
      headers: new Headers(),
      text: async () => {
        abort.abort();
        return JSON.stringify({
          rows: normalizeFirePerimeterSnapshot(validPayload),
        });
      },
    }),
  });
  await assert.rejects(source.getSnapshot({ signal: abort.signal }), {
    name: 'AbortError',
  });
});

test('static hosting queries WFIGS directly and pages on exceededTransferLimit', async () => {
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const requests = [];
    const source = createWfigsPerimeterSource({
      fetchImpl: async (url) => {
        const parsed = new URL(String(url));
        requests.push(parsed);
        const page = requests.length;
        return Response.json({
          type: 'FeatureCollection',
          properties: { exceededTransferLimit: page < 2 },
          features: [
            {
              id: page,
              geometry: { type: 'Polygon', coordinates: [ring] },
              properties: {
                attr_UniqueFireIdentifier: `fire-${page}`,
                poly_IncidentName: `Fire ${page}`,
              },
            },
          ],
        });
      },
    });
    const rows = await source.getSnapshot();
    assert.deepEqual(
      rows.map((row) => row.stableId),
      ['fire-1', 'fire-2'],
    );
    assert.equal(rows[0].name, 'Fire 1');
    assert.ok(
      requests.every((url) => url.href.startsWith(WFIGS_QUERY_URL)),
      'must query WFIGS directly, never the /api proxy',
    );
    assert.deepEqual(
      requests.map((url) => url.searchParams.get('resultOffset')),
      ['0', '1000'],
    );
    const params = requests[0].searchParams;
    assert.equal(params.get('f'), 'geojson');
    assert.equal(params.get('outSR'), '4326');
    assert.equal(params.get('where'), '1=1');
    assert.match(params.get('outFields'), /poly_IncidentName/);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static WFIGS snapshot is cached for five minutes', async () => {
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    let fetches = 0;
    const feature = {
      id: 1,
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { attr_UniqueFireIdentifier: 'fire-1' },
    };
    const source = createWfigsPerimeterSource({
      fetchImpl: async () => {
        fetches += 1;
        return Response.json({
          type: 'FeatureCollection',
          features: [feature],
        });
      },
    });
    const first = await source.getSnapshot();
    const second = await source.getSnapshot();
    assert.equal(fetches, 1, 'second refresh inside the TTL must not refetch');
    assert.equal(first, second);
    assert.equal(first.length, 1);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static malformed WFIGS responses are rejected, never empty snapshots', async () => {
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    for (const payload of [{}, { features: null }, { features: {} }]) {
      const source = createWfigsPerimeterSource({
        fetchImpl: async () => Response.json(payload),
      });
      await assert.rejects(source.getSnapshot(), /Malformed WFIGS response/);
    }
  } finally {
    resetStaticHostingProbe();
  }
});

test('static WFIGS HTTP failures surface their status', async () => {
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    const source = createWfigsPerimeterSource({
      fetchImpl: async () => ({ ok: false, status: 503 }),
    });
    await assert.rejects(source.getSnapshot(), /WFIGS HTTP 503/);
  } finally {
    resetStaticHostingProbe();
  }
});

test('desktop proxy path is unchanged when not on static hosting', async () => {
  resetStaticHostingProbe();
  try {
    let requested;
    const source = createWfigsPerimeterSource({
      fetchImpl: async (url) => {
        requested = String(url);
        return Response.json({
          rows: normalizeFirePerimeterSnapshot(validPayload),
        });
      },
    });
    const rows = await source.getSnapshot();
    assert.equal(requested, '/api/fire-perimeters');
    assert.equal(rows.length, 1);
  } finally {
    resetStaticHostingProbe();
  }
});
