import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CsvGeoImportError,
  detectCsvGeoColumns,
  parseCsv,
  parseCsvGeo,
} from './csvGeoImport.js';

test('quoted fields survive commas, quotes and newlines', () => {
  const rows = parseCsv(
    'name,lat,lon\n"Patna, Bihar",25.6,85.1\n"Say ""hi""",25,85\n"two\nlines",26,86\n',
  );
  assert.deepEqual(rows, [
    ['name', 'lat', 'lon'],
    ['Patna, Bihar', '25.6', '85.1'],
    ['Say "hi"', '25', '85'],
    ['two\nlines', '26', '86'],
  ]);
});

test('CRLF, BOM and blank lines are tolerated', () => {
  const rows = parseCsv('\uFEFFa,lat,lon\r\n\r\nx,25,85\r\n');
  assert.deepEqual(rows, [
    ['a', 'lat', 'lon'],
    ['x', '25', '85'],
  ]);
});

test('an unterminated quoted field throws', () => {
  assert.throws(() => parseCsv('a,lat,lon\n"oops,25,85\n'), CsvGeoImportError);
});

test('column detection accepts aliases, case-insensitively', () => {
  assert.deepEqual(detectCsvGeoColumns(['Name', 'LATITUDE', 'Lng']), {
    latIndex: 1,
    lonIndex: 2,
  });
  assert.deepEqual(detectCsvGeoColumns(['lat', 'long', 'x']), {
    latIndex: 0,
    lonIndex: 1,
  });
  assert.equal(detectCsvGeoColumns(['name', 'value']), null);
});

test('bare x/y are NOT accepted as longitude/latitude', () => {
  // x/y may be projected metres; this importer assumes WGS 84 degrees,
  // so it must not silently re-label a projected grid.
  assert.equal(detectCsvGeoColumns(['name', 'x', 'y']), null);
});

test('points keep extra columns as properties with numeric coercion', () => {
  const result = parseCsvGeo(
    'name,latitude,longitude,visitors\nGolghar,25.62,85.14,1200\nMuseum,25.59,85.07,free\n',
  );
  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 2);
  assert.deepEqual(result.features[0], {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [85.14, 25.62] },
    properties: { name: 'Golghar', visitors: 1200 },
  });
  assert.equal(result.features[1].properties.visitors, 'free');
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.columns, [
    'name',
    'latitude',
    'longitude',
    'visitors',
  ]);
});

test('bad rows are skipped and counted, never placed at Null Island', () => {
  const result = parseCsvGeo(
    'name,lat,lon\nmissing,,85\nbad,abc,85\nrange,91,85\nshort,25\nlong,25,85,extra\nok,25,85\n',
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.name, 'ok');
  assert.equal(result.skipped, 5);
});

test('(0, 0) is kept: it is a real place, not a missing fix', () => {
  const result = parseCsvGeo('name,lat,lon\nNull Island,0,0\n');
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry.coordinates, [0, 0]);
});

test('no lat/lon columns throws with the found columns named', () => {
  assert.throws(
    () => parseCsvGeo('name,value\nx,1\n'),
    (error) =>
      error instanceof CsvGeoImportError &&
      /no latitude\/longitude/.test(error.message) &&
      /name, value/.test(error.message),
  );
});

test('an empty file throws, and the row cap refuses rather than truncates', () => {
  assert.throws(() => parseCsvGeo(''), CsvGeoImportError);
  assert.throws(
    () => parseCsvGeo('lat,lon\n25,85\n26,86\n', { maxRows: 1 }),
    (error) =>
      error instanceof CsvGeoImportError && /max 1/.test(error.message),
  );
});
