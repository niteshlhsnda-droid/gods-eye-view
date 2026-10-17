import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EARTH_MEAN_RADIUS_M,
  destinationPoint,
  haversineDistanceM,
  initialBearingDeg,
  midpoint,
} from './geoMath.js';

// London (Trafalgar Square area) and Paris (Notre-Dame area).
const LONDON = { lat: 51.5074, lon: -0.1278 };
const PARIS = { lat: 48.8566, lon: 2.3522 };

test('one degree of latitude at the equator is pi*R/180 metres', () => {
  const d = haversineDistanceM(0, 0, 1, 0);
  assert.ok(Math.abs(d - (Math.PI * EARTH_MEAN_RADIUS_M) / 180) < 1);
});

test('London–Paris is ~343.6 km', () => {
  const d = haversineDistanceM(LONDON.lat, LONDON.lon, PARIS.lat, PARIS.lon);
  assert.ok(Math.abs(d - 343_600) < 3_000, `got ${d}`);
});

test('London–Paris initial bearing is ~148 degrees (south-east)', () => {
  const b = initialBearingDeg(LONDON.lat, LONDON.lon, PARIS.lat, PARIS.lon);
  assert.ok(Math.abs(b - 148) < 3, `got ${b}`);
});

test('destination round-trips through distance and bearing', () => {
  const bearing = initialBearingDeg(
    LONDON.lat,
    LONDON.lon,
    PARIS.lat,
    PARIS.lon,
  );
  const distance = haversineDistanceM(
    LONDON.lat,
    LONDON.lon,
    PARIS.lat,
    PARIS.lon,
  );
  const dest = destinationPoint(LONDON.lat, LONDON.lon, bearing, distance);
  assert.ok(Math.abs(dest.lat - PARIS.lat) < 0.01, `lat ${dest.lat}`);
  assert.ok(Math.abs(dest.lon - PARIS.lon) < 0.01, `lon ${dest.lon}`);
});

test('destination due north 100 km stays on the meridian', () => {
  const dest = destinationPoint(0, 10, 0, 100_000);
  assert.ok(Math.abs(dest.lon - 10) < 1e-9);
  assert.ok(
    Math.abs(dest.lat - 100_000 / ((Math.PI * EARTH_MEAN_RADIUS_M) / 180)) <
      1e-6,
  );
});

test('destination wraps longitude across the antimeridian', () => {
  const dest = destinationPoint(0, 179.9, 90, 100_000);
  assert.ok(dest.lon < 0 && dest.lon > -180, `lon ${dest.lon}`);
});

test('midpoint of London–Paris is equidistant from both ends', () => {
  const mid = midpoint(LONDON.lat, LONDON.lon, PARIS.lat, PARIS.lon);
  const d1 = haversineDistanceM(LONDON.lat, LONDON.lon, mid.lat, mid.lon);
  const d2 = haversineDistanceM(mid.lat, mid.lon, PARIS.lat, PARIS.lon);
  assert.ok(Math.abs(d1 - d2) < 1, `d1 ${d1} d2 ${d2}`);
  assert.ok(mid.lat > PARIS.lat && mid.lat < LONDON.lat);
  assert.ok(mid.lon > LONDON.lon && mid.lon < PARIS.lon);
});

test('coincident points have zero distance and no bearing', () => {
  assert.equal(haversineDistanceM(10, 20, 10, 20), 0);
  assert.equal(initialBearingDeg(10, 20, 10, 20), null);
});

test('antipodal points are pi*R apart with no defined bearing', () => {
  const d = haversineDistanceM(0, 0, 0, 180);
  assert.ok(Math.abs(d - Math.PI * EARTH_MEAN_RADIUS_M) < 10, `got ${d}`);
  assert.equal(initialBearingDeg(0, 0, 0, 180), null);
});

test('invalid coordinates throw RangeError', () => {
  assert.throws(() => haversineDistanceM(91, 0, 0, 0), RangeError);
  assert.throws(() => haversineDistanceM(0, 0, 0, -181), RangeError);
  assert.throws(() => haversineDistanceM(NaN, 0, 0, 0), RangeError);
  assert.throws(() => destinationPoint(0, 0, 0, -1), RangeError);
});
