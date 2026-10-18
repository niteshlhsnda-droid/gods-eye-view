import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_CONE_ARC_SEGMENTS,
  VIEW_CONE_DEFAULT_HEIGHT_M,
  VIEW_CONE_DEFAULT_RANGE_M,
  coneBbox,
  pointInViewCone,
  viewCone,
} from './viewCone.js';
import { metresBetween } from './view.js';

/** {lon, lat} of a point `metres` north of the origin. */
const north = (metres) => ({ lon: 0, lat: metres / 110_540 });
const south = (metres) => ({ lon: 0, lat: -metres / 110_540 });
const east = (metres) => ({ lon: metres / 111_320, lat: 0 });
const west = (metres) => ({ lon: -metres / 111_320, lat: 0 });

test('rejects unusable input with null', () => {
  assert.equal(viewCone(), null);
  assert.equal(viewCone({}), null);
  assert.equal(viewCone({ lat: 0, lon: 0 }), null); // no heading
  assert.equal(viewCone({ lat: NaN, lon: 0, heading: 0 }), null);
  assert.equal(viewCone({ lat: 91, lon: 0, heading: 0 }), null);
  assert.equal(viewCone({ lat: 0, lon: 0, heading: NaN }), null);
  assert.equal(viewCone({ lat: 0, lon: 0, heading: 0 }), null); // no fov
  assert.equal(viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: 0 }), null);
  assert.equal(viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: -45 }), null);
  assert.equal(viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: NaN }), null);
  assert.equal(
    viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: 90, rangeM: 0 }),
    null,
  );
  assert.equal(
    viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: 90, rangeM: -5 }),
    null,
  );
  assert.equal(
    viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: 90, heightM: 0 }),
    null,
  );
  assert.equal(
    viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: 90, heightM: -1 }),
    null,
  );
});

test('north-facing cone: apex + arc spanning heading ± fov/2', () => {
  const cone = viewCone({
    lat: 0,
    lon: 0,
    heading: 0,
    fovDeg: 90,
    rangeM: 100,
  });
  assert.ok(cone);
  assert.equal(cone.vertices.length, 1 + VIEW_CONE_ARC_SEGMENTS);
  assert.deepEqual(cone.apex, { lon: 0, lat: 0 });
  assert.equal(cone.heading, 0);
  assert.equal(cone.fovDeg, 90);
  assert.equal(cone.radiusM, 100);
  assert.equal(cone.isPano, false);
  // First arc vertex at bearing -45°: ahead and to the west.
  const first = cone.vertices[1];
  assert.ok(first.lat > 0 && first.lon < 0);
  // Last arc vertex at bearing +45°: ahead and to the east.
  const last = cone.vertices[cone.vertices.length - 1];
  assert.ok(last.lat > 0 && last.lon > 0);
  // Mid arc vertex at bearing 0°: due north at the full range.
  const mid = cone.vertices[1 + (VIEW_CONE_ARC_SEGMENTS - 1) / 2];
  assert.ok(Math.abs(mid.lon) < 1e-12);
  assert.ok(Math.abs(metresBetween(mid, cone.apex) - 100) / 100 < 0.02);
});

test('containment: inside ahead, outside behind, beside and beyond range', () => {
  const cone = viewCone({
    lat: 0,
    lon: 0,
    heading: 0,
    fovDeg: 90,
    rangeM: 100,
  });
  assert.equal(pointInViewCone({ lon: 0, lat: 0 }, cone), true); // the apex
  assert.equal(pointInViewCone(north(50), cone), true);
  assert.equal(pointInViewCone(south(50), cone), false); // behind
  assert.equal(pointInViewCone(east(50), cone), false); // 90° > 45° half-angle
  assert.equal(pointInViewCone(west(50), cone), false);
  assert.equal(pointInViewCone(north(150), cone), false); // beyond range
  assert.equal(pointInViewCone(north(99), cone), true);
});

test('containment: heading wraps and the cone points the wrapped way', () => {
  const eastCone = viewCone({
    lat: 0,
    lon: 0,
    heading: 720,
    fovDeg: 90,
    rangeM: 100,
  });
  assert.equal(eastCone.heading, 0);
  const westCone = viewCone({
    lat: 0,
    lon: 0,
    heading: -90,
    fovDeg: 90,
    rangeM: 100,
  });
  assert.equal(westCone.heading, 270);
  assert.equal(pointInViewCone(west(50), westCone), true);
  assert.equal(pointInViewCone(east(50), westCone), false);
  assert.equal(pointInViewCone(north(50), westCone), false);
});

test('pano: full-disc footprint in every direction, radius-capped', () => {
  const cone = viewCone({ lat: 0, lon: 0, heading: 200, isPano: true });
  assert.ok(cone);
  assert.equal(cone.isPano, true);
  assert.equal(cone.fovDeg, 360);
  assert.equal(cone.radiusM, VIEW_CONE_DEFAULT_RANGE_M);
  assert.equal(cone.vertices.length, 1 + VIEW_CONE_ARC_SEGMENTS);
  assert.equal(pointInViewCone(north(30), cone), true);
  assert.equal(pointInViewCone(south(30), cone), true);
  assert.equal(pointInViewCone(east(30), cone), true);
  assert.equal(pointInViewCone(west(30), cone), true);
  assert.equal(
    pointInViewCone(north(VIEW_CONE_DEFAULT_RANGE_M + 1), cone),
    false,
  );
});

test('fovDeg >= 360 without isPano also yields a pano disc', () => {
  const cone = viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: 720 });
  assert.ok(cone);
  assert.equal(cone.isPano, true);
  assert.equal(cone.fovDeg, 360);
  assert.equal(pointInViewCone(south(10), cone), true);
});

test('range cap: a short range sees only a short way', () => {
  const cone = viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: 90, rangeM: 10 });
  assert.equal(cone.radiusM, 10);
  assert.equal(pointInViewCone(north(9), cone), true);
  assert.equal(pointInViewCone(north(11), cone), false);
});

test('horizon cap: an absurd range is capped by camera height', () => {
  const expected = Math.sqrt(2 * 6_371_000 * VIEW_CONE_DEFAULT_HEIGHT_M);
  const cone = viewCone({
    lat: 0,
    lon: 0,
    heading: 0,
    fovDeg: 90,
    rangeM: 1e9,
  });
  assert.ok(Math.abs(cone.radiusM - expected) / expected < 0.001);
});

test('coneBbox: tight bounds around apex and arc', () => {
  const cone = viewCone({
    lat: 0,
    lon: 0,
    heading: 0,
    fovDeg: 90,
    rangeM: 100,
  });
  const box = coneBbox(cone);
  assert.ok(box);
  assert.ok(box.south <= 0 && box.north > 0);
  assert.ok(box.west < 0 && box.east > 0);
  assert.ok(box.west <= box.east); // no date-line crossing here
  const far = cone.vertices[cone.vertices.length - 1];
  assert.ok(far.lon <= box.east && far.lat <= box.north);
  assert.equal(coneBbox(null), null);
  assert.equal(coneBbox({ vertices: [] }), null);
});

test('coneBbox: marks a date-line crossing with west > east', () => {
  const cone = viewCone({
    lat: 0,
    lon: 179.9995,
    heading: 90,
    fovDeg: 60,
    rangeM: 100,
  });
  assert.ok(cone);
  const box = coneBbox(cone);
  assert.ok(box.west > box.east);
  assert.ok(box.west > 179 && box.east < -179);
});

test('containment works the short way round the date line', () => {
  const cone = viewCone({
    lat: 0,
    lon: 179.9995,
    heading: 90,
    fovDeg: 60,
    rangeM: 100,
  });
  // 80 m east of the camera: across the line, inside the cone.
  const eastWrapped = 179.9995 + 80 / 111_320 - 360; // -179.99978…
  assert.equal(pointInViewCone({ lon: eastWrapped, lat: 0 }, cone), true);
  // 50 m west: behind the east-facing camera.
  assert.equal(
    pointInViewCone({ lon: 179.9995 - 50 / 111_320, lat: 0 }, cone),
    false,
  );
});

test('pointInViewCone rejects garbage without throwing', () => {
  const cone = viewCone({ lat: 0, lon: 0, heading: 0, fovDeg: 90 });
  assert.equal(pointInViewCone({ lon: NaN, lat: 0 }, cone), false);
  assert.equal(pointInViewCone(null, cone), false);
  assert.equal(pointInViewCone({ lon: 0, lat: 0 }, null), false);
  assert.equal(pointInViewCone({ lon: 0, lat: 0 }, { vertices: [] }), false);
});

test('footprints are deterministic across calls', () => {
  const options = { lat: 25.6, lon: 85.1, heading: 137, fovDeg: 120 };
  assert.deepEqual(viewCone(options), viewCone(options));
});
