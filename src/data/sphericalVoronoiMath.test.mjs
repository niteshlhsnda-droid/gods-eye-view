import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sphericalVoronoi } from './sphericalVoronoiMath.js';

// Independent oracle helpers (plain 3D geometry, separately written from
// the module -- they verify geometric PROPERTIES of the result, not the
// module's construction steps).
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const TAU = Math.PI * 2;

const toVecT = (lat, lon) => {
  const la = lat * D2R;
  const lo = lon * D2R;
  return [
    Math.cos(la) * Math.cos(lo),
    Math.cos(la) * Math.sin(lo),
    Math.sin(la),
  ];
};
const dotT = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossT = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const tripleT = (a, b, c) => dotT(a, crossT(b, c));
const normT = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Independent bisector plane normal between two site vectors. */
const bisectorT = (p, q) => normT([p[0] - q[0], p[1] - q[1], p[2] - q[2]]);
/** Signed solid angle of triangle (a,b,c) -- Van Oosterom & Strackee. */
const solidAngleT = (a, b, c) => {
  const num = dotT(a, crossT(b, c));
  const den = 1 + dotT(a, b) + dotT(b, c) + dotT(c, a);
  return 2 * Math.atan2(num, den);
};
/** Angular distance between two longitudes, in degrees. */
const lonDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
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
/** Uniform point on the sphere, in [lat, lon] degrees. */
const uniformSphereT = (rand) => {
  const u = rand();
  const v = rand();
  return [Math.asin(2 * u - 1) * R2D, 360 * v - 180];
};
/** Seeded site set with a minimum angular separation (degrees). */
const seededSitesT = (seed, count, minSepDeg) => {
  const rand = mulberry32(seed);
  const sites = [];
  let guard = 0;
  while (sites.length < count && guard < 10000) {
    guard += 1;
    const s = uniformSphereT(rand);
    const v = toVecT(s[0], s[1]);
    if (
      sites.every(
        (t) => dotT(v, toVecT(t[0], t[1])) < Math.cos(minSepDeg * D2R),
      )
    ) {
      sites.push(s);
    }
  }
  assert.equal(sites.length, count, 'site sampler converged');
  return sites;
};

const ringVecsT = (ring) => ring.map(([la, lo]) => toVecT(la, lo));

/**
 * Independent containment: q is strictly inside ring iff q lies strictly
 * on the same side of every great-circle edge as the known interior
 * point p (exact for spherically convex polygons). Returns 'in',
 * 'out', or 'boundary' (too close to an edge to call).
 */
const classifyT = (ring, pVec, qVec) => {
  const vecs = ringVecsT(ring);
  const m = vecs.length;
  let ref = 0;
  for (let k = 0; k < m; k++) {
    const a = vecs[k];
    const b = vecs[(k + 1) % m];
    const s = tripleT(a, b, pVec);
    if (k === 0) ref = s;
    else if (s * ref <= 0) return 'out';
    const sq = tripleT(a, b, qVec);
    if (Math.abs(sq) < 1e-12) return 'boundary';
    if (sq * ref <= 0) return 'out';
  }
  return ref > 0 ? 'in' : 'out';
};

/** Independent cell area: solid-angle fan from the interior site. */
const cellAreaT = (ring, siteVec) => {
  const vecs = ringVecsT(ring);
  const m = vecs.length;
  let sum = 0;
  for (let k = 0; k < m; k++) {
    sum += solidAngleT(siteVec, vecs[k], vecs[(k + 1) % m]);
  }
  return Math.abs(sum);
};

test('null on invalid input, never throws', () => {
  const bad = [
    'x',
    null,
    undefined,
    42,
    [],
    [[0, 0]],
    [
      [0, 0],
      [10, 10],
    ],
    [
      [0, 0],
      [0, 90],
      [Number.NaN, 0],
    ],
    [
      [0, 0],
      [0, 90],
      [91, 0],
    ],
    [
      [-91, 0],
      [0, 90],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 90],
      [0, Number.POSITIVE_INFINITY],
    ],
    [
      [10, 20],
      [10, 20],
      [30, 40],
    ],
    // Near-duplicate: ~1.7e-9 rad apart, far below the ~1.4e-6 rad bar.
    [
      [10, 20],
      [10, 20 + 1e-7],
      [30, 40],
    ],
    [[0], [0, 90], [0, 180]],
    [
      ['a', 'b'],
      [0, 90],
      [0, 180],
    ],
    [[0, 0], [0, 90], 42],
    [[0, 0], [0, 90], null],
    [[0, 0], [0, 90], { lat: 0 }],
  ];
  for (const input of bad) {
    assert.equal(
      sphericalVoronoi(input),
      null,
      `expected null for ${JSON.stringify(input)}`,
    );
  }
});

test('object-form sites match pair-form sites', () => {
  const pairs = [
    [0, 0],
    [0, 120],
    [0, 240],
  ];
  const objs = pairs.map(([lat, lon]) => ({ lat, lon }));
  assert.deepEqual(sphericalVoronoi(objs), sphericalVoronoi(pairs));
});

test('three equatorial sites: known-answer gores', () => {
  const cells = sphericalVoronoi([
    [0, 0],
    [0, 120],
    [0, 240],
  ]);
  assert.ok(Array.isArray(cells));
  assert.equal(cells.length, 3);
  // Expected equatorial boundary longitudes per cell (the two meridians
  // bounding each 120-degree gore).
  const expectedEq = [
    [60, -60],
    [60, 180],
    [180, -60],
  ];
  cells.forEach((ring, i) => {
    assert.equal(ring.length, 4, `cell ${i}: 2 corners + 2 midpoints`);
    const poles = ring.filter(([la]) => Math.abs(Math.abs(la) - 90) < 1e-9);
    const eq = ring.filter(([la]) => Math.abs(la) < 1e-9);
    assert.equal(poles.length, 2, `cell ${i}: both poles are corners`);
    assert.equal(eq.length, 2, `cell ${i}: two edge midpoints on equator`);
    for (const [, lo] of eq) {
      const ok = expectedEq[i].some((e) => lonDist(lo, e) < 1e-6);
      assert.ok(ok, `cell ${i}: unexpected midpoint lon ${lo}`);
    }
  });
});

test('pole plus three equatorial sites: corners at atan(1/2)', () => {
  const sites = [
    [0, 0],
    [0, 120],
    [0, 240],
    [90, 0],
  ];
  const cells = sphericalVoronoi(sites);
  assert.equal(cells.length, 4);
  const poleVec = toVecT(90, 0);
  const others = [0, 1, 2].map((j) => toVecT(...sites[j]));
  const ring = cells[3];
  assert.equal(ring.length, 6, '3 corners + 3 edge midpoints');
  // Independently classify corners: tight on >= 2 bisector planes.
  const corners = ring.filter(([la, lo]) => {
    const v = toVecT(la, lo);
    let tight = 0;
    for (const q of others) {
      if (Math.abs(dotT(v, bisectorT(poleVec, q))) < 1e-7) tight += 1;
    }
    return tight >= 2;
  });
  assert.equal(corners.length, 3, 'exactly 3 bisector-pair corners');
  const expectedLat = Math.atan(0.5) * R2D; // ~26.565051177078
  for (const [la] of corners) {
    assert.ok(
      Math.abs(la - expectedLat) < 1e-6,
      `corner lat ${la}, expected ${expectedLat}`,
    );
  }
});

test('antipodal pair plus equatorial site: known-answer ring', () => {
  const cells = sphericalVoronoi([
    [0, 0],
    [0, 180],
    [0, 90],
  ]);
  assert.equal(cells.length, 3);
  const ring = cells[0];
  assert.equal(ring.length, 4);
  const lats = ring.map(([la]) => la);
  assert.equal(
    lats.filter((la) => Math.abs(Math.abs(la) - 90) < 1e-9).length,
    2,
  );
  const eqLons = ring.filter(([la]) => Math.abs(la) < 1e-9).map(([, lo]) => lo);
  assert.equal(eqLons.length, 2);
  // Cell of (0,0) spans lon (-90, 45): boundary meridians at 45 and -90.
  for (const lo of eqLons) {
    const ok = [45, -90].some((e) => lonDist(lo, e) < 1e-6);
    assert.ok(ok, `unexpected boundary lon ${lo}`);
  }
});

test('antimeridian sites: valid rings, site strictly inside', () => {
  const sites = [
    [0, 179],
    [0, -179],
    [40, 180],
  ];
  const cells = sphericalVoronoi(sites);
  assert.ok(cells);
  assert.equal(cells.length, 3);
  cells.forEach((ring, i) => {
    assert.ok(ring.length >= 4);
    for (const [la, lo] of ring) {
      assert.ok(Number.isFinite(la) && Number.isFinite(lo));
      assert.ok(Math.abs(la) <= 90);
      assert.ok(lo > -180 && lo <= 180);
    }
    const p = toVecT(...sites[i]);
    assert.equal(classifyT(ring, p, p), 'in', `site ${i} inside own cell`);
  });
});

test('cells partition the sphere: areas sum to 4pi', () => {
  const sites = seededSitesT(20261018, 8, 5);
  const cells = sphericalVoronoi(sites);
  assert.ok(cells);
  assert.equal(cells.length, sites.length);
  let total = 0;
  cells.forEach((ring, i) => {
    const area = cellAreaT(ring, toVecT(...sites[i]));
    assert.ok(area > 1e-6, `cell ${i} has positive area`);
    total += area;
  });
  assert.ok(
    Math.abs(total - 4 * Math.PI) < 1e-6,
    `area sum ${total}, expected ${4 * Math.PI}`,
  );
});

test('random queries land in their nearest-site cell', () => {
  const sites = seededSitesT(777, 8, 5);
  const siteVecs = sites.map(([la, lo]) => toVecT(la, lo));
  const cells = sphericalVoronoi(sites);
  assert.ok(cells);
  const rand = mulberry32(4242);
  let checked = 0;
  let skipped = 0;
  for (let t = 0; t < 300; t++) {
    const [la, lo] = uniformSphereT(rand);
    const q = toVecT(la, lo);
    // Independent nearest site by dot product (the Voronoi definition).
    let best = 0;
    let bestDot = -2;
    for (let i = 0; i < siteVecs.length; i++) {
      const d = dotT(q, siteVecs[i]);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    const cls = classifyT(cells[best], siteVecs[best], q);
    if (cls === 'boundary') {
      skipped += 1;
      continue; // measure-zero: query on a cell boundary
    }
    assert.equal(cls, 'in', `query (${la}, ${lo}) in cell ${best}`);
    checked += 1;
  }
  assert.ok(checked > 250, `checked ${checked}, skipped ${skipped}`);
});

test('index alignment, winding, and site containment', () => {
  const sites = seededSitesT(31337, 10, 5);
  const siteVecs = sites.map(([la, lo]) => toVecT(la, lo));
  const cells = sphericalVoronoi(sites);
  assert.ok(cells);
  assert.equal(cells.length, sites.length);
  cells.forEach((ring, i) => {
    assert.ok(ring.length >= 4, `cell ${i}: at least 2 corners + midpoints`);
    assert.equal(ring.length % 2, 0, `cell ${i}: corner/midpoint pairs`);
    const p = siteVecs[i];
    // Site strictly inside its own ring (index alignment).
    assert.equal(classifyT(ring, p, p), 'in', `site ${i} inside ring ${i}`);
    // Canonical winding: counter-clockwise around the site as seen from
    // outside => every edge triple product [a b p] is strictly positive.
    const vecs = ringVecsT(ring);
    for (let k = 0; k < vecs.length; k++) {
      const s = tripleT(vecs[k], vecs[(k + 1) % vecs.length], p);
      assert.ok(s > 1e-12, `cell ${i} edge ${k}: winding sign ${s}`);
    }
    // No vertex may coincide with the site itself.
    for (const v of vecs) {
      assert.ok(dotT(v, p) < 1 - 1e-12, `cell ${i}: vertex != site`);
    }
  });
});

test('deterministic: same input, identical output', () => {
  const sites = seededSitesT(99, 7, 5);
  assert.deepEqual(sphericalVoronoi(sites), sphericalVoronoi(sites));
});

test('every vertex lies on a bisector great circle (independent)', () => {
  const sites = seededSitesT(555, 9, 5);
  const siteVecs = sites.map(([la, lo]) => toVecT(la, lo));
  const cells = sphericalVoronoi(sites);
  assert.ok(cells);
  cells.forEach((ring, i) => {
    const p = siteVecs[i];
    for (const [la, lo] of ring) {
      const v = toVecT(la, lo);
      let nearest = 2;
      for (let j = 0; j < siteVecs.length; j++) {
        if (j === i) continue;
        const d = Math.abs(dotT(v, bisectorT(p, siteVecs[j])));
        if (d < nearest) nearest = d;
      }
      assert.ok(
        nearest < 1e-7,
        `cell ${i} vertex (${la}, ${lo}) off all bisectors: ${nearest}`,
      );
    }
  });
});

test('fuzz: seeded configs never throw, never NaN, structurally valid', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const n = 3 + (seed % 10); // 4..8 sites
    const sites = seededSitesT(1000 + seed, n, 3);
    let cells;
    assert.doesNotThrow(() => {
      cells = sphericalVoronoi(sites);
    }, `seed ${seed}`);
    assert.ok(cells, `seed ${seed}: non-null`);
    assert.equal(cells.length, n);
    cells.forEach((ring, i) => {
      assert.ok(Array.isArray(ring) && ring.length >= 4);
      for (const [la, lo] of ring) {
        assert.ok(Number.isFinite(la) && !Number.isNaN(la));
        assert.ok(Number.isFinite(lo) && !Number.isNaN(lo));
      }
      const p = toVecT(...sites[i]);
      assert.equal(classifyT(ring, p, p), 'in', `seed ${seed} site ${i}`);
    });
  }
});
