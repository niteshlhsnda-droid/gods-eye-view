import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWkbBytes,
  parseWkbToGeoJson,
  WkbGeoImportError,
} from './wkbGeoImport.js';

// Minimal WKB encoder for test fixtures: builds the same bytes a
// PostGIS / Shapely / GDAL export would carry.

function concat(...chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function u8(value) {
  return Uint8Array.of(value);
}

function u32(value, little) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value, little);
  return new Uint8Array(buf);
}

function f64(value, little) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, little);
  return new Uint8Array(buf);
}

function coord(point, little, hasZ) {
  return concat(
    f64(point[0], little),
    f64(point[1], little),
    ...(hasZ ? [f64(point[2] ?? 0, little)] : []),
  );
}

/**
 * One geometry header: byte-order byte, type word (with ISO offset or
 * EWKB flags), and the SRID value when the EWKB SRID flag is set.
 */
function header(
  base,
  { little = true, iso = null, ewkbZ = false, srid = null } = {},
) {
  let type = base;
  if (iso === 'Z') type = base + 1000;
  if (iso === 'M') type = base + 2000;
  if (iso === 'ZM') type = base + 3000;
  if (ewkbZ) type |= 0x80000000;
  if (srid !== null) type |= 0x20000000;
  return concat(
    u8(little ? 1 : 0),
    u32(type, little),
    ...(srid !== null ? [u32(srid, little)] : []),
  );
}

function pointGeom(point, opts = {}) {
  const hasZ = opts.iso === 'Z' || opts.ewkbZ || point.length > 2;
  return concat(header(1, opts), coord(point, opts.little ?? true, hasZ));
}

function lineGeom(points, opts = {}) {
  const little = opts.little ?? true;
  const hasZ = opts.iso === 'Z' || opts.ewkbZ;
  return concat(
    header(2, opts),
    u32(points.length, little),
    ...points.map((p) => coord(p, little, hasZ)),
  );
}

function polygonGeom(rings, opts = {}) {
  const little = opts.little ?? true;
  const hasZ = opts.iso === 'Z' || opts.ewkbZ;
  return concat(
    header(3, opts),
    u32(rings.length, little),
    ...rings.map((ring) =>
      concat(
        u32(ring.length, little),
        ...ring.map((p) => coord(p, little, hasZ)),
      ),
    ),
  );
}

function collectionGeom(base, members, opts = {}) {
  const little = opts.little ?? true;
  return concat(header(base, opts), u32(members.length, little), ...members);
}

function geometryOf(featureCollection) {
  assert.equal(featureCollection.type, 'FeatureCollection');
  assert.equal(featureCollection.features.length, 1);
  return featureCollection.features[0].geometry;
}

function refuses(bytes, pattern) {
  assert.throws(
    () => parseWkbToGeoJson(bytes),
    (error) => {
      assert.ok(
        error instanceof WkbGeoImportError,
        `expected WkbGeoImportError, got ${error}`,
      );
      assert.match(error.message, pattern);
      return true;
    },
  );
}

const SQUARE = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];
const HOLE = [
  [2, 2],
  [4, 2],
  [4, 4],
  [2, 4],
  [2, 2],
];

test('Point, little-endian 2D', () => {
  assert.deepEqual(geometryOf(parseWkbToGeoJson(pointGeom([12.5, -45.25]))), {
    type: 'Point',
    coordinates: [12.5, -45.25],
  });
});

test('Point, big-endian 2D', () => {
  assert.deepEqual(
    geometryOf(parseWkbToGeoJson(pointGeom([12.5, -45.25], { little: false }))),
    { type: 'Point', coordinates: [12.5, -45.25] },
  );
});

test('Point Z via ISO offset 1001 keeps the altitude', () => {
  assert.deepEqual(
    geometryOf(parseWkbToGeoJson(pointGeom([1, 2, 300], { iso: 'Z' }))),
    { type: 'Point', coordinates: [1, 2, 300] },
  );
});

test('Point Z via EWKB Z flag keeps the altitude', () => {
  assert.deepEqual(
    geometryOf(parseWkbToGeoJson(pointGeom([1, 2, 300], { ewkbZ: true }))),
    { type: 'Point', coordinates: [1, 2, 300] },
  );
});

test('EWKB SRID 4326 is accepted', () => {
  assert.deepEqual(
    geometryOf(parseWkbToGeoJson(pointGeom([1, 2], { srid: 4326 }))),
    { type: 'Point', coordinates: [1, 2] },
  );
});

test('EWKB SRID 3857 is refused, never re-labelled as degrees', () => {
  refuses(pointGeom([1, 2], { srid: 3857 }), /SRID 3857/);
});

test('Measured dimensions are refused in every encoding', () => {
  refuses(pointGeom([1, 2], { iso: 'M' }), /measured/i);
  refuses(pointGeom([1, 2], { iso: 'ZM' }), /measured/i);
  const mFlagged = concat(
    u8(1),
    u32(1 | 0x40000000, true),
    f64(1, true),
    f64(2, true),
    f64(5, true),
  );
  refuses(mFlagged, /measured/i);
});

test('LineString parses; EMPTY LineString becomes null geometry', () => {
  assert.deepEqual(
    geometryOf(
      parseWkbToGeoJson(
        lineGeom([
          [0, 0],
          [1, 1],
          [2, 0],
        ]),
      ),
    ),
    {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
    },
  );
  assert.equal(geometryOf(parseWkbToGeoJson(lineGeom([]))), null);
});

test('LineString with one point is refused', () => {
  refuses(lineGeom([[0, 0]]), /one point/);
});

test('Polygon with a hole keeps both rings', () => {
  assert.deepEqual(geometryOf(parseWkbToGeoJson(polygonGeom([SQUARE, HOLE]))), {
    type: 'Polygon',
    coordinates: [SQUARE, HOLE],
  });
});

test('EMPTY Polygon (zero rings) becomes null geometry', () => {
  assert.equal(geometryOf(parseWkbToGeoJson(polygonGeom([]))), null);
});

test('Polygon ring that is not closed is refused', () => {
  const open = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  refuses(polygonGeom([open]), /not closed/);
});

test('Polygon ring with fewer than 4 points is refused', () => {
  refuses(
    polygonGeom([
      [
        [0, 0],
        [0, 0],
      ],
    ]),
    /at least 4/,
  );
});

test('MultiPoint members carry their own headers, in mixed endianness', () => {
  const bytes = collectionGeom(4, [
    pointGeom([1, 1], { little: true }),
    pointGeom([2, 2], { little: false }),
  ]);
  assert.deepEqual(geometryOf(parseWkbToGeoJson(bytes)), {
    type: 'MultiPoint',
    coordinates: [
      [1, 1],
      [2, 2],
    ],
  });
});

test('EMPTY MultiPoint becomes null geometry', () => {
  assert.equal(geometryOf(parseWkbToGeoJson(collectionGeom(4, []))), null);
});

test('MultiLineString and MultiPolygon parse', () => {
  assert.deepEqual(
    geometryOf(
      parseWkbToGeoJson(
        collectionGeom(5, [
          lineGeom([
            [0, 0],
            [1, 1],
          ]),
          lineGeom([
            [2, 2],
            [3, 3],
          ]),
        ]),
      ),
    ),
    {
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ],
    },
  );
  assert.deepEqual(
    geometryOf(parseWkbToGeoJson(collectionGeom(6, [polygonGeom([SQUARE])]))),
    { type: 'MultiPolygon', coordinates: [[SQUARE]] },
  );
});

test('GeometryCollection parses, EMPTY members skipped', () => {
  const bytes = collectionGeom(7, [
    pointGeom([1, 1]),
    lineGeom([]), // EMPTY member: skipped.
    polygonGeom([SQUARE]),
  ]);
  assert.deepEqual(geometryOf(parseWkbToGeoJson(bytes)), {
    type: 'GeometryCollection',
    geometries: [
      { type: 'Point', coordinates: [1, 1] },
      { type: 'Polygon', coordinates: [SQUARE] },
    ],
  });
});

test('EMPTY GeometryCollection becomes null geometry', () => {
  assert.equal(geometryOf(parseWkbToGeoJson(collectionGeom(7, []))), null);
});

test('EMPTY Point is the NaN,NaN encoding; one NaN is refused', () => {
  assert.equal(
    geometryOf(parseWkbToGeoJson(pointGeom([Number.NaN, Number.NaN]))),
    null,
  );
  refuses(pointGeom([Number.NaN, 5]), /exactly one NaN/);
});

test('Multi member of the wrong type is refused', () => {
  const bytes = collectionGeom(4, [
    lineGeom([
      [0, 0],
      [1, 1],
    ]),
  ]);
  refuses(bytes, /inside a MultiPoint/);
});

test('Out-of-range, non-finite and over-altitude coordinates are refused', () => {
  refuses(pointGeom([200, 0]), /longitude/);
  refuses(pointGeom([0, 91]), /latitude/);
  refuses(pointGeom([0, 0, 2_000_000], { iso: 'Z' }), /altitude/);
  refuses(
    lineGeom([
      [0, 0],
      [Number.NaN, 0],
    ]),
    /non-finite/,
  );
});

test('Truncated buffer, trailing bytes, bad byte-order and unknown type are refused', () => {
  const full = pointGeom([1, 2]);
  refuses(full.subarray(0, 6), /truncated/);
  refuses(concat(full, u8(0)), /trailing/);
  refuses(concat(u8(2), full.subarray(1)), /byte-order/);
  refuses(concat(u8(1), u32(99, true)), /unknown geometry type/);
});

test('Empty buffer and non-Uint8Array input are refused', () => {
  refuses(new Uint8Array(0), /empty buffer/);
  assert.throws(() => parseWkbToGeoJson('POINT (1 2)'), WkbGeoImportError);
  assert.throws(() => parseWkbToGeoJson(null), WkbGeoImportError);
});

test('Nesting deeper than the cap is refused', () => {
  let inner = pointGeom([1, 1]);
  for (let i = 0; i < 40; i += 1) {
    inner = collectionGeom(7, [inner]);
  }
  refuses(inner, /deeper than 32/);
});

test('isWkbBytes sniffs without throwing', () => {
  assert.equal(isWkbBytes(pointGeom([1, 2])), true);
  assert.equal(isWkbBytes(pointGeom([1, 2], { little: false })), true);
  assert.equal(isWkbBytes(new Uint8Array(0)), false);
  assert.equal(isWkbBytes(new TextEncoder().encode('POINT (1 2)')), false);
  assert.equal(isWkbBytes('POINT (1 2)'), false);
  assert.equal(isWkbBytes(concat(u8(2), u32(1, true))), false);
  assert.equal(isWkbBytes(concat(u8(1), u32(99, true))), false);
});
