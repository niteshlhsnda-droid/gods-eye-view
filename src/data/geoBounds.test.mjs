import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsCenter,
  boundsContains,
  boundsContainsBounds,
  boundsFromPoints,
  boundsIntersects,
  boundsIntersection,
  boundsSpanDeg,
  boundsToArray,
  boundsUnion,
  expandBounds,
  isValidBounds,
  normalizeBounds,
  splitAtAntimeridian,
} from './geoBounds.js';

test('normalizeBounds accepts the array and object shapes', () => {
  assert.deepEqual(normalizeBounds([10, 20, 30, 40]), {
    west: 10,
    south: 20,
    east: 30,
    north: 40,
  });
  assert.deepEqual(
    normalizeBounds({ west: 10, south: 20, east: 30, north: 40 }),
    {
      west: 10,
      south: 20,
      east: 30,
      north: 40,
    },
  );
  // The { south, west, north, east } key order trafficBounds uses is the
  // same object shape, so it normalizes identically.
  assert.deepEqual(
    normalizeBounds({ south: 20, west: 10, north: 40, east: 30 }),
    {
      west: 10,
      south: 20,
      east: 30,
      north: 40,
    },
  );
});

test('normalizeBounds sorts swapped latitudes and wraps longitudes', () => {
  assert.deepEqual(normalizeBounds([10, 40, 30, 20]), {
    west: 10,
    south: 20,
    east: 30,
    north: 40,
  });
  assert.deepEqual(normalizeBounds([170, 0, 190, 10]), {
    west: 170,
    south: 0,
    east: -170,
    north: 10,
  });
});

test('normalizeBounds clamps latitudes and preserves the whole-globe pair', () => {
  assert.deepEqual(normalizeBounds([-180, -95, 180, 95]), {
    west: -180,
    south: -90,
    east: 180,
    north: 90,
  });
});

test('normalizeBounds rejects degenerate and non-finite input', () => {
  assert.equal(normalizeBounds([10, 20, 10, 40]), null); // zero width
  assert.equal(normalizeBounds([180, 20, -180, 40]), null); // seam, zero width
  assert.equal(normalizeBounds([10, 20, 30, 20]), null); // zero height
  assert.equal(normalizeBounds([10, 20, 30]), null);
  assert.equal(normalizeBounds([10, 20, 30, Number.NaN]), null);
  assert.equal(normalizeBounds(null), null);
  assert.equal(normalizeBounds('10,20,30,40'), null);
  assert.equal(isValidBounds([10, 20, 30, 40]), true);
  assert.equal(isValidBounds([10, 20, 10, 40]), false);
});

test('boundsSpanDeg measures the crossing box the short way round', () => {
  assert.deepEqual(boundsSpanDeg([170, -10, -170, 10]), {
    widthDeg: 20,
    heightDeg: 20,
  });
  assert.deepEqual(boundsSpanDeg([-180, -90, 180, 90]), {
    widthDeg: 360,
    heightDeg: 180,
  });
  assert.equal(boundsSpanDeg([10, 20, 10, 40]), null);
});

test('boundsCenter puts a crossing box on the seam, not at 0', () => {
  // The naive (west + east) / 2 midpoint of 170-to--170 is 0 — the point
  // farthest from the box. The eastward midpoint is the seam itself.
  assert.deepEqual(boundsCenter([170, -10, -170, 10]), { lat: 0, lon: -180 });
  assert.deepEqual(boundsCenter([-10, -10, 10, 10]), { lat: 0, lon: 0 });
  assert.equal(boundsCenter(null), null);
});

test('boundsContains is crossing-aware, edge-inclusive, and wraps input', () => {
  const crossing = [170, -10, -170, 10];
  assert.equal(boundsContains(crossing, 0, 179), true);
  assert.equal(boundsContains(crossing, 0, -179), true);
  assert.equal(boundsContains(crossing, 0, 180), true);
  assert.equal(boundsContains(crossing, 0, -180), true);
  assert.equal(boundsContains(crossing, 0, 0), false);
  assert.equal(boundsContains(crossing, 0, 170), true); // west edge
  assert.equal(boundsContains(crossing, 0, -170), true); // east edge
  assert.equal(boundsContains(crossing, 10, 175), true); // north edge
  assert.equal(boundsContains(crossing, 11, 175), false);
  assert.equal(boundsContains(crossing, 0, 190), true); // 190 wraps to -170
  assert.equal(boundsContains(crossing, 0, Number.NaN), false);
  assert.equal(boundsContains([10, 20, 30, 40], 30, 20), true);
  assert.equal(boundsContains([10, 20, 30, 40], 30, 9), false);
  assert.equal(boundsContains(null, 0, 0), false);
});

test('boundsContainsBounds handles crossing outer and inner boxes', () => {
  assert.equal(
    boundsContainsBounds([170, -10, -170, 10], [175, 0, -175, 5]),
    true,
  );
  assert.equal(
    boundsContainsBounds([170, -10, -170, 10], [175, 0, 178, 5]),
    true,
  );
  assert.equal(
    boundsContainsBounds([170, -10, -170, 10], [-10, 0, 10, 5]),
    false,
  );
  assert.equal(boundsContainsBounds([10, 20, 30, 40], [15, 25, 25, 35]), true);
  assert.equal(boundsContainsBounds([10, 20, 30, 40], [15, 25, 35, 35]), false);
  assert.equal(
    boundsContainsBounds([-180, -90, 180, 90], [170, -10, -170, 10]),
    true,
  );
  assert.equal(
    boundsContainsBounds([170, -10, -170, 10], [-180, -90, 180, 90]),
    false,
  );
  assert.equal(boundsContainsBounds(null, [10, 20, 30, 40]), false);
});

test('boundsIntersects sees crossing overlaps and disjoint boxes', () => {
  assert.equal(
    boundsIntersects([170, -10, -170, 10], [-175, 0, -165, 5]),
    true,
  );
  assert.equal(boundsIntersects([170, -10, -170, 10], [0, 0, 10, 5]), false);
  assert.equal(boundsIntersects([10, 20, 30, 40], [30, 20, 50, 40]), true); // edge-touch
  assert.equal(boundsIntersects([10, 20, 30, 40], [31, 20, 50, 40]), false);
  assert.equal(boundsIntersects([10, 20, 30, 40], [15, 41, 25, 50]), false);
  assert.equal(boundsIntersects(null, [10, 20, 30, 40]), false);
});

test('boundsIntersection returns the single overlap, null for two-piece', () => {
  assert.deepEqual(boundsIntersection([10, 20, 30, 40], [20, 30, 50, 50]), {
    west: 20,
    south: 30,
    east: 30,
    north: 40,
  });
  assert.deepEqual(boundsIntersection([170, -10, -170, 10], [175, 0, 180, 5]), {
    west: 175,
    south: 0,
    east: 180,
    north: 5,
  });
  assert.equal(boundsIntersection([10, 20, 30, 40], [50, 20, 60, 40]), null);
  // Crossing box vs wide box: the overlap is TWO segments (170-175 and
  // -175--170), which one bounds cannot represent.
  assert.equal(
    boundsIntersection([170, -10, -170, 10], [-175, 0, 175, 5]),
    null,
  );
  assert.equal(boundsIntersection([10, 20, 30, 40], [10, 40, 30, 50]), null);
});

test('boundsUnion takes the minimal covering arc across the seam', () => {
  // Two halves of the seam join into the 20-degree crossing box, not the
  // 340-degree box around the other way.
  assert.deepEqual(boundsUnion([170, -10, 180, 10], [-180, -10, -170, 10]), {
    west: 170,
    south: -10,
    east: -170,
    north: 10,
  });
  assert.deepEqual(boundsUnion([0, 0, 10, 10], [20, 0, 30, 10]), {
    west: 0,
    south: 0,
    east: 30,
    north: 10,
  });
  // Union is the minimal COVERING box: the gap between the inputs is
  // included, and latitude spans merge.
  assert.deepEqual(boundsUnion([0, 0, 10, 10], [170, 20, 180, 30]), {
    west: 0,
    south: 0,
    east: 180,
    north: 30,
  });
  assert.deepEqual(boundsUnion([-180, -90, 180, 90], [0, 0, 10, 10]), {
    west: -180,
    south: -90,
    east: 180,
    north: 90,
  });
  assert.equal(boundsUnion(null, [0, 0, 10, 10]), null);
});

test('expandBounds grows every side, wraps, and saturates at the globe', () => {
  assert.deepEqual(expandBounds([0, 0, 10, 10], 5), {
    west: -5,
    south: -5,
    east: 15,
    north: 15,
  });
  assert.deepEqual(expandBounds([0, 0, 10, 10], 0), {
    west: 0,
    south: 0,
    east: 10,
    north: 10,
  });
  // Westward past -180 wraps into a crossing box.
  assert.deepEqual(expandBounds([-180, 0, 0, 10], 10), {
    west: 170,
    south: -10,
    east: 10,
    north: 20,
  });
  // A margin that covers the circle yields the whole globe.
  assert.deepEqual(expandBounds([0, 0, 10, 10], 180), {
    west: -180,
    south: -90,
    east: 180,
    north: 90,
  });
  // Latitude clamps at the poles instead of exceeding them.
  assert.deepEqual(expandBounds([0, 80, 10, 85], 10), {
    west: -10,
    south: 70,
    east: 20,
    north: 90,
  });
  assert.equal(expandBounds([0, 0, 10, 10], -1), null);
  assert.equal(expandBounds([0, 0, 10, 10], Number.NaN), null);
  assert.equal(expandBounds(null, 5), null);
});

test('boundsFromPoints uses the minimal arc across the seam', () => {
  assert.deepEqual(
    boundsFromPoints([
      { lat: 0, lon: 179 },
      { lat: 10, lon: -179 },
      { lat: 5, lon: 178 },
    ]),
    { west: 178, south: 0, east: -179, north: 10 },
  );
  assert.deepEqual(
    boundsFromPoints([
      { lat: 0, lon: 0 },
      { lat: 10, lon: 20 },
    ]),
    { west: 0, south: 0, east: 20, north: 10 },
  );
  assert.equal(boundsFromPoints([]), null);
  assert.equal(boundsFromPoints([{ lat: 0, lon: 10 }]), null);
  assert.equal(
    boundsFromPoints([
      { lat: 5, lon: 0 },
      { lat: 5, lon: 20 },
    ]),
    null,
  ); // one parallel only
  assert.equal(
    boundsFromPoints([
      { lat: 0, lon: 10 },
      { lat: 10, lon: 10 },
    ]),
    null,
  ); // one meridian only
  assert.equal(
    boundsFromPoints([
      { lat: 0, lon: 10 },
      { lat: 91, lon: 20 },
    ]),
    null,
  );
  assert.equal(boundsFromPoints(null), null);
});

test('splitAtAntimeridian leaves normal boxes whole and splits crossing ones', () => {
  assert.deepEqual(splitAtAntimeridian([10, 20, 30, 40]), [
    { west: 10, south: 20, east: 30, north: 40 },
  ]);
  assert.deepEqual(splitAtAntimeridian([170, -10, -170, 10]), [
    { west: 170, south: -10, east: 180, north: 10 },
    { west: -180, south: -10, east: -170, north: 10 },
  ]);
  assert.deepEqual(splitAtAntimeridian([-180, -90, 180, 90]), [
    { west: -180, south: -90, east: 180, north: 90 },
  ]);
  assert.equal(splitAtAntimeridian(null), null);
  // Every piece is itself non-crossing.
  for (const piece of splitAtAntimeridian([170, -10, -170, 10])) {
    assert.ok(piece.west <= piece.east);
  }
});

test('boundsToArray round-trips the GeoJSON bbox shape', () => {
  assert.deepEqual(
    boundsToArray({ west: 10, south: 20, east: 30, north: 40 }),
    [10, 20, 30, 40],
  );
  assert.deepEqual(boundsToArray([170, -10, -170, 10]), [170, -10, -170, 10]);
  assert.equal(boundsToArray(null), null);
});
