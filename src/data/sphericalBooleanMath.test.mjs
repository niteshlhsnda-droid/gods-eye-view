import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unionSphericalPolygons,
  differenceSphericalPolygons,
} from './sphericalBooleanMath.js';

// ---------------------------------------------------------------------------
// Independent oracle helpers (plain 3D geometry, separately written from the
// module — they verify geometric PROPERTIES of the results, not the
// module's walk steps).
// ---------------------------------------------------------------------------
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const tToVec = (lat, lon) => {
  const la = lat * D2R;
  const lo = lon * D2R;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
};
const tToLatLon = (v) => ({
  lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D,
  lon: Math.atan2(v[1], v[0]) * R2D,
});
const tDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const tCross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const tNorm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const tAngleBetween = (a, b) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return 2 * Math.asin(Math.min(1, Math.hypot(dx, dy, dz) / 2));
};
const tOnMinorArc = (s, e, q) =>
  tAngleBetween(q, s) + tAngleBetween(q, e) <= tAngleBetween(s, e) + 1e-9;

/** Independent great-circle arc intersection (for expected vertices). */
const tGcIntersect = (s, e, t, u) => {
  const mA = tNorm(tCross(s, e));
  const mB = tNorm(tCross(t, u));
  const d0 = tCross(mA, mB);
  const l = Math.hypot(d0[0], d0[1], d0[2]);
  const d = [d0[0] / l, d0[1] / l, d0[2] / l];
  const nq = [-d[0], -d[1], -d[2]];
  if (tOnMinorArc(s, e, d) && tOnMinorArc(t, u, d)) return d;
  if (tOnMinorArc(s, e, nq) && tOnMinorArc(t, u, nq)) return nq;
  throw new Error('tGcIntersect: arcs do not intersect');
};

/** Independent signed angle sum (winding number) around p. */
const tSignedAngleSum = (p, vecs) => {
  let sum = 0;
  const n = vecs.length;
  for (let i = 0; i < n; i++) {
    const a = vecs[i];
    const b = vecs[(i + 1) % n];
    const da = tDot(p, a);
    const db = tDot(p, b);
    if (Math.abs(da) > 1 - 1e-12 || Math.abs(db) > 1 - 1e-12) return NaN;
    const au = tNorm([a[0] - p[0] * da, a[1] - p[1] * da, a[2] - p[2] * da]);
    const bu = tNorm([b[0] - p[0] * db, b[1] - p[1] * db, b[2] - p[2] * db]);
    const c = tCross(au, bu);
    sum += Math.atan2(tDot(p, c), tDot(au, bu));
  }
  return sum;
};

const tDistToArc = (p, a, b) => {
  const n = tNorm(tCross(a, b));
  const d = tDot(n, p);
  const q0 = [p[0] - n[0] * d, p[1] - n[1] * d, p[2] - n[2] * d];
  const ql = Math.hypot(q0[0], q0[1], q0[2]);
  if (ql < 1e-15) return Math.PI / 2;
  const q = [q0[0] / ql, q0[1] / ql, q0[2] / ql];
  if (tOnMinorArc(a, b, q)) return tAngleBetween(p, q);
  return Math.min(tAngleBetween(p, a), tAngleBetween(p, b));
};

/** Winding-agnostic strict containment (oracle). */
const tEnclosedInside = (p, vecs) => {
  const n = vecs.length;
  for (let i = 0; i < n; i++) {
    if (tDistToArc(p, vecs[i], vecs[(i + 1) % n]) < 1e-7) return 'boundary';
  }
  const s = tSignedAngleSum(p, vecs);
  if (!Number.isFinite(s)) return 'boundary';
  return Math.abs(s) > Math.PI;
};

/** Independent signed fan solid angle (for winding assertions). */
const tFanSigned = (vecs) => {
  const a = vecs[0];
  let total = 0;
  for (let i = 1; i < vecs.length - 1; i++) {
    const b = vecs[i];
    const c = vecs[i + 1];
    total +=
      2 *
      Math.atan2(
        tDot(a, tCross(b, c)),
        1 + tDot(a, b) + tDot(b, c) + tDot(c, a),
      );
  }
  return total;
};
const tFanArea = (vecs) => Math.abs(tFanSigned(vecs));

const asVecs = (ring) =>
  ring.map((p) =>
    Array.isArray(p) ? tToVec(p[0], p[1]) : tToVec(p.lat, p.lon),
  );

/** Cyclic-order-insensitive ring equality, either winding. */
const tRingCyclicEqual = (got, want) => {
  const g = asVecs(got);
  const w = asVecs(want);
  assert.equal(
    g.length,
    w.length,
    `lengths differ: ${g.length} vs ${w.length}`,
  );
  const n = w.length;
  let matched = false;
  for (let dir = 0; dir < 2 && !matched; dir++) {
    for (let shift = 0; shift < n && !matched; shift++) {
      matched = w.every((wv, i) => {
        const j = dir === 0 ? (i + shift) % n : (shift - i + 2 * n) % n;
        return tAngleBetween(g[j], wv) < 1e-9;
      });
    }
  }
  assert.ok(matched, `rings not cyclically equal: ${JSON.stringify(got)}`);
};

/** Set equality of ring lists (order-insensitive, rotation-insensitive). */
const tRingSetEqual = (got, want) => {
  assert.equal(
    got.length,
    want.length,
    `ring counts differ: ${got.length} vs ${want.length}`,
  );
  const used = new Array(want.length).fill(false);
  for (const g of got) {
    let found = -1;
    for (let k = 0; k < want.length; k++) {
      if (used[k]) continue;
      try {
        tRingCyclicEqual(g, want[k]);
        found = k;
        break;
      } catch {
        // not this one
      }
    }
    assert.ok(found >= 0, `no match for ring ${JSON.stringify(g)}`);
    used[found] = true;
  }
};

/** Every output vertex is an input vertex or lies on an input edge. */
const tNoInventedVertices = (outRings, aVecs, bVecs) => {
  const nearInput = (vv) => {
    for (const vecs of [aVecs, bVecs]) {
      const n = vecs.length;
      for (let i = 0; i < n; i++) {
        if (tAngleBetween(vv, vecs[i]) < 1e-7) return true;
        if (tDistToArc(vv, vecs[i], vecs[(i + 1) % n]) < 1e-7) return true;
      }
    }
    return false;
  };
  for (const ring of outRings) {
    for (const p of ring) {
      const vv = tToVec(p.lat, p.lon);
      assert.ok(nearInput(vv), `invented vertex (${p.lat}, ${p.lon})`);
    }
  }
};

/**
 * Grid oracle: every sample point's expected membership (union/difference
 * of the inputs, winding-agnostic) must match membership in the output
 * ring set (even-odd rule). Points near any boundary are skipped.
 */
const tGridOracle = (outRings, A, B, mode) => {
  const aVecs = asVecs(A);
  const bVecs = asVecs(B);
  const outVecs = outRings.map(asVecs);
  const lats = A.concat(B).map((p) => (Array.isArray(p) ? p[0] : p.lat));
  const lons = A.concat(B).map((p) => (Array.isArray(p) ? p[1] : p.lon));
  // Note: antimeridian-spanning inputs would need unwrapped lons; the grid
  // tests here stay clear of the antimeridian by construction.
  const latMin = Math.min(...lats) - 1;
  const latMax = Math.max(...lats) + 1;
  const lonMin = Math.min(...lons) - 1;
  const lonMax = Math.max(...lons) + 1;
  const nearAnyBoundary = (vv) => {
    for (const vecs of [aVecs, bVecs, ...outVecs]) {
      const n = vecs.length;
      for (let i = 0; i < n; i++) {
        if (tDistToArc(vv, vecs[i], vecs[(i + 1) % n]) < 1e-6) return true;
      }
    }
    return false;
  };
  let checked = 0;
  for (let gi = 0; gi < 45; gi++) {
    for (let gj = 0; gj < 45; gj++) {
      const lat = latMin + ((gi + 0.5) / 45) * (latMax - latMin);
      const lon = lonMin + ((gj + 0.5) / 45) * (lonMax - lonMin);
      const vv = tToVec(lat, lon);
      if (nearAnyBoundary(vv)) continue;
      const inA = tEnclosedInside(vv, aVecs) === true;
      const inB = tEnclosedInside(vv, bVecs) === true;
      const expected = mode === 'union' ? inA || inB : inA && !inB;
      let insideCount = 0;
      for (const ov of outVecs) {
        if (tEnclosedInside(vv, ov) === true) insideCount++;
      }
      const got = insideCount % 2 === 1;
      assert.equal(
        got,
        expected,
        `${mode} membership mismatch at (${lat.toFixed(3)}, ${lon.toFixed(3)}): expected ${expected}, got ${got}`,
      );
      checked++;
    }
  }
  assert.ok(checked > 500, `too few grid points checked: ${checked}`);
};

// All test polygons below are positive-wound (interior on the left:
// east → north → west → south in [lat, lon]).
const SQ_A = [
  [0, 0],
  [0, 2],
  [2, 2],
  [2, 0],
];
const SQ_B = [
  [1, 1],
  [1, 3],
  [3, 3],
  [3, 1],
];
const FAR = [
  [10, 10],
  [10, 11],
  [11, 11],
  [11, 10],
];

test('union: polygon with itself returns itself', () => {
  const out = unionSphericalPolygons(SQ_A, SQ_A);
  assert.equal(out.length, 1);
  tRingCyclicEqual(out[0], SQ_A);
});

test('difference: polygon with itself is empty', () => {
  assert.deepEqual(differenceSphericalPolygons(SQ_A, SQ_A), []);
});

test('union: reversed twin returns the ring', () => {
  const out = unionSphericalPolygons(SQ_A, [...SQ_A].reverse());
  assert.equal(out.length, 1);
  tRingCyclicEqual(out[0], SQ_A);
});

test('difference: disjoint polygons return the first', () => {
  const out = differenceSphericalPolygons(SQ_A, FAR);
  assert.equal(out.length, 1);
  tRingCyclicEqual(out[0], SQ_A);
});

test('union: disjoint polygons return both rings', () => {
  const out = unionSphericalPolygons(SQ_A, FAR);
  tRingSetEqual(out, [SQ_A, FAR]);
});

test('union: overlapping squares merge to the octagon', () => {
  const out = unionSphericalPolygons(SQ_A, SQ_B);
  assert.equal(out.length, 1);
  const aE = [tToVec(0, 2), tToVec(2, 2)]; // A's east edge
  const bS = [tToVec(1, 1), tToVec(1, 3)]; // B's south edge
  const aN = [tToVec(2, 2), tToVec(2, 0)]; // A's north edge
  const bW = [tToVec(3, 1), tToVec(1, 1)]; // B's west edge
  const x1 = tToLatLon(tGcIntersect(aE[0], aE[1], bS[0], bS[1]));
  const x2 = tToLatLon(tGcIntersect(aN[0], aN[1], bW[0], bW[1]));
  tRingCyclicEqual(out[0], [
    [0, 0],
    [0, 2],
    x1,
    [1, 3],
    [3, 3],
    [3, 1],
    x2,
    [2, 0],
  ]);
  // Area conservation: |U| = |A| + |B| - |overlap|.
  // (planar overlap approx vs great-circle truth: 1e-4; exact ring match above is the real check)
  const got = tFanArea(asVecs(out[0]));
  const want =
    tFanArea(asVecs(SQ_A)) +
    tFanArea(asVecs(SQ_B)) -
    tFanArea(
      asVecs([
        [1, 1],
        [1, 2],
        [2, 2],
        [2, 1],
      ]),
    );
  assert.ok(
    Math.abs(got - want) / want < 1e-4,
    `area mismatch: ${got} vs ${want}`,
  );
});

test('difference: corner bite yields the hexagon', () => {
  const C = [
    [0, 0],
    [0, 4],
    [4, 4],
    [4, 0],
  ];
  const E = [
    [3, 3],
    [3, 5],
    [5, 5],
    [5, 3],
  ];
  const out = differenceSphericalPolygons(C, E);
  assert.equal(out.length, 1);
  const cN = [tToVec(4, 4), tToVec(4, 0)]; // C's north edge
  const eW = [tToVec(5, 3), tToVec(3, 3)]; // E's west edge
  const cE = [tToVec(0, 4), tToVec(4, 4)]; // C's east edge
  const eS = [tToVec(3, 3), tToVec(3, 5)]; // E's south edge
  const y1 = tToLatLon(tGcIntersect(cN[0], cN[1], eW[0], eW[1])); // on C north ~(4,3)
  const y2 = tToLatLon(tGcIntersect(cE[0], cE[1], eS[0], eS[1])); // on C east ~(3,4)
  // Boundary: (0,0)->(0,4) C south, north up C east to y2, west along E
  // south to (3,3), north up E west to y1, west along C north, south.
  tRingCyclicEqual(out[0], [[0, 0], [0, 4], y2, [3, 3], y1, [4, 0]]);
  tNoInventedVertices(out, asVecs(C), asVecs(E));
});

test('union: edge-adjacent squares merge to one rectangle', () => {
  const F = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ];
  const G = [
    [1, 0],
    [1, 1],
    [2, 1],
    [2, 0],
  ];
  const out = unionSphericalPolygons(F, G);
  assert.equal(out.length, 1);
  tRingCyclicEqual(out[0], [
    [0, 0],
    [0, 1],
    [2, 1],
    [2, 0],
  ]);
});

test('difference: edge-adjacent outside polygon returns the first', () => {
  const F = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ];
  const G = [
    [1, 0],
    [1, 1],
    [2, 1],
    [2, 0],
  ];
  const out = differenceSphericalPolygons(F, G);
  assert.equal(out.length, 1);
  tRingCyclicEqual(out[0], F);
});

test('union: hemisphere absorbs a polar cap', () => {
  const hemi = [
    [0, -180],
    [0, -90],
    [0, 0],
    [0, 90],
  ];
  const cap = [
    [85, 0],
    [85, 90],
    [85, 180],
    [85, -90],
  ];
  const out = unionSphericalPolygons(hemi, cap);
  assert.equal(out.length, 1);
  tRingCyclicEqual(out[0], hemi);
});

test('difference: hemisphere minus polar cap yields a holed ring', () => {
  const hemi = [
    [0, -180],
    [0, -90],
    [0, 0],
    [0, 90],
  ];
  const cap = [
    [85, 0],
    [85, 90],
    [85, 180],
    [85, -90],
  ];
  const out = differenceSphericalPolygons(hemi, cap);
  assert.equal(out.length, 2);
  const outVecs = out.map(asVecs);
  // Both rings have 4 vertices; outer = the one containing the cap's sample.
  const outer = outVecs.find((v) => tEnclosedInside(tToVec(45, 0), v));
  const hole = outVecs.find((v) => v !== outer);
  assert.ok(outer && hole, 'expected one outer and one hole');
  tRingCyclicEqual(outer.map(tToLatLon), hemi);
  // Winding: outer positive, hole negative (robust angle-sum signs).
  const outerSample = tToVec(45, 0);
  const holeSample = tToVec(87, 45);
  assert.ok(
    tSignedAngleSum(outerSample, outer) > Math.PI,
    'outer not positive-wound',
  );
  assert.ok(
    tSignedAngleSum(holeSample, hole) < -Math.PI,
    'hole not negative-wound',
  );
  // Hole strictly inside outer; areas: |outer| - |hole| = 2π - |cap|.
  // (great-circle bulge: tolerance 1e-6)
  assert.equal(tEnclosedInside(tToVec(87, 45), outer), true);
  const got = tFanArea(outer) - tFanArea(hole);
  const want = 2 * Math.PI - tFanArea(asVecs(cap));
  assert.ok(
    Math.abs(got - want) / want < 1e-6,
    `area mismatch: ${got} vs ${want}`,
  );
});

test('union: antimeridian-adjacent boxes merge across the dateline', () => {
  const A = [
    [0, 170],
    [0, -175],
    [10, -175],
    [10, 170],
  ];
  const B = [
    [0, -175],
    [0, -160],
    [10, -160],
    [10, -175],
  ];
  const out = unionSphericalPolygons(A, B);
  assert.equal(out.length, 1);
  // The shared meridian vertex (10,-175) survives: the merged north edge
  // is a lat-10 small circle, not a great circle, so the kink is real.
  tRingCyclicEqual(out[0], [
    [0, 170],
    [0, -160],
    [10, -160],
    [10, -175],
    [10, 170],
  ]);
});

test('point-touching disjoint polygons stay separate', () => {
  const A = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ];
  const B = [
    [1, 1],
    [1, 2],
    [2, 2],
    [2, 1],
  ]; // touches A only at (1, 1)
  const u = unionSphericalPolygons(A, B);
  tRingSetEqual(u, [A, B]);
  const d = differenceSphericalPolygons(A, B);
  assert.equal(d.length, 1);
  tRingCyclicEqual(d[0], A);
});

test('union absorbs a strictly contained polygon; difference cuts a hole', () => {
  // Strictly inside: no vertex touches SQ_A's boundary.
  const inner = [
    [0.5, 0.5],
    [0.5, 1.5],
    [1.5, 1.5],
    [1.5, 0.5],
  ];
  const u = unionSphericalPolygons(SQ_A, inner);
  assert.equal(u.length, 1);
  tRingCyclicEqual(u[0], SQ_A);
  const d = differenceSphericalPolygons(SQ_A, inner);
  assert.equal(d.length, 2);
  const dVecs = d.map(asVecs);
  // Outer = the ring that contains the other's sample; hole = the other.
  const outer = dVecs.find((v) => tEnclosedInside(tToVec(0.1, 0.1), v));
  const hole = dVecs.find((v) => v !== outer);
  tRingCyclicEqual(outer.map(tToLatLon), SQ_A);
  tRingCyclicEqual(hole.map(tToLatLon), inner);
  const holeSample = tToVec(1, 1);
  assert.ok(
    tSignedAngleSum(holeSample, hole) < -Math.PI,
    'hole not negative-wound',
  );
  assert.equal(tEnclosedInside(holeSample, outer), true);
  const got = tFanArea(outer) - tFanArea(hole);
  const want = tFanArea(asVecs(SQ_A)) - tFanArea(asVecs(inner));
  assert.ok(
    Math.abs(got - want) / want < 1e-6,
    `area mismatch: ${got} vs ${want}`,
  );
});

test('container absorbs contained polygon both ways', () => {
  const inner = [
    [0.5, 0.5],
    [0.5, 1.5],
    [1.5, 1.5],
    [1.5, 0.5],
  ];
  const u = unionSphericalPolygons(inner, SQ_A);
  assert.equal(u.length, 1);
  tRingCyclicEqual(u[0], SQ_A);
  assert.deepEqual(differenceSphericalPolygons(inner, SQ_A), []);
});

test('union: mixed coincident and crossing edges', () => {
  // A = lat 0..2, lon 0..3; B = lat -1..1, lon 1..3. B's east edge is
  // collinear-overlapping A's east edge (same side -> kept); B's west
  // edge properly crosses A's south edge at (0, 1).
  const A = [
    [0, 0],
    [0, 3],
    [2, 3],
    [2, 0],
  ];
  const B = [
    [-1, 1],
    [-1, 3],
    [1, 3],
    [1, 1],
  ];
  const out = unionSphericalPolygons(A, B);
  assert.equal(out.length, 1);
  // (0,3) is collinear on the merged meridian edge -> stripped.
  tRingCyclicEqual(out[0], [
    [0, 0],
    [0, 1],
    [-1, 1],
    [-1, 3],
    [2, 3],
    [2, 0],
  ]);
  tNoInventedVertices(out, asVecs(A), asVecs(B));
});

test('union: concave L-shape (grid oracle, area, no invented vertices)', () => {
  const L = [
    [0, 0],
    [0, 2],
    [1, 2],
    [1, 1],
    [2, 1],
    [2, 0],
  ];
  const box = [
    [0.5, 1.5],
    [0.5, 2.5],
    [1.5, 2.5],
    [1.5, 1.5],
  ];
  const out = unionSphericalPolygons(L, box);
  assert.ok(out.length >= 1, 'expected at least one ring');
  tNoInventedVertices(out, asVecs(L), asVecs(box));
  tGridOracle(out, L, box, 'union');
  // Area conservation via the independent fan oracle.
  const got = out.map((r) => tFanArea(asVecs(r))).reduce((a, b) => a + b, 0);
  const overlap = [
    [0.5, 1.5],
    [0.5, 2],
    [1, 2],
    [1, 1.5],
  ];
  const want =
    tFanArea(asVecs(L)) + tFanArea(asVecs(box)) - tFanArea(asVecs(overlap));
  // Planar overlap approx vs great-circle truth: 1e-4 (grid oracle is exact).
  assert.ok(
    Math.abs(got - want) / want < 1e-4,
    `area mismatch: ${got} vs ${want}`,
  );
});

test('difference: concave notch (grid oracle, no invented vertices)', () => {
  const A = [
    [0, 0],
    [0, 4],
    [4, 4],
    [4, 0],
  ];
  const B = [
    [1, 3],
    [1, 5],
    [3, 5],
    [3, 3],
  ];
  const out = differenceSphericalPolygons(A, B);
  assert.ok(out.length >= 1, 'expected at least one ring');
  tNoInventedVertices(out, asVecs(A), asVecs(B));
  tGridOracle(out, A, B, 'difference');
});

test('union: star vs box, many crossings (grid oracle)', () => {
  // 5-point star (concave), positive-wound.
  const star = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? 2 : 0.9;
    const a = (k / 10) * 2 * Math.PI - Math.PI / 2;
    star.push([1 + r * Math.sin(a), 1 + r * Math.cos(a)]);
  }
  const box = [
    [0, 0.5],
    [0, 2.5],
    [2, 2.5],
    [2, 0.5],
  ];
  const out = unionSphericalPolygons(star, box);
  assert.ok(out.length >= 1, 'expected at least one ring');
  tNoInventedVertices(out, asVecs(star), asVecs(box));
  tGridOracle(out, star, box, 'union');
});

test('invalid inputs return null', () => {
  const bad = [
    [null, SQ_A],
    [undefined, SQ_A],
    ['nope', SQ_A],
    [[], SQ_A],
    [[[0, 0]], SQ_A],
    [
      [
        [0, 0],
        [0, 1],
      ],
      SQ_A,
    ], // fewer than 3 vertices
    [
      [
        [0, 0],
        [0, 999],
        [1, 1],
      ],
      SQ_A,
    ], // bad longitude
    [
      [
        [0, 0],
        [91, 1],
        [1, 1],
      ],
      SQ_A,
    ], // bad latitude
    [
      [
        [0, 0],
        [NaN, 1],
        [1, 1],
      ],
      SQ_A,
    ],
    [
      [
        [0, 0],
        [0, 180],
        [10, 0],
      ],
      SQ_A,
    ], // adjacent antipodal
    [
      [
        [0, 0],
        [0, 10],
        [0, 20],
      ],
      SQ_A,
    ], // zero-area (collinear)
    [SQ_A, null],
    [
      SQ_A,
      [
        [
          [0, 0],
          [0, 1],
        ],
      ],
    ],
    [
      SQ_A,
      [
        [0, 0],
        [0, 10],
        [0, 20],
      ],
    ], // zero-area second ring
  ];
  for (const [a, b] of bad) {
    assert.equal(
      unionSphericalPolygons(a, b),
      null,
      `union(${JSON.stringify(a)}, ...)`,
    );
    assert.equal(
      differenceSphericalPolygons(a, b),
      null,
      `difference(${JSON.stringify(a)}, ...)`,
    );
  }
});

test('results do not depend on input vertex rotation', () => {
  // Rotating the start vertex must not change the result (in-domain).
  const rotA = [...SQ_A.slice(2), ...SQ_A.slice(0, 2)];
  const rotB = [...SQ_B.slice(1), ...SQ_B.slice(0, 1)];
  const u1 = unionSphericalPolygons(SQ_A, SQ_B);
  const u2 = unionSphericalPolygons(rotA, rotB);
  tRingSetEqual(u1, u2);
  const d1 = differenceSphericalPolygons(SQ_A, SQ_B);
  const d2 = differenceSphericalPolygons(rotA, rotB);
  tRingSetEqual(d1, d2);
  // Union is commutative as a set.
  tRingSetEqual(
    unionSphericalPolygons(SQ_A, SQ_B),
    unionSphericalPolygons(SQ_B, SQ_A),
  );
});

test('outputs are canonically wound: outers positive, holes negative', () => {
  const inner = [
    [0.5, 0.5],
    [0.5, 1.5],
    [1.5, 1.5],
    [1.5, 0.5],
  ];
  const d = differenceSphericalPolygons(SQ_A, inner);
  assert.equal(d.length, 2);
  const dVecs = d.map(asVecs);
  // Outer = the ring containing (0.1,0.1) [inside SQ_A, outside inner].
  const outerIdx = dVecs.findIndex((v) => tEnclosedInside(tToVec(0.1, 0.1), v));
  assert.ok(outerIdx >= 0, 'no outer found');
  const holeIdx = 1 - outerIdx;
  for (let i = 0; i < dVecs.length; i++) {
    if (i === holeIdx) {
      const s = tSignedAngleSum(tToVec(1, 1), dVecs[i]);
      assert.ok(s < -Math.PI, `hole ${i} not negative-wound`);
    } else {
      const so = tSignedAngleSum(tToVec(0.1, 0.1), dVecs[i]);
      assert.ok(so > Math.PI, `outer ${i} not positive-wound`);
    }
  }
});

test('accepts {lat, lon} objects and explicitly closed rings', () => {
  const A = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 2 },
    { lat: 2, lon: 2 },
    { lat: 2, lon: 0 },
    { lat: 0, lon: 0 },
  ];
  const B = [
    [1, 1],
    [1, 3],
    [3, 3],
    [3, 1],
  ];
  const out = unionSphericalPolygons(A, B);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 8);
  tNoInventedVertices(out, asVecs(A), asVecs(B));
});

test('union/difference: identical region with an extra collinear vertex', () => {
  const Aplus = [
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 2],
    [2, 0],
  ];
  const u = unionSphericalPolygons(SQ_A, Aplus);
  assert.equal(u.length, 1);
  tRingCyclicEqual(u[0], SQ_A);
  assert.deepEqual(differenceSphericalPolygons(SQ_A, Aplus), []);
});

test('union: two U-shapes form a holed ring', () => {
  // A = U opening north, B = ∩ opening south; union is the 4x4 square
  // with a (1..3)x(1..3) hole. Exercises same-side coincident edges.
  const A = [
    [0, 0],
    [0, 4],
    [3, 4],
    [3, 3],
    [1, 3],
    [1, 1],
    [3, 1],
    [3, 0],
  ];
  const B = [
    [1, 0],
    [1, 1],
    [3, 1],
    [3, 3],
    [1, 3],
    [1, 4],
    [4, 4],
    [4, 0],
  ];
  const out = unionSphericalPolygons(A, B);
  assert.equal(out.length, 2);
  const outVecs = out.map(asVecs);
  const outer = outVecs.find(
    (v) => tEnclosedInside(tToVec(0.5, 0.5), v) === true,
  );
  const hole = outVecs.find((v) => v !== outer);
  assert.ok(outer && hole, 'expected outer + hole');
  tRingCyclicEqual(outer.map(tToLatLon), [
    [0, 0],
    [0, 4],
    [4, 4],
    [4, 0],
  ]);
  tRingCyclicEqual(hole.map(tToLatLon), [
    [1, 1],
    [1, 3],
    [3, 3],
    [3, 1],
  ]);
  // Hole negative-wound, outer positive-wound (robust signs).
  assert.ok(
    tSignedAngleSum(tToVec(2, 2), hole) < -Math.PI,
    'hole not negative',
  );
  assert.ok(
    tSignedAngleSum(tToVec(0.5, 0.5), outer) > Math.PI,
    'outer not positive',
  );
  tGridOracle(out, A, B, 'union');
});

test('difference: straddling box cuts a notch (grid oracle)', () => {
  const A = [
    [0, 0],
    [0, 4],
    [4, 4],
    [4, 0],
  ];
  const B = [
    [2, 3],
    [2, 5],
    [4, 5],
    [4, 3],
  ];
  const out = differenceSphericalPolygons(A, B);
  assert.ok(out.length >= 1, 'expected at least one ring');
  tNoInventedVertices(out, asVecs(A), asVecs(B));
  tGridOracle(out, A, B, 'difference');
  // Area: |A| - |A∩B|; A∩B is the [2..4]x[3..4] box (great-circle edges).
  const got = out.map((r) => tFanArea(asVecs(r))).reduce((a, b) => a + b, 0);
  const overlap = [
    [2, 3],
    [2, 4],
    [4, 4],
    [4, 3],
  ];
  const want = tFanArea(asVecs(A)) - tFanArea(asVecs(overlap));
  // Planar overlap approx vs great-circle truth: 1e-4 (grid oracle is exact).
  assert.ok(
    Math.abs(got - want) / want < 1e-4,
    `area mismatch: ${got} vs ${want}`,
  );
});
