import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sphericalPointInRing,
  sphericalPolygonAreaM2,
  sphericalRingAreaM2,
  sphericalRingCentroid,
  sphericalRingPerimeterM,
} from './sphericalPolygonMath.js';

/** IUGG mean Earth radius, metres — mirrors the module constant. */
const R = 6_371_008.8;
/** Whole-sphere area, m². */
const SPHERE_M2 = 4 * Math.PI * R * R;

/** Assert `actual` is within `tolerance` of `expected`. */
const closeTo = (actual, expected, tolerance) => {
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test('sphericalRingAreaM2: octant triangle is exactly R²·π/2 either way round', () => {
  const expected = (R * R * Math.PI) / 2;
  closeTo(
    sphericalRingAreaM2([
      [0, 0],
      [0, 90],
      [90, 0],
    ]),
    expected,
    1e4,
  );
  closeTo(
    sphericalRingAreaM2([
      [0, 0],
      [90, 0],
      [0, 90],
    ]),
    expected,
    1e4,
  );
});

test('sphericalRingAreaM2: 1°×1° equatorial square matches l’Huilier reference', () => {
  // Independent l'Huilier check on the two fan triangles: 12364031909.47.
  closeTo(
    sphericalRingAreaM2([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]),
    12364031909.47,
    100,
  );
});

test('sphericalRingAreaM2: same square is smaller at 60°N than at the equator', () => {
  const equator = sphericalRingAreaM2([
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  const north = sphericalRingAreaM2([
    [60, 0],
    [60, 1],
    [61, 1],
    [61, 0],
  ]);
  assert.ok(north < equator);
  closeTo(north / equator, 0.4924, 0.001);
});

test('sphericalRingAreaM2: antimeridian-crossing ring equals its plain twin', () => {
  const across = sphericalRingAreaM2([
    [0, 179],
    [0, -179],
    [1, -179],
    [1, 179],
  ]);
  const plain = sphericalRingAreaM2([
    [0, 0],
    [0, 2],
    [1, 2],
    [1, 0],
  ]);
  // Identical up to floating-point noise from the different longitudes.
  closeTo(across, plain, 1e-3);
});

test('sphericalRingAreaM2: pole-encircling triangle gives the small cap, not the sphere', () => {
  // The Chamberlain–Duquette trapezoid answers ~the whole sphere here
  // (phantom ±4πR² residue); the 3D fan must give the small triangle.
  const area = sphericalRingAreaM2([
    [89, 0],
    [89, 120],
    [89, -120],
  ]);
  closeTo(area, 16063183566.59, 1e5);
  assert.ok(area < SPHERE_M2 / 1000);
});

test('sphericalRingAreaM2: northern hemisphere ring is exactly half the sphere', () => {
  closeTo(
    sphericalRingAreaM2([
      [0, 0],
      [0, 90],
      [0, 180],
      [0, -90],
    ]),
    SPHERE_M2 / 2,
    1e3,
  );
});

test('sphericalRingAreaM2: accepts {lat, lon} objects and explicit closure', () => {
  const pairs = sphericalRingAreaM2([
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  const objects = sphericalRingAreaM2([
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
    { lat: 1, lon: 0 },
  ]);
  const closed = sphericalRingAreaM2([
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ]);
  assert.equal(objects, pairs);
  assert.equal(closed, pairs);
});

test('sphericalRingAreaM2: degenerate collinear ring has area 0', () => {
  assert.equal(
    sphericalRingAreaM2([
      [0, 0],
      [0, 1],
      [0, 2],
    ]),
    0,
  );
});

test('sphericalRingAreaM2: invalid rings return null, never throw or NaN', () => {
  assert.equal(
    sphericalRingAreaM2([
      [0, 0],
      [0, 1],
    ]),
    null,
  ); // < 3 vertices
  assert.equal(sphericalRingAreaM2('nope'), null);
  assert.equal(sphericalRingAreaM2(null), null);
  assert.equal(sphericalRingAreaM2([]), null);
  assert.equal(
    sphericalRingAreaM2([
      [0, 0],
      [0, NaN],
      [1, 1],
    ]),
    null,
  );
  assert.equal(
    sphericalRingAreaM2([
      [100, 0],
      [100, 1],
      [101, 1],
    ]),
    null,
  ); // lat > 90
  assert.equal(
    sphericalRingAreaM2([
      [0, 200],
      [1, 200],
      [1, 201],
    ]),
    null,
  ); // lon > 180
  // [lon, lat]-ordered input is rejected when the longitude-as-latitude
  // falls outside [-90, 90] — the documented order is [lat, lon].
  assert.equal(
    sphericalRingAreaM2([
      [100, 10],
      [101, 10],
      [101, 11],
    ]),
    null,
  );
});

test('sphericalRingPerimeterM: 1°×1° square is four great-circle legs', () => {
  // Meridian legs are 111194.93 m; the parallel legs shrink with latitude.
  closeTo(
    sphericalRingPerimeterM([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]),
    444763.38,
    1,
  );
  // The closing edge is implied for open rings.
  closeTo(
    sphericalRingPerimeterM([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]),
    sphericalRingPerimeterM([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]),
    1e-9,
  );
  assert.equal(
    sphericalRingPerimeterM([
      [0, 0],
      [0, 1],
    ]),
    null,
  );
  assert.equal(sphericalRingPerimeterM('x'), null);
});

test('sphericalPolygonAreaM2: outer minus holes, clamped at zero', () => {
  const outer = [
    [0, 0],
    [0, 2],
    [2, 2],
    [2, 0],
  ];
  const hole = [
    [0.5, 0.5],
    [0.5, 1.5],
    [1.5, 1.5],
    [1.5, 0.5],
  ];
  const withHole = sphericalPolygonAreaM2([outer, hole]);
  closeTo(
    withHole,
    sphericalRingAreaM2(outer) - sphericalRingAreaM2(hole),
    1e-6,
  );
  closeTo(withHole, 37089736376.09, 100);
  // A hole larger than its outer ring is a caller bug: clamp at 0.
  assert.equal(sphericalPolygonAreaM2([hole, outer]), 0);
  // Any invalid ring poisons the polygon.
  assert.equal(
    sphericalPolygonAreaM2([
      outer,
      [
        [0, 0],
        [1, 1],
      ],
    ]),
    null,
  );
  assert.equal(sphericalPolygonAreaM2([]), null);
  assert.equal(sphericalPolygonAreaM2('x'), null);
});

test('sphericalRingCentroid: square centroid and antimeridian safety', () => {
  const c = sphericalRingCentroid([
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ]);
  closeTo(c.lat, 0.5, 0.001);
  closeTo(c.lon, 0.5, 0.001);
  // A naive lat/lon average of this ring lands near lon 0 — wrong side.
  const am = sphericalRingCentroid([
    [0, 179],
    [0, -179],
    [1, -179],
    [1, 179],
  ]);
  closeTo(am.lat, 0.5, 0.001);
  assert.ok(Math.abs(Math.abs(am.lon) - 180) < 0.001);
  assert.equal(
    sphericalRingCentroid([
      [0, 0],
      [0, 1],
    ]),
    null,
  );
});

test('sphericalRingCentroid: null for antipodally symmetric rings', () => {
  // (0,0), (0,120), (0,240): 3D vectors cancel exactly — no meaningful
  // centroid exists.
  assert.equal(
    sphericalRingCentroid([
      [0, 0],
      [0, 120],
      [0, 240],
    ]),
    null,
  );
});

test('sphericalPointInRing: inside/outside on a plain square', () => {
  const square = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ];
  assert.equal(sphericalPointInRing(square, 0.5, 0.5), true);
  assert.equal(sphericalPointInRing(square, 5, 5), false);
  assert.equal(sphericalPointInRing(square, 0.5, -0.5), false);
  // Boundary counts as inside.
  assert.equal(sphericalPointInRing(square, 0, 0.5), true);
  assert.equal(sphericalPointInRing(square, 0, 0), true);
});

test('sphericalPointInRing: antimeridian ring keeps its topology', () => {
  const ring = [
    [0, 179],
    [0, -179],
    [1, -179],
    [1, 179],
  ];
  assert.equal(sphericalPointInRing(ring, 0.5, 180), true);
  assert.equal(sphericalPointInRing(ring, 0.5, -179.5), true);
  assert.equal(sphericalPointInRing(ring, 0.5, 179.5), true);
  // Unwrapping around the query would tear this ring across the plane
  // and wrongly report these as inside.
  assert.equal(sphericalPointInRing(ring, 0.5, 0), false);
  assert.equal(sphericalPointInRing(ring, 0.5, 90), false);
});

test('sphericalPointInRing: invalid input and polar queries return null', () => {
  const square = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ];
  assert.equal(
    sphericalPointInRing(
      [
        [0, 0],
        [0, 1],
      ],
      0.5,
      0.5,
    ),
    null,
  );
  assert.equal(sphericalPointInRing(square, NaN, 0.5), null);
  assert.equal(sphericalPointInRing(square, 0.5, 200), null);
  assert.equal(sphericalPointInRing('x', 0.5, 0.5), null);
  // Tangent projection degenerates near the pole.
  assert.equal(sphericalPointInRing(square, 89.5, 0.5), null);
  assert.equal(sphericalPointInRing(square, -90, 0), null);
});
