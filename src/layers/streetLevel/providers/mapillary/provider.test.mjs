import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapillaryProvider, nearestPosition } from './index.js';
import {
  freshestFirst,
  isLowQuality,
  mapillaryImageUrl,
  preferPano,
} from './policy.js';
import { sequenceIdFromPick } from './coverage.js';
import { normalizeSequenceImage, thinImages } from './sequences.js';
import { validateProviders } from '../../registry.js';
import { PROVIDER_COLORS } from '../../policy.js';
import { resolveFilter } from '../../filter.js';
import * as Cesium from 'cesium';
import { rayCamera } from '../../../../testSupport/streetLevelFakes.mjs';

function fakeSource({ nearest = [] } = {}) {
  return {
    hasToken: () => true,
    getStatus: async () => ({ configured: true }),
    getTile: async () => new Uint8Array(0),
    getSequenceImages: async () => [],
    nearestImages: async () => nearest,
  };
}

function fakeContext(filter = { pano: 'all', sinceMs: null }) {
  const opened = [];
  return {
    opened,
    services: {},
    getFilter: typeof filter === 'function' ? filter : () => filter,
    isActive: () => true,
    notify: () => {},
    actions: {
      openImage: (id) => {
        opened.push(id);
      },
      reportError: () => {},
    },
  };
}

test('the definition satisfies the Street Level provider contract', () => {
  const def = createMapillaryProvider({ source: fakeSource() });
  assert.doesNotThrow(() => validateProviders([def]));
  assert.equal(def.id, 'mapillary');
  assert.equal(def.label, 'MAPILLARY');
  assert.equal(def.requiresKeyId, 'mapillary');
  assert.equal(def.pickPrefix, 'mly:');
  assert.match(def.credit.html, /CC BY-SA 4\.0/);
  // One colour per source: Mapillary is green everywhere it draws.
  assert.deepEqual(Object.keys(def.colors).sort(), ['coverage', 'selected']);
  assert.equal(def.colors.coverage, PROVIDER_COLORS.mapillary);
  assert.equal(PROVIDER_COLORS.mapillary, '#05cb63');
  assert.throws(() => createMapillaryProvider({ source: {} }), /source/);
});

test('image deep links match the mapillary.com share format', () => {
  assert.equal(
    mapillaryImageUrl(1814275685699406),
    'https://www.mapillary.com/app/?pKey=1814275685699406&focus=photo',
  );
  assert.equal(mapillaryImageUrl('  '), 'https://www.mapillary.com/app/');
});

test('picks route sequences to selection and images to the core opener', () => {
  const context = fakeContext();
  const instance = createMapillaryProvider({ source: fakeSource() }).create(
    context,
  );
  assert.equal(instance.handlePick('mly:img:77'), true);
  assert.deepEqual(context.opened, ['77']);
  assert.equal(instance.handlePick('cctv:1'), false);
  assert.deepEqual(instance.sequenceStats(), {
    selectedId: null,
    images: 0,
    loading: false,
  });
});

test('nearestImage honours the imagery filter and reports key status', async () => {
  const nearest = [
    { id: 1, is_pano: false, captured_at: 10 },
    { id: 2, is_pano: true, captured_at: 20 },
  ];
  const source = fakeSource({ nearest });
  const flat = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await flat.nearestImage({ lat: 1, lon: 2 }), '1');
  const pano = createMapillaryProvider({ source }).create(
    fakeContext({ pano: 'pano', sinceMs: null }),
  );
  assert.equal(await pano.nearestImage({ lat: 1, lon: 2 }), '2');
  const none = createMapillaryProvider({ source }).create(
    fakeContext({ pano: 'all', sinceMs: 100 }),
  );
  assert.equal(await none.nearestImage({ lat: 1, lon: 2 }), null);
  assert.deepEqual(await flat.status(), { configured: true });
  assert.equal(flat.coverageStats().keyRequired, false);
});

test('any part of a multi-part sequence picks the whole sequence', () => {
  assert.equal(sequenceIdFromPick('mly:seq:abc'), 'abc');
  assert.equal(sequenceIdFromPick('mly:seq:abc~2'), 'abc');
  assert.equal(sequenceIdFromPick('mly:img:abc'), null);
  assert.equal(sequenceIdFromPick(null), null);
});

test('nearestImage picks the closest image, not the first the API returned', async () => {
  const at = (id, lon, lat) => ({
    id,
    is_pano: false,
    captured_at: 10,
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });
  const source = fakeSource({
    nearest: [
      at('far', 2.0004, 1), // ~45 m east
      at('near', 2.00005, 1), // ~5 m east
      at('mid', 2, 1.0002), // ~22 m north
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'near');
});

test('nearestPosition drops a claimed-but-unusable position, keeps the rest', () => {
  const at = (geometry, computed_geometry) => ({
    geometry,
    computed_geometry,
  });
  const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
  // No fix: [0, 0] is a missing position, not a photo in the Gulf of Guinea.
  assert.equal(nearestPosition(at(point(0, 0))), null);
  assert.equal(nearestPosition(at(undefined, point(0, 0))), null);
  // One zero is a real meridian/equator crossing; both zero is not.
  assert.deepEqual(nearestPosition(at(point(0, 51.5))), { lon: 0, lat: 51.5 });
  assert.deepEqual(nearestPosition(at(point(-0.12, 0))), {
    lon: -0.12,
    lat: 0,
  });
  // Out-of-range and non-numeric coordinates cannot stand on the globe.
  assert.equal(nearestPosition(at(point(200, 0))), null);
  assert.equal(nearestPosition(at(point(0, 91))), null);
  assert.equal(nearestPosition(at(point('abc', 0))), null);
  assert.equal(nearestPosition(at(point(NaN, 0))), null);
  assert.equal(nearestPosition(at(point(Infinity, 0))), null);
  // Boundary values still stand.
  assert.deepEqual(nearestPosition(at(point(180, 90))), { lon: 180, lat: 90 });
  assert.deepEqual(nearestPosition(at(point(-180, -90))), {
    lon: -180,
    lat: -90,
  });
  // No coordinates claimed at all: still eligible as a last resort.
  assert.equal(nearestPosition({}), undefined);
  assert.equal(nearestPosition({ geometry: {} }), undefined);
  // A bad computed position falls back to the real GPS fix, not a drop.
  assert.deepEqual(nearestPosition(at(point(2.0001, 1), point(0, 0))), {
    lon: 2.0001,
    lat: 1,
  });
  // A usable computed position wins over the raw fix.
  assert.deepEqual(nearestPosition(at(point(2.5, 1.5), point(2.0001, 1))), {
    lon: 2.0001,
    lat: 1,
  });
});

test('nearestImage never opens a no-fix placeholder, however close it measures', async () => {
  const at = (id, lon, lat) => ({
    id,
    is_pano: false,
    captured_at: 10,
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });
  // Clicked ~150 m from Null Island: the [0, 0] record would measure the
  // shortest distance of all, but it is a receiver with no fix.
  const source = fakeSource({
    nearest: [
      at('no-fix', 0, 0),
      at('real', 0.01, 0.01), // ~1.5 km away
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 0.001, lon: 0.001 }), 'real');
  assert.deepEqual(instance.nearestStats(), { droppedWithoutPosition: 1 });
});

test('nearestImage counts dropped records and keeps position-less ones eligible', async () => {
  const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
  const source = fakeSource({
    nearest: [
      { id: 'no-fix', is_pano: false, captured_at: 10, geometry: point(0, 0) },
      {
        id: 'out-of-range',
        is_pano: false,
        captured_at: 10,
        geometry: point(200, 0),
      },
      { id: 'no-coords', is_pano: false, captured_at: 10 },
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.deepEqual(instance.nearestStats(), { droppedWithoutPosition: 0 });
  // Nothing real to rank: the position-less record is still openable, and
  // only the two claimed-but-bad records count as dropped.
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'no-coords');
  assert.deepEqual(instance.nearestStats(), { droppedWithoutPosition: 2 });
  // The count accumulates across lookups.
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'no-coords');
  assert.deepEqual(instance.nearestStats(), { droppedWithoutPosition: 4 });
});

test('nearestImage prefers a pano a few steps away over the nearest flat shot', async () => {
  const at = (id, lon, isPano) => ({
    id,
    is_pano: isPano,
    captured_at: 10,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  // Flat ~5.6 m east, pano ~8.9 m east: inside twice the flat distance.
  const source = fakeSource({
    nearest: [at('flat', 2.00005, false), at('pano', 2.00008, true)],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'pano');
});

test('nearestImage keeps the flat shot when the pano is halfway down the street', async () => {
  const at = (id, lon, isPano) => ({
    id,
    is_pano: isPano,
    captured_at: 10,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  // Flat ~5.6 m east, pano ~22 m east: past twice the flat distance.
  const source = fakeSource({
    nearest: [at('flat', 2.00005, false), at('pano', 2.0002, true)],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'flat');
});

test('nearestImage pano preference never overrides a flat-only filter', async () => {
  const at = (id, lon, isPano) => ({
    id,
    is_pano: isPano,
    captured_at: 10,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  // The pano is nearer; with a flat-only filter it must not win.
  const source = fakeSource({
    nearest: [at('flat', 2.0002, false), at('pano', 2.00005, true)],
  });
  const instance = createMapillaryProvider({ source }).create(
    fakeContext({ pano: 'flat', sinceMs: null }),
  );
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'flat');
});

test('nearestImage pano preference needs a real position on both sides', async () => {
  // The pano has no position (last-resort only); the placed flat wins.
  const source = fakeSource({
    nearest: [
      { id: 'pano', is_pano: true, captured_at: 10 },
      {
        id: 'flat',
        is_pano: false,
        captured_at: 10,
        geometry: { type: 'Point', coordinates: [2.00005, 1] },
      },
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'flat');
  // With no positions at all, API order decides, as before.
  const unplaced = fakeSource({
    nearest: [
      { id: 'pano', is_pano: true, captured_at: 10 },
      { id: 'flat', is_pano: false, captured_at: 10 },
    ],
  });
  const unplacedInstance = createMapillaryProvider({ source: unplaced }).create(
    fakeContext(),
  );
  assert.equal(await unplacedInstance.nearestImage({ lat: 1, lon: 2 }), 'pano');
});

test('preferPano picks the nearest, the near pano, or nothing', () => {
  assert.equal(preferPano([]), undefined);
  assert.equal(preferPano([{ isPano: false, metres: Infinity }]), undefined);
  const flat = { isPano: false, metres: 5 };
  const nearPano = { isPano: true, metres: 9 };
  const farPano = { isPano: true, metres: 11 };
  assert.equal(preferPano([flat, nearPano]), nearPano);
  assert.equal(preferPano([flat, farPano]), flat);
  assert.equal(preferPano([nearPano, flat]), nearPano);
});

test('nearestImage composes freshest-first with the pano preference', async () => {
  const at = (id, lon, isPano, capturedAt) => ({
    id,
    is_pano: isPano,
    captured_at: capturedAt,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  // The older pano is nearer, but the freshest pano decides the pano side:
  // freshest flat ~5.6 m (captured 30), older pano ~6.7 m (captured 10),
  // freshest pano ~8.9 m (captured 20) — inside twice the flat's distance.
  const source = fakeSource({
    nearest: [
      at('flat', 2.00005, false, 30),
      at('old-pano', 2.00006, true, 10),
      at('pano', 2.00008, true, 20),
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'pano');
});

test('isLowQuality flags only finite scores below the floor, never a missing one', () => {
  assert.equal(isLowQuality(0), true);
  assert.equal(isLowQuality(0.24), true);
  assert.equal(isLowQuality('0.1'), true, 'a numeric string still scores');
  assert.equal(isLowQuality(0.25), false, 'the floor itself is decent');
  assert.equal(isLowQuality(0.9), false);
  assert.equal(isLowQuality(1), false);
  for (const missing of [null, undefined, '', NaN, 'not a score'])
    assert.equal(
      isLowQuality(missing),
      false,
      `${String(missing)} is unscored`,
    );
});

test('nearestImage passes over a bottom-quartile photo for a sharp one nearby', async () => {
  const at = (id, lon, quality_score) => ({
    id,
    is_pano: false,
    captured_at: 10,
    quality_score,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const source = fakeSource({
    nearest: [
      at('blurry-near', 2.00005, 0.1), // ~5 m east, bottom quartile
      at('sharp-nearby', 2.00009, 0.9), // ~10 m east, within twice the distance
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'sharp-nearby');
});

test('nearestImage keeps a blurry nearest photo when the sharp one is far away', async () => {
  const at = (id, lon, quality_score) => ({
    id,
    is_pano: false,
    captured_at: 10,
    quality_score,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const source = fakeSource({
    nearest: [
      at('blurry-near', 2.00005, 0.1), // ~5 m east
      at('sharp-far', 2.0004, 0.9), // ~45 m east, past twice the distance
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'blurry-near');
});

test('nearestImage falls back to the nearest photo when all are low-quality', async () => {
  const at = (id, lon, quality_score) => ({
    id,
    is_pano: false,
    captured_at: 10,
    quality_score,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const source = fakeSource({
    nearest: [at('blurry-near', 2.00005, 0.1), at('blurry-far', 2.0004, 0.2)],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'blurry-near');
});

test('nearestImage never penalises an unscored photo for lacking a score', async () => {
  const at = (id, lon, quality_score) => ({
    id,
    is_pano: false,
    captured_at: 10,
    quality_score,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  // An unscored nearest photo wins outright: it is not low-quality.
  const unscoredNear = fakeSource({
    nearest: [
      at('unscored-near', 2.00005, undefined),
      at('sharp-far', 2.0004, 0.9),
    ],
  });
  const first = createMapillaryProvider({ source: unscoredNear }).create(
    fakeContext(),
  );
  assert.equal(await first.nearestImage({ lat: 1, lon: 2 }), 'unscored-near');
  // An unscored photo rescues a blurry nearest one, like a scored decent one.
  const unscoredRescue = fakeSource({
    nearest: [
      at('blurry-near', 2.00005, 0.1),
      at('unscored-nearby', 2.00009, undefined),
    ],
  });
  const second = createMapillaryProvider({ source: unscoredRescue }).create(
    fakeContext(),
  );
  assert.equal(
    await second.nearestImage({ lat: 1, lon: 2 }),
    'unscored-nearby',
  );
});

test('nearestImage quality never overrides the imagery filter', async () => {
  const at = (id, lon, quality_score, is_pano) => ({
    id,
    is_pano,
    captured_at: 10,
    quality_score,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const source = fakeSource({
    nearest: [
      at('blurry-pano', 2.00005, 0.1, true),
      at('sharp-flat', 2.00009, 0.9, false),
    ],
  });
  const instance = createMapillaryProvider({ source }).create(
    fakeContext({ pano: 'pano', sinceMs: null }),
  );
  assert.equal(
    await instance.nearestImage({ lat: 1, lon: 2 }),
    'blurry-pano',
    'the only passing photo wins, however blurry',
  );
});

test('a "since N days" window follows the clock in a long-open tab', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 1) });
  const day = 86_400_000;
  const capturedAt = Date.now() - day / 2;
  const source = fakeSource({
    nearest: [{ id: 'recent', is_pano: false, captured_at: capturedAt }],
  });
  // The core's context resolves the stored filter whenever it is asked.
  const instance = createMapillaryProvider({ source }).create(
    fakeContext(() => resolveFilter({ pano: 'all', sinceDays: 1 })),
  );
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'recent');
  t.mock.timers.tick(2 * day);
  assert.equal(
    await instance.nearestImage({ lat: 1, lon: 2 }),
    null,
    'two days on, the image is older than the window',
  );
});

test('nearestImage measures the short way round the date line', async () => {
  const at = (id, lon, lat) => ({
    id,
    is_pano: false,
    captured_at: 10,
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });
  const source = fakeSource({
    nearest: [
      at('same-side', 179.9995, 0), // ~45 m west, on the camera's side
      at('across', -179.9999, 0), // ~11 m east, across ±180°
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(
    await instance.nearestImage({ lat: 0, lon: 179.9999 }),
    'across',
  );
  // And from the other side.
  const west = createMapillaryProvider({
    source: fakeSource({
      nearest: [at('same-side', -179.9995, 0), at('across', 179.9999, 0)],
    }),
  }).create(fakeContext());
  assert.equal(await west.nearestImage({ lat: 0, lon: -179.9999 }), 'across');
});

test('sequence cones drop no-fix placeholders instead of drawing them at Null Island', () => {
  const at = (id, coordinates) => ({
    id,
    is_pano: false,
    captured_at: 10,
    compass_angle: 0,
    geometry: { type: 'Point', coordinates },
  });
  assert.equal(normalizeSequenceImage(at('no-fix', [0, 0])), null);
  assert.equal(normalizeSequenceImage(at('out-of-range', [200, 0])), null);
  assert.equal(normalizeSequenceImage(at('non-finite', [NaN, 0])), null);
  assert.equal(normalizeSequenceImage({ id: 'no-coords' }), null);
  // One zero is a real meridian/equator crossing; both zero is not.
  assert.equal(normalizeSequenceImage(at('greenwich', [0, 51.5])).lon, 0);
  assert.equal(normalizeSequenceImage(at('equator', [-0.12, 0])).lat, 0);
});

test('nearestImage prefers the freshest shot within the radius over a closer stale one', async () => {
  const at = (id, lon, captured_at) => ({
    id,
    is_pano: false,
    captured_at,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const source = fakeSource({
    nearest: [
      at('stale-near', 2.00005, 1_400_000_000_000), // ~5 m east, 2014
      at('fresh-far', 2.0004, 1_750_000_000_000), // ~45 m east, 2025
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'fresh-far');
});

test('nearestImage sorts an undated shot last and breaks freshness ties by distance', async () => {
  const at = (id, lon, captured_at) => ({
    id,
    is_pano: false,
    captured_at,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const source = fakeSource({
    nearest: [
      at('undated-near', 2.00005, undefined), // ~5 m east, unknown date
      at('dated-far', 2.0004, 1_750_000_000_000), // ~45 m east, 2025
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'dated-far');
  // Same date: the closer one wins again.
  const tied = fakeSource({
    nearest: [
      at('tied-far', 2.0004, 1_750_000_000_000),
      at('tied-near', 2.00005, 1_750_000_000_000),
    ],
  });
  const tiedInstance = createMapillaryProvider({ source: tied }).create(
    fakeContext(),
  );
  assert.equal(
    await tiedInstance.nearestImage({ lat: 1, lon: 2 }),
    'tied-near',
  );
});

test('nearestImage freshness never overrides the imagery filter', async () => {
  const at = (id, lon, captured_at, is_pano) => ({
    id,
    is_pano,
    captured_at,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const source = fakeSource({
    nearest: [
      at('fresh-flat', 2.00005, 1_750_000_000_000, false),
      at('older-pano', 2.0004, 1_400_000_000_000, true),
    ],
  });
  const instance = createMapillaryProvider({ source }).create(
    fakeContext({ pano: 'pano', sinceMs: null }),
  );
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'older-pano');
});

test('nearestImage still opens a positioned shot over a position-less fresher one', async () => {
  const source = fakeSource({
    nearest: [
      { id: 'no-position', is_pano: false, captured_at: 1_750_000_000_000 },
      {
        id: 'positioned',
        is_pano: false,
        captured_at: 1_400_000_000_000,
        geometry: { type: 'Point', coordinates: [2.00005, 1] },
      },
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'positioned');
});

test('freshestFirst sorts by capture date, unknown last, distance on ties', () => {
  const entries = [
    { capturedAt: 0, metres: 1 },
    { capturedAt: 20, metres: 40 },
    { capturedAt: 20, metres: 5 },
    { capturedAt: 10, metres: 1 },
  ];
  assert.deepEqual(
    freshestFirst(entries).map(({ metres }) => metres),
    [5, 40, 1, 1],
  );
  assert.equal(entries[0].metres, 1, 'the input order is untouched');
});

test('cone thinning across the date line drops images metres apart', () => {
  const image = (id, lon) => ({ id, lon, lat: 0 });
  // A sequence driving east over ±180° with images ~1 m apart, then ~11 m on.
  const kept = thinImages(
    [
      image('a', 179.99999),
      image('b', -179.99999), // ~2 m from a, across the date line
      image('c', -179.9999), // ~11 m from a
    ],
    3,
  );
  assert.deepEqual(
    kept.map(({ id }) => id),
    ['a', 'c'],
  );
});

/** A viewer looking straight down on downtown Sacramento from 900 m. */
function streetViewer() {
  const collection = () => ({
    add: (item) => item,
    remove: () => true,
    contains: () => false,
    get length() {
      return 0;
    },
  });
  const event = () => ({ addEventListener: () => () => {} });
  const camera = Object.assign(
    rayCamera({
      lon: -121.4944,
      lat: 38.5816,
      altitude: 900,
      pitch: -90,
      width: 100,
      height: 100,
    }),
    { changed: event(), moveEnd: event() },
  );
  return {
    camera,
    scene: {
      canvas: { clientWidth: 100, clientHeight: 100 },
      globe: { show: false, ellipsoid: Cesium.Ellipsoid.WGS84 },
      primitives: collection(),
      groundPrimitives: collection(),
      preRender: event(),
      postRender: event(),
      requestRender() {},
    },
  };
}

test('coverage asks for no tiles before the key status is known', async () => {
  for (const configured of [false, true]) {
    let answer;
    const tiles = [];
    const source = {
      ...fakeSource(),
      hasToken: () => configured,
      getStatus: () => new Promise((resolve) => (answer = resolve)),
      getTile: (...args) => {
        tiles.push(args);
        return new Promise(() => {});
      },
    };
    const instance = createMapillaryProvider({ source }).create(fakeContext());
    const viewer = streetViewer();
    instance.init(viewer);
    const status = instance.status();
    instance.activate(viewer);
    assert.equal(tiles.length, 0, 'nothing before the status answers');
    answer({ configured });
    await status;
    if (configured)
      assert.ok(tiles.length > 0, 'coverage loads as soon as the key is known');
    else {
      assert.equal(tiles.length, 0, 'a key-less install never asks');
      assert.equal(instance.coverageStats().keyRequired, true);
    }
    instance.destroy(viewer);
  }
});
