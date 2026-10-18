import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESRI_MAX_FEATURES,
  ESRI_MAX_POSITIONS,
  EsriJsonImportError,
  esriJsonToGeoJson,
  isEsriJsonText,
  isEsriJsonValue,
} from './esriJsonImport.js';

const esri = (input) => esriJsonToGeoJson(input);
const refuses = (input, pattern) =>
  assert.throws(
    () => esri(input),
    (error) => {
      assert.ok(
        error instanceof EsriJsonImportError,
        `expected EsriJsonImportError, got ${error}`,
      );
      assert.match(error.message, pattern);
      return true;
    },
  );

/* Clockwise exterior (Esri rule): (0,0)->(0,1)->(1,1)->(1,0)->(0,0) is
   clockwise in lon/lat orientation (shoelace area < 0). */
const CW_RING = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];
/* Counter-clockwise hole. */
const CCW_HOLE = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
  [0.2, 0.2],
];

test('isEsriJsonText sniffs Esri JSON and rejects GeoJSON / empty text', () => {
  assert.equal(
    isEsriJsonText('{"geometryType":"esriGeometryPoint","features":[]}'),
    true,
  );
  assert.equal(
    isEsriJsonText('{"x": 12.5, "y": 55.7, "spatialReference":{"wkid":4326}}'),
    true,
  );
  assert.equal(
    isEsriJsonText('{"type":"FeatureCollection","features":[]}'),
    false,
  );
  assert.equal(
    isEsriJsonText(
      '{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}',
    ),
    false,
  );
  assert.equal(isEsriJsonText(''), false);
  assert.equal(isEsriJsonText(null), false);
  assert.equal(isEsriJsonText('<kml></kml>'), false);
});

test('isEsriJsonValue gates on parsed values', () => {
  assert.equal(
    isEsriJsonValue({ geometryType: 'esriGeometryPoint', features: [] }),
    true,
  );
  assert.equal(isEsriJsonValue({ x: 1, y: 2 }), true);
  assert.equal(
    isEsriJsonValue({
      features: [{ attributes: { a: 1 }, geometry: { x: 1, y: 2 } }],
    }),
    true,
  );
  assert.equal(
    isEsriJsonValue({ type: 'FeatureCollection', features: [] }),
    false,
  );
  assert.equal(
    isEsriJsonValue({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    }),
    false,
  );
  assert.equal(isEsriJsonValue([1, 2]), false);
  assert.equal(isEsriJsonValue(null), false);
});

test('bare Point converts, z dropped, missing SR assumed WGS 84', () => {
  assert.deepEqual(esri({ x: 12.5, y: 55.7, z: 10 }), {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [12.5, 55.7] },
        properties: {},
      },
    ],
  });
});

test('bare Point with wkid 4326 converts; latestWkid 4326 converts', () => {
  assert.equal(
    esri({ x: 1, y: 2, spatialReference: { wkid: 4326 } }).features[0].geometry
      .type,
    'Point',
  );
  assert.equal(
    esri({ x: 1, y: 2, spatialReference: { latestWkid: 4326 } }).features[0]
      .geometry.type,
    'Point',
  );
});

test('Multipoint converts; duplicate points are kept', () => {
  assert.deepEqual(
    esri({
      points: [
        [0, 0],
        [1, 1],
        [1, 1],
      ],
    }).features[0].geometry,
    {
      type: 'MultiPoint',
      coordinates: [
        [0, 0],
        [1, 1],
        [1, 1],
      ],
    },
  );
});

test('Polyline: one path -> LineString, several -> MultiLineString', () => {
  assert.deepEqual(
    esri({
      paths: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    }).features[0].geometry,
    {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  );
  assert.deepEqual(
    esri({
      paths: [
        [
          [0, 0],
          [1, 1],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ],
    }).features[0].geometry,
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
});

test('Polygon: clockwise exterior re-orients to GeoJSON counter-clockwise', () => {
  assert.deepEqual(esri({ rings: [CW_RING] }).features[0].geometry, {
    type: 'Polygon',
    coordinates: [[...CW_RING].reverse()],
  });
});

test('Polygon: counter-clockwise hole attaches and re-orients clockwise', () => {
  assert.deepEqual(esri({ rings: [CW_RING, CCW_HOLE] }).features[0].geometry, {
    type: 'Polygon',
    coordinates: [[...CW_RING].reverse(), [...CCW_HOLE].reverse()],
  });
});

test('Polygon: two exteriors -> MultiPolygon', () => {
  const second = CW_RING.map(([x, y]) => [x + 10, y + 10]);
  assert.deepEqual(esri({ rings: [CW_RING, second] }).features[0].geometry, {
    type: 'MultiPolygon',
    coordinates: [[[...CW_RING].reverse()], [[...second].reverse()]],
  });
});

test('Envelope converts to a counter-clockwise Polygon', () => {
  assert.deepEqual(
    esri({ xmin: 0, ymin: 0, xmax: 1, ymax: 2 }).features[0].geometry,
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    },
  );
});

test('Feature keeps scalar attributes; missing attributes -> {}', () => {
  assert.deepEqual(
    esri({
      geometry: { x: 1, y: 2 },
      attributes: { name: 'A', n: 3, ok: true, missing: null },
    }).features[0].properties,
    { name: 'A', n: 3, ok: true, missing: null },
  );
  assert.deepEqual(
    esri({ geometry: { x: 1, y: 2 } }).features[0].properties,
    {},
  );
});

test('FeatureSet: geometryType + FeatureSet SR apply to all features', () => {
  const out = esri({
    geometryType: 'esriGeometryPoint',
    spatialReference: { wkid: 4326 },
    objectIdFieldName: 'OBJECTID',
    fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }],
    features: [
      { geometry: { x: 1, y: 2 }, attributes: { OBJECTID: 1 } },
      { geometry: { x: 3, y: 4 }, attributes: { OBJECTID: 2 } },
    ],
  });
  assert.equal(out.features.length, 2);
  assert.deepEqual(out.features[1].geometry, {
    type: 'Point',
    coordinates: [3, 4],
  });
  assert.deepEqual(out.features[1].properties, { OBJECTID: 2 });
});

test('FeatureSet: geometry-level SR wins; a 3857 geometry refuses', () => {
  refuses(
    {
      geometryType: 'esriGeometryPoint',
      spatialReference: { wkid: 4326 },
      features: [
        {
          geometry: { x: 1, y: 2, spatialReference: { wkid: 3857 } },
          attributes: {},
        },
      ],
    },
    /only WGS 84/,
  );
});

test('JSON string input parses; invalid JSON refuses', () => {
  assert.equal(esri('{"x": 1, "y": 2}').features[0].geometry.type, 'Point');
  refuses('{not json', /not valid JSON/);
  refuses('[1, 2]', /must be a JSON object/);
  refuses(null, /must be a JSON object/);
});

test('refuses non-4326 spatial references', () => {
  refuses(
    { x: 1, y: 2, spatialReference: { wkid: 3857 } },
    /only WGS 84.*3857/,
  );
  refuses(
    { x: 1, y: 2, spatialReference: { wkid: 102100 } },
    /only WGS 84.*102100/,
  );
  refuses(
    { x: 1, y: 2, spatialReference: { latestWkid: 3857 } },
    /only WGS 84/,
  );
  refuses(
    { x: 1, y: 2, spatialReference: { wkt: 'GEOGCS["WGS 84"]' } },
    /only a WKT definition/,
  );
  refuses(
    { x: 1, y: 2, spatialReference: { wkid: '4326' } },
    /wkid must be an integer/,
  );
  refuses({ x: 1, y: 2, spatialReference: '4326' }, /must be an object/);
  refuses(
    {
      spatialReference: { wkid: 3857 },
      features: [{ geometry: { x: 1, y: 2 }, attributes: {} }],
    },
    /only WGS 84/,
  );
});

test('refuses bad coordinates', () => {
  refuses({ x: 181, y: 0 }, /longitude 181/);
  refuses({ x: 0, y: 91 }, /latitude 91/);
  refuses({ x: '1', y: 2 }, /finite numbers/);
  refuses({ x: Number.NaN, y: 2 }, /finite numbers/);
  refuses({ x: 1 }, /both x and y/);
  refuses({ points: [[0, 0, 1, 2]] }, /position must be/);
  refuses({ points: [[0]] }, /position must be/);
  refuses({ points: [[0, Number.POSITIVE_INFINITY]] }, /finite numbers/);
});

test('refuses malformed rings', () => {
  refuses(
    {
      rings: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
        ],
      ],
    },
    /not closed/,
  );
  refuses(
    {
      rings: [
        [
          [0, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    /at least 4/,
  );
  refuses(
    {
      rings: [
        [
          [0, 0],
          [1, 1],
          [2, 2],
          [0, 0],
        ],
      ],
    },
    /zero area/,
  );
  // Counter-clockwise "exterior" (GeoJSON order) reads as a hole with
  // no exterior: refused, never silently misconverted.
  refuses({ rings: [[...CW_RING].reverse()] }, /hole ring appears before/);
  // Hole outside its exterior.
  refuses(
    {
      rings: [
        CW_RING,
        [
          [5, 5],
          [6, 5],
          [6, 6],
          [5, 6],
          [5, 5],
        ],
      ],
    },
    /outside its exterior/,
  );
});

test('refuses degenerate geometries', () => {
  refuses({ points: [] }, /non-empty points/);
  refuses({ paths: [] }, /non-empty paths/);
  refuses({ paths: [[[]]] }, /at least 2/);
  refuses(
    {
      paths: [
        [
          [0, 0],
          [0, 0],
        ],
      ],
    },
    /degenerate/,
  );
  refuses({ rings: [] }, /non-empty rings/);
  refuses({ xmin: 1, ymin: 0, xmax: 1, ymax: 2 }, /xmin < xmax/);
  refuses({ xmin: 0, ymin: 2, xmax: 1, ymax: 2 }, /xmin < xmax/);
  refuses({ geometry: null, attributes: {} }, /null geometry/);
  refuses({ attributes: {} }, /no geometry/);
  refuses({ foo: 1 }, /unrecognised Esri JSON/);
});

test('refuses ambiguous geometry and geometryType mismatch', () => {
  refuses({ x: 1, y: 2, rings: [CW_RING] }, /ambiguous/);
  refuses(
    {
      geometryType: 'esriGeometryPoint',
      features: [
        {
          geometry: {
            paths: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
          attributes: {},
        },
      ],
    },
    /geometryType requires point/,
  );
  refuses(
    {
      geometryType: 'esriGeometryCircle',
      features: [{ geometry: { x: 1, y: 2 }, attributes: {} }],
    },
    /unsupported FeatureSet geometryType/,
  );
});

test('refuses truncated FeatureSets and bad attributes', () => {
  refuses(
    {
      exceededTransferLimit: true,
      features: [{ geometry: { x: 1, y: 2 }, attributes: {} }],
    },
    /truncated/,
  );
  refuses(
    { geometry: { x: 1, y: 2 }, attributes: { nested: { a: 1 } } },
    /must be a JSON scalar/,
  );
  refuses(
    { geometry: { x: 1, y: 2 }, attributes: { list: [1] } },
    /must be a JSON scalar/,
  );
  refuses(
    { geometry: { x: 1, y: 2 }, attributes: { v: Number.NaN } },
    /must be a JSON scalar/,
  );
  refuses({ features: [] }, /no features/);
  refuses(
    {
      features: [{ geometry: { x: 1, y: 2 }, attributes: {} }],
      rings: [CW_RING],
    },
    /mixes a FeatureSet/,
  );
});

test('refuses over the feature cap', () => {
  const features = Array.from({ length: ESRI_MAX_FEATURES + 1 }, () => ({
    geometry: { x: 0, y: 0 },
    attributes: {},
  }));
  refuses({ features }, new RegExp(String(ESRI_MAX_FEATURES.toLocaleString())));
});

test('refuses over the position cap', () => {
  const path = Array.from({ length: ESRI_MAX_POSITIONS + 1 }, (_, i) => [
    i % 180,
    0,
  ]);
  refuses(
    { paths: [path] },
    new RegExp(String(ESRI_MAX_POSITIONS.toLocaleString())),
  );
});
