import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterNewQuakes,
  filterNewStorms,
  satelliteSubpoint,
  haversineKm,
  findFlyovers,
  createCycloneProvider,
  parseTleCatalog,
  DEFAULT_QUAKE_MIN_MAG,
  FLYOVER_COOLDOWN_MS,
} from './providers.js';

const ROWS = [
  {
    stableId: 'us123',
    mag: 6.2,
    place: 'Hindu Kush',
    lat: 36.5,
    lon: 70.9,
    depthKm: 180,
    time: 2000,
  },
  {
    stableId: 'us124',
    mag: 4.1,
    place: 'Too small',
    lat: 0,
    lon: 0,
    depthKm: 10,
    time: 2000,
  },
  {
    stableId: 'us125',
    mag: 7.0,
    place: 'Old event',
    lat: 0,
    lon: 0,
    depthKm: 10,
    time: 500,
  },
];

test('filterNewQuakes keeps only new, big-enough, recent events', () => {
  const { alerts, seenIds } = filterNewQuakes(ROWS, {
    minMag: 5,
    sinceMs: 1000,
  });
  assert.deepEqual(
    alerts.map((alert) => alert.id),
    ['us123'],
  );
  assert.equal(alerts[0].place, 'Hindu Kush');
  assert.ok(seenIds.has('us123'));
});

test('filterNewQuakes dedupes across polls and sorts loudest-first', () => {
  const first = filterNewQuakes(ROWS, { minMag: 5 });
  assert.equal(first.alerts.length, 2);
  assert.equal(first.alerts[0].mag, 7.0);
  const second = filterNewQuakes(ROWS, {
    minMag: 5,
    seenIds: first.seenIds,
  });
  assert.equal(second.alerts.length, 0);
});

test('filterNewQuakes ignores malformed rows', () => {
  const { alerts } = filterNewQuakes(
    [null, {}, { stableId: 'x', mag: 'big' }, { mag: 9 }],
    { minMag: 5 },
  );
  assert.equal(alerts.length, 0);
  assert.ok(DEFAULT_QUAKE_MIN_MAG > 0);
});

test('haversineKm matches known distances', () => {
  // Patna (25.6, 85.1) to Delhi (28.6, 77.2): ~850 km.
  const distance = haversineKm(25.6, 85.1, 28.6, 77.2);
  assert.ok(distance > 800 && distance < 900, `got ${distance}`);
  assert.equal(haversineKm(0, 0, 0, 0), 0);
});

test('satelliteSubpoint propagates a real ISS TLE', () => {
  const tle1 =
    '1 25544U 98067A   26300.50000000  .00016717  00000-0  10270-3 0  9000';
  const tle2 =
    '2 25544  51.6416 208.9163 0006703  69.9862  25.2906 15.72125391    10';
  const subpoint = satelliteSubpoint(
    tle1,
    tle2,
    new Date('2026-10-12T00:00:00Z'),
  );
  assert.ok(subpoint, 'propagated');
  assert.ok(Math.abs(subpoint.lat) <= 51.7, `lat ${subpoint.lat}`);
  assert.ok(Math.abs(subpoint.lon) <= 180, `lon ${subpoint.lon}`);
});

test('satelliteSubpoint returns null for garbage TLEs', () => {
  assert.equal(satelliteSubpoint('nope', 'nope'), null);
  assert.equal(satelliteSubpoint(null, null), null);
});

test('findFlyovers flags satellites within radius of the target', () => {
  const tle1 =
    '1 25544U 98067A   26300.50000000  .00016717  00000-0  10270-3 0  9000';
  const tle2 =
    '2 25544  51.6416 208.9163 0006703  69.9862  25.2906 15.72125391    10';
  const date = new Date('2026-10-12T00:00:00Z');
  const subpoint = satelliteSubpoint(tle1, tle2, date);
  const hits = findFlyovers({
    satellites: [{ name: 'ISS', tle1, tle2 }],
    target: subpoint,
    radiusKm: 1500,
    date,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'ISS');
  assert.ok(hits[0].distanceKm < 1);

  const misses = findFlyovers({
    satellites: [{ name: 'ISS', tle1, tle2 }],
    target: { lat: -subpoint.lat, lon: subpoint.lon + 170 },
    radiusKm: 1500,
    date,
  });
  assert.equal(misses.length, 0);
  assert.deepEqual(findFlyovers({ satellites: [], target: null }), []);
});

test('filterNewStorms alerts once per new storm', () => {
  const storms = [
    {
      id: 'al092026',
      name: 'Test Storm',
      classification: 'TS',
      basin: 'AL',
      windKt: 45,
      position: { latitude: 15.5, longitude: -45.2 },
    },
    { id: 'bad', name: 42 },
  ];
  const first = filterNewStorms(storms);
  assert.equal(first.alerts.length, 1);
  assert.equal(first.alerts[0].name, 'Test Storm');
  assert.equal(first.alerts[0].windKt, 45);
  const second = filterNewStorms(storms, { seenIds: first.seenIds });
  assert.equal(second.alerts.length, 0);
});

test('createCycloneProvider reports not-configured without a source', async () => {
  const provider = createCycloneProvider();
  assert.equal(provider.status, 'not-configured');
  assert.ok(provider.reason.length > 0);
  const result = await provider.check();
  assert.deepEqual(result.alerts, []);
});

test('createCycloneProvider surfaces storms from a wired source', async () => {
  const storms = [{ id: 'ep152026', name: 'Fifteen-E' }];
  const provider = createCycloneProvider({
    cycloneSource: async () => ({ storms }),
  });
  assert.equal(provider.status, 'active');
  const result = await provider.check();
  assert.deepEqual(result.alerts, storms);
});

test('createCycloneProvider survives a failing feed', async () => {
  const provider = createCycloneProvider({
    cycloneSource: async () => {
      throw new Error('down');
    },
  });
  const result = await provider.check();
  assert.deepEqual(result.alerts, []);
  assert.ok(FLYOVER_COOLDOWN_MS > 0);
});

test('parseTleCatalog reads 3-line triples and skips bad ones', () => {
  const text = [
    'ISS (ZARYA)',
    '1 25544U 98067A   26285.50000000  .00016717  00000-0  31000-3 0  9000',
    '2 25544  51.6400 208.9163 0006703  69.9862  25.2906 15.49560532    10',
    'BROKEN ENTRY',
    'not a tle line',
    '2 00000  51.6400 208.9163 0006703  69.9862  25.2906 15.49560532    10',
    'HST',
    '1 20580U 90037B   26285.50000000  .00001000  00000-0  10000-3 0  9001',
    '2 20580  28.4700 200.0000 0002800  80.0000  25.0000 15.09000000    10',
  ].join('\n');
  const entries = parseTleCatalog(text);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'ISS (ZARYA)');
  assert.ok(entries[0].tle1.startsWith('1 '));
  assert.ok(entries[0].tle2.startsWith('2 '));
  assert.equal(entries[1].name, 'HST');
  assert.deepEqual(parseTleCatalog(null), []);
  assert.deepEqual(parseTleCatalog(''), []);
});
