import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GeoJsonLinesError,
  MAX_GEOJSONL_FEATURES,
  MAX_GEOJSONL_POSITIONS,
  isGeoJsonLinesText,
  parseGeoJsonLines,
} from './geoJsonLinesImport.js';

const point = (lon, lat, name) =>
  JSON.stringify({
    type: 'Feature',
    properties: name ? { name } : {},
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });

test('two Feature lines become one FeatureCollection', () => {
  const result = parseGeoJsonLines(`${point(0, 0, 'a')}\n${point(1, 1, 'b')}`);
  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].properties.name, 'a');
  assert.equal(result.features[1].properties.name, 'b');
});

test('a bare geometry line is wrapped in a Feature', () => {
  const result = parseGeoJsonLines('{"type":"Point","coordinates":[10,20]}');
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].type, 'Feature');
  assert.deepEqual(result.features[0].properties, {});
  assert.deepEqual(result.features[0].geometry, {
    type: 'Point',
    coordinates: [10, 20],
  });
});

test('a FeatureCollection line is flattened', () => {
  const result = parseGeoJsonLines(
    `${JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
      ],
    })}\n${point(1, 1)}`,
  );
  assert.equal(result.features.length, 2);
});

test('a GeometryCollection line is wrapped, not flattened', () => {
  const result = parseGeoJsonLines(
    '{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[0,0]}]}',
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry.type, 'GeometryCollection');
});

test('a Feature with null geometry is kept', () => {
  const result = parseGeoJsonLines(
    '{"type":"Feature","properties":{"name":"nowhere"},"geometry":null}',
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry, null);
  assert.equal(result.features[0].properties.name, 'nowhere');
});

test('blank lines, trailing newline and CRLF are tolerated', () => {
  const result = parseGeoJsonLines(
    `\r\n${point(0, 0)}\r\n\r\n${point(1, 1)}\r\n`,
  );
  assert.equal(result.features.length, 2);
});

test('a leading BOM is stripped', () => {
  const result = parseGeoJsonLines(`﻿${point(0, 0)}`);
  assert.equal(result.features.length, 1);
});

test('properties pass through untouched, even number-led arrays', () => {
  const result = parseGeoJsonLines(
    '{"type":"Feature","properties":{"scores":[1,2,300],"nested":{"x":[999,999]}},"geometry":{"type":"Point","coordinates":[0,0]}}',
  );
  assert.deepEqual(result.features[0].properties.scores, [1, 2, 300]);
  assert.deepEqual(result.features[0].properties.nested, { x: [999, 999] });
});

test('ids and foreign members pass through untouched', () => {
  const result = parseGeoJsonLines(
    '{"type":"Feature","id":"abc","custom":true,"properties":{},"geometry":{"type":"Point","coordinates":[0,0]}}',
  );
  assert.equal(result.features[0].id, 'abc');
  assert.equal(result.features[0].custom, true);
});

test('invalid JSON reports the 1-based line number', () => {
  assert.throws(
    () => parseGeoJsonLines(`${point(0, 0)}\n{nope}\n${point(1, 1)}`),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 2: not valid JSON.',
  );
});

test('line numbers count blank lines', () => {
  assert.throws(
    () => parseGeoJsonLines(`\n\n{nope}`),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 3: not valid JSON.',
  );
});

test('an unknown type reports the line', () => {
  assert.throws(
    () => parseGeoJsonLines('{"type":"Circle","coordinates":[0,0]}'),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 1: type "Circle" is not GeoJSON.',
  );
});

test('a JSON scalar or array line is rejected', () => {
  for (const line of ['42', '"hello"', '[1,2]', 'null']) {
    assert.throws(
      () => parseGeoJsonLines(line),
      (error) =>
        error instanceof GeoJsonLinesError &&
        error.message === 'line 1: not a GeoJSON object.',
    );
  }
});

test('out-of-range coordinates report the line', () => {
  assert.throws(
    () =>
      parseGeoJsonLines(
        `${point(0, 0)}\n{"type":"Point","coordinates":[181,0]}`,
      ),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 2: invalid coordinates.',
  );
  assert.throws(
    () => parseGeoJsonLines('{"type":"Point","coordinates":[0,-91]}'),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 1: invalid coordinates.',
  );
});

test('a four-number position and an overflowing altitude are rejected', () => {
  assert.throws(
    () => parseGeoJsonLines('{"type":"Point","coordinates":[0,0,0,0]}'),
    /invalid coordinates/,
  );
  assert.throws(
    () => parseGeoJsonLines('{"type":"Point","coordinates":[0,0,1000001]}'),
    /invalid coordinates/,
  );
  assert.throws(
    () => parseGeoJsonLines('{"type":"Point","coordinates":[1e999,0]}'),
    /invalid coordinates/,
  );
});

test('nested geometry coordinates are validated', () => {
  assert.throws(
    () =>
      parseGeoJsonLines(
        '{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,200],[0,0]]]}',
      ),
    /invalid coordinates/,
  );
  const ok = parseGeoJsonLines(
    '{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}',
  );
  assert.equal(ok.features.length, 1);
});

test('a FeatureCollection without a features list is rejected', () => {
  assert.throws(
    () => parseGeoJsonLines('{"type":"FeatureCollection"}'),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 1: that FeatureCollection has no features list.',
  );
});

test('a FeatureCollection member that is not a Feature is rejected', () => {
  assert.throws(
    () =>
      parseGeoJsonLines(
        '{"type":"FeatureCollection","features":[{"type":"Point","coordinates":[0,0]}]}',
      ),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 1: every feature must have type Feature.',
  );
});

test('empty and blank-only input is rejected', () => {
  assert.throws(
    () => parseGeoJsonLines(''),
    (error) =>
      error instanceof GeoJsonLinesError &&
      /No GeoJSON features found/.test(error.message),
  );
  assert.throws(
    () => parseGeoJsonLines('\n\r\n  \n'),
    (error) =>
      error instanceof GeoJsonLinesError &&
      /No GeoJSON features found/.test(error.message),
  );
});

test('non-string input throws a typed GeoJsonLinesError (DS-24)', () => {
  for (const bad of [null, undefined, 5]) {
    assert.throws(
      () => parseGeoJsonLines(bad),
      (error) =>
        error instanceof GeoJsonLinesError &&
        error.message === 'GeoJSONL import needs text.',
      `parseGeoJsonLines(${String(bad)}) must refuse typed`,
    );
  }
});

test('feature limit is enforced with the line number', () => {
  assert.throws(
    () =>
      parseGeoJsonLines(`${point(0, 0)}\n${point(1, 1)}`, {
        maxFeatures: 1,
      }),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 2: more than 1 features (the limit).',
  );
});

test('position limit is enforced with the line number', () => {
  assert.throws(
    () =>
      parseGeoJsonLines(
        '{"type":"LineString","coordinates":[[0,0],[1,1],[2,2]]}',
        { maxPositions: 2 },
      ),
    (error) =>
      error instanceof GeoJsonLinesError &&
      error.message === 'line 1: more than 2 points (the limit).',
  );
});

test('default limits match the loader caps', () => {
  assert.equal(MAX_GEOJSONL_FEATURES, 20_000);
  assert.equal(MAX_GEOJSONL_POSITIONS, 250_000);
});

test('isGeoJsonLinesText detects two Feature lines', () => {
  assert.equal(isGeoJsonLinesText(`${point(0, 0)}\n${point(1, 1)}`), true);
  assert.equal(
    isGeoJsonLinesText(`${point(0, 0)}\r\n${point(1, 1)}\r\n`),
    true,
  );
});

test('isGeoJsonLinesText rejects single-line and pretty-printed GeoJSON', () => {
  assert.equal(isGeoJsonLinesText(point(0, 0)), false);
  assert.equal(
    isGeoJsonLinesText('{\n"type":"Feature",\n"geometry":null\n}'),
    false,
  );
  assert.equal(isGeoJsonLinesText(''), false);
  assert.equal(isGeoJsonLinesText('a,b\nc,d'), false);
  assert.equal(isGeoJsonLinesText(null), false);
});

test('isGeoJsonLinesText does not validate beyond the first line', () => {
  assert.equal(isGeoJsonLinesText(`${point(0, 0)}\n{broken`), true);
});
