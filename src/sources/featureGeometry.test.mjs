// FEATURE GEOMETRY — pure polygon/corridor operations over lon/lat pairs, and
// what they do at the edges. These pins exist because the callers (Overpass
// feature records, corridor buffers) silently inherit every quirk below: a
// dropped segment, an unclosed ring, or a dateline-crossing distance that is
// 40,000 km instead of 22 km. Surprising behaviours are PINNED, not fixed.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ringAreaM2,
  stitchLine,
  bufferCorridor,
  simplifyRing,
  douglasPeucker,
  perpDistance,
  stitchRing,
  largestByArea,
  ringSpanM,
  buildRingComponents,
  endpointGapM,
  closeRing,
  ringCentroid,
  approximateAreaM2,
  approximateDistanceM,
  pointInPolygon,
} from './featureGeometry.js';

const approx = (actual, expected, tol = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} of ${expected}`,
  );

// A 0.01-degree square at the equator: (0.01 * 111320)^2 = 1239214.24 m^2.
const EQUATOR_SQUARE = [
  [0, 0],
  [0.01, 0],
  [0.01, 0.01],
  [0, 0.01],
];
const SQUARE_M2 = 1239214.24;

test('ringAreaM2 measures a 0.01-degree equatorial square', () => {
  approx(ringAreaM2(EQUATOR_SQUARE), SQUARE_M2, 0.01);
});

test('ringAreaM2 halves the area at latitude 60 (cosine longitude scale)', () => {
  const at60 = [
    [0, 60],
    [0.01, 60],
    [0.01, 60.01],
    [0, 60.01],
  ];
  approx(ringAreaM2(at60), SQUARE_M2 / 2, 0.01);
  approx(ringAreaM2(at60) / ringAreaM2(EQUATOR_SQUARE), 0.5, 1e-9);
});

test('ringAreaM2 needs no closing point: an unclosed triangle is half the square', () => {
  approx(
    ringAreaM2([
      [0, 0],
      [0.01, 0],
      [0, 0.01],
    ]),
    SQUARE_M2 / 2,
    0.01,
  );
});

test('ringAreaM2 is winding-independent', () => {
  const reversed = [...EQUATOR_SQUARE].reverse();
  // Float summation order differs by winding: allow 1 m^2 on a 1.24M m^2 area.
  approx(ringAreaM2(reversed), ringAreaM2(EQUATOR_SQUARE), 1);
});

test('ringAreaM2 returns 0 for degenerate and missing rings', () => {
  assert.equal(ringAreaM2(null), 0);
  assert.equal(ringAreaM2(undefined), 0);
  assert.equal(ringAreaM2([]), 0);
  assert.equal(
    ringAreaM2([
      [0, 0],
      [1, 1],
    ]),
    0,
  );
  // Collinear: zero enclosed area.
  assert.equal(
    ringAreaM2([
      [0, 0],
      [0.01, 0],
      [0.02, 0],
    ]),
    0,
  );
});

test('approximateDistanceM: one degree of latitude is exactly 111320 m', () => {
  assert.equal(approximateDistanceM(0, 0, 1, 0), 111320);
  assert.equal(approximateDistanceM(0, 0, 0, 1), 111320);
  assert.equal(approximateDistanceM(10, 20, 10, 20), 0);
});

test('approximateDistanceM is symmetric in its endpoints', () => {
  assert.equal(
    approximateDistanceM(10, 20, 30, 40),
    approximateDistanceM(30, 40, 10, 20),
  );
});

test('approximateDistanceM does NOT wrap at the antimeridian', () => {
  // The true gap between 179.9 and -179.9 is 0.2 degrees (~22 km). The
  // function takes the raw 359.8-degree difference instead: callers that
  // feed it dateline-crossing pairs get ~40,053 km.
  approx(approximateDistanceM(0, 179.9, 0, -179.9), 40052936, 1);
});

test('approximateAreaM2 agrees with ringAreaM2 on the same square', () => {
  const square = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.01 },
    { lat: 0.01, lon: 0.01 },
    { lat: 0.01, lon: 0 },
  ];
  approx(approximateAreaM2(square), SQUARE_M2, 0.01);
  assert.equal(approximateAreaM2([]), 0);
  assert.equal(
    approximateAreaM2([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
    ]),
    0,
  );
});

test('approximateAreaM2 also halves at latitude 60', () => {
  const at0 = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.01 },
    { lat: 0.01, lon: 0.01 },
    { lat: 0.01, lon: 0 },
  ];
  const at60 = [
    { lat: 60, lon: 0 },
    { lat: 60, lon: 0.01 },
    { lat: 60.01, lon: 0.01 },
    { lat: 60.01, lon: 0 },
  ];
  approx(approximateAreaM2(at60) / approximateAreaM2(at0), 0.5, 1e-9);
});

test('pointInPolygon: inside, outside, and empty', () => {
  const square = [
    { lon: 0, lat: 0 },
    { lon: 1, lat: 0 },
    { lon: 1, lat: 1 },
    { lon: 0, lat: 1 },
  ];
  assert.equal(pointInPolygon(0.5, 0.5, square), true);
  assert.equal(pointInPolygon(2, 2, square), false);
  assert.equal(pointInPolygon(0, 0, []), false);
});

test('pointInPolygon counts boundary points as inside', () => {
  const square = [
    { lon: 0, lat: 0 },
    { lon: 1, lat: 0 },
    { lon: 1, lat: 1 },
    { lon: 0, lat: 1 },
  ];
  assert.equal(pointInPolygon(0.5, 0, square), true);
  assert.equal(pointInPolygon(0, 0, square), true);
});

test('pointInPolygon honours a concave notch', () => {
  const concave = [
    { lon: 0, lat: 0 },
    { lon: 2, lat: 0 },
    { lon: 2, lat: 2 },
    { lon: 1, lat: 1 },
    { lon: 0, lat: 2 },
  ];
  assert.equal(pointInPolygon(0.3, 1.5, concave), true);
  assert.equal(pointInPolygon(1.0, 1.5, concave), false);
});

test('perpDistance: perpendicular, on-segment, and clamped to the endpoint', () => {
  assert.equal(perpDistance([0.5, 1], [0, 0], [1, 0]), 1);
  assert.equal(perpDistance([0.5, 0], [0, 0], [1, 0]), 0);
  // Beyond the far end the distance is to the endpoint, not the infinite line.
  assert.equal(perpDistance([2, 0], [0, 0], [1, 0]), 1);
  assert.equal(perpDistance([-1, 0], [0, 0], [1, 0]), 1);
});

test('perpDistance of a degenerate segment is the Euclidean distance', () => {
  assert.equal(perpDistance([3, 4], [0, 0], [0, 0]), 5);
});

test('douglasPeucker returns a copy, never the input, for fewer than 3 points', () => {
  const points = [
    [0, 0],
    [1, 1],
  ];
  const out = douglasPeucker(points, 1);
  assert.deepEqual(out, points);
  assert.notEqual(out, points);
});

test('douglasPeucker collapses a collinear run to its endpoints', () => {
  assert.deepEqual(
    douglasPeucker(
      [
        [0, 0],
        [0.5, 0],
        [1, 0],
        [1.5, 0],
        [2, 0],
      ],
      0.1,
    ),
    [
      [0, 0],
      [2, 0],
    ],
  );
});

test('douglasPeucker keeps a bump above tolerance and drops one below it', () => {
  assert.deepEqual(
    douglasPeucker(
      [
        [0, 0],
        [0.5, 1],
        [1, 0],
      ],
      0.1,
    ),
    [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ],
  );
  assert.deepEqual(
    douglasPeucker(
      [
        [0, 0],
        [0.5, 0.01],
        [1, 0],
      ],
      0.1,
    ),
    [
      [0, 0],
      [1, 0],
    ],
  );
});

test('douglasPeucker does not mutate its input', () => {
  const points = [
    [0, 0],
    [0.5, 1],
    [1, 0],
  ];
  const before = JSON.stringify(points);
  douglasPeucker(points, 0.1);
  assert.equal(JSON.stringify(points), before);
});

test('closeRing appends the first point and mutates the input in place', () => {
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const out = closeRing(ring);
  assert.equal(out, ring);
  assert.deepEqual(ring, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ]);
});

test('closeRing leaves an already-closed ring and a short ring untouched', () => {
  const closed = [
    [0, 0],
    [1, 0],
    [0, 0],
  ];
  assert.equal(closeRing(closed), closed);
  assert.equal(closed.length, 3);
  const short = [
    [0, 0],
    [1, 1],
  ];
  assert.equal(closeRing(short), short);
  assert.equal(short.length, 2);
});

test('ringCentroid averages the vertices as given', () => {
  assert.deepEqual(
    ringCentroid([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]),
    {
      lat: 1,
      lon: 1,
    },
  );
});

test('ringCentroid counts a closing duplicate vertex twice', () => {
  // The closed square repeats [0,0], so the origin gets double weight and
  // the centroid shifts from (1,1) to (0.8,0.8). Callers that close rings
  // before taking the centroid inherit this bias.
  assert.deepEqual(
    ringCentroid([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ]),
    {
      lat: 0.8,
      lon: 0.8,
    },
  );
});

test('ringCentroid returns null for missing or short rings', () => {
  assert.equal(ringCentroid(null), null);
  assert.equal(
    ringCentroid([
      [0, 0],
      [1, 1],
    ]),
    null,
  );
});

test('endpointGapM is 0 for a closed chain and Infinity for a missing one', () => {
  assert.equal(
    endpointGapM([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
      { lat: 0, lon: 0 },
    ]),
    0,
  );
  assert.equal(endpointGapM(null), Infinity);
  assert.equal(endpointGapM([]), Infinity);
  assert.equal(endpointGapM([{ lat: 0, lon: 0 }]), Infinity);
});

test('buildRingComponents returns no components for no ways', () => {
  assert.deepEqual(buildRingComponents([]), []);
});

test('buildRingComponents joins tail-head, reversed, and head-prepend ways', () => {
  const a = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
  ];
  const b = [
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
  ];
  assert.equal(buildRingComponents([a, b]).length, 1);
  assert.equal(
    buildRingComponents([
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
      [
        { lat: 1, lon: 1 },
        { lat: 0, lon: 1 },
      ],
    ]).length,
    1,
  );
  assert.equal(
    buildRingComponents([
      [
        { lat: 0, lon: 1 },
        { lat: 1, lon: 1 },
      ],
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
    ]).length,
    1,
  );
});

test('buildRingComponents needs endpoints within 1e-7 degrees to join', () => {
  // 1e-6 degrees apart (~11 cm) is already too far: the ways stay separate.
  assert.equal(
    buildRingComponents([
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
      [
        { lat: 0, lon: 1.000001 },
        { lat: 1, lon: 1 },
      ],
    ]).length,
    2,
  );
});

test('buildRingComponents keeps disjoint ways as separate components', () => {
  assert.equal(
    buildRingComponents([
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
      [
        { lat: 5, lon: 5 },
        { lat: 5, lon: 6 },
      ],
    ]).length,
    2,
  );
});

test('stitchRing returns an empty ring for no ways', () => {
  assert.deepEqual(stitchRing([]), []);
});

test('stitchRing returns a closed square with its closing point', () => {
  assert.deepEqual(
    stitchRing([
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
      [
        { lat: 0, lon: 1 },
        { lat: 1, lon: 1 },
      ],
      [
        { lat: 1, lon: 1 },
        { lat: 1, lon: 0 },
      ],
      [
        { lat: 1, lon: 0 },
        { lat: 0, lon: 0 },
      ],
    ]),
    [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
      { lat: 0, lon: 0 },
    ],
  );
});

test('stitchRing returns a near-closed chain as-is, without appending a close', () => {
  // Endpoint gap ~15.7 m is inside the 30 m CLOSE_TOL, so the chain counts
  // as closed — but no closing point is appended; the endpoints stay 15.7 m apart.
  const chain = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.01 },
    { lat: 0.01, lon: 0.01 },
    { lat: 0.0001, lon: 0.0001 },
  ];
  assert.deepEqual(stitchRing([chain]), chain);
});

test('stitchRing bridges a seam gap inside the 15%-of-span / 1200 m ceiling', () => {
  // Gap ~157 m; span ~15,742 m, so the allowance is min(2361, 1200) = 1200 m.
  const chain = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.1 },
    { lat: 0.1, lon: 0.1 },
    { lat: 0.001, lon: 0.001 },
  ];
  assert.deepEqual(stitchRing([chain]), chain);
});

test('stitchRing rejects a gap past the 1200 m absolute ceiling', () => {
  // Gap ~2226 m beats both the 15%-of-span allowance and the 1200 m ceiling.
  assert.deepEqual(
    stitchRing([
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.1 },
        { lat: 0.1, lon: 0.1 },
        { lat: 0.02, lon: 0 },
      ],
    ]),
    [],
  );
});

test('stitchRing rejects disjoint ways and a lone open way', () => {
  assert.deepEqual(
    stitchRing([
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
      [
        { lat: 5, lon: 5 },
        { lat: 5, lon: 6 },
      ],
    ]),
    [],
  );
  assert.deepEqual(
    stitchRing([
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
    ]),
    [],
  );
});

test('stitchRing prefers a closed ring over a larger open chain', () => {
  const closed = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.001 },
    { lat: 0.001, lon: 0.001 },
    { lat: 0.001, lon: 0 },
    { lat: 0, lon: 0 },
  ];
  const ways = [
    [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.001 },
    ],
    [
      { lat: 0, lon: 0.001 },
      { lat: 0.001, lon: 0.001 },
    ],
    [
      { lat: 0.001, lon: 0.001 },
      { lat: 0.001, lon: 0 },
    ],
    [
      { lat: 0.001, lon: 0 },
      { lat: 0, lon: 0 },
    ],
    [
      { lat: 5, lon: 5 },
      { lat: 5, lon: 6 },
      { lat: 6, lon: 6 },
    ],
  ];
  assert.deepEqual(stitchRing(ways), closed);
});

test('largestByArea picks the larger component', () => {
  const small = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
  ];
  const large = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 2 },
    { lat: 2, lon: 2 },
  ];
  assert.equal(largestByArea([small, large]), large);
});

test('largestByArea throws on an empty list instead of returning nothing', () => {
  assert.throws(() => largestByArea([]), TypeError);
});

test('ringSpanM measures the corner-to-corner diagonal', () => {
  approx(
    ringSpanM([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
    ]),
    157427.26,
    0.01,
  );
  assert.equal(ringSpanM([{ lat: 5, lon: 5 }]), 0);
  assert.equal(ringSpanM([]), Infinity);
});

test('stitchLine returns undefined for no segments', () => {
  assert.equal(stitchLine([]), undefined);
});

test('stitchLine returns a lone segment untouched', () => {
  assert.deepEqual(
    stitchLine([
      [
        [0, 0],
        [1, 0],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
    ],
  );
});

test('stitchLine chains segments in any orientation', () => {
  assert.deepEqual(
    stitchLine([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [2, 0],
      ],
      [
        [2, 0],
        [3, 0],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  );
  // Reversed tail join.
  assert.deepEqual(
    stitchLine([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [2, 0],
        [1, 0],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  );
  // Head prepend, both orientations.
  assert.deepEqual(
    stitchLine([
      [
        [1, 0],
        [2, 0],
      ],
      [
        [0, 0],
        [1, 0],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  );
  assert.deepEqual(
    stitchLine([
      [
        [1, 0],
        [2, 0],
      ],
      [
        [1, 0],
        [0, 0],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  );
});

test('stitchLine joins endpoints within 2 m and refuses a 3.3 m gap', () => {
  assert.deepEqual(
    stitchLine([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1.00001, 0],
        [2, 0],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  );
  assert.deepEqual(
    stitchLine([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1.00003, 0],
        [2, 0],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
    ],
  );
});

test('stitchLine skips an unjoinable segment and keeps chaining past it', () => {
  assert.deepEqual(
    stitchLine([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [9, 9],
        [10, 9],
      ],
      [
        [1, 0],
        [2, 0],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  );
});

test('stitchLine silently drops a disjoint trailing segment', () => {
  // The second segment never joins, and no error is raised: it just vanishes.
  assert.deepEqual(
    stitchLine([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [5, 5],
        [6, 5],
      ],
    ]),
    [
      [0, 0],
      [1, 0],
    ],
  );
});

test('stitchLine does not mutate its input segments', () => {
  const segments = [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [1, 0],
      [2, 0],
    ],
  ];
  const before = JSON.stringify(segments);
  stitchLine(segments);
  assert.equal(JSON.stringify(segments), before);
});

test('bufferCorridor closes a two-point line with a five-point ring', () => {
  const ring = bufferCorridor(
    [
      [0, 0],
      [0.01, 0],
    ],
    100,
  );
  assert.equal(ring.length, 5);
  // Closed by value: the final map() rebuilds every point, so first and last
  // are distinct arrays with equal coordinates, not the same reference.
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  for (const point of ring) {
    assert.equal(point.length, 2);
    assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]));
  }
});

test('bufferCorridor yields 2n+1 points for an n-point line', () => {
  assert.equal(
    bufferCorridor(
      [
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
      ],
      100,
    ).length,
    7,
  );
});

test('bufferCorridor with zero width collapses to the centre line', () => {
  const ring = bufferCorridor(
    [
      [0, 0],
      [0.01, 0],
    ],
    0,
  );
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  approx(ring[0][0], 0);
  approx(ring[1][0], 0.01, 1e-9);
});

test('bufferCorridor of a single point is three identical points', () => {
  assert.deepEqual(bufferCorridor([[0, 0]], 100), [
    [0, 0],
    [0, 0],
    [0, 0],
  ]);
});

test('bufferCorridor throws on an empty line instead of returning nothing', () => {
  assert.throws(() => bufferCorridor([], 100), TypeError);
});

test('simplifyRing returns short rings untouched, same reference', () => {
  const ring = Array.from({ length: 10 }, (_, i) => [i * 0.001, 0]);
  assert.equal(simplifyRing(ring, 100), ring);
});

test('simplifyRing reduces a 30-point ring and keeps both endpoints', () => {
  const ring = Array.from({ length: 30 }, (_, i) => [
    i * 0.001,
    i === 10 || i === 20 ? 0.01 : 0,
  ]);
  const out = simplifyRing(ring, 10);
  assert.equal(out.length, 8);
  assert.deepEqual(out[0], ring[0]);
  assert.deepEqual(out[out.length - 1], ring[ring.length - 1]);
  assert.ok(out.some((p) => p[0] === 0.01 && p[1] === 0.01));
  assert.ok(out.some((p) => p[0] === 0.02 && p[1] === 0.01));
});

test('simplifyRing falls back to the original ring when too few points survive', () => {
  // A 30-point small-wiggle ring collapses to 2 points under Douglas-Peucker,
  // below the 4-point floor — so the unsimplified ring comes back, same reference.
  const ring = Array.from({ length: 30 }, (_, i) => [
    i * 0.001,
    (i % 2) * 0.00001,
  ]);
  assert.equal(simplifyRing(ring, 10), ring);
  assert.equal(simplifyRing(ring, 1e9), ring);
});
