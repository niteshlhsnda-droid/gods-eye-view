import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PolylineGeoImportError,
  decodeEncodedPolyline,
  encodedPolylineToGeoJson,
} from './polylineGeoImport.js';

// Google's canonical example from the Encoded Polyline Algorithm docs:
// (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
const GOOGLE_EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

test('Google docs example decodes to the documented points', () => {
  assert.deepEqual(decodeEncodedPolyline(GOOGLE_EXAMPLE), [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
});

test('precision 6 decodes the same alphabet to finer coordinates', () => {
  // "??" = (0, 0); "AA" = deltas of 1 unit each = 1e-6 at precision 6.
  assert.deepEqual(decodeEncodedPolyline('??AA', { precision: 6 }), [
    [0, 0],
    [0.000001, 0.000001],
  ]);
  // The same string at precision 5 is 10x coarser.
  assert.deepEqual(decodeEncodedPolyline('??AA', { precision: 5 }), [
    [0, 0],
    [0.00001, 0.00001],
  ]);
});

test('surrounding whitespace is trimmed, not treated as data', () => {
  assert.deepEqual(decodeEncodedPolyline(`${GOOGLE_EXAMPLE}\n`), [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
});

test('single polyline becomes a LineString FeatureCollection', () => {
  assert.deepEqual(
    encodedPolylineToGeoJson(GOOGLE_EXAMPLE, {
      properties: { name: 'Test route' },
    }),
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Test route' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-120.2, 38.5],
              [-120.95, 40.7],
              [-126.453, 43.252],
            ],
          },
        },
      ],
    },
  );
});

test('array of polylines becomes one MultiLineString feature', () => {
  const fc = encodedPolylineToGeoJson(['????', '??AA']);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].geometry.type, 'MultiLineString');
  assert.deepEqual(fc.features[0].geometry.coordinates, [
    [
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0.00001, 0.00001],
    ],
  ]);
});

test('refuses empty, non-string, and whitespace-only input', () => {
  for (const bad of ['', '   ', '\n', null, undefined, 42, {}]) {
    assert.throws(
      () => decodeEncodedPolyline(bad),
      PolylineGeoImportError,
      String(bad),
    );
  }
});

test('refuses characters outside the ?-~ alphabet', () => {
  // Space inside the string, DEL, and a non-ASCII letter.
  assert.throws(
    () => decodeEncodedPolyline('_p~i F~ps|U'),
    PolylineGeoImportError,
  );
  assert.throws(
    () => decodeEncodedPolyline('_p~iF~ps|U\x7f'),
    PolylineGeoImportError,
  );
  assert.throws(
    () => decodeEncodedPolyline('_p~iF~ps|Ué'),
    PolylineGeoImportError,
  );
});

test('refuses a truncated chunk and an odd value count', () => {
  // '_' = 32: continuation bit set, no following character.
  assert.throws(() => decodeEncodedPolyline('_'), PolylineGeoImportError);
  assert.throws(
    () => decodeEncodedPolyline('_p~iF~ps|U_'),
    PolylineGeoImportError,
  );
  // '?' = one value only: a latitude with no longitude.
  assert.throws(() => decodeEncodedPolyline('?'), PolylineGeoImportError);
});

test('refuses coordinates outside lon ±180 / lat ±90', () => {
  // Latitude 100: zigzag 20,000,000 -> "_gjaR", longitude 0 -> "?".
  assert.throws(() => decodeEncodedPolyline('_gjaR?'), PolylineGeoImportError);
  // Longitude 181: zigzag 36,200,000 -> "_qvoa@", latitude 0 -> "?".
  assert.throws(() => decodeEncodedPolyline('?_qvoa@'), PolylineGeoImportError);
});

test('refuses a single-point polyline as a line', () => {
  assert.deepEqual(decodeEncodedPolyline('??'), [[0, 0]]);
  assert.throws(() => encodedPolylineToGeoJson('??'), PolylineGeoImportError);
});

test('refuses bad precision and bad properties', () => {
  for (const precision of [-1, 11, 5.5, '5', null, NaN]) {
    assert.throws(
      () => decodeEncodedPolyline('????', { precision }),
      PolylineGeoImportError,
      String(precision),
    );
  }
  assert.throws(
    () => encodedPolylineToGeoJson('????', { properties: 'name' }),
    PolylineGeoImportError,
  );
  assert.throws(
    () => encodedPolylineToGeoJson('????', { properties: ['x'] }),
    PolylineGeoImportError,
  );
});

test('refuses an empty array and non-string members', () => {
  assert.throws(() => encodedPolylineToGeoJson([]), PolylineGeoImportError);
  assert.throws(
    () => encodedPolylineToGeoJson(['????', null]),
    PolylineGeoImportError,
  );
  assert.throws(() => encodedPolylineToGeoJson(['??']), PolylineGeoImportError);
});

test('refuses inputs over the point cap instead of truncating', () => {
  // 250,001 points of (0, 0): "?" repeated 500,002 times.
  assert.throws(
    () => decodeEncodedPolyline('?'.repeat(500_002)),
    PolylineGeoImportError,
  );
});
