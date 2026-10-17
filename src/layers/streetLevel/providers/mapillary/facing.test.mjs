import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FACING_MAX_EXTRA_M,
  FACING_TOLERANCE_DEG,
  angularDifference,
  facesHeading,
  headingOf,
  normalizeHeading,
  pickFacingImage,
} from './facing.js';

test('angularDifference is the short way round the compass', () => {
  assert.equal(angularDifference(10, 10), 0);
  assert.equal(angularDifference(350, 10), 20);
  assert.equal(angularDifference(10, 350), 20);
  assert.equal(angularDifference(0, 180), 180);
  assert.equal(angularDifference(90, 270), 180);
  assert.equal(angularDifference(0, 359), 1);
});

test('normalizeHeading wraps and rejects unusable values', () => {
  assert.equal(normalizeHeading(0), 0);
  assert.equal(normalizeHeading(-10), 350);
  assert.equal(normalizeHeading(370), 10);
  assert.equal(normalizeHeading(360), 0);
  assert.equal(normalizeHeading('90'), 90);
  assert.equal(normalizeHeading(null), null);
  assert.equal(normalizeHeading(undefined), null);
  assert.equal(normalizeHeading(''), null);
  assert.equal(normalizeHeading('   '), null);
  assert.equal(normalizeHeading(Number.NaN), null);
  assert.equal(normalizeHeading('north'), null);
  assert.equal(normalizeHeading(true), null);
  assert.equal(normalizeHeading({}), null);
});

test('headingOf prefers the computed compass and keeps a 0 compass', () => {
  assert.equal(
    headingOf({ computed_compass_angle: 200, compass_angle: 10 }),
    200,
  );
  assert.equal(headingOf({ compass_angle: 10 }), 10);
  assert.equal(headingOf({ compass_angle: 0 }), 0);
  assert.equal(headingOf({ computed_compass_angle: 0, compass_angle: 10 }), 0);
  assert.equal(headingOf({}), null);
  assert.equal(headingOf({ compass_angle: 'bad' }), null);
  assert.equal(headingOf(null), null);
});

test('facesHeading treats panos as facing every direction', () => {
  assert.equal(facesHeading({ is_pano: true }, 0), true);
  assert.equal(facesHeading({ is_pano: true }, 180), true);
  assert.equal(facesHeading({ is_pano: true, compass_angle: 270 }, 0), true);
});

test('facesHeading applies the tolerance, across the 0° wrap', () => {
  assert.equal(facesHeading({ compass_angle: 90 }, 90), true);
  assert.equal(
    facesHeading({ compass_angle: 90 }, 90 + FACING_TOLERANCE_DEG),
    true,
  );
  assert.equal(
    facesHeading({ compass_angle: 90 }, 90 + FACING_TOLERANCE_DEG + 1),
    false,
  );
  assert.equal(facesHeading({ compass_angle: 350 }, 10), true);
  assert.equal(facesHeading({ compass_angle: 10 }, 350), true);
  assert.equal(facesHeading({ compass_angle: 270 }, 90), false);
  assert.equal(facesHeading({ compass_angle: 90 }, null), false);
  assert.equal(facesHeading({}, 90), false);
});

test('pickFacingImage without a heading picks the nearest record', () => {
  const at = (id, lon, compassAngle) => ({
    id,
    compass_angle: compassAngle,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const records = [at('far-facing', 2.0004, 90), at('near-away', 2.00005, 270)];
  assert.equal(pickFacingImage(records, { lat: 1, lon: 2 }).id, 'near-away');
  assert.equal(
    pickFacingImage(records, { lat: 1, lon: 2, heading: null }).id,
    'near-away',
  );
  assert.equal(
    pickFacingImage(records, { lat: 1, lon: 2, heading: 'bad' }).id,
    'near-away',
  );
});

test('pickFacingImage prefers a facing shot a few metres farther away', () => {
  const at = (id, lon, compassAngle) => ({
    id,
    compass_angle: compassAngle,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  // ~5 m east, facing away (west); ~11 m east, facing the requested east.
  const records = [at('near-away', 2.00005, 270), at('far-facing', 2.0001, 90)];
  assert.equal(
    pickFacingImage(records, { lat: 1, lon: 2, heading: 90 }).id,
    'far-facing',
  );
  // Looking west instead: the near shot already faces the right way.
  assert.equal(
    pickFacingImage(records, { lat: 1, lon: 2, heading: 270 }).id,
    'near-away',
  );
});

test('pickFacingImage keeps the nearest shot when the facing one is too far', () => {
  const at = (id, lon, compassAngle) => ({
    id,
    compass_angle: compassAngle,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  // ~5 m east facing away; the facing shot is ~45 m east, past the extra.
  const records = [at('near-away', 2.00005, 270), at('far-facing', 2.0004, 90)];
  assert.equal(
    pickFacingImage(records, { lat: 1, lon: 2, heading: 90 }).id,
    'near-away',
  );
});

test('pickFacingImage counts a pano as facing, even with no compass', () => {
  const at = (id, lon, extra = {}) => ({
    id,
    ...extra,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  });
  const records = [
    at('near-flat-away', 2.00005, { compass_angle: 270 }),
    at('pano', 2.0001, { is_pano: true }),
  ];
  assert.equal(
    pickFacingImage(records, { lat: 1, lon: 2, heading: 90 }).id,
    'pano',
  );
});

test('pickFacingImage uses computed geometry and computed compass', () => {
  const records = [
    {
      id: 'away',
      compass_angle: 270,
      computed_compass_angle: 270,
      geometry: { type: 'Point', coordinates: [0, 0] },
      computed_geometry: { type: 'Point', coordinates: [2.00005, 1] },
    },
    {
      id: 'facing',
      compass_angle: 270,
      computed_compass_angle: 90,
      geometry: { type: 'Point', coordinates: [0, 0] },
      computed_geometry: { type: 'Point', coordinates: [2.0001, 1] },
    },
  ];
  assert.equal(
    pickFacingImage(records, { lat: 1, lon: 2, heading: 90 }).id,
    'facing',
  );
});

test('pickFacingImage sorts position-less records last and handles empties', () => {
  const records = [
    { id: 'no-position', compass_angle: 90 },
    {
      id: 'positioned-away',
      compass_angle: 270,
      geometry: { type: 'Point', coordinates: [2.00005, 1] },
    },
  ];
  assert.equal(
    pickFacingImage(records, { lat: 1, lon: 2, heading: 90 }).id,
    'positioned-away',
  );
  assert.equal(pickFacingImage([], { lat: 1, lon: 2 }), null);
  assert.equal(pickFacingImage(null, { lat: 1, lon: 2 }), null);
  // Alone, a position-less record is still the only answer.
  assert.equal(
    pickFacingImage([{ id: 'only' }], { lat: 1, lon: 2 }).id,
    'only',
  );
});

test('the facing trade-off bound is the documented 15 m', () => {
  assert.equal(FACING_MAX_EXTRA_M, 15);
  assert.equal(FACING_TOLERANCE_DEG, 60);
});
