import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OsmGeoImportError,
  parseOsmToFeatureCollection,
} from './osmGeoImport.js';

// The parser takes a Document (like gpxToGeoJson): Node has no DOMParser,
// so tests build the small DOM surface the parser reads — childNodes,
// nodeType, localName, getAttribute.
const el = (localName, attrs = {}, kids = []) => ({
  nodeType: 1,
  localName,
  childNodes: kids,
  getAttribute: (name) => (name in attrs ? String(attrs[name]) : null),
});
const tag = (k, v) => el('tag', { k, v });
const osmDoc = (...kids) => ({ documentElement: el('osm', {}, kids) });
const node = (id, lat, lon, tags = []) =>
  el(
    'node',
    { id, lat, lon },
    tags.map(([k, v]) => tag(k, v)),
  );
const way = (id, refs, tags = []) =>
  el('way', { id }, [
    ...refs.map((ref) => el('nd', { ref })),
    ...tags.map(([k, v]) => tag(k, v)),
  ]);
const relation = (id, members, tags = []) =>
  el('relation', { id }, [
    ...members.map(([type, ref, role]) => el('member', { type, ref, role })),
    ...tags.map(([k, v]) => tag(k, v)),
  ]);

// Nodes 2–4 form a unit square; node 1 is a tagged cafe in its corner.
const square = [
  node(1, 25.6, 85.1, [
    ['name', 'Cafe'],
    ['amenity', 'cafe'],
    ['addr:street', 'Main Rd'],
  ]),
  node(2, 25.6, 85.2),
  node(3, 25.7, 85.2),
  node(4, 25.7, 85.1),
];

test('a tagged node becomes a point keeping only its name', () => {
  const out = parseOsmToFeatureCollection(
    osmDoc(
      node(1, 25.6, 85.1, [
        ['name', 'Cafe'],
        ['amenity', 'cafe'],
      ]),
    ),
  );
  assert.equal(out.type, 'FeatureCollection');
  assert.deepEqual(out.features, [
    {
      type: 'Feature',
      properties: { name: 'Cafe' },
      geometry: { type: 'Point', coordinates: [85.1, 25.6] },
    },
  ]);
});

test('untagged nodes draw nothing on their own', () => {
  assert.throws(
    () => parseOsmToFeatureCollection(osmDoc(node(1, 25.6, 85.1))),
    (error) =>
      error instanceof OsmGeoImportError &&
      /nothing to draw/.test(error.message),
  );
});

test('an open way becomes a LineString and a closed building way a Polygon', () => {
  const out = parseOsmToFeatureCollection(
    osmDoc(
      ...square,
      way(
        10,
        [2, 3],
        [
          ['highway', 'residential'],
          ['name', 'Main Rd'],
        ],
      ),
      way(
        11,
        [2, 3, 4, 2],
        [
          ['building', 'yes'],
          ['name', 'Hall'],
        ],
      ),
    ),
  );
  const road = out.features.find((f) => f.properties.name === 'Main Rd');
  const hall = out.features.find((f) => f.properties.name === 'Hall');
  assert.equal(road.geometry.type, 'LineString');
  assert.deepEqual(road.geometry.coordinates, [
    [85.2, 25.6],
    [85.2, 25.7],
  ]);
  assert.equal(hall.geometry.type, 'Polygon');
  assert.deepEqual(hall.geometry.coordinates, [
    [
      [85.2, 25.6],
      [85.2, 25.7],
      [85.1, 25.7],
      [85.2, 25.6],
    ],
  ]);
});

test('a closed highway stays a line; area=yes forces a polygon, area=no a line', () => {
  const out = parseOsmToFeatureCollection(
    osmDoc(
      ...square,
      way(10, [2, 3, 4, 2], [['highway', 'residential']]),
      way(
        11,
        [2, 3, 4, 2],
        [
          ['highway', 'pedestrian'],
          ['area', 'yes'],
        ],
      ),
      way(
        12,
        [2, 3, 4, 2],
        [
          ['building', 'yes'],
          ['area', 'no'],
        ],
      ),
    ),
  );
  assert.deepEqual(
    out.features
      .filter((f) => f.geometry.type !== 'Point')
      .map((f) => f.geometry.type),
    ['LineString', 'Polygon', 'LineString'],
  );
});

test('a multipolygon becomes a polygon with its inner ring as a hole', () => {
  const out = parseOsmToFeatureCollection(
    osmDoc(
      ...square,
      node(5, 25.62, 85.12),
      node(6, 25.62, 85.18),
      node(7, 25.68, 85.18),
      node(8, 25.68, 85.12),
      way(10, [2, 3, 4, 1, 2], [['building', 'yes']]),
      way(11, [5, 6, 7, 8, 5]),
      relation(
        20,
        [
          ['way', 10, 'outer'],
          ['way', 11, 'inner'],
        ],
        [
          ['type', 'multipolygon'],
          ['name', 'Court'],
        ],
      ),
    ),
  );
  const feature = out.features.find((f) => f.geometry.type === 'Polygon');
  assert.ok(feature, 'the multipolygon becomes a polygon');
  assert.equal(feature.properties.name, 'Court');
  assert.equal(feature.geometry.coordinates.length, 2);
  assert.deepEqual(feature.geometry.coordinates[1][0], [85.12, 25.62]);
});

test('two outers become a MultiPolygon and non-multipolygon relations are skipped', () => {
  const out = parseOsmToFeatureCollection(
    osmDoc(
      ...square,
      way(10, [2, 3, 4, 2]),
      way(11, [2, 3, 4, 2]),
      relation(
        20,
        [
          ['way', 10, 'outer'],
          ['way', 11, 'outer'],
        ],
        [['type', 'multipolygon']],
      ),
      relation(21, [['way', 10, '']], [['type', 'route']]),
    ),
  );
  const multi = out.features.find((f) => f.geometry.type === 'MultiPolygon');
  assert.ok(multi, 'two outers become a MultiPolygon');
  assert.equal(multi.geometry.coordinates.length, 2);
});

test('negative JOSM ids parse like real ones', () => {
  const out = parseOsmToFeatureCollection(
    osmDoc(node(-1, 25.6, 85.1, [['name', 'Draft']])),
  );
  assert.equal(out.features[0].properties.name, 'Draft');
});

test('a dangling way reference refuses the whole file', () => {
  assert.throws(
    () => parseOsmToFeatureCollection(osmDoc(way(10, [99, 98]))),
    (error) =>
      error instanceof OsmGeoImportError &&
      /references a missing node/.test(error.message),
  );
});

test('a dangling multipolygon member refuses the whole file', () => {
  assert.throws(
    () =>
      parseOsmToFeatureCollection(
        osmDoc(
          relation(20, [['way', 99, 'outer']], [['type', 'multipolygon']]),
        ),
      ),
    (error) =>
      error instanceof OsmGeoImportError &&
      /references a missing way/.test(error.message),
  );
});

test('an unclosed multipolygon ring and an orphan inner ring refuse the file', () => {
  const open = osmDoc(
    ...square,
    way(10, [2, 3, 4]),
    relation(20, [['way', 10, 'outer']], [['type', 'multipolygon']]),
  );
  assert.throws(
    () => parseOsmToFeatureCollection(open),
    (error) =>
      error instanceof OsmGeoImportError && /not closed/.test(error.message),
  );
  const orphan = osmDoc(
    ...square,
    node(5, 26.0, 86.0),
    node(6, 26.0, 86.1),
    node(7, 26.1, 86.1),
    node(8, 26.1, 86.0),
    way(10, [2, 3, 4, 2]),
    way(11, [5, 6, 7, 8, 5]),
    relation(
      20,
      [
        ['way', 10, 'outer'],
        ['way', 11, 'inner'],
      ],
      [['type', 'multipolygon']],
    ),
  );
  assert.throws(
    () => parseOsmToFeatureCollection(orphan),
    (error) =>
      error instanceof OsmGeoImportError && /outside/.test(error.message),
  );
});

test('a way reused by two multipolygons refuses the file', () => {
  assert.throws(
    () =>
      parseOsmToFeatureCollection(
        osmDoc(
          ...square,
          way(10, [2, 3, 4, 2]),
          relation(20, [['way', 10, 'outer']], [['type', 'multipolygon']]),
          relation(21, [['way', 10, 'outer']], [['type', 'multipolygon']]),
        ),
      ),
    (error) =>
      error instanceof OsmGeoImportError && /more than one/.test(error.message),
  );
});

test('a non-osm root, a duplicate id and bad coordinates refuse the file', () => {
  for (const [label, doc] of [
    ['wrong root', { documentElement: el('kml') }],
    ['no root', { documentElement: null }],
    ['duplicate node', osmDoc(node(1, 25.6, 85.1), node(1, 25.6, 85.1))],
    ['bad latitude', osmDoc(node(1, 95, 85.1, [['name', 'X']]))],
    [
      'missing latitude',
      osmDoc(el('node', { id: 1, lon: 85.1 }, [tag('name', 'X')])),
    ],
  ])
    assert.throws(
      () => parseOsmToFeatureCollection(doc),
      (error) => error instanceof OsmGeoImportError,
      label,
    );
});

test('feature and position caps refuse the file', () => {
  const twoPoints = osmDoc(
    node(1, 25.6, 85.1, [['name', 'A']]),
    node(2, 25.7, 85.2, [['name', 'B']]),
  );
  assert.throws(
    () => parseOsmToFeatureCollection(twoPoints, { maxFeatures: 1 }),
    (error) =>
      error instanceof OsmGeoImportError && /features/.test(error.message),
  );
  assert.throws(
    () => parseOsmToFeatureCollection(twoPoints, { maxPositions: 1 }),
    (error) =>
      error instanceof OsmGeoImportError && /points/.test(error.message),
  );
});

test('a way that repeats one node cannot amplify past the position cap', () => {
  const refs = Array.from({ length: 30 }, () => 1);
  assert.throws(
    () =>
      parseOsmToFeatureCollection(osmDoc(node(1, 25.6, 85.1), way(10, refs)), {
        maxPositions: 10,
      }),
    (error) =>
      error instanceof OsmGeoImportError && /points/.test(error.message),
  );
});
