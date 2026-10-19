import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSphericalSpatialIndex,
  sphericalKnn,
  sphericalRadiusSearch,
} from './sphericalSpatialIndex.js';

// Independent oracle helpers — separately written from the module:
// haversine in (lat, lon) degree space (the module uses 3D chord
// form), brute-force scans, and its own PRNG.
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EARTH_M = 6_371_008.8;

const haversineOracleM = (lat1, lon1, lat2, lon2) => {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
};

const pointOf = (raw, i) => {
  const p = Array.isArray(raw) ? { lat: raw[0], lon: raw[1] } : raw;
  return { index: i, lat: p.lat, lon: p.lon };
};

/** Brute-force exact kNN oracle, sorted by (distance, index). */
const bruteKnn = (points, qLat, qLon, k) =>
  points
    .map((raw, i) => {
      const p = pointOf(raw, i);
      return { ...p, d: haversineOracleM(qLat, qLon, p.lat, p.lon) };
    })
    .sort((a, b) => (a.d === b.d ? a.index - b.index : a.d - b.d))
    .slice(0, k);

/** Brute-force exact radius oracle, sorted by (distance, index). */
const bruteRadius = (points, qLat, qLon, radiusM) =>
  points
    .map((raw, i) => {
      const p = pointOf(raw, i);
      return { ...p, d: haversineOracleM(qLat, qLon, p.lat, p.lon) };
    })
    .filter((h) => h.d <= radiusM)
    .sort((a, b) => (a.d === b.d ? a.index - b.index : a.d - b.d));

/** Deterministic PRNG (mulberry32). */
const mulberry32 = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/** Uniform point on the sphere, [lat, lon] degrees. */
const uniformSphere = (rand) => [
  Math.asin(2 * rand() - 1) * R2D,
  360 * rand() - 180,
];
/** Uniform point in a small disc around (lat, lon). */
const nearPoint = (rand, lat, lon, radiusDeg) => [
  lat + (rand() * 2 - 1) * radiusDeg,
  lon + (rand() * 2 - 1) * radiusDeg,
];

/** Distance tolerance: the two haversine formulations agree to ~1e-12 relative. */
const closeEnough = (a, b) =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

test('build rejects invalid input with null', () => {
  assert.equal(buildSphericalSpatialIndex(null), null);
  assert.equal(buildSphericalSpatialIndex('nope'), null);
  assert.equal(buildSphericalSpatialIndex([]), null);
  assert.equal(
    buildSphericalSpatialIndex([
      [25, 85],
      [91, 0],
    ]),
    null,
  );
  assert.equal(
    buildSphericalSpatialIndex([
      [25, 85],
      [25, 181],
    ]),
    null,
  );
  assert.equal(
    buildSphericalSpatialIndex([
      [25, 85],
      [NaN, 0],
    ]),
    null,
  );
  assert.equal(buildSphericalSpatialIndex([[25, 85], [25]]), null);
  assert.equal(buildSphericalSpatialIndex([[25, 85], 'x']), null);
  assert.equal(buildSphericalSpatialIndex([[25, 85], { lat: 25 }]), null);
  // A valid index is recognized; anything else is rejected by queries.
  const ok = buildSphericalSpatialIndex([[25, 85]]);
  assert.ok(ok && ok.type === 'spherical-spatial-index/v1' && ok.size === 1);
});

test('build does not mutate the input array', () => {
  const points = [
    [25.6, 85.1],
    { lat: -33.9, lon: 151.2, id: 'syd' },
    [51.5, -0.12],
  ];
  const snapshot = JSON.stringify(points);
  buildSphericalSpatialIndex(points);
  assert.equal(JSON.stringify(points), snapshot);
});

test('single-point index: knn distance 0, radius 0 hits', () => {
  const index = buildSphericalSpatialIndex([[25.5941, 85.1376]]);
  const knn = sphericalKnn(index, [25.5941, 85.1376]);
  assert.equal(knn.length, 1);
  assert.equal(knn[0].index, 0);
  assert.equal(knn[0].distanceM, 0);
  assert.equal(knn[0].lat, 25.5941);
  assert.equal(knn[0].lon, 85.1376);
  assert.equal(sphericalRadiusSearch(index, [25.6, 85.14], 0).length, 0);
  assert.equal(sphericalRadiusSearch(index, [25.5941, 85.1376], 0).length, 1);
});

test('two-point index queries both orders', () => {
  for (const points of [
    [
      [0, 0],
      [0, 90],
    ],
    [
      [0, 90],
      [0, 0],
    ],
  ]) {
    const index = buildSphericalSpatialIndex(points);
    const got = sphericalKnn(index, [0, 45], 2);
    const want = bruteKnn(points, 0, 45, 2);
    assert.equal(got.length, 2);
    for (let i = 0; i < 2; i += 1) {
      assert.equal(got[i].index, want[i].index);
      assert.ok(closeEnough(got[i].distanceM, want[i].d));
    }
  }
});

test('knn matches brute force on seeded uniform-sphere sets', () => {
  const rand = mulberry32(20261019);
  const points = Array.from({ length: 400 }, () => uniformSphere(rand));
  const index = buildSphericalSpatialIndex(points);
  assert.ok(index);
  for (const k of [1, 3, 10, 25]) {
    for (let q = 0; q < 40; q += 1) {
      const [qLat, qLon] = uniformSphere(rand);
      const got = sphericalKnn(index, [qLat, qLon], k);
      const want = bruteKnn(points, qLat, qLon, k);
      assert.equal(got.length, want.length, `k=${k} query ${q}`);
      // Exactness without depending on tie order: every reported entry
      // must name the oracle distance of its own index, and the multiset
      // of distances must match the oracle's top-k multiset.
      for (const entry of got) {
        const oracleD = haversineOracleM(
          qLat,
          qLon,
          points[entry.index][0],
          points[entry.index][1],
        );
        assert.ok(
          closeEnough(entry.distanceM, oracleD),
          `entry distance mismatch k=${k} query ${q}`,
        );
      }
      const gotD = got.map((e) => e.distanceM).sort((a, b) => a - b);
      const wantD = want.map((w) => w.d).sort((a, b) => a - b);
      for (let i = 0; i < wantD.length; i += 1) {
        assert.ok(
          closeEnough(gotD[i], wantD[i]),
          `distance multiset mismatch k=${k} query ${q} pos ${i}`,
        );
      }
      // The true nearest must be first (distance 0 vs >0 can't tie here
      // on continuous random data).
      assert.equal(got[0].index, want[0].index);
    }
  }
});

test('radius search matches brute force on seeded sets', () => {
  const rand = mulberry32(777);
  const points = Array.from({ length: 300 }, () => uniformSphere(rand));
  const index = buildSphericalSpatialIndex(points);
  for (const radiusM of [0, 1000, 100_000, 1_000_000, 20_000_000]) {
    for (let q = 0; q < 25; q += 1) {
      const [qLat, qLon] = uniformSphere(rand);
      const got = sphericalRadiusSearch(index, [qLat, qLon], radiusM);
      const want = bruteRadius(points, qLat, qLon, radiusM);
      assert.equal(got.length, want.length, `r=${radiusM} query ${q}`);
      for (let i = 0; i < want.length; i += 1) {
        assert.equal(got[i].index, want[i].index, `r=${radiusM} query ${q}`);
        assert.ok(closeEnough(got[i].distanceM, want[i].d));
      }
    }
  }
});

test('knn on a tight cluster matches brute force', () => {
  const rand = mulberry32(4242);
  const points = Array.from({ length: 250 }, () =>
    nearPoint(rand, 25.6, 85.1, 0.5),
  );
  const index = buildSphericalSpatialIndex(points);
  for (let q = 0; q < 20; q += 1) {
    const [qLat, qLon] = nearPoint(rand, 25.6, 85.1, 2);
    const got = sphericalKnn(index, [qLat, qLon], 5);
    const want = bruteKnn(points, qLat, qLon, 5);
    assert.equal(got.length, 5);
    for (const entry of got) {
      const oracleD = haversineOracleM(
        qLat,
        qLon,
        points[entry.index][0],
        points[entry.index][1],
      );
      assert.ok(closeEnough(entry.distanceM, oracleD));
    }
  }
});

test('k larger than the set returns all points sorted', () => {
  const points = [
    [10, 10],
    [20, 20],
    [30, 30],
  ];
  const index = buildSphericalSpatialIndex(points);
  const got = sphericalKnn(index, [0, 0], 100);
  assert.equal(got.length, 3);
  const want = bruteKnn(points, 0, 0, 100);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(got[i].index, want[i].index);
  }
});

test('ties break by lower original index', () => {
  // (1, 0) and (-1, 0) are equidistant from (0, 0); index 1 must win
  // the tie over index 2 even though it sorts after.
  const points = [
    [45, 45],
    [1, 0],
    [-1, 0],
  ];
  const index = buildSphericalSpatialIndex(points);
  const got = sphericalKnn(index, [0, 0], 3);
  assert.equal(got[0].index, 1);
  assert.equal(got[1].index, 2);
  assert.ok(closeEnough(got[0].distanceM, got[1].distanceM));
});

test('duplicate points: all zero-distance, index order, terminates', () => {
  const points = Array.from({ length: 200 }, () => [25.6, 85.1]);
  points.push([40, 40]);
  const index = buildSphericalSpatialIndex(points);
  assert.ok(index);
  const got = sphericalKnn(index, [25.6, 85.1], 200);
  assert.equal(got.length, 200);
  for (let i = 0; i < 200; i += 1) {
    assert.equal(got[i].index, i);
    assert.equal(got[i].distanceM, 0);
  }
  const rad = sphericalRadiusSearch(index, [25.6, 85.1], 0);
  assert.equal(rad.length, 200);
});

test('antipodal and polar points are exact', () => {
  const points = [
    [0, 0],
    [0, 180], // antipode of [0,0]
    [90, 0], // north pole
    [-90, 0], // south pole
    [45, 45],
  ];
  const index = buildSphericalSpatialIndex(points);
  const got = sphericalKnn(index, [0, 0], 5);
  const want = bruteKnn(points, 0, 0, 5);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(got[i].index, want[i].index);
    assert.ok(closeEnough(got[i].distanceM, want[i].d));
  }
  // Antipode distance is exactly half the circumference.
  const anti = got.find((e) => e.index === 1);
  assert.ok(closeEnough(anti.distanceM, Math.PI * EARTH_M));
  // Query from the pole itself.
  const polar = sphericalKnn(index, [90, 0], 1);
  assert.equal(polar[0].index, 2);
  assert.equal(polar[0].distanceM, 0);
});

test('id is carried through untouched', () => {
  const index = buildSphericalSpatialIndex([
    { lat: 10, lon: 10, id: 'a' },
    { lat: 20, lon: 20, id: 42 },
    [30, 30],
  ]);
  const got = sphericalKnn(index, [0, 0], 3);
  assert.equal(got[0].id, 'a');
  assert.equal(got[1].id, 42);
  assert.equal(got[2].id, undefined);
  assert.ok('index' in got[0] && 'lat' in got[0] && 'lon' in got[0]);
});

test('queries reject invalid input with null', () => {
  const index = buildSphericalSpatialIndex([[25, 85]]);
  assert.equal(sphericalKnn(null, [0, 0]), null);
  assert.equal(sphericalKnn({}, [0, 0]), null);
  assert.equal(
    sphericalKnn({ type: 'spherical-spatial-index/v1', size: 1 }, [0, 0]),
    null,
  );
  assert.equal(sphericalKnn(index, null), null);
  assert.equal(sphericalKnn(index, [95, 0]), null);
  assert.equal(sphericalKnn(index, [0, 0], 0), null);
  assert.equal(sphericalKnn(index, [0, 0], 2.5), null);
  assert.equal(sphericalKnn(index, [0, 0], NaN), null);
  assert.equal(sphericalKnn(index, [0, 0], -1), null);
  assert.equal(sphericalRadiusSearch(index, [0, 0], -1), null);
  assert.equal(sphericalRadiusSearch(index, [0, 0], NaN), null);
  assert.equal(sphericalRadiusSearch(index, [0, 0], Infinity), null);
  assert.equal(sphericalRadiusSearch(index, [95, 0], 1000), null);
  assert.equal(sphericalRadiusSearch('x', [0, 0], 1000), null);
});

test('builds are deterministic and JSON-serializable', () => {
  const rand = mulberry32(99);
  const points = Array.from({ length: 120 }, () => uniformSphere(rand));
  const a = buildSphericalSpatialIndex(points);
  const b = buildSphericalSpatialIndex(points);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const qa = sphericalKnn(a, [10, 20], 5);
  const qb = sphericalKnn(b, [10, 20], 5);
  assert.deepEqual(qa, qb);
  // The index survives a JSON round-trip (plain-object claim in header).
  const revived = JSON.parse(JSON.stringify(a));
  const qr = sphericalKnn(revived, [10, 20], 5);
  assert.deepEqual(qr, qa);
});

test('stats collector reports sublinear node visits', () => {
  const rand = mulberry32(31337);
  const points = Array.from({ length: 1500 }, () => uniformSphere(rand));
  const index = buildSphericalSpatialIndex(points);
  let maxVisited = 0;
  let totalVisited = 0;
  const queries = 25;
  for (let q = 0; q < queries; q += 1) {
    const stats = {};
    const got = sphericalKnn(index, uniformSphere(rand), 1, { stats });
    assert.equal(got.length, 1);
    assert.ok(Number.isInteger(stats.visited) && stats.visited > 0);
    maxVisited = Math.max(maxVisited, stats.visited);
    totalVisited += stats.visited;
  }
  // Pruning must do real work: every query visits strictly fewer nodes
  // than the full set, and the mean is a small fraction of n.
  assert.ok(maxVisited < 1500, `max visited ${maxVisited} not < 1500`);
  assert.ok(
    totalVisited / queries < 1500 / 3,
    `mean visited ${totalVisited / queries} not < 500`,
  );
  // Malformed options are ignored, not fatal.
  assert.equal(sphericalKnn(index, [0, 0], 1, null).length, 1);
  assert.equal(sphericalKnn(index, [0, 0], 1, { stats: 42 }).length, 1);
});

test('radius stats and empty-range result', () => {
  const index = buildSphericalSpatialIndex([
    [0, 0],
    [10, 10],
  ]);
  const stats = {};
  const got = sphericalRadiusSearch(index, [80, 80], 1000, { stats });
  assert.deepEqual(got, []);
  assert.ok(Number.isInteger(stats.visited) && stats.visited > 0);
});
