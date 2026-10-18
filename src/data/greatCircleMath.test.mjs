import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  densifyGreatCircle,
  greatCircleSegmentsIntersect,
  interpolateGreatCircle,
} from './greatCircleMath.js';
import { midpoint } from './geoMath.js';

// Independent oracle helpers (plain 3D geometry, not the module's logic).
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const R = 6_371_008.8;
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
const centralAngle = (a, b, c, d) => {
  const va = toVec(a, b);
  const vb = toVec(c, d);
  return Math.acos(Math.min(1, Math.max(-1, dot(va, vb))));
};
const approxPt = (got, lat, lon, tol = 1e-6) => {
  assert.ok(
    Math.abs(got.lat - lat) < tol && Math.abs(got.lon - lon) < tol,
    `expected ~(${lat}, ${lon}), got (${got.lat}, ${got.lon})`,
  );
};

// --- interpolateGreatCircle ---

test('fraction 0 returns the start, fraction 1 the end', () => {
  approxPt(interpolateGreatCircle(51.5, -0.12, 48.85, 2.35, 0), 51.5, -0.12);
  approxPt(interpolateGreatCircle(51.5, -0.12, 48.85, 2.35, 1), 48.85, 2.35);
});

test('equator quarter arc interpolates exactly along the equator', () => {
  approxPt(interpolateGreatCircle(0, 0, 0, 90, 0.25), 0, 22.5, 1e-9);
  approxPt(interpolateGreatCircle(0, 0, 0, 90, 0.5), 0, 45, 1e-9);
  approxPt(interpolateGreatCircle(0, 0, 0, 90, 0.75), 0, 67.5, 1e-9);
});

test('meridian arc interpolates exactly along the meridian', () => {
  approxPt(interpolateGreatCircle(0, 0, 90, 0, 0.5), 45, 0, 1e-9);
  approxPt(interpolateGreatCircle(-30, 10, 30, 10, 0.5), 0, 10, 1e-9);
});

test('interpolation is direction-symmetric: interp(a,b,f) == interp(b,a,1-f)', () => {
  const fwd = interpolateGreatCircle(51.5, -0.12, -33.86, 151.2, 0.3);
  const rev = interpolateGreatCircle(-33.86, 151.2, 51.5, -0.12, 0.7);
  approxPt(fwd, rev.lat, rev.lon, 1e-9);
});

test('halfway interpolation agrees with geoMath.midpoint (independent formula)', () => {
  const pairs = [
    [51.5, -0.12, 48.85, 2.35],
    [0, 0, 0, 90],
    [-33.86, 151.2, 35.68, 139.69],
    [60, -150, 20, 30],
  ];
  for (const [la1, lo1, la2, lo2] of pairs) {
    const slerp = interpolateGreatCircle(la1, lo1, la2, lo2, 0.5);
    const mid = midpoint(la1, lo1, la2, lo2);
    approxPt(slerp, mid.lat, mid.lon, 1e-9);
  }
});

test('antipodal midpoint is ambiguous: slerp and geoMath.midpoint may differ, both must be valid', () => {
  // (60,-150) and (-60,30) are antipodal: every great circle through them
  // is a valid "midpoint path", so implementations may legitimately pick
  // different ones. Both answers must be on-sphere and finite.
  const s = interpolateGreatCircle(60, -150, -60, 30, 0.5);
  const g = midpoint(60, -150, -60, 30);
  for (const p of [s, g]) {
    assert.ok(p !== null && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    assert.ok(p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180);
  }
});

test('interpolated point lies on the great circle and at fraction * arc angle', () => {
  const la1 = 51.5;
  const lo1 = -0.12;
  const la2 = -33.86;
  const lo2 = 151.2;
  const f = 0.37;
  const p = interpolateGreatCircle(la1, lo1, la2, lo2, f);
  const va = toVec(la1, lo1);
  const vb = toVec(la2, lo2);
  const vp = toVec(p.lat, p.lon);
  // On the great-circle plane: dot(p, a×b) == 0.
  const n = [
    va[1] * vb[2] - va[2] * vb[1],
    va[2] * vb[0] - va[0] * vb[2],
    va[0] * vb[1] - va[1] * vb[0],
  ];
  assert.ok(Math.abs(dot(vp, n)) < 1e-9, `off-plane by ${dot(vp, n)}`);
  // At fraction f of the arc from a.
  const arc = centralAngle(la1, lo1, la2, lo2);
  assert.ok(
    Math.abs(centralAngle(la1, lo1, p.lat, p.lon) - f * arc) < 1e-9,
    `arc fraction off`,
  );
});

test('coincident points return the point for any fraction', () => {
  approxPt(interpolateGreatCircle(10, 20, 10, 20, 0.37), 10, 20, 1e-12);
  approxPt(interpolateGreatCircle(-45, 170, -45, 170, 1), -45, 170, 1e-12);
});

test('antipodal endpoints return a valid on-sphere point, not NaN', () => {
  const p = interpolateGreatCircle(0, 0, 0, 180, 0.5);
  assert.ok(p !== null, 'must not be null');
  assert.ok(
    Number.isFinite(p.lat) && Number.isFinite(p.lon),
    `got (${p.lat}, ${p.lon})`,
  );
  assert.ok(p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180);
  // Deterministic across calls.
  const q = interpolateGreatCircle(0, 0, 0, 180, 0.5);
  assert.deepStrictEqual(p, q);
  // Endpoints still exact on the fallback path.
  approxPt(interpolateGreatCircle(0, 0, 0, 180, 0), 0, 0, 1e-9);
  approxPt(interpolateGreatCircle(0, 0, 0, 180, 1), 0, 180, 1e-9);
});

test('near-antipodal endpoints interpolate without exploding', () => {
  const p = interpolateGreatCircle(0, 0, 0, 179.9999999, 0.5);
  assert.ok(p !== null && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  // Still on the minor arc between the endpoints.
  const arc = centralAngle(0, 0, 0, 179.9999999);
  assert.ok(
    Math.abs(centralAngle(0, 0, p.lat, p.lon) - 0.5 * arc) < 1e-6,
    `fraction off: (${p.lat}, ${p.lon})`,
  );
});

test('interpolate returns null on invalid input', () => {
  assert.strictEqual(interpolateGreatCircle(91, 0, 0, 0, 0.5), null);
  assert.strictEqual(interpolateGreatCircle(0, 181, 0, 0, 0.5), null);
  assert.strictEqual(interpolateGreatCircle(0, 0, 0, 0, -0.1), null);
  assert.strictEqual(interpolateGreatCircle(0, 0, 0, 0, 1.1), null);
  assert.strictEqual(interpolateGreatCircle(0, 0, 0, 0, NaN), null);
  assert.strictEqual(interpolateGreatCircle(NaN, 0, 0, 0, 0.5), null);
  assert.strictEqual(interpolateGreatCircle(0, 0, Infinity, 0, 0.5), null);
});

// --- densifyGreatCircle ---

test('densify caps every segment at maxSegmentM (London–Paris, 100 km)', () => {
  const pts = densifyGreatCircle(51.5074, -0.1278, 48.8566, 2.3522, 100_000);
  assert.ok(pts !== null);
  // ~343.6 km / 100 km -> ceil = 4 segments -> 5 points.
  assert.strictEqual(pts.length, 5);
  approxPt(pts[0], 51.5074, -0.1278, 1e-9);
  approxPt(pts[4], 48.8566, 2.3522, 1e-9);
  for (let i = 1; i < pts.length; i++) {
    const segM =
      centralAngle(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon) * R;
    assert.ok(segM <= 100_000 + 1, `segment ${i} is ${segM} m`);
  }
});

test('densify with maxSegmentM >= distance returns just the endpoints', () => {
  const pts = densifyGreatCircle(0, 0, 0, 1, 200_000);
  assert.ok(pts !== null);
  assert.strictEqual(pts.length, 2);
  approxPt(pts[0], 0, 0, 1e-9);
  approxPt(pts[1], 0, 1, 1e-9);
});

test('densify of a zero-length arc returns a single point', () => {
  const pts = densifyGreatCircle(10, 20, 10, 20, 1000);
  assert.deepStrictEqual(pts, [{ lat: 10, lon: 20 }]);
});

test('densify waypoints are evenly spaced along the arc', () => {
  const pts = densifyGreatCircle(0, 0, 0, 90, 10_000_000);
  // 1/4 of the earth = ~10,018 km; 10,000 km cap -> 2 segments.
  assert.strictEqual(pts.length, 3);
  approxPt(pts[1], 0, 45, 1e-6);
});

test('densify returns null on invalid input', () => {
  assert.strictEqual(densifyGreatCircle(0, 0, 0, 1, 0), null);
  assert.strictEqual(densifyGreatCircle(0, 0, 0, 1, -5), null);
  assert.strictEqual(densifyGreatCircle(0, 0, 0, 1, NaN), null);
  assert.strictEqual(densifyGreatCircle(0, 0, 0, 1, Infinity), null);
  assert.strictEqual(densifyGreatCircle(91, 0, 0, 1, 1000), null);
});

// --- greatCircleSegmentsIntersect ---

test('crossing segments intersect at (0, 0)', () => {
  const p = greatCircleSegmentsIntersect([0, -10], [0, 10], [-10, 0], [10, 0]);
  assert.ok(p !== null);
  approxPt(p, 0, 0, 1e-6);
});

test('accepts {lat, lon} objects as well as pairs', () => {
  const p = greatCircleSegmentsIntersect(
    { lat: 0, lon: -10 },
    { lat: 0, lon: 10 },
    { lat: -10, lon: 0 },
    { lat: 10, lon: 0 },
  );
  assert.ok(p !== null);
  approxPt(p, 0, 0, 1e-6);
});

test('parallel non-touching segments do not intersect', () => {
  assert.strictEqual(
    greatCircleSegmentsIntersect([0, -10], [0, 10], [20, -10], [20, 10]),
    null,
  );
});

test('great circles cross but the minor arcs do not overlap', () => {
  // Circles meet at (0,0)/(0,180); neither point is on both arcs.
  assert.strictEqual(
    greatCircleSegmentsIntersect([0, 10], [0, 20], [-10, 0], [-5, 0]),
    null,
  );
});

test('segments sharing an endpoint intersect there', () => {
  const p = greatCircleSegmentsIntersect([0, -10], [0, 0], [0, 0], [10, 0]);
  assert.ok(p !== null);
  approxPt(p, 0, 0, 1e-6);
});

test('intersection works across the antimeridian', () => {
  const p = greatCircleSegmentsIntersect(
    [0, 179],
    [0, -179],
    [-10, 180],
    [10, 180],
  );
  assert.ok(p !== null, 'expected an intersection');
  assert.ok(Math.abs(p.lat) < 1e-6, `lat ${p.lat}`);
  assert.ok(Math.abs(Math.abs(p.lon) - 180) < 1e-6, `lon ${p.lon}`);
});

test('collinear overlapping segments on one great circle return a point in the overlap', () => {
  const p = greatCircleSegmentsIntersect([0, 0], [0, 20], [0, 10], [0, 30]);
  assert.ok(p !== null);
  // Any point of the overlap [10, 20] on the equator is a valid answer.
  assert.ok(Math.abs(p.lat) < 1e-6, `lat ${p.lat}`);
  assert.ok(p.lon >= 10 - 1e-6 && p.lon <= 20 + 1e-6, `lon ${p.lon}`);
});

test('collinear touching segments return the touching endpoint', () => {
  const p = greatCircleSegmentsIntersect([0, 0], [0, 10], [0, 10], [0, 20]);
  assert.ok(p !== null);
  approxPt(p, 0, 10, 1e-6);
});

test('collinear disjoint segments on one great circle do not intersect', () => {
  assert.strictEqual(
    greatCircleSegmentsIntersect([0, 0], [0, 10], [0, 20], [0, 30]),
    null,
  );
});

test('a point segment on the other arc intersects at the point', () => {
  const p = greatCircleSegmentsIntersect([0, 0], [0, 0], [0, -10], [0, 10]);
  assert.ok(p !== null);
  approxPt(p, 0, 0, 1e-6);
});

test('a point segment off the other arc does not intersect', () => {
  assert.strictEqual(
    greatCircleSegmentsIntersect([5, 0], [5, 0], [0, -10], [0, 10]),
    null,
  );
});

test('two identical point segments intersect; two different ones do not', () => {
  const p = greatCircleSegmentsIntersect([3, 4], [3, 4], [3, 4], [3, 4]);
  assert.ok(p !== null);
  approxPt(p, 3, 4, 1e-9);
  assert.strictEqual(
    greatCircleSegmentsIntersect([3, 4], [3, 4], [3, 5], [3, 5]),
    null,
  );
});

test('intersection returns null on invalid input', () => {
  assert.strictEqual(
    greatCircleSegmentsIntersect([0, 0], [0, 10], [91, 0], [10, 0]),
    null,
  );
  assert.strictEqual(
    greatCircleSegmentsIntersect([0, 0], 'x', [0, -10], [0, 10]),
    null,
  );
  assert.strictEqual(
    greatCircleSegmentsIntersect([0, 0], [0, 10], [0, -10], null),
    null,
  );
});
