import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipSphericalPolygon } from './sphericalClipMath.js';

// Independent oracle helpers (plain 3D geometry, separately written from
// the module — they verify geometric PROPERTIES of the result, not the
// module's clipping steps).
const D2R = Math.PI / 180;
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
const normT = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const pt = ([lat, lon]) => ({ lat, lon });

/** Independent convex-ring containment via 3D half-planes. */
const convexContainsT = (ring, lat, lon) => {
  const vecs = ring.map(([la, lo]) => toVecT(la, lo));
  const n = vecs.length;
  const normals = [];
  for (let i = 0; i < n; i++) {
    normals.push(normT(crossT(vecs[i], vecs[(i + 1) % n])));
  }
  let sign = 0;
  for (let i = 0; i < n && sign === 0; i++) {
    for (let j = 0; j < n; j++) {
      const d = dotT(normals[i], vecs[j]);
      if (d > 1e-9) {
        sign = 1;
        break;
      }
      if (d < -1e-9) {
        sign = -1;
        break;
      }
    }
  }
  if (sign === 0) return false;
  const p = toVecT(lat, lon);
  return normals.every((nn) => sign * dotT(nn, p) >= -1e-9);
};

/** Edge plane normals of a ring (independent of the module). */
const edgeNormalsT = (ring) => {
  const vecs = ring.map(([la, lo]) => toVecT(la, lo));
  const n = vecs.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(normT(crossT(vecs[i], vecs[(i + 1) % n])));
  }
  return out;
};

const approxPt = (got, lat, lon, tol = 1e-9) => {
  assert.ok(
    Math.abs(got.lat - lat) < tol && Math.abs(got.lon - lon) < tol,
    `expected ~(${lat}, ${lon}), got (${got.lat}, ${got.lon})`,
  );
};

/** Cyclic-order-insensitive ring equality (same winding assumed). */
const ringCyclicEqual = (got, want, tol = 1e-9) => {
  assert.equal(
    got.length,
    want.length,
    `lengths differ: ${got.length} vs ${want.length}`,
  );
  const n = want.length;
  let matched = false;
  for (let shift = 0; shift < n && !matched; shift++) {
    matched = want.every((w, i) => {
      const g = got[(i + shift) % n];
      return Math.abs(g.lat - w.lat) < tol && Math.abs(g.lon - w.lon) < tol;
    });
  }
  assert.ok(matched, `rings not cyclically equal: ${JSON.stringify(got)}`);
};

/** Every output vertex is a subject vertex or lies on a clip edge. */
const noInventedVertices = (out, subject, clip) => {
  const sVecs = subject.map(([la, lo]) => toVecT(la, lo));
  const normals = edgeNormalsT(clip);
  const ang = (a, b) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return 2 * Math.asin(Math.min(1, Math.hypot(dx, dy, dz) / 2));
  };
  for (const v of out) {
    const vv = toVecT(v.lat, v.lon);
    const isSubjectVertex = sVecs.some((s) => ang(s, vv) < 1e-9);
    const onClipEdge = normals.some((nn) => Math.abs(dotT(nn, vv)) < 1e-9);
    assert.ok(
      isSubjectVertex || onClipEdge,
      `vertex (${v.lat}, ${v.lon}) is neither a subject vertex nor on a clip edge`,
    );
  }
};

const BOX = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

// --- validation: null on invalid input ---

test('null on non-array inputs', () => {
  assert.equal(clipSphericalPolygon(null, BOX), null);
  assert.equal(clipSphericalPolygon(BOX, undefined), null);
  assert.equal(clipSphericalPolygon('nope', BOX), null);
  assert.equal(clipSphericalPolygon(BOX, 42), null);
});

test('null on rings with fewer than three vertices', () => {
  assert.equal(clipSphericalPolygon([], BOX), null);
  assert.equal(
    clipSphericalPolygon(
      [
        [0, 0],
        [0, 10],
      ],
      BOX,
    ),
    null,
  );
  assert.equal(clipSphericalPolygon(BOX, [[0, 0]]), null);
});

test('null on invalid vertices', () => {
  const bad = (v) => clipSphericalPolygon([v, [0, 10], [10, 0]], BOX);
  assert.equal(bad([NaN, 0]), null);
  assert.equal(bad([91, 0]), null);
  assert.equal(bad([-91, 0]), null);
  assert.equal(bad([0, 181]), null);
  assert.equal(bad([0, -181]), null);
  assert.equal(bad([1, 2, 3]), null);
  assert.equal(bad([0]), null);
  assert.equal(bad(null), null);
  assert.equal(bad('12'), null);
  assert.equal(bad({ lat: 0 }), null);
  assert.equal(bad({ lat: 0, lon: Infinity }), null);
});

test('null when fewer than three distinct vertices survive dedup', () => {
  assert.equal(
    clipSphericalPolygon(
      [
        [0, 0],
        [0, 0],
        [0, 10],
        [0, 10],
      ],
      BOX,
    ),
    null,
  );
  assert.equal(
    clipSphericalPolygon(
      [
        [5, 5],
        [5, 5],
        [5, 5],
      ],
      BOX,
    ),
    null,
  );
});

test('null on adjacent antipodal vertices (ambiguous minor arc)', () => {
  const subject = [
    [0, 0],
    [0, 180],
    [10, 90],
  ];
  assert.equal(clipSphericalPolygon(subject, BOX), null);
  const clip = [
    [0, 0],
    [0, 180],
    [10, 90],
  ];
  assert.equal(clipSphericalPolygon(BOX, clip), null);
});

test('null on a concave clip ring', () => {
  // Notched arrowhead: concave at (5, 4).
  const concave = [
    [0, 0],
    [10, 0],
    [10, 10],
    [5, 4],
    [0, 10],
  ];
  assert.equal(clipSphericalPolygon(BOX, concave), null);
});

test('null on a zero-area (collinear) clip ring', () => {
  const flat = [
    [0, 0],
    [0, 10],
    [0, 20],
  ];
  assert.equal(clipSphericalPolygon(BOX, flat), null);
});

test('null on a self-intersecting (bowtie) clip ring', () => {
  const bowtie = [
    [0, 0],
    [10, 10],
    [10, 0],
    [0, 10],
  ];
  assert.equal(clipSphericalPolygon(BOX, bowtie), null);
});

// --- containment behaviour ---

test('subject fully inside clip returns the subject vertices', () => {
  const inner = [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
  ];
  const out = clipSphericalPolygon(inner, BOX);
  assert.ok(Array.isArray(out));
  ringCyclicEqual(out, inner.map(pt));
});

test('clip fully inside subject returns the clip vertices', () => {
  const inner = [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
  ];
  const out = clipSphericalPolygon(BOX, inner);
  ringCyclicEqual(out, inner.map(pt));
});

test('identical rings return the ring', () => {
  const out = clipSphericalPolygon(BOX, BOX);
  ringCyclicEqual(out, BOX.map(pt));
});

test('disjoint polygons return []', () => {
  const far = [
    [40, 40],
    [40, 50],
    [50, 50],
    [50, 40],
  ];
  assert.deepEqual(clipSphericalPolygon(far, BOX), []);
  assert.deepEqual(clipSphericalPolygon(BOX, far), []);
});

test('polygons sharing only an edge return []', () => {
  const east = [
    [0, 10],
    [0, 20],
    [10, 20],
    [10, 10],
  ];
  assert.deepEqual(clipSphericalPolygon(east, BOX), []);
});

test('polygons touching at a single corner return []', () => {
  const ne = [
    [10, 10],
    [10, 20],
    [20, 20],
    [20, 10],
  ];
  assert.deepEqual(clipSphericalPolygon(ne, BOX), []);
});

// --- partial overlap: exact pins + oracle properties ---

test('partial box overlap cuts exact meridian/equator crossings', () => {
  // Subject straddles the box east-west; its meridian edges cross the
  // box's equator edge exactly at (0,5) and (0,6).
  const subject = [
    [-5, 5],
    [20, 5],
    [20, 6],
    [-5, 6],
  ];
  const out = clipSphericalPolygon(subject, BOX);
  assert.equal(out.length, 4);
  approxPt(out[0], 0, 5);
  approxPt(out[3], 0, 6);
  // The other two vertices sit on the box's northern great-circle edge:
  // longitude is exactly the subject meridian, latitude just above 10.
  for (const [v, lon] of [
    [out[1], 5],
    [out[2], 6],
  ]) {
    assert.ok(Math.abs(v.lon - lon) < 1e-9, `lon drifted: ${v.lon}`);
    assert.ok(v.lat > 10 && v.lat < 10.5, `lat out of range: ${v.lat}`);
  }
  // Independent oracles: every vertex inside both polygons, none invented.
  for (const v of out) {
    assert.ok(
      convexContainsT(BOX, v.lat, v.lon),
      `outside clip: ${v.lat},${v.lon}`,
    );
    assert.ok(
      convexContainsT(subject, v.lat, v.lon),
      `outside subject: ${v.lat},${v.lon}`,
    );
  }
  noInventedVertices(out, subject, BOX);
  // The cut vertices lie exactly on the box's northern edge plane.
  const normals = edgeNormalsT(BOX);
  for (const v of [out[1], out[2]]) {
    const vv = toVecT(v.lat, v.lon);
    assert.ok(
      normals.some((n) => Math.abs(dotT(n, vv)) < 1e-9),
      `cut vertex not on any clip edge: ${v.lat},${v.lon}`,
    );
  }
});

test('clockwise-wound clip gives the same intersection', () => {
  const subject = [
    [-5, 5],
    [20, 5],
    [20, 6],
    [-5, 6],
  ];
  const ccw = clipSphericalPolygon(subject, BOX);
  const cw = clipSphericalPolygon(subject, [...BOX].reverse());
  ringCyclicEqual(cw, ccw);
});

test('antimeridian-crossing polygons clip correctly in 3D', () => {
  const clip = [
    [10, 170],
    [10, -170],
    [20, -170],
    [20, 170],
  ];
  const subject = [
    [0, 165],
    [30, 165],
    [30, -165],
    [0, -165],
  ];
  // The clip quad sits strictly inside the subject: result is the clip.
  // Note the subject ring is wound CW while the clip is CCW, and
  // Sutherland–Hodgman preserves the SUBJECT's winding, so the output
  // follows the reversed clip order.
  const out = clipSphericalPolygon(subject, clip);
  ringCyclicEqual(out, [...clip].reverse().map(pt));
  for (const v of out) {
    assert.ok(
      convexContainsT(subject, v.lat, v.lon),
      `outside subject: ${v.lat},${v.lon}`,
    );
  }
  // And symmetrically the subject is untouched when it is the subject.
  const out2 = clipSphericalPolygon(clip, subject);
  ringCyclicEqual(out2, clip.map(pt));
});

// --- concave subject ---

test('concave L-shaped subject clips to the exact L/box intersection', () => {
  const ell = [
    [-5, -5],
    [15, -5],
    [15, 5],
    [5, 5],
    [5, 15],
    [-5, 15],
  ];
  const out = clipSphericalPolygon(ell, BOX);
  // Hand-traced Sutherland–Hodgman order: equator/meridian cuts are
  // exact, great-circle cuts keep their exact meridian longitude.
  assert.equal(out.length, 6);
  approxPt(out[0], 0, 10); // equator x clip east meridian: exact
  approxPt(out[1], 0, 0); // equator x clip west meridian: exact
  approxPt(out[4], 5, 5); // interior subject vertex, preserved
  // Cut vertices: exact in one coordinate, bounded in the other.
  assert.ok(
    Math.abs(out[2].lon - 0) < 1e-9 && out[2].lat > 9 && out[2].lat < 10.5,
  );
  assert.ok(
    Math.abs(out[3].lon - 5) < 1e-9 && out[3].lat > 10 && out[3].lat < 10.5,
  );
  assert.ok(
    Math.abs(out[5].lon - 10) < 1e-9 && out[5].lat > 5 && out[5].lat < 5.5,
  );
  for (const v of out) {
    assert.ok(
      convexContainsT(BOX, v.lat, v.lon),
      `outside clip: ${v.lat},${v.lon}`,
    );
  }
  noInventedVertices(out, ell, BOX);
});

// --- algebraic properties ---

test('clipping twice is a fixed point', () => {
  const subject = [
    [-5, 5],
    [20, 5],
    [20, 6],
    [-5, 6],
  ];
  const once = clipSphericalPolygon(subject, BOX);
  const twice = clipSphericalPolygon(once, BOX);
  ringCyclicEqual(twice, once);
});

test('intersection of two convex rings is commutative', () => {
  const other = [
    [5, 5],
    [5, 15],
    [15, 15],
    [15, 5],
  ];
  const ab = clipSphericalPolygon(BOX, other);
  const ba = clipSphericalPolygon(other, BOX);
  assert.ok(ab.length >= 3 && ba.length >= 3);
  ringCyclicEqual(ab, ba);
  for (const v of ab) {
    assert.ok(convexContainsT(BOX, v.lat, v.lon));
    assert.ok(convexContainsT(other, v.lat, v.lon));
  }
});

// --- input conveniences ---

test('accepts {lat, lon} objects and explicitly closed rings', () => {
  const innerObj = [
    { lat: 2, lon: 2 },
    { lat: 2, lon: 8 },
    { lat: 8, lon: 8 },
    { lat: 8, lon: 2 },
  ];
  const out = clipSphericalPolygon(innerObj, BOX);
  ringCyclicEqual(
    out,
    innerObj.map((p) => ({ lat: p.lat, lon: p.lon })),
  );
  const closed = [...BOX, [0, 0]];
  const out2 = clipSphericalPolygon(closed, BOX);
  ringCyclicEqual(out2, BOX.map(pt));
});

test('a duplicated clip vertex is tolerated', () => {
  const dupClip = [
    [0, 0],
    [0, 10],
    [0, 10],
    [10, 10],
    [10, 0],
  ];
  const inner = [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
  ];
  const out = clipSphericalPolygon(inner, dupClip);
  ringCyclicEqual(out, inner.map(pt));
});
