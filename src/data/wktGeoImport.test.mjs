import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMPORT_ENTITIES, MAX_IMPORT_POSITIONS } from './geoFileImport.js';
import {
  MAX_WKT_FEATURES,
  MAX_WKT_POSITIONS,
  WktGeoImportError,
  isWktText,
  parseWkt,
  parseWktToFeatureCollection,
} from './wktGeoImport.js';

test('all seven geometry types parse, case-insensitively', () => {
  assert.deepEqual(parseWkt('point(85.1 25.6)'), {
    type: 'Point',
    coordinates: [85.1, 25.6],
  });
  assert.deepEqual(parseWkt('LINESTRING(0 0,1 1,1 2)'), {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1],
      [1, 2],
    ],
  });
  assert.deepEqual(
    parseWkt('POLYGON((0 0,4 0,4 4,0 4,0 0),(1 1,2 1,2 2,1 2,1 1))'),
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
          [1, 1],
        ],
      ],
    },
  );
  assert.deepEqual(parseWkt('MULTIPOINT((0 0),(1 2))'), {
    type: 'MultiPoint',
    coordinates: [
      [0, 0],
      [1, 2],
    ],
  });
  assert.deepEqual(parseWkt('MULTILINESTRING((0 0,1 1),(2 3,3 2))'), {
    type: 'MultiLineString',
    coordinates: [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [2, 3],
        [3, 2],
      ],
    ],
  });
  assert.deepEqual(parseWkt('MULTIPOLYGON(((0 0,4 0,4 4,0 4,0 0)))'), {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    ],
  });
  assert.deepEqual(
    parseWkt('GEOMETRYCOLLECTION(POINT(2 3),LINESTRING(2 3,3 4))'),
    {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [2, 3] },
        {
          type: 'LineString',
          coordinates: [
            [2, 3],
            [3, 4],
          ],
        },
      ],
    },
  );
});

test('MULTIPOINT accepts the bare-tuple form too', () => {
  assert.deepEqual(parseWkt('MULTIPOINT(0 0,1 2)'), {
    type: 'MultiPoint',
    coordinates: [
      [0, 0],
      [1, 2],
    ],
  });
});

test('Z qualifier and bare 3-tuples keep altitude; scientific notation works', () => {
  assert.deepEqual(parseWkt('POINT Z (85.1 25.6 120)'), {
    type: 'Point',
    coordinates: [85.1, 25.6, 120],
  });
  // PostGIS EWKT canonical form drops the Z qualifier on 3D output.
  assert.deepEqual(parseWkt('POINT(85.1 25.6 120)'), {
    type: 'Point',
    coordinates: [85.1, 25.6, 120],
  });
  assert.deepEqual(parseWkt('POINT(-1.5e2 4.5)'), {
    type: 'Point',
    coordinates: [-150, 4.5],
  });
});

test('EMPTY becomes null; EMPTY members are skipped inside collections', () => {
  assert.equal(parseWkt('POINT EMPTY'), null);
  assert.equal(parseWkt('  point   empty  '), null);
  assert.deepEqual(parseWkt('GEOMETRYCOLLECTION(POINT EMPTY,POINT(1 2))'), {
    type: 'GeometryCollection',
    geometries: [{ type: 'Point', coordinates: [1, 2] }],
  });
});

test('SRID=4326 is accepted; any other SRID is refused, not re-labelled', () => {
  assert.deepEqual(parseWkt('SRID=4326;POINT(85.1 25.6)'), {
    type: 'Point',
    coordinates: [85.1, 25.6],
  });
  assert.throws(
    () => parseWkt('SRID=3857;POINT(85.1 25.6)'),
    (error) =>
      error instanceof WktGeoImportError && /SRID=3857/.test(error.message),
  );
});

test('a lowercase srid prefix parses; a lowercase bad SRID still refuses', () => {
  assert.deepEqual(parseWkt('srid=4326;point(85.1 25.6)'), {
    type: 'Point',
    coordinates: [85.1, 25.6],
  });
  assert.throws(
    () => parseWkt('srid=3857;point(85.1 25.6)'),
    (error) =>
      error instanceof WktGeoImportError && /SRID=3857/.test(error.message),
  );
  assert.equal(isWktText('  srid=4326;linestring(0 0,1 1)'), true);
});

test('a lowercase dimension qualifier parses; lowercase measured still refuses', () => {
  assert.deepEqual(parseWkt('point z (85.1 25.6 120)'), {
    type: 'Point',
    coordinates: [85.1, 25.6, 120],
  });
  assert.throws(() => parseWkt('point m (1 2 3)'), WktGeoImportError);
  assert.throws(() => parseWkt('point zm (1 2 3 4)'), WktGeoImportError);
});

test('WKT caps are the importer caps, not a second copy of the numbers', () => {
  assert.equal(MAX_WKT_FEATURES, MAX_IMPORT_ENTITIES);
  assert.equal(MAX_WKT_POSITIONS, MAX_IMPORT_POSITIONS);
});

test('measured (M / ZM) coordinates are refused, never silently stripped', () => {
  assert.throws(() => parseWkt('POINT M (1 2 3)'), WktGeoImportError);
  assert.throws(() => parseWkt('POINT ZM (1 2 3 4)'), WktGeoImportError);
  assert.throws(() => parseWkt('POINT(1 2 3 4)'), WktGeoImportError);
  assert.throws(() => parseWkt('POINTM(1 2 3)'), WktGeoImportError);
});

test('out-of-range coordinates are refused, not re-labelled as degrees', () => {
  assert.throws(() => parseWkt('POINT(181 0)'), WktGeoImportError);
  assert.throws(() => parseWkt('POINT(0 91)'), WktGeoImportError);
  // Projected metres (e.g. Web Mercator) land far outside degree bounds.
  assert.throws(() => parseWkt('POINT(9462000 2900000)'), WktGeoImportError);
});

test('unclosed polygon rings are refused, not silently auto-closed', () => {
  assert.throws(
    () => parseWkt('POLYGON((0 0,4 0,4 4,0 4))'),
    WktGeoImportError,
  );
});

test('malformed input throws the import error, not a bare SyntaxError', () => {
  for (const bad of [
    '',
    '   ',
    'POINT',
    'POINT()',
    'POINT(1)',
    'POINT(1 2',
    'POINT(1 2) trailing',
    'CIRCLE(1 2, 3)',
    'LINESTRING(0 0)',
    'POLYGON((0 0,1 0,1 1))',
    'POINT(1 2))',
    42,
    null,
  ]) {
    assert.throws(() => parseWkt(bad), WktGeoImportError, String(bad));
  }
});

test('a multi-geometry dump becomes one Feature per geometry', () => {
  const result = parseWktToFeatureCollection(
    'POINT(85.1 25.6)\nLINESTRING(0 0,1 1)\nPOINT EMPTY\n',
  );
  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 3);
  assert.deepEqual(result.features[0], {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [85.1, 25.6] },
    properties: {},
  });
  assert.equal(result.features[2].geometry, null);
});

test('a pretty-printed geometry spanning lines still parses as one Feature', () => {
  const result = parseWktToFeatureCollection(
    'POLYGON((\n  0 0,\n  4 0,\n  4 4,\n  0 4,\n  0 0\n))\n',
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry.type, 'Polygon');
});

test('an empty collection input is refused, not returned as an empty map', () => {
  assert.throws(() => parseWktToFeatureCollection('  \n '), WktGeoImportError);
  assert.throws(() => parseWktToFeatureCollection(''), WktGeoImportError);
});

test('isWktText detects WKT without parsing it', () => {
  assert.equal(isWktText('POINT(1 2)'), true);
  assert.equal(isWktText('  SRID=4326;LINESTRING(0 0,1 1)'), true);
  assert.equal(isWktText('\uFEFFPOLYGON((0 0,1 0,1 1,0 0))'), true);
  assert.equal(isWktText('{"type":"Point"}'), false);
  assert.equal(isWktText('<kml></kml>'), false);
  assert.equal(isWktText(''), false);
  assert.equal(isWktText(null), false);
});

test('deeply nested GEOMETRYCOLLECTIONs are refused', () => {
  const open = 'GEOMETRYCOLLECTION('.repeat(40);
  const close = ')'.repeat(40);
  assert.throws(() => parseWkt(`${open}POINT(1 2)${close}`), WktGeoImportError);
});
