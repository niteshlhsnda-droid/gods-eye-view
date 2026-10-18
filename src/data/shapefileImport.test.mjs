import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShapefile,
  isShapefileBytes,
  isWgs84Prj,
  ShapefileImportError,
  SHP_MAX_FEATURES,
  SHP_MAX_POSITIONS,
} from './shapefileImport.js';

const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],' +
  'PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';
const NAD83_PRJ =
  'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",' +
  'SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],' +
  'UNIT["Degree",0.017453292519943295]]';
const PROJCS_PRJ =
  'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",' +
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],' +
  'PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],' +
  'PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0],' +
  'PARAMETER["Central_Meridian",0],UNIT["Meter",1]]';

class Writer {
  constructor() {
    this.bytes = [];
  }

  i32le(value) {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, value, true);
    this.bytes.push(...new Uint8Array(view.buffer));
    return this;
  }

  i32be(value) {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, value, false);
    this.bytes.push(...new Uint8Array(view.buffer));
    return this;
  }

  f64le(value) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    this.bytes.push(...new Uint8Array(view.buffer));
    return this;
  }

  raw(other) {
    this.bytes.push(...other.bytes);
    return this;
  }

  toUint8() {
    return new Uint8Array(this.bytes);
  }
}

function pointBody(type, x, y, z, m) {
  const w = new Writer().i32le(type).f64le(x).f64le(y);
  if (z !== undefined) w.f64le(z);
  if (m !== undefined) w.f64le(m);
  return w;
}

function bboxOf(parts) {
  const flat = parts.flat();
  const xs = flat.map((p) => p[0]);
  const ys = flat.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function partsBody(type, parts, { z = false } = {}) {
  const w = new Writer().i32le(type);
  const [xmin, ymin, xmax, ymax] = bboxOf(parts);
  w.f64le(xmin).f64le(ymin).f64le(xmax).f64le(ymax);
  const flat = parts.flat();
  w.i32le(parts.length).i32le(flat.length);
  let start = 0;
  for (const part of parts) {
    w.i32le(start);
    start += part.length;
  }
  for (const p of flat) w.f64le(p[0]).f64le(p[1]);
  if (z) {
    const zs = flat.map((p) => p[2] ?? 0);
    w.f64le(Math.min(...zs)).f64le(Math.max(...zs));
    for (const value of zs) w.f64le(value);
    for (let i = 0; i < flat.length; i += 1) w.f64le(0);
  }
  return w;
}

function multipointBody(type, points, { z = false } = {}) {
  const w = new Writer().i32le(type);
  const [xmin, ymin, xmax, ymax] = bboxOf([points]);
  w.f64le(xmin).f64le(ymin).f64le(xmax).f64le(ymax);
  w.i32le(points.length);
  for (const p of points) w.f64le(p[0]).f64le(p[1]);
  if (z) {
    const zs = points.map((p) => p[2] ?? 0);
    w.f64le(Math.min(...zs)).f64le(Math.max(...zs));
    for (const value of zs) w.f64le(value);
    for (let i = 0; i < points.length; i += 1) w.f64le(0);
  }
  return w;
}

/**
 * Assemble a whole .shp file. `records` are { type, body } with `body`
 * a Writer. `mutate` can rewrite header/record bytes afterwards.
 */
function buildFile(records, headerType, mutate) {
  const bodies = records.map((record) => record.body.toUint8());
  const totalBytes =
    100 + bodies.reduce((sum, body) => sum + 8 + body.length, 0);
  const w = new Writer();
  w.i32be(9994);
  for (let i = 0; i < 5; i += 1) w.i32be(0);
  w.i32be(totalBytes / 2);
  w.i32le(1000).i32le(headerType);
  const allPoints = records.flatMap((record) => record.points ?? []);
  const [xmin, ymin, xmax, ymax] =
    allPoints.length > 0 ? bboxOf([allPoints]) : [0, 0, 0, 0];
  w.f64le(xmin).f64le(ymin).f64le(xmax).f64le(ymax);
  w.f64le(0).f64le(0).f64le(0).f64le(0);
  records.forEach((record, index) => {
    w.i32be(index + 1).i32be(bodies[index].length / 2);
    w.raw(record.body);
  });
  const bytes = w.toUint8();
  if (mutate) mutate(bytes);
  return bytes;
}

function pointRecord(x, y, type = 1) {
  return { type, points: [[x, y]], body: pointBody(type, x, y) };
}

function assertRefuses(bytes, options, pattern) {
  assert.throws(
    () => parseShapefile(bytes, options),
    (error) =>
      error instanceof ShapefileImportError && pattern.test(error.message),
  );
}

const OUTER_CW = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
  [0, 0],
];
const HOLE_CCW = [
  [2, 2],
  [8, 2],
  [8, 8],
  [2, 8],
  [2, 2],
];
const OUTER2_CW = [
  [20, 20],
  [20, 30],
  [30, 30],
  [30, 20],
  [20, 20],
];

test('Point record becomes a Point feature', () => {
  const bytes = buildFile([pointRecord(12.5, 77.5)], 1);
  const out = parseShapefile(bytes, { prjText: WGS84_PRJ });
  assert.equal(out.type, 'FeatureCollection');
  assert.equal(out.features.length, 1);
  assert.deepEqual(out.features[0], {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [12.5, 77.5] },
  });
});

test('single-part PolyLine becomes a LineString', () => {
  const line = [
    [0, 0],
    [1, 1],
    [2, 0],
  ];
  const bytes = buildFile([{ points: line, body: partsBody(3, [line]) }], 3);
  const out = parseShapefile(bytes, { assumeWgs84: true });
  assert.equal(out.features[0].geometry.type, 'LineString');
  assert.deepEqual(out.features[0].geometry.coordinates, line);
});

test('multi-part PolyLine becomes a MultiLineString', () => {
  const a = [
    [0, 0],
    [1, 1],
  ];
  const b = [
    [2, 2],
    [3, 3],
  ];
  const bytes = buildFile(
    [{ points: [...a, ...b], body: partsBody(3, [a, b]) }],
    3,
  );
  const out = parseShapefile(bytes, { assumeWgs84: true });
  assert.equal(out.features[0].geometry.type, 'MultiLineString');
  assert.deepEqual(out.features[0].geometry.coordinates, [a, b]);
});

test('Polygon exterior is re-oriented to GeoJSON counter-clockwise', () => {
  const bytes = buildFile(
    [{ points: OUTER_CW, body: partsBody(5, [OUTER_CW]) }],
    5,
  );
  const out = parseShapefile(bytes, { assumeWgs84: true });
  assert.equal(out.features[0].geometry.type, 'Polygon');
  assert.deepEqual(out.features[0].geometry.coordinates, [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ]);
});

test('Polygon hole is attached and re-oriented clockwise', () => {
  const bytes = buildFile(
    [
      {
        points: [...OUTER_CW, ...HOLE_CCW],
        body: partsBody(5, [OUTER_CW, HOLE_CCW]),
      },
    ],
    5,
  );
  const out = parseShapefile(bytes, { assumeWgs84: true });
  assert.equal(out.features[0].geometry.type, 'Polygon');
  assert.equal(out.features[0].geometry.coordinates.length, 2);
  assert.deepEqual(out.features[0].geometry.coordinates[1], [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
    [2, 2],
  ]);
});

test('two exteriors become a MultiPolygon', () => {
  const bytes = buildFile(
    [
      {
        points: [...OUTER_CW, ...OUTER2_CW],
        body: partsBody(5, [OUTER_CW, OUTER2_CW]),
      },
    ],
    5,
  );
  const out = parseShapefile(bytes, { assumeWgs84: true });
  assert.equal(out.features[0].geometry.type, 'MultiPolygon');
  assert.equal(out.features[0].geometry.coordinates.length, 2);
});

test('MultiPoint record becomes a MultiPoint', () => {
  const points = [
    [0, 0],
    [1, 1],
  ];
  const bytes = buildFile([{ points, body: multipointBody(8, points) }], 8);
  const out = parseShapefile(bytes, { assumeWgs84: true });
  assert.deepEqual(out.features[0].geometry, {
    type: 'MultiPoint',
    coordinates: points,
  });
});

test('PointZ preserves Z and drops a zero M', () => {
  const bytes = buildFile(
    [{ points: [[1, 2]], body: pointBody(11, 1, 2, 42, 0) }],
    11,
  );
  const out = parseShapefile(bytes, { assumeWgs84: true });
  assert.deepEqual(out.features[0].geometry.coordinates, [1, 2, 42]);
});

test('PointZ drops a NaN M sentinel', () => {
  const bytes = buildFile(
    [{ points: [[1, 2]], body: pointBody(11, 1, 2, 42, Number.NaN) }],
    11,
  );
  const out = parseShapefile(bytes, { assumeWgs84: true });
  assert.deepEqual(out.features[0].geometry.coordinates, [1, 2, 42]);
});

test('PolyLineZ / PolygonZ / MultiPointZ preserve Z', () => {
  const line = [
    [0, 0, 5],
    [1, 1, 6],
  ];
  const polyBytes = buildFile(
    [{ points: line, body: partsBody(13, [line], { z: true }) }],
    13,
  );
  const polyOut = parseShapefile(polyBytes, { assumeWgs84: true });
  assert.deepEqual(polyOut.features[0].geometry.coordinates, line);

  const ring = [
    [0, 0, 1],
    [0, 10, 1],
    [10, 10, 1],
    [10, 0, 1],
    [0, 0, 1],
  ];
  const gonBytes = buildFile(
    [{ points: ring, body: partsBody(15, [ring], { z: true }) }],
    15,
  );
  const gonOut = parseShapefile(gonBytes, { assumeWgs84: true });
  assert.deepEqual(gonOut.features[0].geometry.coordinates[0][1], [10, 0, 1]);

  const pts = [
    [0, 0, 7],
    [1, 1, 8],
  ];
  const mpBytes = buildFile(
    [{ points: pts, body: multipointBody(18, pts, { z: true }) }],
    18,
  );
  const mpOut = parseShapefile(mpBytes, { assumeWgs84: true });
  assert.deepEqual(mpOut.features[0].geometry.coordinates, pts);
});

test('prjText "EPSG:4326" is accepted', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1);
  const out = parseShapefile(bytes, { prjText: 'EPSG:4326' });
  assert.equal(out.features.length, 1);
});

test('missing CRS evidence refuses the whole input', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1);
  assertRefuses(bytes, {}, /CRS is unknown/);
  assertRefuses(bytes, undefined, /CRS is unknown/);
});

test('projected .prj refuses the whole input', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1);
  assertRefuses(bytes, { prjText: PROJCS_PRJ }, /not WGS 84/);
});

test('non-WGS-84 datum .prj refuses the whole input', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1);
  assertRefuses(bytes, { prjText: NAD83_PRJ }, /not WGS 84/);
});

test('bad file code refuses', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1, (b) => {
    new DataView(b.buffer).setInt32(0, 1234, false);
  });
  assertRefuses(bytes, { assumeWgs84: true }, /file code/);
});

test('bad version refuses', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1, (b) => {
    new DataView(b.buffer).setInt32(28, 999, true);
  });
  assertRefuses(bytes, { assumeWgs84: true }, /version/);
});

test('header file-length mismatch refuses', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1, (b) => {
    new DataView(b.buffer).setInt32(24, 9999, false);
  });
  assertRefuses(bytes, { assumeWgs84: true }, /file length/);
});

test('truncated record refuses', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1);
  assertRefuses(
    bytes.slice(0, bytes.length - 4),
    { assumeWgs84: true },
    /truncated|file length/,
  );
});

test('trailing bytes after the last record refuse', () => {
  const base = buildFile([pointRecord(1, 2)], 1);
  const bytes = new Uint8Array(base.length + 4);
  bytes.set(base);
  assertRefuses(bytes, { assumeWgs84: true }, /file length|trailing|truncated/);
});

test('trailing bytes inside a record refuse', () => {
  const body = pointBody(1, 1, 2);
  body.i32le(0); // Padding the parser must not swallow.
  const bytes = buildFile([{ points: [[1, 2]], body }], 1);
  assertRefuses(bytes, { assumeWgs84: true }, /trailing bytes/);
});

test('record type disagreeing with the header refuses', () => {
  const bytes = buildFile([pointRecord(1, 2, 1)], 3);
  assertRefuses(bytes, { assumeWgs84: true }, /disagrees|declares/);
});

test('non-sequential record number refuses', () => {
  const bytes = buildFile([pointRecord(1, 2), pointRecord(3, 4)], 1, (b) => {
    // Second record header starts at 100 + 8 + 20 = 128.
    new DataView(b.buffer).setInt32(128, 7, false);
  });
  assertRefuses(bytes, { assumeWgs84: true }, /record number/);
});

test('out-of-range and NaN coordinates refuse', () => {
  const lon = buildFile([pointRecord(181, 0)], 1);
  assertRefuses(lon, { assumeWgs84: true }, /outside WGS 84/);
  const lat = buildFile([pointRecord(0, -91)], 1);
  assertRefuses(lat, { assumeWgs84: true }, /outside WGS 84/);
  const nan = buildFile([pointRecord(Number.NaN, 0)], 1, (b) => {
    // Zero the header bbox so the NaN coordinate check is what fires.
    for (let off = 36; off <= 60; off += 8) {
      new DataView(b.buffer).setFloat64(off, 0, true);
    }
  });
  assertRefuses(nan, { assumeWgs84: true }, /not a finite number/);
});

test('unclosed, short, and zero-area rings refuse', () => {
  const open = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
  ];
  const openBytes = buildFile(
    [{ points: open, body: partsBody(5, [open]) }],
    5,
  );
  assertRefuses(openBytes, { assumeWgs84: true }, /not closed/);

  const triangle = [
    [0, 0],
    [10, 0],
    [0, 0],
  ];
  const shortBytes = buildFile(
    [{ points: triangle, body: partsBody(5, [triangle]) }],
    5,
  );
  assertRefuses(shortBytes, { assumeWgs84: true }, /at least 4/);

  const flat = [
    [0, 0],
    [5, 0],
    [10, 0],
    [0, 0],
  ];
  const flatBytes = buildFile(
    [{ points: flat, body: partsBody(5, [flat]) }],
    5,
  );
  assertRefuses(flatBytes, { assumeWgs84: true }, /zero area/);
});

test('hole before any exterior refuses', () => {
  const bytes = buildFile(
    [{ points: HOLE_CCW, body: partsBody(5, [HOLE_CCW]) }],
    5,
  );
  assertRefuses(bytes, { assumeWgs84: true }, /before any exterior/);
});

test('hole outside its exterior refuses', () => {
  const outside = [
    [20, 20],
    [30, 20],
    [30, 30],
    [20, 30],
    [20, 20],
  ];
  const bytes = buildFile(
    [
      {
        points: [...OUTER_CW, ...outside],
        body: partsBody(5, [OUTER_CW, outside]),
      },
    ],
    5,
  );
  assertRefuses(bytes, { assumeWgs84: true }, /outside its exterior/);
});

test('one-point polyline part and empty MultiPoint refuse', () => {
  const lineBytes = buildFile(
    [{ points: [[0, 0]], body: partsBody(3, [[[0, 0]]]) }],
    3,
  );
  assertRefuses(lineBytes, { assumeWgs84: true }, /at least 2/);

  const mpBytes = buildFile(
    [{ points: [], body: multipointBody(8, []) }],
    8,
    (b) => {
      // Zero the record bbox (offset 112) so the empty-count check is
      // the refusal that fires, not the Infinity bbox from the builder.
      new DataView(b.buffer).setFloat64(112, 0, true);
      new DataView(b.buffer).setFloat64(120, 0, true);
      new DataView(b.buffer).setFloat64(128, 0, true);
      new DataView(b.buffer).setFloat64(136, 0, true);
    },
  );
  assertRefuses(mpBytes, { assumeWgs84: true }, /empty/);
});

test('Null record and Null header refuse', () => {
  const nullBody = new Writer().i32le(0);
  const bytes = buildFile([{ points: [], body: nullBody }], 1);
  assertRefuses(bytes, { assumeWgs84: true }, /disagrees|Null/);

  const headerNull = buildFile([], 0);
  assertRefuses(headerNull, { assumeWgs84: true }, /not imported|no records/);
});

test('M-only types, MultiPatch, and unknown types refuse', () => {
  for (const type of [21, 31, 99]) {
    const bytes = buildFile([], type);
    assertRefuses(bytes, { assumeWgs84: true }, /not imported|no records/);
  }
});

test('PointZ with a real M value refuses', () => {
  const bytes = buildFile(
    [{ points: [[1, 2]], body: pointBody(11, 1, 2, 42, 5) }],
    11,
  );
  assertRefuses(bytes, { assumeWgs84: true }, /M \(measure\)/);
});

test('empty file with no records refuses', () => {
  const bytes = buildFile([], 1);
  assertRefuses(bytes, { assumeWgs84: true }, /no records/);
});

test('cap breaches refuse', () => {
  const two = buildFile([pointRecord(1, 2), pointRecord(3, 4)], 1);
  assertRefuses(
    two,
    { assumeWgs84: true, maxFeatures: 1 },
    /more than 1 features/,
  );
  assertRefuses(
    two,
    { assumeWgs84: true, maxPositions: 1 },
    /more than 1 points/,
  );
  assert.equal(SHP_MAX_FEATURES, 20_000);
  assert.equal(SHP_MAX_POSITIONS, 250_000);
});

test('isShapefileBytes sniffs the header', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1);
  assert.equal(isShapefileBytes(bytes), true);
  assert.equal(isShapefileBytes(new Uint8Array([0, 0, 0, 1])), false);
  assert.equal(isShapefileBytes(new Uint8Array(50)), false);
  assert.equal(isShapefileBytes('not bytes'), false);
  assert.equal(isShapefileBytes(null), false);
});

test('isWgs84Prj accepts WGS 84 and rejects the rest', () => {
  assert.equal(isWgs84Prj(WGS84_PRJ), true);
  assert.equal(isWgs84Prj('EPSG:4326'), true);
  assert.equal(isWgs84Prj('epsg:4326'), true);
  assert.equal(isWgs84Prj(PROJCS_PRJ), false);
  assert.equal(isWgs84Prj(NAD83_PRJ), false);
  assert.equal(isWgs84Prj('GEOGCS["X",DATUM["D_Y",SPHEROID["Z",1,2]]]'), false);
  assert.equal(isWgs84Prj(''), false);
  assert.equal(isWgs84Prj(null), false);
  assert.equal(isWgs84Prj(4326), false);
});

test('non-bytes input refuses', () => {
  assert.throws(
    () => parseShapefile('not bytes', { assumeWgs84: true }),
    (error) =>
      error instanceof ShapefileImportError && /Uint8Array/.test(error.message),
  );
});

test('ArrayBuffer input parses', () => {
  const bytes = buildFile([pointRecord(1, 2)], 1);
  const out = parseShapefile(bytes.buffer, { assumeWgs84: true });
  assert.equal(out.features.length, 1);
});
