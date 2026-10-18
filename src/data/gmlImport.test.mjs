import test from 'node:test';
import assert from 'node:assert/strict';
import { GmlImportError, gmlToGeoJson, isGmlText } from './gmlImport.js';

/* Minimal DOM surface: localName / childNodes / nodeType / textContent /
   getAttribute — the same surface the parser reads. */
function el(localName, attrs = {}, kids = []) {
  const node = {
    nodeType: 1,
    localName,
    childNodes: [],
    getAttribute: (name) => (name in attrs ? String(attrs[name]) : null),
    get textContent() {
      return typeof kids === 'string'
        ? kids
        : node.childNodes.map((c) => c.textContent).join('');
    },
  };
  for (const kid of typeof kids === 'string' ? [] : kids) {
    kid.parentNode = node;
    node.childNodes.push(kid);
  }
  return node;
}
const doc = (root) => ({ documentElement: root });
const gml = (root) => gmlToGeoJson(doc(root));

test('isGmlText sniffs GML and rejects KML / GeoJSON / empty text', () => {
  assert.equal(
    isGmlText(
      '<?xml version="1.0"?><gml:FeatureCollection ' +
        'xmlns:gml="http://www.opengis.net/gml/3.2"></gml:FeatureCollection>',
    ),
    true,
  );
  assert.equal(
    isGmlText(
      '<FeatureCollection xmlns="http://www.opengis.net/gml/3.2">' +
        '</FeatureCollection>',
    ),
    true,
  );
  assert.equal(
    isGmlText('<kml xmlns="http://www.opengis.net/kml/2.2"></kml>'),
    false,
  );
  assert.equal(isGmlText('{"type":"FeatureCollection"}'), false);
  assert.equal(isGmlText(''), false);
  assert.equal(isGmlText(null), false);
});

test('bare CRS84 Point reads lon,lat from pos', () => {
  const fc = gml(el('Point', {}, [el('pos', {}, '12.5 41.9')]));
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Point',
    coordinates: [12.5, 41.9],
  });
  assert.deepEqual(fc.features[0].properties, {});
});

test('EPSG:4326 Point swaps lat,lon to GeoJSON lon,lat', () => {
  const fc = gml(
    el('Point', { srsName: 'EPSG:4326' }, [el('pos', {}, '41.9 12.5')]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [12.5, 41.9]);
});

test('EPSG URN forms also swap, CRS84 forms do not', () => {
  for (const srsName of [
    'urn:ogc:def:crs:EPSG::4326',
    'urn:ogc:def:crs:EPSG:6.18:3:4326',
    'http://www.opengis.net/gml/srs/epsg.xml#4326',
  ]) {
    const fc = gml(el('Point', { srsName }, [el('pos', {}, '41.9 12.5')]));
    assert.deepEqual(fc.features[0].geometry.coordinates, [12.5, 41.9]);
  }
  for (const srsName of [
    'urn:ogc:def:crs:OGC:1.3:CRS84',
    'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
  ]) {
    const fc = gml(el('Point', { srsName }, [el('pos', {}, '12.5 41.9')]));
    assert.deepEqual(fc.features[0].geometry.coordinates, [12.5, 41.9]);
  }
});

test('LineString from posList, and srsDimension 3 drops altitude', () => {
  const line = gml(el('LineString', {}, [el('posList', {}, '0 0 10 0 10 10')]));
  assert.deepEqual(line.features[0].geometry, {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
  });
  const line3d = gml(
    el('LineString', { srsDimension: '3' }, [
      el('posList', {}, '0 0 500 10 0 600'),
    ]),
  );
  assert.deepEqual(line3d.features[0].geometry.coordinates, [
    [0, 0],
    [10, 0],
  ]);
});

test('GML 3 Polygon with hole via exteriorRing / interiorRing', () => {
  const fc = gml(
    el('Polygon', {}, [
      el('exteriorRing', {}, [
        el('LinearRing', {}, [el('posList', {}, '0 0 10 0 10 10 0 10 0 0')]),
      ]),
      el('interiorRing', {}, [
        el('LinearRing', {}, [el('posList', {}, '2 2 4 2 4 4 2 4 2 2')]),
      ]),
    ]),
  );
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
      [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
        [2, 2],
      ],
    ],
  });
});

test('GML 2 Polygon via outerBoundaryIs and coordinates', () => {
  const fc = gml(
    el('Polygon', {}, [
      el('outerBoundaryIs', {}, [
        el('LinearRing', {}, [el('coordinates', {}, '0,0 10,0 10,10 0,0')]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 0],
    ],
  ]);
});

test('GML 2 coord elements with X / Y children', () => {
  const fc = gml(
    el('LineString', {}, [
      el('coord', {}, [el('X', {}, '1'), el('Y', {}, '2')]),
      el('coord', {}, [el('X', {}, '3'), el('Y', {}, '4')]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [
    [1, 2],
    [3, 4],
  ]);
});

test('MultiPoint, MultiLineString, MultiPolygon and MultiSurface', () => {
  const multiPoint = gml(
    el('MultiPoint', {}, [
      el('pointMember', {}, [el('Point', {}, [el('pos', {}, '1 2')])]),
      el('pointMember', {}, [el('Point', {}, [el('pos', {}, '3 4')])]),
    ]),
  );
  assert.deepEqual(multiPoint.features[0].geometry, {
    type: 'MultiPoint',
    coordinates: [
      [1, 2],
      [3, 4],
    ],
  });
  const multiLine = gml(
    el('MultiLineString', {}, [
      el('lineStringMember', {}, [
        el('LineString', {}, [el('posList', {}, '0 0 1 1')]),
      ]),
      el('lineStringMember', {}, [
        el('LineString', {}, [el('posList', {}, '2 2 3 3')]),
      ]),
    ]),
  );
  assert.deepEqual(multiLine.features[0].geometry, {
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
  });
  const ring = (coords) => el('LinearRing', {}, [el('posList', {}, coords)]);
  const polygon = (coords) =>
    el('Polygon', {}, [el('exteriorRing', {}, [ring(coords)])]);
  const multiPolygon = gml(
    el('MultiPolygon', {}, [
      el('polygonMember', {}, [polygon('0 0 1 0 1 1 0 0')]),
      el('polygonMember', {}, [polygon('2 2 3 2 3 3 2 2')]),
    ]),
  );
  assert.equal(multiPolygon.features[0].geometry.type, 'MultiPolygon');
  assert.equal(multiPolygon.features[0].geometry.coordinates.length, 2);
  const multiSurface = gml(
    el('MultiSurface', {}, [
      el('surfaceMember', {}, [polygon('0 0 1 0 1 1 0 0')]),
    ]),
  );
  assert.equal(multiSurface.features[0].geometry.type, 'MultiPolygon');
  assert.equal(multiSurface.features[0].geometry.coordinates.length, 1);
});

test('FeatureCollection members carry names; bare feature root works', () => {
  const fc = gml(
    el('FeatureCollection', {}, [
      el('featureMember', {}, [
        el('roads', {}, [
          el('name', {}, '  Via  Roma '),
          el('geometry', {}, [el('Point', {}, [el('pos', {}, '12.5 41.9')])]),
        ]),
      ]),
      el('featureMember', {}, [
        el('roads', {}, [el('Point', {}, [el('pos', {}, '0 0')])]),
      ]),
    ]),
  );
  assert.equal(fc.features.length, 2);
  assert.equal(fc.features[0].properties.name, 'Via Roma');
  assert.deepEqual(fc.features[0].geometry.coordinates, [12.5, 41.9]);
  assert.deepEqual(fc.features[1].properties, {});
  const bare = gml(
    el('roads', {}, [
      el('geometry', {}, [el('Point', {}, [el('pos', {}, '1 2')])]),
    ]),
  );
  assert.equal(bare.features.length, 1);
  assert.deepEqual(bare.features[0].geometry.coordinates, [1, 2]);
});

test('featureMembers wrapper and nested FeatureCollection flatten', () => {
  const fc = gml(
    el('FeatureCollection', {}, [
      el('featureMembers', {}, [
        el('a', {}, [el('Point', {}, [el('pos', {}, '1 2')])]),
        el('b', {}, [el('Point', {}, [el('pos', {}, '3 4')])]),
      ]),
      el('featureMember', {}, [
        el('FeatureCollection', {}, [
          el('featureMember', {}, [
            el('c', {}, [el('Point', {}, [el('pos', {}, '5 6')])]),
          ]),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(
    fc.features.map((f) => f.geometry.coordinates),
    [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
  );
});

test('feature with no geometry becomes a null-geometry feature', () => {
  const fc = gml(
    el('FeatureCollection', {}, [
      el('featureMember', {}, [el('place', {}, [el('name', {}, 'Nowhere')])]),
    ]),
  );
  assert.equal(fc.features[0].geometry, null);
  assert.equal(fc.features[0].properties.name, 'Nowhere');
});

test('feature with two geometries becomes a GeometryCollection', () => {
  const fc = gml(
    el('place', {}, [
      el('Point', {}, [el('pos', {}, '1 2')]),
      el('Point', {}, [el('pos', {}, '3 4')]),
    ]),
  );
  assert.equal(fc.features[0].geometry.type, 'GeometryCollection');
  assert.equal(fc.features[0].geometry.geometries.length, 2);
});

test('srsName is per-geometry: one file can mix EPSG:4326 and CRS84', () => {
  const fc = gml(
    el('FeatureCollection', {}, [
      el('featureMember', {}, [
        el('a', {}, [
          el('Point', { srsName: 'EPSG:4326' }, [el('pos', {}, '41.9 12.5')]),
        ]),
      ]),
      el('featureMember', {}, [
        el('b', {}, [
          el('Point', { srsName: 'CRS84' }, [el('pos', {}, '12.5 41.9')]),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [12.5, 41.9]);
  assert.deepEqual(fc.features[1].geometry.coordinates, [12.5, 41.9]);
});

test('collection srsName is inherited unless a geometry overrides it', () => {
  const fc = gml(
    el('FeatureCollection', { srsName: 'EPSG:4326' }, [
      el('featureMember', {}, [
        el('a', {}, [el('Point', {}, [el('pos', {}, '41.9 12.5')])]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [12.5, 41.9]);
});

test('non-WGS84 srsName refuses the whole file', () => {
  assert.throws(
    () =>
      gml(el('Point', { srsName: 'EPSG:3857' }, [el('pos', {}, '12.5 41.9')])),
    (error) =>
      error instanceof GmlImportError &&
      /unsupported CRS "EPSG:3857"/.test(error.message),
  );
});

test('out-of-range and non-numeric coordinates refuse the whole file', () => {
  assert.throws(
    () => gml(el('Point', {}, [el('pos', {}, '200 0')])),
    (error) => error instanceof GmlImportError,
  );
  assert.throws(
    () => gml(el('Point', {}, [el('pos', {}, 'abc 0')])),
    (error) => error instanceof GmlImportError,
  );
  assert.throws(
    () => gml(el('Point', {}, [el('pos', {}, '0 91')])),
    (error) => error instanceof GmlImportError,
  );
});

test('unclosed Polygon ring is refused', () => {
  assert.throws(
    () =>
      gml(
        el('Polygon', {}, [
          el('exteriorRing', {}, [
            el('LinearRing', {}, [el('posList', {}, '0 0 10 0 10 10 0 10')]),
          ]),
        ]),
      ),
    (error) =>
      error instanceof GmlImportError && /not closed/.test(error.message),
  );
});

test('degenerate geometries are refused', () => {
  assert.throws(
    () => gml(el('Point', {}, [el('posList', {}, '1 2 3 4')])),
    (error) =>
      error instanceof GmlImportError && /exactly one/.test(error.message),
  );
  assert.throws(
    () => gml(el('LineString', {}, [el('pos', {}, '1 2')])),
    (error) =>
      error instanceof GmlImportError && /at least two/.test(error.message),
  );
  assert.throws(
    () =>
      gml(
        el('Polygon', {}, [
          el('exteriorRing', {}, [
            el('LinearRing', {}, [el('posList', {}, '0 0 1 1 0 0')]),
          ]),
        ]),
      ),
    (error) =>
      error instanceof GmlImportError && /at least four/.test(error.message),
  );
  assert.throws(
    () => gml(el('Polygon', {}, [])),
    (error) =>
      error instanceof GmlImportError && /no exterior ring/.test(error.message),
  );
});

test('posList count not a multiple of srsDimension is refused', () => {
  assert.throws(
    () => gml(el('LineString', {}, [el('posList', {}, '0 0 1')])),
    (error) =>
      error instanceof GmlImportError && /multiple/.test(error.message),
  );
});

test('custom coordinates separators are refused', () => {
  assert.throws(
    () =>
      gml(
        el('LineString', {}, [
          el('coordinates', { cs: ';', ts: '|' }, '0;0|1;1'),
        ]),
      ),
    (error) =>
      error instanceof GmlImportError &&
      /custom separators/.test(error.message),
  );
});

test('unsupported geometry types are refused, not silently dropped', () => {
  assert.throws(
    () =>
      gml(
        el('place', {}, [
          el('geometry', {}, [
            el('Curve', {}, [
              el('segments', {}, [
                el('LineStringSegment', {}, [el('posList', {}, '0 0 1 1')]),
              ]),
            ]),
          ]),
        ]),
      ),
    (error) =>
      error instanceof GmlImportError &&
      /unsupported geometry/.test(error.message),
  );
  assert.throws(
    () => gml(el('Surface', {}, [el('patches', {}, [])])),
    (error) =>
      error instanceof GmlImportError &&
      /unsupported geometry/.test(error.message),
  );
});

test('non-GML roots are refused', () => {
  assert.throws(
    () => gmlToGeoJson(doc(el('kml', {}, []))),
    (error) => error instanceof GmlImportError,
  );
  assert.throws(
    () => gmlToGeoJson({}),
    (error) => error instanceof GmlImportError,
  );
  assert.throws(
    () => gmlToGeoJson(doc(el('Envelope', {}, []))),
    (error) =>
      error instanceof GmlImportError && /bounding box/.test(error.message),
  );
});

test('feature and position caps are enforced', () => {
  const many = Array.from({ length: 3 }, () =>
    el('featureMember', {}, [
      el('a', {}, [el('Point', {}, [el('pos', {}, '1 2')])]),
    ]),
  );
  assert.throws(
    () =>
      gmlToGeoJson(doc(el('FeatureCollection', {}, many)), {
        maxFeatures: 2,
      }),
    (error) =>
      error instanceof GmlImportError && /features/.test(error.message),
  );
  assert.throws(
    () =>
      gmlToGeoJson(
        doc(el('LineString', {}, [el('posList', {}, '0 0 1 1 2 2')])),
        { maxPositions: 2 },
      ),
    (error) => error instanceof GmlImportError && /points/.test(error.message),
  );
});

test('unsupported srsDimension is refused', () => {
  assert.throws(
    () =>
      gml(
        el('LineString', { srsDimension: '4' }, [
          el('posList', {}, '0 0 0 0 1 1 1 1'),
        ]),
      ),
    (error) =>
      error instanceof GmlImportError && /srsDimension/.test(error.message),
  );
});
