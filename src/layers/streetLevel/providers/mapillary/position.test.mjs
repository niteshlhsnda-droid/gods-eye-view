import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestPosition } from './position.js';

const point = (lon, lat) => ({
  type: 'Point',
  coordinates: [lon, lat],
});

test('nearestPosition prefers the refined fix when it is usable', () => {
  assert.deepEqual(
    nearestPosition({
      computed_geometry: point(2.0001, 1),
      geometry: point(2.001, 1),
    }),
    { lon: 2.0001, lat: 1 },
  );
});

test('nearestPosition falls back to GPS on a placeholder refined fix', () => {
  assert.deepEqual(
    nearestPosition({
      computed_geometry: point(0, 0),
      geometry: point(2.0001, 1),
    }),
    { lon: 2.0001, lat: 1 },
  );
});

test('nearestPosition falls back to GPS on a non-finite refined fix', () => {
  assert.deepEqual(
    nearestPosition({
      computed_geometry: point(Number.NaN, 1),
      geometry: point(2.0001, 1),
    }),
    { lon: 2.0001, lat: 1 },
  );
});

test('nearestPosition falls back to GPS on an out-of-range refined fix', () => {
  assert.deepEqual(
    nearestPosition({
      computed_geometry: point(200, 1),
      geometry: point(2.0001, 1),
    }),
    { lon: 2.0001, lat: 1 },
  );
  assert.deepEqual(
    nearestPosition({
      computed_geometry: point(2, 91),
      geometry: point(2.0001, 1),
    }),
    { lon: 2.0001, lat: 1 },
  );
});

test('nearestPosition uses GPS alone when there is no refined fix', () => {
  assert.deepEqual(
    nearestPosition({ geometry: point(2.0001, 1) }),
    { lon: 2.0001, lat: 1 },
  );
});

test('nearestPosition returns null when neither fix can place the photo', () => {
  assert.equal(nearestPosition({}), null);
  assert.equal(nearestPosition(null), null);
  assert.equal(
    nearestPosition({
      computed_geometry: point(0, 0),
      geometry: point(0, 0),
    }),
    null,
  );
  assert.equal(
    nearestPosition({
      computed_geometry: { type: 'Point', coordinates: null },
      geometry: { type: 'Point', coordinates: [] },
    }),
    null,
  );
});

test('nearestPosition rejects string coordinates and keeps the edge values', () => {
  assert.deepEqual(
    nearestPosition({
      computed_geometry: point('2.0001', '1'),
      geometry: point(2.0001, 1),
    }),
    { lon: 2.0001, lat: 1 },
  );
  assert.deepEqual(
    nearestPosition({ geometry: point(180, 90) }),
    { lon: 180, lat: 90 },
  );
  assert.deepEqual(
    nearestPosition({ geometry: point(-180, -90) }),
    { lon: -180, lat: -90 },
  );
});

test('nearestPosition reads the first two elements of a 3D fix', () => {
  assert.deepEqual(
    nearestPosition({
      geometry: { type: 'Point', coordinates: [2.0001, 1, 12] },
    }),
    { lon: 2.0001, lat: 1 },
  );
});
