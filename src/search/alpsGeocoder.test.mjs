// src/search/alpsGeocoder.test.mjs
// Tests-only pins for createAlpsGeocoder (src/search/alpsGeocoder.js).
// No production code is changed. Pins capture current behaviour, including
// surprising-but-current coercions (String(query) matching, array/object
// queries) and the bbox-centre/containment rules for bundled geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlpsGeocoder } from './alpsGeocoder.js';

const UNAVAILABLE = 'Bundled Alps geometry unavailable';

const rectangle = () => ({
  name: 'Alps',
  kind: 'natural',
  polygons: [
    [
      [5, 45],
      [15, 45],
      [15, 50],
      [5, 50],
    ],
  ],
});

const withRegion = (region) =>
  createAlpsGeocoder({ lookupRegion: async () => region });

test('non-Alps names pass through without consulting the lookup', async () => {
  let calls = 0;
  const geocoder = createAlpsGeocoder({
    lookupRegion: async () => {
      calls += 1;
      return rectangle();
    },
  });
  for (const query of [
    'Paris',
    'Alps, Europe',
    'Alp',
    'Alpss',
    'My Alps',
    'Alps National Park',
    'Southern Alps',
    'Australian Alps',
  ]) {
    assert.deepEqual(await geocoder.geocode(query), {
      place: null,
      answered: true,
    });
  }
  assert.equal(calls, 0);
});

test('singular "Alps Mountain" does not match — the suffix must be "mountains"', async () => {
  let calls = 0;
  const geocoder = createAlpsGeocoder({
    lookupRegion: async () => {
      calls += 1;
      return rectangle();
    },
  });
  assert.deepEqual(await geocoder.geocode('Alps Mountain'), {
    place: null,
    answered: true,
  });
  assert.deepEqual(await geocoder.geocode('The Alps Mountain'), {
    place: null,
    answered: true,
  });
  assert.equal(calls, 0);
});

test('empty, blank, nullish and non-string queries pass through', async () => {
  let calls = 0;
  const geocoder = createAlpsGeocoder({
    lookupRegion: async () => {
      calls += 1;
      return rectangle();
    },
  });
  for (const query of ['', '   ', null, undefined, 123, false]) {
    assert.deepEqual(await geocoder.geocode(query), {
      place: null,
      answered: true,
    });
  }
  assert.equal(calls, 0);
});

test('article + suffix combinations all match, case-insensitively', async () => {
  for (const query of [
    'Alps',
    'The Alps',
    'Alps Mountains',
    'The Alps Mountains',
    'THE ALPS',
    'alps mountains',
    'the alps',
    'tHe AlPs MoUnTaInS',
  ]) {
    const { place, answered } = await withRegion(rectangle()).geocode(query);
    assert.equal(answered, true);
    assert.equal(place.name, 'Alps');
  }
});

test('surrounding and internal whitespace collapses before matching', async () => {
  for (const query of [
    '  Alps  ',
    'The\tAlps\nMountains',
    'The   Alps   Mountains',
    'Alps\u00A0Mountains',
    'Alps Mountains  ',
  ]) {
    const { place } = await withRegion(rectangle()).geocode(query);
    assert.equal(place.name, 'Alps');
  }
});

test('String(query) coercion: array and toString-object queries match', async () => {
  // Surprising-but-current: String(['Alps']) === 'Alps', so an array query
  // resolves exactly like the string query. Pinned, not endorsed.
  const fromArray = await withRegion(rectangle()).geocode(['Alps']);
  assert.equal(fromArray.place.name, 'Alps');
  const fromObject = await withRegion(rectangle()).geocode({
    toString: () => 'Alps',
  });
  assert.equal(fromObject.place.name, 'Alps');
});

test('rectangle resolves to the bbox-centre centroid with the full place shape', async () => {
  const result = await withRegion(rectangle()).geocode('Alps');
  assert.deepEqual(result, {
    answered: true,
    place: {
      lat: 47.5,
      lng: 10,
      name: 'Alps',
      label: 'Alps',
      types: ['natural_feature'],
      exact: true,
      viewport: {
        southwest: { lat: 45, lng: 5 },
        northeast: { lat: 50, lng: 15 },
      },
    },
  });
});

test('lookup is called exactly once, always with "Alps"', async () => {
  const seen = [];
  const geocoder = createAlpsGeocoder({
    lookupRegion: async (query) => {
      seen.push(query);
      return rectangle();
    },
  });
  await geocoder.geocode('The Alps Mountains');
  assert.deepEqual(seen, ['Alps']);
});

test('open triangle resolves; the centre is the bbox centre, not the vertex average', async () => {
  const triangle = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [0, 0],
        [10, 0],
        [5, 10],
      ],
    ],
  };
  const { place } = await withRegion(triangle).geocode('Alps');
  // Bbox centre (5, 5) — the vertex average would be (5, 10/3).
  assert.equal(place.lat, 5);
  assert.equal(place.lng, 5);
  assert.deepEqual(place.viewport, {
    southwest: { lat: 0, lng: 0 },
    northeast: { lat: 10, lng: 10 },
  });
});

test('closed rings resolve identically to open rings', async () => {
  const closed = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [5, 45],
        [15, 45],
        [15, 50],
        [5, 50],
        [5, 45],
      ],
    ],
  };
  const result = await withRegion(closed).geocode('Alps');
  assert.equal(result.place.lat, 47.5);
  assert.equal(result.place.lng, 10);
});

test('negative-longitude rings resolve with a negative centre longitude', async () => {
  const region = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [-10, 40],
        [-5, 40],
        [-5, 45],
        [-10, 45],
      ],
    ],
  };
  const { place } = await withRegion(region).geocode('Alps');
  assert.equal(place.lat, 42.5);
  assert.equal(place.lng, -7.5);
  assert.deepEqual(place.viewport, {
    southwest: { lat: 40, lng: -10 },
    northeast: { lat: 45, lng: -5 },
  });
});

test('extreme valid bounds ±180/±90 resolve', async () => {
  const world = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [-180, -90],
        [180, -90],
        [180, 90],
        [-180, 90],
      ],
    ],
  };
  const { place } = await withRegion(world).geocode('Alps');
  assert.equal(place.lat, 0);
  assert.equal(place.lng, 0);
  assert.deepEqual(place.viewport, {
    southwest: { lat: -90, lng: -180 },
    northeast: { lat: 90, lng: 180 },
  });
});

test('latitude exactly 90 is accepted', async () => {
  const region = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [-10, 80],
        [10, 80],
        [10, 90],
        [-10, 90],
      ],
    ],
  };
  const { place } = await withRegion(region).geocode('Alps');
  assert.equal(place.lat, 85);
  assert.equal(place.lng, 0);
});

test('nested inner ring: bbox spans the outer ring and the centre must lie in one ring', async () => {
  const region = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [0, 0],
        [20, 0],
        [20, 10],
        [0, 10],
      ],
      [
        [5, 2],
        [8, 2],
        [8, 5],
        [5, 5],
      ],
    ],
  };
  const { place } = await withRegion(region).geocode('Alps');
  assert.equal(place.lat, 5);
  assert.equal(place.lng, 10);
  assert.deepEqual(place.viewport, {
    southwest: { lat: 0, lng: 0 },
    northeast: { lat: 10, lng: 20 },
  });
});

test('extra region fields are ignored', async () => {
  const region = {
    ...rectangle(),
    areaKm2: 999,
    featurecla: 'Range/mtn',
    bboxDiagonalKm: 1,
  };
  const { place } = await withRegion(region).geocode('Alps');
  assert.equal(place.name, 'Alps');
  assert.equal(place.lat, 47.5);
});

test('default bundled lookup resolves the real Alps pack entry', async () => {
  const result = await createAlpsGeocoder().geocode('Alps');
  assert.deepEqual(result, {
    answered: true,
    place: {
      lat: 45.9105,
      lng: 10.67,
      name: 'Alps',
      label: 'Alps',
      types: ['natural_feature'],
      exact: true,
      viewport: {
        southwest: { lat: 43.666, lng: 5.157 },
        northeast: { lat: 48.155, lng: 16.183 },
      },
    },
  });
});

test('explicit lookupRegion: undefined falls back to the default bundled lookup', async () => {
  const result = await createAlpsGeocoder({ lookupRegion: undefined }).geocode(
    'Alps',
  );
  assert.equal(result.place.lat, 45.9105);
  assert.equal(result.place.lng, 10.67);
});

test('geocode works with no options argument and with an empty options object', async () => {
  assert.equal(
    (await withRegion(rectangle()).geocode('Alps')).place.name,
    'Alps',
  );
  assert.equal(
    (await withRegion(rectangle()).geocode('Alps', {})).place.name,
    'Alps',
  );
  assert.equal(
    (await withRegion(rectangle()).geocode('Alps', { signal: undefined })).place
      .name,
    'Alps',
  );
});

test('null or undefined region throws the bundled-geometry error', async () => {
  await assert.rejects(withRegion(null).geocode('Alps'), {
    message: UNAVAILABLE,
  });
  await assert.rejects(withRegion(undefined).geocode('Alps'), {
    message: UNAVAILABLE,
  });
});

test('wrong region name throws, including case-only differences', async () => {
  await assert.rejects(
    withRegion({ ...rectangle(), name: 'alps' }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  await assert.rejects(
    withRegion({ ...rectangle(), name: 'European Alps' }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  await assert.rejects(
    withRegion({ ...rectangle(), name: '' }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
});

test('wrong or missing kind throws', async () => {
  await assert.rejects(
    withRegion({ ...rectangle(), kind: 'marine' }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  const { kind, ...withoutKind } = rectangle();
  assert.equal(kind, 'natural');
  await assert.rejects(withRegion(withoutKind).geocode('Alps'), {
    message: UNAVAILABLE,
  });
});

test('missing, non-array or empty polygons throw', async () => {
  const { polygons, ...withoutPolygons } = rectangle();
  assert.ok(Array.isArray(polygons));
  await assert.rejects(withRegion(withoutPolygons).geocode('Alps'), {
    message: UNAVAILABLE,
  });
  await assert.rejects(
    withRegion({ ...rectangle(), polygons: 'nope' }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  await assert.rejects(
    withRegion({ ...rectangle(), polygons: [] }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
});

test('degenerate rings throw: fewer than 3 points, empty ring, null ring', async () => {
  const base = { name: 'Alps', kind: 'natural' };
  await assert.rejects(
    withRegion({
      ...base,
      polygons: [
        [
          [5, 45],
          [15, 45],
        ],
      ],
    }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  await assert.rejects(
    withRegion({ ...base, polygons: [[]] }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  await assert.rejects(
    withRegion({ ...base, polygons: [null] }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  await assert.rejects(
    withRegion({ ...base, polygons: ['ring'] }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
});

test('malformed points throw: wrong arity, null, non-array', async () => {
  const base = { name: 'Alps', kind: 'natural' };
  const badPolygons = [
    [
      [
        [5, 45, 0],
        [15, 45, 0],
        [15, 50, 0],
      ],
    ],
    [[[5], [15, 45], [15, 50]]],
    [[null, [15, 45], [15, 50]]],
    [[42, [15, 45], [15, 50]]],
  ];
  for (const polygons of badPolygons) {
    await assert.rejects(withRegion({ ...base, polygons }).geocode('Alps'), {
      message: UNAVAILABLE,
    });
  }
});

test('non-finite coordinates throw: NaN and Infinity', async () => {
  const base = { name: 'Alps', kind: 'natural' };
  await assert.rejects(
    withRegion({
      ...base,
      polygons: [
        [
          [Number.NaN, 45],
          [15, 45],
          [15, 50],
        ],
      ],
    }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  await assert.rejects(
    withRegion({
      ...base,
      polygons: [
        [
          [Infinity, 45],
          [15, 45],
          [15, 50],
        ],
      ],
    }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
  await assert.rejects(
    withRegion({
      ...base,
      polygons: [
        [
          [5, -Infinity],
          [15, 45],
          [15, 50],
        ],
      ],
    }).geocode('Alps'),
    { message: UNAVAILABLE },
  );
});

test('out-of-range coordinates throw just past the ±180/±90 limits', async () => {
  const base = { name: 'Alps', kind: 'natural' };
  const badPolygons = [
    [
      [
        [180.0001, 45],
        [15, 45],
        [15, 50],
      ],
    ],
    [
      [
        [-181, 45],
        [15, 45],
        [15, 50],
      ],
    ],
    [
      [
        [5, 90.0001],
        [15, 45],
        [15, 50],
      ],
    ],
    [
      [
        [5, -91],
        [15, 45],
        [15, 50],
      ],
    ],
    [
      [
        [500, 45],
        [15, 45],
        [15, 50],
      ],
    ],
  ];
  for (const polygons of badPolygons) {
    await assert.rejects(withRegion({ ...base, polygons }).geocode('Alps'), {
      message: UNAVAILABLE,
    });
  }
});

test('non-numeric coordinates are not coerced: strings, booleans and null throw', async () => {
  const base = { name: 'Alps', kind: 'natural' };
  const badPolygons = [
    [
      [
        ['5', '45'],
        ['15', '45'],
        ['15', '50'],
      ],
    ],
    [
      [
        [true, 45],
        [15, 45],
        [15, 50],
      ],
    ],
    [
      [
        [null, 45],
        [15, 45],
        [15, 50],
      ],
    ],
    [
      [
        [undefined, 45],
        [15, 45],
        [15, 50],
      ],
    ],
  ];
  for (const polygons of badPolygons) {
    await assert.rejects(withRegion({ ...base, polygons }).geocode('Alps'), {
      message: UNAVAILABLE,
    });
  }
});

test('one invalid ring among valid rings throws the whole lookup', async () => {
  const region = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [5, 45],
        [15, 45],
        [15, 50],
        [5, 50],
      ],
      [
        [5, 45],
        [15, 45],
      ],
    ],
  };
  await assert.rejects(withRegion(region).geocode('Alps'), {
    message: UNAVAILABLE,
  });
});

test('zero-area ring throws via the containment check, not validation', async () => {
  // All points are in-range and finite, so validation passes; the bbox
  // centre of a zero-area ring is never inside it.
  const region = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [5, 45],
        [5, 45],
        [5, 45],
      ],
    ],
  };
  await assert.rejects(withRegion(region).geocode('Alps'), {
    message: UNAVAILABLE,
  });
});

test('bbox centre falling in the gap between disjoint rings throws', async () => {
  const region = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [20, 0],
        [30, 0],
        [30, 10],
        [20, 10],
      ],
    ],
  };
  await assert.rejects(withRegion(region).geocode('Alps'), {
    message: UNAVAILABLE,
  });
});

test('bbox centre exactly on a triangle edge throws (ray-cast boundary behaviour)', async () => {
  // Triangle (0,0)-(10,0)-(0,10): bbox centre (5,5) lies on the hypotenuse.
  const region = {
    name: 'Alps',
    kind: 'natural',
    polygons: [
      [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
    ],
  };
  await assert.rejects(withRegion(region).geocode('Alps'), {
    message: UNAVAILABLE,
  });
});

test('lookup rejections propagate unwrapped', async () => {
  const geocoder = createAlpsGeocoder({
    lookupRegion: async () => {
      throw new Error('boom');
    },
  });
  await assert.rejects(geocoder.geocode('Alps'), { message: 'boom' });
});

test('pre-aborted signal rejects with AbortError and never calls the lookup', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const geocoder = createAlpsGeocoder({
    lookupRegion: async () => {
      calls += 1;
      return rectangle();
    },
  });
  await assert.rejects(
    geocoder.geocode('Alps', { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
});

test('abort during lookup rejects with AbortError even for valid geometry', async () => {
  const controller = new AbortController();
  const geocoder = createAlpsGeocoder({
    lookupRegion: async () => {
      controller.abort();
      return rectangle();
    },
  });
  await assert.rejects(
    geocoder.geocode('Alps', { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('unaborted signal does not disturb a successful lookup', async () => {
  const controller = new AbortController();
  const { place } = await withRegion(rectangle()).geocode('Alps', {
    signal: controller.signal,
  });
  assert.equal(place.name, 'Alps');
});

test('null lookup: passthrough still works, but a match throws TypeError', async () => {
  const geocoder = createAlpsGeocoder({ lookupRegion: null });
  assert.deepEqual(await geocoder.geocode('Paris'), {
    place: null,
    answered: true,
  });
  await assert.rejects(geocoder.geocode('Alps'), { name: 'TypeError' });
});
