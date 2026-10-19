import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRouteProfile,
  projectNearbyPlaces,
  projectRouteResult,
  projectTextSearchPlaces,
} from './placeProviderPayloads.js';

// ---------------------------------------------------------------------------
// normalizeRouteProfile: spoken/alias profile names -> canonical profile
// ---------------------------------------------------------------------------

test('normalizeRouteProfile maps car aliases to car', () => {
  assert.equal(normalizeRouteProfile('car'), 'car');
  assert.equal(normalizeRouteProfile('driving'), 'car');
});

test('normalizeRouteProfile maps bike aliases to bike', () => {
  assert.equal(normalizeRouteProfile('bike'), 'bike');
  assert.equal(normalizeRouteProfile('cycling'), 'bike');
  assert.equal(normalizeRouteProfile('bicycle'), 'bike');
});

test('normalizeRouteProfile maps foot aliases to foot', () => {
  assert.equal(normalizeRouteProfile('foot'), 'foot');
  assert.equal(normalizeRouteProfile('walking'), 'foot');
  assert.equal(normalizeRouteProfile('walk'), 'foot');
});

test('normalizeRouteProfile rejects unknown profiles as null', () => {
  assert.equal(normalizeRouteProfile('truck'), null);
  assert.equal(normalizeRouteProfile('boat'), null);
  assert.equal(normalizeRouteProfile('transit'), null);
  assert.equal(normalizeRouteProfile(''), null);
});

test('normalizeRouteProfile is case-sensitive and type-strict', () => {
  assert.equal(normalizeRouteProfile('Car'), null);
  assert.equal(normalizeRouteProfile('CAR'), null);
  assert.equal(normalizeRouteProfile('DRIVING'), null);
  assert.equal(normalizeRouteProfile(null), null);
  assert.equal(normalizeRouteProfile(undefined), null);
  assert.equal(normalizeRouteProfile(0), null);
  assert.equal(normalizeRouteProfile(false), null);
  assert.equal(normalizeRouteProfile({}), null);
  assert.equal(normalizeRouteProfile(['car']), null);
});

test('normalizeRouteProfile does not trim whitespace', () => {
  assert.equal(normalizeRouteProfile(' car'), null);
  assert.equal(normalizeRouteProfile('car '), null);
});

// ---------------------------------------------------------------------------
// projectRouteResult: route payload projection
// ---------------------------------------------------------------------------

test('projectRouteResult projects distance, duration, geometry and profile', () => {
  const out = projectRouteResult(
    {
      distance: 1234.4,
      duration: 300.6,
      geometry: {
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
    },
    'bike',
  );
  assert.deepEqual(out, {
    ok: true,
    profile: 'bike',
    distanceM: 1234,
    durationS: 301,
    geometry: [
      [1, 2],
      [3, 4],
    ],
  });
});

test('projectRouteResult always reports ok:true even with nonsense profile', () => {
  const out = projectRouteResult(
    { distance: 10, duration: 5, geometry: { coordinates: [] } },
    'spaceship',
  );
  assert.equal(out.ok, true);
  assert.equal(out.profile, 'spaceship');
});

test('projectRouteResult rounds halves up and negatives away from zero-ish', () => {
  const out = projectRouteResult(
    { distance: 12.5, duration: -3.6, geometry: { coordinates: [] } },
    'foot',
  );
  assert.equal(out.distanceM, 13);
  assert.equal(out.durationS, -4);
});

test('projectRouteResult yields NaN for missing numeric fields instead of throwing', () => {
  const out = projectRouteResult({ geometry: { coordinates: [] } }, 'car');
  assert.ok(Number.isNaN(out.distanceM));
  assert.ok(Number.isNaN(out.durationS));
});

test('projectRouteResult throws TypeError when geometry is missing', () => {
  assert.throws(
    () => projectRouteResult({ distance: 1, duration: 1 }, 'car'),
    TypeError,
  );
});

test('projectRouteResult throws TypeError on null or undefined route', () => {
  assert.throws(() => projectRouteResult(null, 'car'), TypeError);
  assert.throws(() => projectRouteResult(undefined, 'car'), TypeError);
});

// ---------------------------------------------------------------------------
// projectNearbyPlaces: nearby search projection, dedupe, priority sort, cap
// ---------------------------------------------------------------------------

function nearbyPlace(overrides = {}) {
  return {
    id: 'place-1',
    displayName: { text: 'Gol Ghar' },
    shortFormattedAddress: 'Bankipur, Patna',
    formattedAddress: 'Golghar, Bankipur, Patna',
    location: { latitude: 25.62, longitude: 85.14 },
    primaryTypeDisplayName: { text: 'Landmark' },
    primaryType: 'tourist_attraction',
    types: ['tourist_attraction', 'point_of_interest'],
    ...overrides,
  };
}

test('projectNearbyPlaces maps a full place record', () => {
  const [place] = projectNearbyPlaces(
    { places: [nearbyPlace()] },
    25.62,
    85.14,
  );
  assert.equal(place.id, 'place-1');
  assert.equal(place.name, 'Gol Ghar');
  assert.equal(place.address, 'Bankipur, Patna');
  assert.equal(place.latitude, 25.62);
  assert.equal(place.longitude, 85.14);
  assert.equal(place.distanceM, 0);
  assert.equal(place.primaryType, 'Landmark');
  assert.deepEqual(place.types, ['tourist_attraction', 'point_of_interest']);
});

test('projectNearbyPlaces prefers shortFormattedAddress then formattedAddress then null', () => {
  const [a] = projectNearbyPlaces(
    { places: [nearbyPlace({ shortFormattedAddress: undefined })] },
    0,
    0,
  );
  assert.equal(a.address, 'Golghar, Bankipur, Patna');
  const [b] = projectNearbyPlaces(
    {
      places: [
        nearbyPlace({
          shortFormattedAddress: undefined,
          formattedAddress: undefined,
        }),
      ],
    },
    0,
    0,
  );
  assert.equal(b.address, null);
});

test('projectNearbyPlaces nulls missing id, primaryType and coordinates', () => {
  const [place] = projectNearbyPlaces(
    {
      places: [
        nearbyPlace({
          id: undefined,
          primaryTypeDisplayName: undefined,
          primaryType: undefined,
          location: undefined,
        }),
      ],
    },
    0,
    0,
  );
  assert.equal(place.id, null);
  assert.equal(place.primaryType, null);
  assert.equal(place.latitude, null);
  assert.equal(place.longitude, null);
});

test('projectNearbyPlaces uses primaryType when primaryTypeDisplayName is absent', () => {
  const [place] = projectNearbyPlaces(
    { places: [nearbyPlace({ primaryTypeDisplayName: undefined })] },
    0,
    0,
  );
  assert.equal(place.primaryType, 'tourist_attraction');
});

test('projectNearbyPlaces returns [] for missing or non-array places', () => {
  assert.deepEqual(projectNearbyPlaces({}, 0, 0), []);
  assert.deepEqual(projectNearbyPlaces({ places: null }, 0, 0), []);
  assert.deepEqual(projectNearbyPlaces({ places: 'nope' }, 0, 0), []);
  assert.deepEqual(projectNearbyPlaces({ places: [] }, 0, 0), []);
});

test('projectNearbyPlaces throws TypeError when data is null or undefined', () => {
  assert.throws(() => projectNearbyPlaces(null, 0, 0), TypeError);
  assert.throws(() => projectNearbyPlaces(undefined, 0, 0), TypeError);
});

test('projectNearbyPlaces throws TypeError on a null entry inside places', () => {
  assert.throws(
    () => projectNearbyPlaces({ places: [nearbyPlace(), null] }, 0, 0),
    TypeError,
  );
});

test('projectNearbyPlaces pins distance to 111320m per degree of longitude at the equator', () => {
  const [place] = projectNearbyPlaces(
    { places: [nearbyPlace({ location: { latitude: 0, longitude: 1 } })] },
    0,
    0,
  );
  assert.equal(place.distanceM, 111320);
});

test('projectNearbyPlaces reports MAX_SAFE_INTEGER distance for missing coordinates', () => {
  const [place] = projectNearbyPlaces(
    { places: [nearbyPlace({ location: undefined })] },
    25.62,
    85.14,
  );
  assert.equal(place.distanceM, Number.MAX_SAFE_INTEGER);
});

test('projectNearbyPlaces reports MAX_SAFE_INTEGER distance for NaN coordinates', () => {
  const [place] = projectNearbyPlaces(
    {
      places: [nearbyPlace({ location: { latitude: NaN, longitude: 85.14 } })],
    },
    25.62,
    85.14,
  );
  assert.equal(place.distanceM, Number.MAX_SAFE_INTEGER);
});

test('projectNearbyPlaces reports MAX_SAFE_INTEGER distance when the query point is undefined', () => {
  const [place] = projectNearbyPlaces(
    { places: [nearbyPlace()] },
    undefined,
    undefined,
  );
  assert.equal(place.distanceM, Number.MAX_SAFE_INTEGER);
});

test('projectNearbyPlaces sorts higher context priority before closer distance', () => {
  const places = projectNearbyPlaces(
    {
      places: [
        nearbyPlace({
          id: 'near-poi',
          displayName: { text: 'Near POI' },
          location: { latitude: 0, longitude: 0 },
          types: ['point_of_interest'],
        }),
        nearbyPlace({
          id: 'far-monument',
          displayName: { text: 'Far Monument' },
          location: { latitude: 0, longitude: 1 },
          types: ['monument'],
        }),
      ],
    },
    0,
    0,
  );
  assert.deepEqual(
    places.map((p) => p.id),
    ['far-monument', 'near-poi'],
  );
});

test('projectNearbyPlaces breaks priority ties by ascending distance', () => {
  const places = projectNearbyPlaces(
    {
      places: [
        nearbyPlace({
          id: 'far',
          displayName: { text: 'Far' },
          location: { latitude: 0, longitude: 1 },
          types: ['point_of_interest'],
        }),
        nearbyPlace({
          id: 'near',
          displayName: { text: 'Near' },
          location: { latitude: 0, longitude: 0.5 },
          types: ['point_of_interest'],
        }),
      ],
    },
    0,
    0,
  );
  assert.deepEqual(
    places.map((p) => p.id),
    ['near', 'far'],
  );
  assert.equal(places[0].distanceM, 55660);
});

test('projectNearbyPlaces dedupes name+address case-insensitively, keeping the first', () => {
  const places = projectNearbyPlaces(
    {
      places: [
        nearbyPlace({ id: 'first', displayName: { text: 'Cafe' } }),
        nearbyPlace({
          id: 'second',
          displayName: { text: 'CAFE' },
          shortFormattedAddress: 'bankipur, patna',
        }),
      ],
    },
    0,
    0,
  );
  assert.equal(places.length, 1);
  assert.equal(places[0].id, 'first');
});

test('projectNearbyPlaces keeps same name with a different address', () => {
  const places = projectNearbyPlaces(
    {
      places: [
        nearbyPlace({ id: 'one', displayName: { text: 'Cafe' } }),
        nearbyPlace({
          id: 'two',
          displayName: { text: 'Cafe' },
          shortFormattedAddress: 'Different Road',
        }),
      ],
    },
    0,
    0,
  );
  assert.equal(places.length, 2);
});

test('projectNearbyPlaces drops places without a name', () => {
  const places = projectNearbyPlaces(
    {
      places: [
        nearbyPlace({ displayName: undefined }),
        nearbyPlace({ id: 'named', displayName: { text: 'Named' } }),
      ],
    },
    0,
    0,
  );
  assert.equal(places.length, 1);
  assert.equal(places[0].id, 'named');
});

test('projectNearbyPlaces truncates types to the first 8', () => {
  const types = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const [place] = projectNearbyPlaces(
    { places: [nearbyPlace({ types })] },
    0,
    0,
  );
  assert.deepEqual(place.types, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
});

test('projectNearbyPlaces maps non-array types to []', () => {
  const [place] = projectNearbyPlaces(
    { places: [nearbyPlace({ types: 'museum' })] },
    0,
    0,
  );
  assert.deepEqual(place.types, []);
});

test('projectNearbyPlaces strips contextPriority from the output', () => {
  const [place] = projectNearbyPlaces({ places: [nearbyPlace()] }, 0, 0);
  assert.ok(!('contextPriority' in place));
});

test('projectNearbyPlaces caps output at 20 places', () => {
  const places = Array.from({ length: 25 }, (_, i) =>
    nearbyPlace({
      id: `p-${i}`,
      displayName: { text: `Place ${i}` },
      shortFormattedAddress: `Street ${i}`,
    }),
  );
  assert.equal(projectNearbyPlaces({ places }, 0, 0).length, 20);
});

// ---------------------------------------------------------------------------
// projectTextSearchPlaces: text search projection (no dedupe, no sort, no cap)
// ---------------------------------------------------------------------------

function textPlace(overrides = {}) {
  return {
    id: 'place-9',
    displayName: { text: 'Marine Drive' },
    formattedAddress: 'JP Ganga Path, Patna',
    location: { latitude: 25.63, longitude: 85.16 },
    primaryType: 'tourist_attraction',
    primaryTypeDisplayName: { text: 'Scenic Spot' },
    types: ['tourist_attraction'],
    ...overrides,
  };
}

test('projectTextSearchPlaces maps a full text-search record', () => {
  const [place] = projectTextSearchPlaces(
    { places: [textPlace()] },
    25.63,
    85.16,
  );
  assert.equal(place.id, 'place-9');
  assert.equal(place.name, 'Marine Drive');
  assert.equal(place.address, 'JP Ganga Path, Patna');
  assert.equal(place.distanceM, 0);
  // text search uses primaryType, NOT primaryTypeDisplayName
  assert.equal(place.primaryType, 'tourist_attraction');
  assert.equal(place.viewport, null);
});

test('projectTextSearchPlaces normalizes a complete viewport to plain numbers', () => {
  const [place] = projectTextSearchPlaces(
    {
      places: [
        textPlace({
          viewport: {
            low: { latitude: 25.6, longitude: 85.1 },
            high: { latitude: 25.7, longitude: 85.2 },
          },
        }),
      ],
    },
    0,
    0,
  );
  assert.deepEqual(place.viewport, {
    low: { latitude: 25.6, longitude: 85.1 },
    high: { latitude: 25.7, longitude: 85.2 },
  });
});

test('projectTextSearchPlaces nulls a partial viewport', () => {
  const [place] = projectTextSearchPlaces(
    {
      places: [
        textPlace({
          viewport: {
            low: { latitude: 25.6, longitude: 85.1 },
            high: { latitude: 25.7 },
          },
        }),
      ],
    },
    0,
    0,
  );
  assert.equal(place.viewport, null);
});

test('projectTextSearchPlaces nulls a viewport with non-finite corners', () => {
  const [place] = projectTextSearchPlaces(
    {
      places: [
        textPlace({
          viewport: {
            low: { latitude: '25.6', longitude: 85.1 },
            high: { latitude: 25.7, longitude: 85.2 },
          },
        }),
      ],
    },
    0,
    0,
  );
  assert.equal(place.viewport, null);
});

test('projectTextSearchPlaces filters nameless places', () => {
  const places = projectTextSearchPlaces(
    { places: [textPlace({ displayName: undefined }), textPlace()] },
    0,
    0,
  );
  assert.equal(places.length, 1);
  assert.equal(places[0].id, 'place-9');
});

test('projectTextSearchPlaces preserves input order (no sorting)', () => {
  const places = projectTextSearchPlaces(
    {
      places: [
        textPlace({
          id: 'far',
          displayName: { text: 'Far' },
          location: { latitude: 0, longitude: 1 },
        }),
        textPlace({
          id: 'near',
          displayName: { text: 'Near' },
          location: { latitude: 0, longitude: 0 },
        }),
      ],
    },
    0,
    0,
  );
  assert.deepEqual(
    places.map((p) => p.id),
    ['far', 'near'],
  );
});

test('projectTextSearchPlaces does not dedupe and does not cap at 20', () => {
  const places = Array.from({ length: 30 }, (_, i) =>
    textPlace({
      id: `t-${i}`,
      displayName: { text: 'Same Name' },
      formattedAddress: 'Same Address',
    }),
  );
  assert.equal(projectTextSearchPlaces({ places }, 0, 0).length, 30);
});

test('projectTextSearchPlaces returns [] for missing or non-array places', () => {
  assert.deepEqual(projectTextSearchPlaces({}, 0, 0), []);
  assert.deepEqual(projectTextSearchPlaces({ places: 'x' }, 0, 0), []);
});

test('projectTextSearchPlaces throws TypeError when data is null or undefined', () => {
  assert.throws(() => projectTextSearchPlaces(null, 0, 0), TypeError);
  assert.throws(() => projectTextSearchPlaces(undefined, 0, 0), TypeError);
});
