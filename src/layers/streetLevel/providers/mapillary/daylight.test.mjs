import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapillaryProvider } from './index.js';
import {
  DAYLIGHT_PREFERENCE_FACTOR,
  captureLight,
  preferDaylight,
  solarElevationDeg,
} from './daylight.js';

/** June noon in London: the sun culminates near 90 − 51.5 + 23.44 ≈ 62°. */
const LONDON_JUNE_NOON = Date.UTC(2026, 5, 21, 12, 0, 0);
/** December noon in London: near 90 − 51.5 − 23.44 ≈ 15°. */
const LONDON_DECEMBER_NOON = Date.UTC(2025, 11, 21, 12, 0, 0);
/** June midnight in London: near −15°. */
const LONDON_JUNE_MIDNIGHT = Date.UTC(2026, 5, 21, 0, 0, 0);
/** Night capture near the equator: solar midnight in January. */
const EQUATOR_JANUARY_MIDNIGHT = Date.UTC(2026, 0, 15, 0, 0, 0);
/** Day capture near the equator: solar noon on the June solstice. */
const EQUATOR_JUNE_NOON = Date.UTC(2026, 5, 21, 12, 0, 0);
/** Night capture near the equator: solar midnight on the June solstice (fresh). */
const EQUATOR_JUNE_MIDNIGHT = Date.UTC(2026, 5, 21, 0, 0, 0);
/** Day capture near the equator: solar noon in January (older than June). */
const EQUATOR_JANUARY_NOON = Date.UTC(2026, 0, 15, 12, 0, 0);

test('solar elevation matches textbook values', () => {
  const londonJune = solarElevationDeg(51.5, 0, LONDON_JUNE_NOON);
  assert.ok(londonJune > 60 && londonJune < 64, `June noon: ${londonJune}`);
  const londonDecember = solarElevationDeg(51.5, 0, LONDON_DECEMBER_NOON);
  assert.ok(
    londonDecember > 13 && londonDecember < 17,
    `December noon: ${londonDecember}`,
  );
  const londonMidnight = solarElevationDeg(51.5, 0, LONDON_JUNE_MIDNIGHT);
  assert.ok(
    londonMidnight > -17 && londonMidnight < -13,
    `June midnight: ${londonMidnight}`,
  );
  // Equinox noon at the equator: the sun is near the zenith.
  assert.ok(solarElevationDeg(0, 0, Date.UTC(2026, 2, 20, 12, 0, 0)) > 85);
});

test('solar elevation honours longitude and the polar day/night', () => {
  // The same instant is midday in London and 22:00 in Sydney: day vs night.
  assert.ok(solarElevationDeg(51.5, 0, LONDON_JUNE_NOON) > 0);
  assert.ok(solarElevationDeg(-33.9, 151.2, LONDON_JUNE_NOON) < -55);
  // Svalbard in June: the sun never sets; in December it never rises.
  assert.ok(solarElevationDeg(78, 15, LONDON_JUNE_MIDNIGHT) > 0);
  assert.ok(solarElevationDeg(78, 15, LONDON_DECEMBER_NOON) < 0);
});

test('solar elevation is NaN for invalid inputs', () => {
  assert.ok(Number.isNaN(solarElevationDeg(200, 0, 0)));
  assert.ok(Number.isNaN(solarElevationDeg(0, 0, NaN)));
  assert.ok(Number.isNaN(solarElevationDeg(NaN, 0, 0)));
});

test('captureLight classifies day, night, and unknown', () => {
  assert.equal(
    captureLight({ lat: 51.5, lon: 0, capturedAt: LONDON_JUNE_NOON }),
    'day',
  );
  assert.equal(
    captureLight({ lat: 51.5, lon: 0, capturedAt: LONDON_JUNE_MIDNIGHT }),
    'night',
  );
  assert.equal(captureLight({ lat: 1, lon: 2, capturedAt: 0 }), 'unknown');
  assert.equal(captureLight({ lat: 1, lon: 2 }), 'unknown');
  assert.equal(captureLight({ lat: 1, lon: 2, capturedAt: -5 }), 'unknown');
  assert.equal(captureLight({ lat: 1, lon: 2, capturedAt: NaN }), 'unknown');
  // A capture timestamp in the future is a bogus clock, not daylight.
  assert.equal(
    captureLight(
      { lat: 1, lon: 2, capturedAt: Date.UTC(2036, 0, 1) },
      { nowMs: Date.UTC(2026, 0, 1) },
    ),
    'unknown',
  );
  assert.equal(
    captureLight({ lat: 200, lon: 2, capturedAt: LONDON_JUNE_NOON }),
    'unknown',
  );
});

const entry = (id, capturedAt, metres) => ({
  record: { id, captured_at: capturedAt },
  metres,
});

test('preferDaylight keeps the nearest unless it is night', () => {
  assert.equal(preferDaylight([], { lat: 1, lon: 2 }), null);
  // Nearest is daylight: nothing to fix.
  assert.equal(
    preferDaylight(
      [
        entry('day-near', EQUATOR_JUNE_NOON, 5),
        entry('night-far', EQUATOR_JANUARY_MIDNIGHT, 9),
      ],
      { lat: 1, lon: 2 },
    ).id,
    'day-near',
  );
  // Nearest is undated: its light is unknown, not night — it stays.
  assert.equal(
    preferDaylight(
      [entry('undated-near', 0, 5), entry('day-far', EQUATOR_JUNE_NOON, 9)],
      { lat: 1, lon: 2 },
    ).id,
    'undated-near',
  );
});

test('preferDaylight displaces a night nearest with nearby daylight', () => {
  // Daylight at 9 m beats a night nearest at 5 m: within 2×.
  assert.equal(
    preferDaylight(
      [
        entry('night-near', EQUATOR_JANUARY_MIDNIGHT, 5),
        entry('day-close', EQUATOR_JUNE_NOON, 9),
        entry('day-farther', EQUATOR_JUNE_NOON, 10),
      ],
      { lat: 1, lon: 2 },
    ).id,
    'day-close',
  );
  // Daylight at 11 m is beyond 2× the 5 m nearest: the night shot stays.
  assert.equal(
    preferDaylight(
      [
        entry('night-near', EQUATOR_JANUARY_MIDNIGHT, 5),
        entry('day-beyond', EQUATOR_JUNE_NOON, 11),
      ],
      { lat: 1, lon: 2 },
    ).id,
    'night-near',
  );
  // All night within range: the nearest stays.
  assert.equal(
    preferDaylight(
      [
        entry('night-near', EQUATOR_JANUARY_MIDNIGHT, 5),
        entry('night-far', EQUATOR_JANUARY_MIDNIGHT, 9),
      ],
      { lat: 1, lon: 2 },
    ).id,
    'night-near',
  );
  // A night shot exactly on the point has a 2× window of zero: it stays.
  assert.equal(
    preferDaylight(
      [
        entry('night-on-point', EQUATOR_JANUARY_MIDNIGHT, 0),
        entry('day-close', EQUATOR_JUNE_NOON, 5),
      ],
      { lat: 1, lon: 2 },
    ).id,
    'night-on-point',
  );
  assert.equal(DAYLIGHT_PREFERENCE_FACTOR, 2);
});

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
  return {
    services: {},
    getFilter: () => filter,
    isActive: () => true,
    notify: () => {},
    actions: { openImage: () => {}, reportError: () => {} },
  };
}

/** A record ~`lonOffset` degrees east of the query point (1, 2). */
const at = (id, lonOffset, capturedAt, isPano = false) => ({
  id,
  is_pano: isPano,
  captured_at: capturedAt,
  geometry: { type: 'Point', coordinates: [2 + lonOffset, 1] },
});

test('nearestImage opens a nearby daylight shot over a night nearest', async () => {
  const source = fakeSource({
    nearest: [
      at('night-near', 0.00005, EQUATOR_JUNE_MIDNIGHT), // ~5.6 m, freshest
      at('day-close', 0.00009, EQUATOR_JANUARY_NOON), // ~10 m, within 2×
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'day-close');
});

test('nearestImage keeps a night nearest when daylight is too far away', async () => {
  const source = fakeSource({
    nearest: [
      at('night-near', 0.00005, EQUATOR_JUNE_MIDNIGHT), // ~5.6 m, freshest
      at('day-beyond', 0.00015, EQUATOR_JANUARY_NOON), // ~16.7 m, beyond 2×
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'night-near');
});

test('nearestImage never displaces a daylight or undated nearest', async () => {
  const dayFirst = createMapillaryProvider({
    source: fakeSource({
      nearest: [
        at('day-near', 0.00005, EQUATOR_JUNE_NOON),
        at('night-far', 0.00009, EQUATOR_JANUARY_MIDNIGHT),
      ],
    }),
  }).create(fakeContext());
  assert.equal(await dayFirst.nearestImage({ lat: 1, lon: 2 }), 'day-near');
  // Undated records tie on freshness, so distance decides and the daylight
  // step stays inert (an undated winner's light is 'unknown', never night).
  const undatedFirst = createMapillaryProvider({
    source: fakeSource({
      nearest: [
        at('undated-near', 0.00005, 0),
        at('undated-far', 0.00009, 0),
      ],
    }),
  }).create(fakeContext());
  assert.equal(
    await undatedFirst.nearestImage({ lat: 1, lon: 2 }),
    'undated-near',
  );
});

test('nearestImage applies the daylight preference after the imagery filter', async () => {
  // Flat only: the daylight pano is filtered out, so the night flat stays.
  const flatOnly = createMapillaryProvider({
    source: fakeSource({
      nearest: [
        at('night-flat', 0.00005, EQUATOR_JANUARY_MIDNIGHT, false),
        at('day-pano', 0.00009, EQUATOR_JUNE_NOON, true),
      ],
    }),
  }).create(fakeContext({ pano: 'flat', sinceMs: null }));
  assert.equal(await flatOnly.nearestImage({ lat: 1, lon: 2 }), 'night-flat');
  // Pano only: the night flat is filtered out, so the daylight pano wins.
  const panoOnly = createMapillaryProvider({
    source: fakeSource({
      nearest: [
        at('night-flat', 0.00005, EQUATOR_JANUARY_MIDNIGHT, false),
        at('day-pano', 0.00009, EQUATOR_JUNE_NOON, true),
      ],
    }),
  }).create(fakeContext({ pano: 'pano', sinceMs: null }));
  assert.equal(await panoOnly.nearestImage({ lat: 1, lon: 2 }), 'day-pano');
});
