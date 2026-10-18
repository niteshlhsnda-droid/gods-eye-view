// src/data/mifImport.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MifImportError,
  isMifText,
  parseMifToFeatureCollection,
} from './mifImport.js';

const HEADER = `Version 300
Charset "Neutral"
CoordSys Earth Projection 1, 104
Columns 0
Data
`;

const mif = (body, header = HEADER) => `${header}${body}`;

test('isMifText accepts MIF and rejects other text', () => {
  assert.equal(isMifText(mif('Point 10 20\n')), true);
  assert.equal(isMifText(''), false);
  assert.equal(isMifText('{"type":"FeatureCollection"}'), false);
  assert.equal(isMifText('<gml:FeatureCollection/>'), false);
  assert.equal(isMifText(null), false);
  assert.equal(isMifText(42), false);
});

test('Point parses with MIF x=lon, y=lat order', () => {
  const fc = parseMifToFeatureCollection(mif('Point 10.5 -20.25\n'));
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Point',
    coordinates: [10.5, -20.25],
  });
  assert.deepEqual(fc.features[0].properties, {});
});

test('Line parses to a two-point LineString', () => {
  const fc = parseMifToFeatureCollection(mif('Line 0 0 10 10\n'));
  assert.deepEqual(fc.features[0].geometry, {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [10, 10],
    ],
  });
});

test('Pline single section is a LineString; sections concatenate', () => {
  const fc = parseMifToFeatureCollection(
    mif('Pline 2\n2\n0 0\n5 5\n2\n5 5\n10 10\n'),
  );
  assert.deepEqual(fc.features[0].geometry, {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [5, 5],
      [5, 5],
      [10, 10],
    ],
  });
});

test('Pline Multiple is a MultiLineString', () => {
  const fc = parseMifToFeatureCollection(
    mif('Pline Multiple 2\n2\n0 0\n1 1\n2\n5 5\n6 6\n'),
  );
  assert.deepEqual(fc.features[0].geometry, {
    type: 'MultiLineString',
    coordinates: [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [5, 5],
        [6, 6],
      ],
    ],
  });
});

test('Region closes an unclosed ring and stays a Polygon', () => {
  const fc = parseMifToFeatureCollection(mif('Region 1\n3\n0 0\n10 0\n0 10\n'));
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [0, 10],
        [0, 0],
      ],
    ],
  });
});

test('Region with two polygons is a MultiPolygon', () => {
  const fc = parseMifToFeatureCollection(
    mif('Region 2\n4\n0 0\n1 0\n1 1\n0 0\n4\n5 5\n6 5\n6 6\n5 5\n'),
  );
  assert.equal(fc.features[0].geometry.type, 'MultiPolygon');
  assert.equal(fc.features[0].geometry.coordinates.length, 2);
});

test('Rect normalizes reversed corners into a closed ring', () => {
  const fc = parseMifToFeatureCollection(mif('Rect 10 10 0 0\n'));
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  });
});

test('RoundRect imports as its bounding-rect Polygon', () => {
  const fc = parseMifToFeatureCollection(mif('RoundRect 0 0 10 10 2\n'));
  assert.deepEqual(fc.features[0].geometry.coordinates[0][2], [10, 10]);
  assert.equal(fc.features[0].geometry.coordinates[0].length, 5);
});

test('Ellipse approximates with 65 positions, first equals last', () => {
  const fc = parseMifToFeatureCollection(mif('Ellipse -10 -5 10 5\n'));
  const ring = fc.features[0].geometry.coordinates[0];
  assert.equal(fc.features[0].geometry.type, 'Polygon');
  assert.equal(ring.length, 65);
  assert.deepEqual(ring[0], [10, 0]);
  assert.deepEqual(ring[ring.length - 1], ring[0]);
});

test('Arc runs from the start angle to the end angle', () => {
  const fc = parseMifToFeatureCollection(mif('Arc -10 -10 10 10 0 90\n'));
  const points = fc.features[0].geometry.coordinates;
  assert.equal(fc.features[0].geometry.type, 'LineString');
  assert.equal(points.length, 33);
  assert.deepEqual(points[0], [10, 0]);
  assert.ok(Math.abs(points[32][0]) < 1e-9);
  assert.ok(Math.abs(points[32][1] - 10) < 1e-9);
});

test('Text becomes a Point at (x1, y1) with the label property', () => {
  const fc = parseMifToFeatureCollection(
    mif('Text "City ""Center""" 10 20 30 25\n'),
  );
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Point',
    coordinates: [10, 20],
  });
  assert.equal(fc.features[0].properties.label, 'City "Center"');
});

test('Multipoint parses to MultiPoint', () => {
  const fc = parseMifToFeatureCollection(mif('Multipoint 2\n0 0\n1 1\n'));
  assert.deepEqual(fc.features[0].geometry, {
    type: 'MultiPoint',
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  });
});

test('style lines after objects are skipped', () => {
  const fc = parseMifToFeatureCollection(
    mif(
      'Point 1 2\n  Symbol (35,0,12)\nPline 1\n2\n0 0\n1 1\n  Pen (1,2,0)\nRegion 1\n4\n0 0\n1 0\n1 1\n0 0\n  Pen (1,2,0)\n  Brush (2,1,0)\n',
    ),
  );
  assert.equal(fc.features.length, 3);
});

test('CRLF input parses', () => {
  const crlf =
    HEADER.replaceAll('\n', '\r\n') + 'Point 1 2\r\nLine 0 0 3 3\r\n';
  const fc = parseMifToFeatureCollection(crlf);
  assert.equal(fc.features.length, 2);
});

test('keywords are case-insensitive', () => {
  const header = `version 300
charset "Neutral"
coordsys earth projection 1, 104
columns 0
data
`;
  const fc = parseMifToFeatureCollection(`${header}point 1 2\n`);
  assert.deepEqual(fc.features[0].geometry.coordinates, [1, 2]);
});

test('CoordSys units "degree" accepted', () => {
  const header = `Version 300
CoordSys Earth Projection 1, 104, "degree"
Columns 0
Data
`;
  const fc = parseMifToFeatureCollection(`${header}Point 1 2\n`);
  assert.equal(fc.features.length, 1);
});

test('empty Data section yields an empty FeatureCollection', () => {
  const fc = parseMifToFeatureCollection(mif(''));
  assert.deepEqual(fc, { type: 'FeatureCollection', features: [] });
});

test('MID rows attach coerced properties in object order', () => {
  const header = `Version 300
Delimiter ","
CoordSys Earth Projection 1, 104
Columns 4
  Name Char(20)
  Pop Integer
  Area Decimal(10, 2)
  Active Logical
Data
`;
  const fc = parseMifToFeatureCollection(
    `${header}Point 10 20\nPoint 30 40\n`,
    'Springfield,1234,56.78,T\nShelbyville,0,,F\n',
  );
  assert.deepEqual(fc.features[0].properties, {
    Name: 'Springfield',
    Pop: 1234,
    Area: 56.78,
    Active: true,
  });
  assert.deepEqual(fc.features[1].properties, {
    Name: 'Shelbyville',
    Pop: 0,
    Area: null,
    Active: false,
  });
});

test('MID honors the Delimiter clause and quoted fields', () => {
  const header = `Version 300
Delimiter ","
CoordSys Earth Projection 1, 104
Columns 2
  Name Char(20)
  Pop Integer
Data
`;
  const fc = parseMifToFeatureCollection(
    `${header}Point 10 20\n`,
    '"Spring,field",1234\n',
  );
  assert.deepEqual(fc.features[0].properties, {
    Name: 'Spring,field',
    Pop: 1234,
  });
});

test('MID default delimiter is tab; short rows pad with null', () => {
  const header = `Version 300
CoordSys Earth Projection 1, 104
Columns 2
  Name Char(20)
  Pop Integer
Data
`;
  const fc = parseMifToFeatureCollection(`${header}Point 10 20\n`, 'Only\n');
  assert.deepEqual(fc.features[0].properties, { Name: 'Only', Pop: null });
});

test('MID row-count mismatch refuses the whole input', () => {
  assert.throws(
    () => parseMifToFeatureCollection(mif('Point 1 2\nPoint 3 4\n'), 'One\n'),
    (error) =>
      error instanceof MifImportError && /row count/.test(error.message),
  );
});

test('MID non-numeric value in a numeric column refuses the whole input', () => {
  const header = `Version 300
Delimiter ","
CoordSys Earth Projection 1, 104
Columns 1
  Pop Integer
Data
`;
  assert.throws(
    () => parseMifToFeatureCollection(`${header}Point 1 2\n`, 'abc\n'),
    (error) => error instanceof MifImportError && /integer/.test(error.message),
  );
});

test('MID unterminated quote refuses the whole input', () => {
  const header = `Version 300
Delimiter ","
CoordSys Earth Projection 1, 104
Columns 1
  Name Char(20)
Data
`;
  assert.throws(
    () => parseMifToFeatureCollection(`${header}Point 1 2\n`, '"oops\n'),
    (error) =>
      error instanceof MifImportError && /Unterminated/.test(error.message),
  );
});

test('non-WGS-84 CoordSys forms are refused whole', () => {
  const cases = [
    'CoordSys NonEarth Units "m"',
    'CoordSys Layout Units "mm"',
    'CoordSys Earth Projection 8, 104, "m", 0, 0, 0, 0, 0, 0, 0',
    'CoordSys Earth Projection 1, 0',
    'CoordSys Earth Projection 1, 104, "m"',
  ];
  for (const coordsys of cases) {
    const header = `Version 300\n${coordsys}\nColumns 0\nData\n`;
    assert.throws(
      () => parseMifToFeatureCollection(`${header}Point 1 2\n`),
      (error) =>
        error instanceof MifImportError && /WGS-84/.test(error.message),
      coordsys,
    );
  }
});

test('missing CoordSys / Data / Version are refused', () => {
  assert.throws(
    () =>
      parseMifToFeatureCollection('Version 300\nColumns 0\nData\nPoint 1 2\n'),
    /CoordSys/,
  );
  assert.throws(
    () =>
      parseMifToFeatureCollection(
        'Version 300\nCoordSys Earth Projection 1, 104\nColumns 0\n',
      ),
    /Data section/,
  );
  assert.throws(
    () =>
      parseMifToFeatureCollection(
        'CoordSys Earth Projection 1, 104\nColumns 0\nData\nPoint 1 2\n',
      ),
    /Version/,
  );
});

test('unknown header clause is refused', () => {
  const header = `Version 300
CoordSys Earth Projection 1, 104
BogusClause 1
Columns 0
Data
`;
  assert.throws(
    () => parseMifToFeatureCollection(`${header}Point 1 2\n`),
    /Unsupported MIF header clause/,
  );
});

test('Spline, Collection, and unknown objects are refused', () => {
  assert.throws(
    () => parseMifToFeatureCollection(mif('Spline 2\n2\n0 0\n1 1\n')),
    /Spline/,
  );
  assert.throws(
    () => parseMifToFeatureCollection(mif('Collection 1\nPoint 1 2\n')),
    /Collection/,
  );
  assert.throws(
    () => parseMifToFeatureCollection(mif('Wobble 1 2\n')),
    /Unknown MIF object/,
  );
});

test('bad coordinates refuse the whole input', () => {
  assert.throws(
    () => parseMifToFeatureCollection(mif('Point 200 0\n')),
    /Longitude/,
  );
  assert.throws(
    () => parseMifToFeatureCollection(mif('Point 0 91\n')),
    /Latitude/,
  );
  assert.throws(
    () => parseMifToFeatureCollection(mif('Point NaN 0\n')),
    /Invalid number/,
  );
  assert.throws(
    () => parseMifToFeatureCollection(mif('Point 1e999 0\n')),
    /Non-finite/,
  );
});

test('degenerate geometries are refused', () => {
  assert.throws(
    () => parseMifToFeatureCollection(mif('Rect 5 5 5 10\n')),
    /degenerate/,
  );
  assert.throws(
    () => parseMifToFeatureCollection(mif('Ellipse 5 5 5 10\n')),
    /degenerate/,
  );
  assert.throws(
    () => parseMifToFeatureCollection(mif('Arc -10 -10 10 10 45 45\n')),
    /ambiguous/,
  );
  assert.throws(
    () => parseMifToFeatureCollection(mif('Region 1\n3\n0 0\n1 1\n0 0\n')),
    /degenerate/,
  );
});

test('duplicate column names are refused', () => {
  const header = `Version 300
CoordSys Earth Projection 1, 104
Columns 2
  Name Char(20)
  Name Integer
Data
`;
  assert.throws(
    () => parseMifToFeatureCollection(`${header}Point 1 2\n`),
    /Duplicate column name/,
  );
});

test('feature cap refuses a 20001-point file', () => {
  const body = 'Point 0 0\n'.repeat(20_001);
  assert.throws(
    () => parseMifToFeatureCollection(mif(body)),
    /20,000.*features/,
  );
});

test('position cap refuses a Pline with 250001 points', () => {
  const body = `Pline 1\n250001\n${'0 0\n'.repeat(250_001)}`;
  assert.throws(
    () => parseMifToFeatureCollection(mif(body)),
    /250,000.*positions/,
  );
});

test('non-string MIF input is refused', () => {
  assert.throws(
    () => parseMifToFeatureCollection(null),
    (error) => error instanceof MifImportError,
  );
});
