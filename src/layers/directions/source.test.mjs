import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectionsSource } from './source.js';

const query = { mode: 'foot', a: { lon: 1, lat: 2 }, b: { lon: 3, lat: 4 } };

test('route acquisition uses only the supplied transport and endpoint', async () => {
  const controller = new AbortController();
  const payload = { ok: true, geometry: [[1, 2], [3, 4]] };
  const calls = [];
  const source = createDirectionsSource({
    endpoint: 'https://routes.example/route',
    fetchImpl: async (...args) => { calls.push(args); return Response.json(payload); },
  });
  assert.deepEqual(await source.getRoute(query, { signal: controller.signal }), payload);
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(new URL(url).origin, 'https://routes.example');
  assert.equal(new URL(url).searchParams.get('coords'), '1.000000,2.000000;3.000000,4.000000');
  assert.equal(new URL(url).searchParams.get('profile'), 'foot');
  assert.equal(init.signal, controller.signal);
  assert.equal(init.headers.Accept, 'application/json');
});

test('aborting during route parsing discards the result', async () => {
  const controller = new AbortController();
  const source = createDirectionsSource({ fetchImpl: async () => ({
    ok: true, json: async () => { controller.abort(); return { ok: true }; },
  }) });
  await assert.rejects(source.getRoute(query, { signal: controller.signal }), { name: 'AbortError' });
});

test('route failures are surfaced without fallback requests', async () => {
  for (const status of [429, 503]) {
    let calls = 0;
    const source = createDirectionsSource({ fetchImpl: async () => {
      calls++;
      return Response.json({}, { status });
    } });
    await assert.rejects(source.getRoute(query), status === 429 ? /rate limited/ : /HTTP 503/);
    assert.equal(calls, 1);
  }
});

/* Static-hosting direct OSRM path (gap-fix). */

import {
  isStaticHosting,
  probeApiAvailable,
  resetStaticHostingProbe,
} from '../../sources/staticHosting.js';
import {
  OSRM_CLIENT_THROTTLE_MS,
  OSRM_DIRECT_BASE,
} from './source.js';
import { DIRECTIONS_OSRM_ATTRIBUTION } from './index.js';

/** Become "static hosting" for the duration of one test. */
async function asStaticHosting() {
  resetStaticHostingProbe();
  const available = await probeApiAvailable({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(available, false);
  assert.equal(isStaticHosting(), true);
}

const osrmOkBody = {
  code: 'Ok',
  routes: [
    {
      distance: 5869.5,
      duration: 370.9,
      geometry: {
        type: 'LineString',
        coordinates: [
          [1.0, 2.0],
          [1.5, 2.5],
          [3.0, 4.0],
        ],
      },
      legs: [
        {
          steps: [
            {
              maneuver: { type: 'depart', location: [1.0, 2.0] },
              name: 'Main St',
              distance: 100,
              duration: 60,
            },
            {
              maneuver: { type: 'arrive', location: [3.0, 4.0] },
              name: '',
              distance: 0,
              duration: 0,
            },
          ],
        },
      ],
    },
  ],
  waypoints: [],
};

test('static routing calls the FOSSGIS OSRM server and projects the payload', async () => {
  await asStaticHosting();
  try {
    const calls = [];
    const source = createDirectionsSource({
      routeThrottleMs: 1,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json(osrmOkBody);
      },
    });
    const payload = await source.getRoute(query);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname.split('/route/')[0], OSRM_DIRECT_BASE + '/routed-foot');
    assert.ok(
      calls[0].url.startsWith(
        `${OSRM_DIRECT_BASE}/routed-foot/route/v1/foot/1.000000,2.000000;3.000000,4.000000`,
      ),
      calls[0].url,
    );
    assert.equal(url.searchParams.get('overview'), 'full');
    assert.equal(url.searchParams.get('geometries'), 'geojson');
    assert.equal(url.searchParams.get('steps'), 'true');
    assert.equal(calls[0].init.headers.Accept, 'application/json');
    // Same shape the desktop proxy serves: ok + projected geometry + steps.
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.geometry, [
      [1.0, 2.0],
      [1.5, 2.5],
      [3.0, 4.0],
    ]);
    assert.equal(payload.distanceM, 5870);
    assert.equal(payload.durationS, 371);
    assert.ok(Array.isArray(payload.steps));
    assert.equal(payload.steps.length, 2);
    assert.ok(
      payload.steps.every(
        (step) =>
          typeof step.instruction === 'string' &&
          Number.isFinite(step.lat) &&
          Number.isFinite(step.lon),
      ),
    );
  } finally {
    resetStaticHostingProbe();
  }
});

test('static routing maps car to the OSRM driving profile', async () => {
  await asStaticHosting();
  try {
    const calls = [];
    const source = createDirectionsSource({
      routeThrottleMs: 1,
      fetchImpl: async (url) => {
        calls.push(url);
        return Response.json(osrmOkBody);
      },
    });
    await source.getRoute({ ...query, mode: 'car' });
    assert.ok(
      calls[0].startsWith(`${OSRM_DIRECT_BASE}/routed-car/route/v1/driving/`),
      calls[0],
    );
    await source.getRoute({ ...query, mode: 'bike' });
    assert.ok(
      calls[1].startsWith(`${OSRM_DIRECT_BASE}/routed-bike/route/v1/bike/`),
      calls[1],
    );
  } finally {
    resetStaticHostingProbe();
  }
});

test('static routing rejects unknown profiles', async () => {
  await asStaticHosting();
  try {
    const source = createDirectionsSource({
      fetchImpl: async () => Response.json(osrmOkBody),
    });
    await assert.rejects(
      source.getRoute({ ...query, mode: 'rocket' }),
      /Unsupported route profile/,
    );
  } finally {
    resetStaticHostingProbe();
  }
});

test('static routing reports busy on 429/504 and no-route honestly', async () => {
  await asStaticHosting();
  try {
    for (const status of [429, 504]) {
      const source = createDirectionsSource({
        routeThrottleMs: 1,
        fetchImpl: async () => new Response('{}', { status }),
      });
      await assert.rejects(source.getRoute(query), /Routing is busy/);
    }
    const noRoute = createDirectionsSource({
      routeThrottleMs: 1,
      fetchImpl: async () => Response.json({ code: 'NoRoute', routes: [] }),
    });
    assert.deepEqual(await noRoute.getRoute(query), {
      ok: false,
      error: 'no route found',
    });
    const malformed = createDirectionsSource({
      routeThrottleMs: 1,
      fetchImpl: async () => Response.json({ code: 'Ok' }),
    });
    assert.deepEqual(await malformed.getRoute(query), {
      ok: false,
      error: 'no route found',
    });
  } finally {
    resetStaticHostingProbe();
  }
});

test('static routing spaces requests by the client throttle', async () => {
  await asStaticHosting();
  try {
    const source = createDirectionsSource({
      routeThrottleMs: 60,
      fetchImpl: async () => Response.json(osrmOkBody),
    });
    const first = Date.now();
    await source.getRoute(query);
    await source.getRoute(query);
    const elapsed = Date.now() - first;
    assert.ok(elapsed >= 40, `expected >=40ms spacing, saw ${elapsed}ms`);
    assert.equal(OSRM_CLIENT_THROTTLE_MS, 1200);
  } finally {
    resetStaticHostingProbe();
  }
});

test('static routing failure without a response stays descriptive', async () => {
  await asStaticHosting();
  try {
    const source = createDirectionsSource({
      routeThrottleMs: 1,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await assert.rejects(source.getRoute(query), /no response from the routing service/);
  } finally {
    resetStaticHostingProbe();
  }
});

test('directions OSRM attribution constant', () => {
  assert.equal(
    DIRECTIONS_OSRM_ATTRIBUTION,
    'Routing by OSRM (FOSSGIS demo server)',
  );
});
