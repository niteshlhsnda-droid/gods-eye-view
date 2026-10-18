// SEARCH HTTP PROVIDER — the Google-backed geospatial provider's normalize and
// transport layer. What matters here is that raw provider payloads never leak
// to callers, label text is sanitized and capped, a missing API key stops the
// request before it starts, and HTTP failures surface as one clear error.
//
// Run with: node --test src/search/http.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGoogleReverse,
  createHttpGeospatialProvider,
} from './http.js';

/** A fake fetch that records calls and answers from a handler. */
function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return { calls, fetchImpl };
}

const okJson = (data) => ({ ok: true, json: async () => data });

function searchParams(url) {
  return new URL(url, 'http://localhost').searchParams;
}

const mountainViewResult = () => ({
  formatted_address: '1600 Amphitheatre Parkway, Mountain View, CA 94043, USA',
  types: ['street_address'],
  address_components: [
    { long_name: '1600', types: ['street_number'] },
    { long_name: 'Amphitheatre Parkway', types: ['route'] },
    { long_name: 'Mountain View', types: ['locality', 'political'] },
    {
      long_name: 'Santa Clara County',
      types: ['administrative_area_level_2', 'political'],
    },
    {
      long_name: 'California',
      types: ['administrative_area_level_1', 'political'],
    },
    { long_name: 'United States', types: ['country', 'political'] },
  ],
});

const googleOk = (results = [mountainViewResult()]) => ({
  status: 'OK',
  results,
});

test('normalizeGoogleReverse returns null for missing or failed payloads', () => {
  for (const data of [
    null,
    undefined,
    {},
    { status: 'OK' },
    { status: 'OK', results: [] },
    { status: 'ZERO_RESULTS', results: [] },
    { status: 'REQUEST_DENIED', results: [mountainViewResult()] },
    { status: 'OVER_QUERY_LIMIT', results: [mountainViewResult()] },
  ]) {
    assert.equal(
      normalizeGoogleReverse(data),
      null,
      `must decline ${JSON.stringify(data?.status)}`,
    );
  }
});

test('normalizeGoogleReverse extracts the place fields from the first result', () => {
  assert.deepEqual(normalizeGoogleReverse(googleOk()), {
    formattedAddress: '1600 Amphitheatre Parkway, Mountain View, CA 94043, USA',
    locality: 'Mountain View',
    region: 'California',
    country: 'United States',
    types: ['street_address'],
    labels: ['1600 Amphitheatre Parkway, Mountain View, CA 94043, USA'],
    streetLabels: ['Amphitheatre Parkway'],
  });
});

test('normalizeGoogleReverse exposes only the sanitized shape, never raw objects', () => {
  const normalized = normalizeGoogleReverse(googleOk());
  assert.deepEqual(Object.keys(normalized).sort(), [
    'country',
    'formattedAddress',
    'labels',
    'locality',
    'region',
    'streetLabels',
    'types',
  ]);
});

test('normalizeGoogleReverse falls back through locality, postal_town, admin level 2', () => {
  const componentsFor = (names) =>
    googleOk([
      {
        formatted_address: 'Somewhere',
        types: [],
        address_components: names.map(([long_name, type]) => ({
          long_name,
          types: [type],
        })),
      },
    ]);
  assert.equal(
    normalizeGoogleReverse(componentsFor([['Reading', 'postal_town']]))
      .locality,
    'Reading',
    'postal_town fills a missing locality',
  );
  assert.equal(
    normalizeGoogleReverse(
      componentsFor([['Berkshire', 'administrative_area_level_2']]),
    ).locality,
    'Berkshire',
    'admin level 2 fills a missing locality and postal_town',
  );
  assert.equal(
    normalizeGoogleReverse(componentsFor([['Main St', 'route']])).locality,
    null,
    'no locality-like component means null, not a guess',
  );
});

test('normalizeGoogleReverse nulls missing scalar fields instead of echoing undefined', () => {
  const normalized = normalizeGoogleReverse(
    googleOk([{ types: ['plus_code'] }]),
  );
  assert.equal(normalized.formattedAddress, null);
  assert.equal(normalized.locality, null);
  assert.equal(normalized.region, null);
  assert.equal(normalized.country, null);
  assert.deepEqual(normalized.types, ['plus_code']);
  assert.deepEqual(normalized.labels, []);
  assert.deepEqual(normalized.streetLabels, []);
});

test('normalizeGoogleReverse defaults types to an empty list when the provider omits them', () => {
  const normalized = normalizeGoogleReverse(
    googleOk([{ formatted_address: 'Nowhere', address_components: [] }]),
  );
  assert.deepEqual(normalized.types, []);
});

test('normalizeGoogleReverse sanitizes labels: control chars, whitespace, length, dupes', () => {
  const normalized = normalizeGoogleReverse(
    googleOk([
      { formatted_address: '  Café\tMüller\nBerlin  ' },
      { formatted_address: 'Café Müller Berlin' },
      { formatted_address: 'NUL\x00here\x7fnow' },
      { formatted_address: '   ' },
      { formatted_address: `Long ${'x'.repeat(200)}` },
    ]),
  );
  assert.deepEqual(normalized.labels, [
    'Café Müller Berlin',
    'NUL here now',
    `Long ${'x'.repeat(115)}`,
  ]);
  assert.ok(
    normalized.labels.every((label) => label.length <= 120),
    'no label may exceed 120 characters',
  );
});

test('normalizeGoogleReverse reads at most the first 12 results for labels', () => {
  const results = Array.from({ length: 13 }, (_, i) => ({
    formatted_address: `Place ${i}`,
    address_components: [{ long_name: `Road ${i}`, types: ['route'] }],
  }));
  const normalized = normalizeGoogleReverse(googleOk(results));
  assert.equal(normalized.labels.length, 12);
  assert.equal(normalized.labels[11], 'Place 11');
  assert.ok(!normalized.labels.includes('Place 12'));
  assert.equal(normalized.streetLabels.length, 12);
  assert.ok(!normalized.streetLabels.includes('Road 12'));
});

test('normalizeGoogleReverse streetLabels only take route components, deduped', () => {
  const normalized = normalizeGoogleReverse(
    googleOk([
      {
        formatted_address: 'A',
        address_components: [
          { long_name: 'Main St', types: ['route'] },
          { long_name: 'Main St', types: ['route'] },
          { long_name: 'Springfield', types: ['locality'] },
        ],
      },
      {
        formatted_address: 'B',
        address_components: [{ long_name: 'Main St', types: ['route'] }],
      },
    ]),
  );
  assert.deepEqual(normalized.streetLabels, ['Main St']);
});

test('provider exposes attribution and route profiles', () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson(null));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  assert.deepEqual(provider.attribution, {
    reverseGeocode: 'Google',
    textSearch: 'Google',
    nearby: 'Google',
    route: 'OpenStreetMap / OSRM',
  });
  assert.deepEqual(provider.routeProfiles, ['foot', 'car', 'bike']);
  assert.equal(calls.length, 0, 'building a provider makes no request');
});

test('reverseGeocode hits the Google endpoint with latlng and no key by default', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson(googleOk()));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  const place = await provider.reverseGeocode(30.27, -97.74);
  assert.equal(calls.length, 1);
  assert.ok(
    calls[0].url.startsWith(
      'https://maps.googleapis.com/maps/api/geocode/json?',
    ),
  );
  const params = searchParams(calls[0].url);
  assert.equal(params.get('latlng'), '30.27,-97.74');
  assert.equal(params.get('key'), null);
  assert.equal(place.locality, 'Mountain View');
});

test('reverseGeocode attaches the key when resolveApiKey provides one', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson(googleOk()));
  const provider = createHttpGeospatialProvider({
    fetchImpl,
    resolveApiKey: () => 'KEY123',
  });
  await provider.reverseGeocode(30.27, -97.74);
  assert.equal(searchParams(calls[0].url).get('key'), 'KEY123');
});

test('reverseGeocode returns null without fetching when the key resolver is empty', async () => {
  for (const resolveApiKey of [() => '', () => undefined, () => null]) {
    const { calls, fetchImpl } = fakeFetch(() => okJson(googleOk()));
    const provider = createHttpGeospatialProvider({ fetchImpl, resolveApiKey });
    assert.equal(await provider.reverseGeocode(30.27, -97.74), null);
    assert.equal(calls.length, 0, 'no request may start without a key');
  }
});

test('reverseGeocode returns null for a non-OK provider status', async () => {
  const { fetchImpl } = fakeFetch(() =>
    okJson({ status: 'ZERO_RESULTS', results: [] }),
  );
  const provider = createHttpGeospatialProvider({ fetchImpl });
  assert.equal(await provider.reverseGeocode(30.27, -97.74), null);
});

test('reverseGeocode with a falsy endpoint override answers null without fetching', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson(googleOk()));
  const provider = createHttpGeospatialProvider({
    fetchImpl,
    endpoints: { reverse: '' },
  });
  assert.equal(await provider.reverseGeocode(30.27, -97.74), null);
  assert.equal(calls.length, 0);
});

test('query strings use & when the endpoint already carries a query', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson({ places: [] }));
  const provider = createHttpGeospatialProvider({
    fetchImpl,
    endpoints: { textSearch: '/api/x?token=abc' },
  });
  await provider.textSearch('coffee', { latitude: 30.27, longitude: -97.74 });
  assert.ok(calls[0].url.startsWith('/api/x?token=abc&'));

  const { calls: defaultCalls, fetchImpl: defaultFetch } = fakeFetch(() =>
    okJson({ places: [] }),
  );
  const plain = createHttpGeospatialProvider({ fetchImpl: defaultFetch });
  await plain.textSearch('coffee', { latitude: 30.27, longitude: -97.74 });
  assert.ok(defaultCalls[0].url.startsWith('/api/google/text-search?'));
});

test('endpoint overrides are honored for every operation', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson({ places: [] }));
  const provider = createHttpGeospatialProvider({
    fetchImpl,
    endpoints: {
      textSearch: 'https://example.com/search',
      nearby: 'https://example.com/nearby',
      route: 'https://example.com/route',
    },
  });
  await provider.textSearch('coffee', { latitude: 1, longitude: 2 });
  await provider.nearby({ latitude: 1, longitude: 2 });
  await provider.route(
    [
      [2, 1],
      [3, 4],
    ],
    'car',
  );
  assert.deepEqual(
    calls.map(({ url }) => new URL(url).origin + new URL(url).pathname),
    [
      'https://example.com/search',
      'https://example.com/nearby',
      'https://example.com/route',
    ],
  );
});

test('an HTTP failure surfaces as one clear error and cancels the body', async () => {
  const cancelled = [];
  const { fetchImpl } = fakeFetch(() => ({
    ok: false,
    body: { cancel: async () => cancelled.push(true) },
  }));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  await assert.rejects(
    provider.textSearch('coffee', { latitude: 1, longitude: 2 }),
    /Geospatial service unavailable/,
  );
  assert.equal(cancelled.length, 1);
});

test('an HTTP failure without a cancellable body still surfaces the same error', async () => {
  const { fetchImpl } = fakeFetch(() => ({ ok: false }));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  await assert.rejects(
    provider.reverseGeocode(1, 2),
    /Geospatial service unavailable/,
  );
});

test('textSearch sends q, lat, lon and the default 6000m radius', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson({ places: [] }));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  await provider.textSearch('coffee', { latitude: 30.27, longitude: -97.74 });
  const params = searchParams(calls[0].url);
  assert.equal(params.get('q'), 'coffee');
  assert.equal(params.get('lat'), '30.27');
  assert.equal(params.get('lon'), '-97.74');
  assert.equal(params.get('radiusM'), '6000');
});

test('textSearch honors an explicit radius', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson({ places: [] }));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  await provider.textSearch('coffee', {
    latitude: 30.27,
    longitude: -97.74,
    radiusM: 100,
  });
  assert.equal(searchParams(calls[0].url).get('radiusM'), '100');
});

test('nearby defaults to a 250m radius', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson({ places: [] }));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  await provider.nearby({ latitude: 30.27, longitude: -97.74 });
  const params = searchParams(calls[0].url);
  assert.ok(calls[0].url.startsWith('/api/google/nearby-places?'));
  assert.equal(params.get('radiusM'), '250');
});

test('textSearch keeps only places with valid coordinates, at most 20', async () => {
  const places = [
    { name: 'A', longitude: -97.74, latitude: 30.27 },
    { name: 'no-lat', longitude: -97.74 },
    { name: 'no-lon', latitude: 30.27 },
    { name: 'lon-too-far', longitude: 200, latitude: 30.27 },
    { name: 'lat-too-far', longitude: -97.74, latitude: 95 },
    { name: 'not-finite', longitude: NaN, latitude: 30.27 },
    ...Array.from({ length: 21 }, (_, i) => ({
      name: `V${i}`,
      longitude: -97.7 + i * 0.001,
      latitude: 30.27,
    })),
  ];
  const { fetchImpl } = fakeFetch(() => okJson({ places }));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  const found = await provider.textSearch('x', {
    latitude: 30.27,
    longitude: -97.74,
  });
  assert.equal(found.length, 20, 'valid places are capped at 20');
  assert.equal(found[0].name, 'A');
  for (const name of [
    'no-lat',
    'no-lon',
    'lon-too-far',
    'lat-too-far',
    'not-finite',
  ]) {
    assert.ok(
      !found.some((place) => place.name === name),
      `${name} must be filtered out`,
    );
  }
});

test('textSearch returns an empty list when the payload has no places array', async () => {
  const { fetchImpl } = fakeFetch(() => okJson({ results: [] }));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  assert.deepEqual(
    await provider.textSearch('x', { latitude: 1, longitude: 2 }),
    [],
  );
});

test('route formats coordinate pairs to six decimals joined by semicolons', async () => {
  const { calls, fetchImpl } = fakeFetch(() =>
    okJson({ ok: true, routes: ['r1'] }),
  );
  const provider = createHttpGeospatialProvider({ fetchImpl });
  const data = await provider.route(
    [
      [-97.7403, 30.2747],
      [-97.7951, 30.3451, 99],
    ],
    'car',
  );
  const params = searchParams(calls[0].url);
  assert.equal(params.get('profile'), 'car');
  assert.equal(
    params.get('coords'),
    '-97.740300,30.274700;-97.795100,30.345100',
  );
  assert.deepEqual(data, { ok: true, routes: ['r1'] });
});

test('route returns null when the router reports no route', async () => {
  for (const payload of [{ ok: false }, null]) {
    const { fetchImpl } = fakeFetch(() => okJson(payload));
    const provider = createHttpGeospatialProvider({ fetchImpl });
    assert.equal(
      await provider.route(
        [
          [2, 1],
          [3, 4],
        ],
        'foot',
      ),
      null,
    );
  }
});

test('an aborted signal rejects with an AbortError after the request starts', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson(googleOk()));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    provider.reverseGeocode(1, 2, { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(
    calls.length,
    1,
    'the abort is only checked after fetch resolves, so the request still fires',
  );
});

test('the abort signal is forwarded to fetch', async () => {
  const { calls, fetchImpl } = fakeFetch(() => okJson({ places: [] }));
  const provider = createHttpGeospatialProvider({ fetchImpl });
  const controller = new AbortController();
  await provider.nearby(
    { latitude: 1, longitude: 2 },
    { signal: controller.signal },
  );
  assert.equal(calls[0].options.signal, controller.signal);
});
