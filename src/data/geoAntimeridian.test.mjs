import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitAntimeridianPolygon,
  splitAntimeridianRing,
} from './geoAntimeridian.js';

const ring = (points) => [...points, points[0]];

test('a ring that does not cross is returned unchanged', () => {
  const input = ring([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);
  assert.deepEqual(splitAntimeridianRing(input), [input]);
});

test('a ring crossing the antimeridian splits into two closed rings', () => {
  const pieces = splitAntimeridianRing(
    ring([
      [179, 0],
      [-179, 0],
      [-179, 10],
      [179, 10],
    ]),
  );
  assert.equal(pieces.length, 2);
  for (const piece of pieces) {
    assert.deepEqual(piece[0], piece[piece.length - 1]);
    for (const [lon] of piece) {
      assert.ok(lon >= -180 && lon <= 180);
    }
  }
  // Each piece touches the antimeridian.
  for (const piece of pieces) {
    assert.ok(piece.some(([lon]) => Math.abs(Math.abs(lon) - 180) < 1e-9));
  }
});

test('a ring crossing westward (negative delta) splits too', () => {
  const pieces = splitAntimeridianRing(
    ring([
      [-179, 0],
      [179, 0],
      [179, 10],
      [-179, 10],
    ]),
  );
  assert.equal(pieces.length, 2);
  for (const piece of pieces) {
    assert.deepEqual(piece[0], piece[piece.length - 1]);
  }
});

test('crossing edges interpolate the boundary latitude', () => {
  const pieces = splitAntimeridianRing(
    ring([
      [179, 0],
      [-179, 20],
      [-179, 30],
      [179, 30],
    ]),
  );
  assert.equal(pieces.length, 2);
  const boundaryLats = pieces
    .flat()
    .filter(([lon]) => Math.abs(Math.abs(lon) - 180) < 1e-9)
    .map(([, lat]) => lat);
  assert.ok(boundaryLats.includes(10));
});

test('a ring crossing twice (out and back) splits into two rings', () => {
  const pieces = splitAntimeridianRing(
    ring([
      [170, 0],
      [-170, 0],
      [-170, 10],
      [170, 10],
    ]),
  );
  assert.equal(pieces.length, 2);
});

test('a ring touching the antimeridian without crossing stays whole', () => {
  const input = ring([
    [170, 0],
    [180, 0],
    [180, 10],
    [170, 10],
  ]);
  const pieces = splitAntimeridianRing(input);
  assert.equal(pieces.length, 1);
});

test('invalid rings throw', () => {
  assert.throws(() => splitAntimeridianRing([[0, 0]]), TypeError);
  assert.throws(
    () =>
      splitAntimeridianRing([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    TypeError,
  );
  assert.throws(
    () =>
      splitAntimeridianRing([
        [0, 0],
        [NaN, 0],
        [1, 1],
        [0, 0],
      ]),
    TypeError,
  );
});

test('splitAntimeridianPolygon turns a crossing Polygon into a MultiPolygon', () => {
  const result = splitAntimeridianPolygon({
    type: 'Polygon',
    coordinates: [
      ring([
        [179, 0],
        [-179, 0],
        [-179, 10],
        [179, 10],
      ]),
    ],
  });
  assert.equal(result.type, 'MultiPolygon');
  assert.equal(result.coordinates.length, 2);
});

test('splitAntimeridianPolygon leaves a non-crossing Polygon alone', () => {
  const result = splitAntimeridianPolygon({
    type: 'Polygon',
    coordinates: [
      ring([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    ],
  });
  assert.equal(result.type, 'Polygon');
  assert.equal(result.coordinates.length, 1);
});

test('a hole on one side stays attached to that side’s piece', () => {
  const result = splitAntimeridianPolygon({
    type: 'Polygon',
    coordinates: [
      ring([
        [179, 0],
        [-179, 0],
        [-179, 10],
        [179, 10],
      ]),
      ring([
        [179.2, 2],
        [179.8, 2],
        [179.8, 8],
        [179.2, 8],
      ]),
    ],
  });
  assert.equal(result.type, 'MultiPolygon');
  assert.equal(result.coordinates.length, 2);
  const holed = result.coordinates.filter((polygon) => polygon.length === 2);
  assert.equal(holed.length, 1);
});

test('splitAntimeridianPolygon passes a MultiPolygon through per polygon', () => {
  const result = splitAntimeridianPolygon({
    type: 'MultiPolygon',
    coordinates: [
      [
        ring([
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
      ],
      [
        ring([
          [179, 0],
          [-179, 0],
          [-179, 10],
          [179, 10],
        ]),
      ],
    ],
  });
  assert.equal(result.type, 'MultiPolygon');
  assert.equal(result.coordinates.length, 3);
});

test('splitAntimeridianPolygon rejects non-polygon input', () => {
  assert.throws(
    () => splitAntimeridianPolygon({ type: 'Point', coordinates: [0, 0] }),
    TypeError,
  );
});
