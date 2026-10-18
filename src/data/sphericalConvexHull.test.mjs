import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sphericalConvexHull } from './sphericalConvexHull.js';

// Independent oracle helpers (plain 3D geometry, not the module's logic).
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const toVec = (lat, lon) => {
  const la = lat * D2R;
  const lo = lon * D2R;
  return [
    Math.cos(la) * Math.cos(lo),
    Math.cos(la) * Math.sin(lo),
    Math.sin(la),
  ];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (x, y, z) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
const vecToLatLon = ([x, y, z]) => ({
  lat: Math.asin(Math.min(1, Math.max(-1, z))) * R2D,
  lon: Math.atan2(y, x) * R2D,
});
/** Signed solid angle of triangle (Oosterom-Strackee), independent of module. */
const signedSolidAngle = (a, b, c) => {
  const num = dot(a, cross(b, c));
  const den = 1 + dot(a, b) + dot(b, c) + dot(c, a);
  return 2 * Math.atan2(num, den);
};
const signedRingArea = (ring) => {
  const v0 = toVec(ring[0].lat, ring[0].lon);
  let s = 0;
  for (let i = 1; i < ring.length - 1; i += 1) {
    s += signedSolidAngle(
      v0,
      toVec(ring[i].lat, ring[i].lon),
      toVec(ring[i + 1].lat, ring[i + 1].lon),
    );
  }
  return s;
};
/** Defining hull property, recomputed here: every input point left of every edge. */
const allPointsInsideHull = (points, ring) => {
  const pvecs = points.map((p) =>
    toVec(Array.isArray(p) ? p[0] : p.lat, Array.isArray(p) ? p[1] : p.lon),
  );
  for (let i = 0; i < ring.length; i += 1) {
    const a = toVec(ring[i].lat, ring[i].lon);
    const b = toVec(
      ring[(i + 1) % ring.length].lat,
      ring[(i + 1) % ring.length].lon,
    );
    const n = cross(a, b);
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-15) return false;
    for (const p of pvecs) {
      if (dot(n, p) / l < -1e-9) return false;
    }
  }
  return true;
};
const sortPts = (pts) =>
  pts.map((p) => [p.lat, p.lon]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test('invalid input returns null, never throws', () => {
  for (const bad of [
    null,
    undefined,
    'nope',
    42,
    [],
    [null],
    [[0]],
    [[0, 0, 0]],
    [[91, 0]],
    [[-91, 0]],
    [[0, 181]],
    [[0, -181]],
    [[NaN, 0]],
    [[0, Infinity]],
    [['a', 'b']],
    [{ lat: 10 }],
    [
      [0, 0],
      [200, 0],
    ],
  ]) {
    assert.equal(sphericalConvexHull(bad), null, JSON.stringify(bad));
  }
});

test('single distinct point returns [point]', () => {
  assert.deepEqual(sphericalConvexHull([[10, 20]]), [{ lat: 10, lon: 20 }]);
  assert.deepEqual(sphericalConvexHull([{ lat: -5, lon: 30 }]), [
    { lat: -5, lon: 30 },
  ]);
});

test('two distinct points return the segment', () => {
  assert.deepEqual(
    sphericalConvexHull([
      [0, 0],
      [0, 10],
    ]),
    [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 10 },
    ],
  );
});

test('coincident duplicates are removed', () => {
  assert.deepEqual(
    sphericalConvexHull([
      [5, 5],
      [5, 5],
      [5, 5],
    ]),
    [{ lat: 5, lon: 5 }],
  );
  const hull = sphericalConvexHull([
    [0, 0],
    [0, 10],
    [0, 10],
  ]);
  assert.deepEqual(hull, [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 10 },
  ]);
});

test('octahedron face triple returns the triangle, CCW', () => {
  const pts = [
    [0, 0],
    [0, 90],
    [90, 0],
  ];
  const hull = sphericalConvexHull(pts);
  assert.equal(hull.length, 3);
  assert.deepEqual(
    sortPts(hull),
    sortPts(pts.map(([lat, lon]) => ({ lat, lon }))),
  );
  // Starts at a deterministic hull vertex (the input point minimizing
  // the dot product with the winning hemisphere pole; exact start
  // index is float-noise-dependent, determinism is covered below).
  assert.ok(
    pts.some(([lat, lon]) => hull[0].lat === lat && hull[0].lon === lon),
  );
  // Counter-clockwise: positive signed solid angle.
  assert.ok(signedRingArea(hull) > 0);
  // Defining property, verified independently.
  assert.ok(allPointsInsideHull(pts, hull));
  // Known area: octant triangle = pi/2 steradians.
  assert.ok(Math.abs(signedRingArea(hull) - Math.PI / 2) < 1e-9);
});

test('square with interior point returns the four corners', () => {
  const corners = [
    [10, 10],
    [10, -10],
    [-10, 10],
    [-10, -10],
  ];
  const pts = [...corners, [0, 0]];
  const hull = sphericalConvexHull(pts);
  assert.equal(hull.length, 4);
  assert.deepEqual(
    sortPts(hull),
    sortPts(corners.map(([lat, lon]) => ({ lat, lon }))),
  );
  assert.ok(signedRingArea(hull) > 0);
  assert.ok(allPointsInsideHull(pts, hull));
});

test('hexagon with interior points returns the six outer vertices', () => {
  const outer = [
    [20, 0],
    [10, 30],
    [-10, 30],
    [-20, 0],
    [-10, -30],
    [10, -30],
  ];
  const pts = [...outer, [0, 0], [5, 5], [-5, -8]];
  const hull = sphericalConvexHull(pts);
  assert.equal(hull.length, 6);
  assert.deepEqual(
    sortPts(hull),
    sortPts(outer.map(([lat, lon]) => ({ lat, lon }))),
  );
  assert.ok(signedRingArea(hull) > 0);
  assert.ok(allPointsInsideHull(pts, hull));
});

test('antimeridian-straddling square is handled (no longitude wrapping bugs)', () => {
  const corners = [
    [10, 170],
    [10, -170],
    [-10, 170],
    [-10, -170],
  ];
  const hull = sphericalConvexHull(corners);
  assert.equal(hull.length, 4);
  assert.deepEqual(
    sortPts(hull),
    sortPts(corners.map(([lat, lon]) => ({ lat, lon }))),
  );
  assert.ok(signedRingArea(hull) > 0);
  assert.ok(allPointsInsideHull(corners, hull));
});

test('full tetrahedron vertex set is not hemisphere-contained -> null', () => {
  const tetra = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ].map((v) => {
    const [x, y, z] = norm3(...v);
    const { lat, lon } = vecToLatLon([x, y, z]);
    return [lat, lon];
  });
  assert.equal(sphericalConvexHull(tetra), null);
});

test('three tetrahedron vertices form a valid triangle', () => {
  const tri = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
  ].map((v) => {
    const [x, y, z] = norm3(...v);
    const { lat, lon } = vecToLatLon([x, y, z]);
    return [lat, lon];
  });
  const hull = sphericalConvexHull(tri);
  assert.equal(hull.length, 3);
  assert.deepEqual(
    sortPts(hull),
    sortPts(tri.map(([lat, lon]) => ({ lat, lon }))),
  );
  assert.ok(signedRingArea(hull) > 0);
  assert.ok(allPointsInsideHull(tri, hull));
});

test('full octahedron vertex set -> null', () => {
  const pts = [
    [0, 0],
    [0, 90],
    [0, 180],
    [0, -90],
    [90, 0],
    [-90, 0],
  ];
  assert.equal(sphericalConvexHull(pts), null);
});

test('antipodal pairs -> null', () => {
  assert.equal(
    sphericalConvexHull([
      [0, 0],
      [0, 180],
    ]),
    null,
  );
  assert.equal(
    sphericalConvexHull([
      [0, 0],
      [0, 180],
      [10, 10],
    ]),
    null,
  );
  // Antipodal pair hidden among hullable points -> still null.
  assert.equal(
    sphericalConvexHull([
      [80, 90],
      [0, 0],
      [80, -90],
      [0, 180],
    ]),
    null,
  );
});

test('great-circle span >= 180 degrees -> null', () => {
  assert.equal(
    sphericalConvexHull([
      [0, 0],
      [0, 120],
      [0, -120],
    ]),
    null,
  );
});

test('collinear points spanning < 180 degrees return the extreme endpoints', () => {
  assert.deepEqual(
    sphericalConvexHull([
      [0, 0],
      [0, 30],
      [0, 60],
    ]),
    [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 60 },
    ],
  );
  // Interior collinear point on a hull edge of a triangle is skipped.
  const hull = sphericalConvexHull([
    [0, 0],
    [0, 60],
    [30, 30],
    [0, 30],
  ]);
  assert.deepEqual(
    sortPts(hull),
    sortPts([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 60 },
      { lat: 30, lon: 30 },
    ]),
  );
});

test('result is deterministic and does not mutate input', () => {
  const pts = [
    [10, 10],
    [10, -10],
    [-10, 10],
    [-10, -10],
    [0, 0],
  ];
  const frozen = JSON.parse(JSON.stringify(pts));
  const a = sphericalConvexHull(pts);
  const b = sphericalConvexHull(pts);
  assert.deepEqual(a, b);
  assert.deepEqual(pts, frozen);
});

test('mixed [lat, lon] and {lat, lon} inputs are accepted', () => {
  const hull = sphericalConvexHull([[0, 0], { lat: 0, lon: 90 }, [90, 0]]);
  assert.equal(hull.length, 3);
  assert.ok(
    allPointsInsideHull(
      [
        [0, 0],
        [0, 90],
        [90, 0],
      ],
      hull,
    ),
  );
});
