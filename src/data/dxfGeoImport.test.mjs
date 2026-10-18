import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMPORT_ALTITUDE,
  MAX_IMPORT_ENTITIES,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';
import {
  CIRCLE_SEGMENTS,
  DxfGeoImportError,
  MAX_DXF_ALTITUDE,
  MAX_DXF_ENTITIES,
  MAX_DXF_POSITIONS,
  isDxfText,
  parseDxfPairs,
  parseDxfToFeatureCollection,
} from './dxfGeoImport.js';

const pair = (code, value) => [code, String(value)];

function dxfFile(entityPairs, { headerSections = null } = {}) {
  const lines = [];
  if (headerSections) {
    for (const s of headerSections) lines.push(...s);
  }
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  for (const [code, value] of entityPairs)
    lines.push(String(code), String(value));
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n') + '\n';
}

function blocksFile(blockName, blockEntityPairs, insertPairs) {
  const lines = ['0', 'SECTION', '2', 'BLOCKS'];
  lines.push('0', 'BLOCK', '2', blockName, '10', '0', '20', '0');
  for (const [code, value] of blockEntityPairs)
    lines.push(String(code), String(value));
  lines.push('0', 'ENDBLK', '0', 'ENDSEC');
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  for (const [code, value] of insertPairs)
    lines.push(String(code), String(value));
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n') + '\n';
}

const point = (lon, lat, extra = []) => [
  pair(0, 'POINT'),
  pair(8, 'sites'),
  pair(10, lon),
  pair(20, lat),
  ...extra,
];

test('isDxfText classifies ascii, binary and non-DXF text', () => {
  assert.equal(isDxfText(dxfFile([])), 'ascii');
  assert.equal(isDxfText('AutoCAD Binary DXF\r\n\x1a\x00rest'), 'binary');
  assert.equal(isDxfText('just some text'), null);
  assert.equal(isDxfText(null), null);
});

test('parseDxfPairs keeps value lines verbatim and strips a BOM', () => {
  const pairs = parseDxfPairs(
    '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nPOINT\r\n10\r\n 85.1 \r\n',
  );
  assert.deepEqual(pairs, [
    [0, 'SECTION'],
    [2, 'ENTITIES'],
    [0, 'POINT'],
    [10, ' 85.1 '],
  ]);
});

test('parseDxfPairs refuses an odd line count and a bad group code', () => {
  assert.throws(() => parseDxfPairs('0\nSECTION\n2'), DxfGeoImportError);
  assert.throws(() => parseDxfPairs('oops\nx\n'), DxfGeoImportError);
});

test('a POINT becomes a Point with the layer as a property', () => {
  const result = parseDxfToFeatureCollection(dxfFile(point(85.14, 25.62)));
  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0], {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [85.14, 25.62] },
    properties: { layer: 'sites' },
  });
  assert.equal(result.skipped, 0);
});

test('a POINT with elevation keeps a third coordinate', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile(point(85.14, 25.62, [pair(30, 120)])),
  );
  assert.deepEqual(
    result.features[0].geometry.coordinates,
    [85.14, 25.62, 120],
  );
});

test('a LINE becomes a two-vertex LineString', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'LINE'),
      pair(10, 85),
      pair(20, 25),
      pair(11, 86),
      pair(21, 26),
    ]),
  );
  assert.deepEqual(result.features[0].geometry, {
    type: 'LineString',
    coordinates: [
      [85, 25],
      [86, 26],
    ],
  });
});

test('an open LWPOLYLINE becomes a LineString', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'LWPOLYLINE'),
      pair(10, 85),
      pair(20, 25),
      pair(10, 86),
      pair(20, 26),
      pair(10, 87),
      pair(20, 25.5),
    ]),
  );
  assert.equal(result.features[0].geometry.type, 'LineString');
  assert.equal(result.features[0].geometry.coordinates.length, 3);
});

test('a closed LWPOLYLINE (flag 70 bit 0) becomes a Polygon', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'LWPOLYLINE'),
      pair(70, 1),
      pair(10, 85),
      pair(20, 25),
      pair(10, 86),
      pair(20, 26),
      pair(10, 85.5),
      pair(20, 27),
    ]),
  );
  const geometry = result.features[0].geometry;
  assert.equal(geometry.type, 'Polygon');
  const ring = geometry.coordinates[0];
  assert.equal(ring.length, 4);
  assert.deepEqual(ring[0], ring[3]);
});

test('a POLYLINE with VERTEX subentities becomes a LineString', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'POLYLINE'),
      pair(70, 0),
      pair(0, 'VERTEX'),
      pair(10, 85),
      pair(20, 25),
      pair(0, 'VERTEX'),
      pair(10, 86),
      pair(20, 26),
      pair(0, 'SEQEND'),
    ]),
  );
  assert.deepEqual(result.features[0].geometry, {
    type: 'LineString',
    coordinates: [
      [85, 25],
      [86, 26],
    ],
  });
});

test('a closed POLYLINE becomes a Polygon', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'POLYLINE'),
      pair(70, 1),
      pair(0, 'VERTEX'),
      pair(10, 85),
      pair(20, 25),
      pair(0, 'VERTEX'),
      pair(10, 86),
      pair(20, 26),
      pair(0, 'VERTEX'),
      pair(10, 85.5),
      pair(20, 27),
      pair(0, 'SEQEND'),
    ]),
  );
  assert.equal(result.features[0].geometry.type, 'Polygon');
});

test('a CIRCLE becomes a closed polygon ring', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([pair(0, 'CIRCLE'), pair(10, 85), pair(20, 25), pair(40, 1)]),
  );
  const geometry = result.features[0].geometry;
  assert.equal(geometry.type, 'Polygon');
  const ring = geometry.coordinates[0];
  assert.equal(ring.length, CIRCLE_SEGMENTS + 1);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  // First vertex sits due east of the centre, one degree out.
  assert.ok(Math.abs(ring[0][0] - 86) < 1e-9);
  assert.ok(Math.abs(ring[0][1] - 25) < 1e-9);
});

test('an ARC becomes a LineString along the given angles', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'ARC'),
      pair(10, 85),
      pair(20, 25),
      pair(40, 1),
      pair(50, 0),
      pair(51, 90),
    ]),
  );
  const geometry = result.features[0].geometry;
  assert.equal(geometry.type, 'LineString');
  const first = geometry.coordinates[0];
  const last = geometry.coordinates[geometry.coordinates.length - 1];
  assert.ok(Math.abs(first[0] - 86) < 1e-9); // east
  assert.ok(Math.abs(last[1] - 26) < 1e-9); // north
});

test('TEXT becomes a Point carrying its text, truncated', () => {
  const long = 'x'.repeat(200);
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'TEXT'),
      pair(10, 85),
      pair(20, 25),
      pair(1, 'Golghar'),
      pair(0, 'MTEXT'),
      pair(10, 86),
      pair(20, 26),
      pair(1, long),
    ]),
  );
  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].properties.text, 'Golghar');
  assert.equal(result.features[1].properties.text.length, 120);
});

test('a SOLID becomes a Polygon from its corners', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'SOLID'),
      pair(10, 85),
      pair(20, 25),
      pair(11, 86),
      pair(21, 25),
      pair(12, 86),
      pair(22, 26),
      pair(13, 85),
      pair(23, 26),
    ]),
  );
  const ring = result.features[0].geometry.coordinates[0];
  assert.equal(result.features[0].geometry.type, 'Polygon');
  assert.equal(ring.length, 5);
});

test('INSERT instantiates a block with translation', () => {
  const result = parseDxfToFeatureCollection(
    blocksFile(
      'MARKER',
      [pair(0, 'POINT'), pair(10, 1), pair(20, 2)],
      [pair(0, 'INSERT'), pair(2, 'MARKER'), pair(10, 85), pair(20, 25)],
    ),
  );
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry.coordinates, [86, 27]);
  assert.equal(result.features[0].properties.block, 'MARKER');
});

test('INSERT of an unknown block is skipped', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([pair(0, 'INSERT'), pair(2, 'NOPE'), pair(10, 85), pair(20, 25)]),
  );
  assert.equal(result.features.length, 0);
  assert.equal(result.skipped, 1);
});

test('a rotated or scaled INSERT is skipped, not misplaced', () => {
  const rotated = blocksFile(
    'MARKER',
    [pair(0, 'POINT'), pair(10, 1), pair(20, 2)],
    [
      pair(0, 'INSERT'),
      pair(2, 'MARKER'),
      pair(10, 85),
      pair(20, 25),
      pair(50, 45),
    ],
  );
  assert.equal(parseDxfToFeatureCollection(rotated).skipped, 1);
  const scaled = blocksFile(
    'MARKER',
    [pair(0, 'POINT'), pair(10, 1), pair(20, 2)],
    [
      pair(0, 'INSERT'),
      pair(2, 'MARKER'),
      pair(10, 85),
      pair(20, 25),
      pair(41, 2),
    ],
  );
  assert.equal(parseDxfToFeatureCollection(scaled).skipped, 1);
});

test('out-of-range coordinates skip the entity but keep the file', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      ...point(500, 25.62), // projected metres, not degrees
      ...point(85.14, 25.62),
    ]),
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.skipped, 1);
});

test('non-numeric coordinates skip the entity', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([pair(0, 'POINT'), pair(10, 'abc'), pair(20, 25)]),
  );
  assert.equal(result.features.length, 0);
  assert.equal(result.skipped, 1);
});

test('a bad altitude skips the entity', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile(point(85.14, 25.62, [pair(30, MAX_IMPORT_ALTITUDE + 1)])),
  );
  assert.equal(result.features.length, 0);
  assert.equal(result.skipped, 1);
});

test('unsupported entities (SPLINE, HATCH) are skipped and counted', () => {
  const result = parseDxfToFeatureCollection(
    dxfFile([
      pair(0, 'SPLINE'),
      pair(10, 85),
      pair(0, 'HATCH'),
      pair(10, 85),
      ...point(85.14, 25.62),
    ]),
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.skipped, 2);
});

test('binary DXF is refused', () => {
  assert.throws(
    () => parseDxfToFeatureCollection('AutoCAD Binary DXF\r\n\x1a\x00...'),
    DxfGeoImportError,
  );
});

test('non-DXF text is refused', () => {
  assert.throws(
    () => parseDxfToFeatureCollection('hello world'),
    DxfGeoImportError,
  );
  assert.throws(() => parseDxfToFeatureCollection(42), DxfGeoImportError);
});

test('a DXF without an ENTITIES section is refused', () => {
  const lines = ['0', 'SECTION', '2', 'HEADER', '0', 'ENDSEC', '0', 'EOF'];
  assert.throws(
    () => parseDxfToFeatureCollection(lines.join('\n')),
    /ENTITIES/,
  );
});

test('an all-projected file is refused with a CRS-honest message', () => {
  assert.throws(
    () =>
      parseDxfToFeatureCollection(
        dxfFile([...point(500000, 2800000), ...point(500001, 2800001)]),
      ),
    /projected units/,
  );
});

test('an empty ENTITIES section returns an empty collection', () => {
  const result = parseDxfToFeatureCollection(dxfFile([]));
  assert.deepEqual(result.features, []);
  assert.equal(result.skipped, 0);
});

test('the entity cap refuses the whole file', () => {
  const many = [];
  for (let i = 0; i < 6; i++) many.push(...point(85 + i * 0.001, 25));
  assert.throws(
    () => parseDxfToFeatureCollection(dxfFile(many), { maxEntities: 5 }),
    /max 5/,
  );
});

test('the position cap refuses the whole file', () => {
  const verts = [pair(0, 'LWPOLYLINE')];
  for (let i = 0; i < 10; i++)
    verts.push(pair(10, 85 + i * 0.01), pair(20, 25));
  assert.throws(
    () => parseDxfToFeatureCollection(dxfFile(verts), { maxPositions: 9 }),
    /positions/,
  );
});

test('caps are aliases of the importer caps', () => {
  assert.equal(MAX_DXF_ENTITIES, MAX_IMPORT_ENTITIES);
  assert.equal(MAX_DXF_POSITIONS, MAX_IMPORT_POSITIONS);
  assert.equal(MAX_DXF_ALTITUDE, MAX_IMPORT_ALTITUDE);
});

test('a (0, 0) point is kept — it is a real place', () => {
  const result = parseDxfToFeatureCollection(dxfFile(point(0, 0)));
  assert.equal(result.features.length, 1);
});

test('CRLF line endings parse', () => {
  const text = dxfFile(point(85.14, 25.62)).replace(/\n/g, '\r\n');
  assert.equal(parseDxfToFeatureCollection(text).features.length, 1);
});

test('a degenerate circle (zero or giant radius) is skipped', () => {
  const zero = dxfFile([
    pair(0, 'CIRCLE'),
    pair(10, 85),
    pair(20, 25),
    pair(40, 0),
  ]);
  assert.equal(parseDxfToFeatureCollection(zero).skipped, 1);
  const giant = dxfFile([
    pair(0, 'CIRCLE'),
    pair(10, 85),
    pair(20, 25),
    pair(40, 200),
  ]);
  assert.equal(parseDxfToFeatureCollection(giant).skipped, 1);
});
