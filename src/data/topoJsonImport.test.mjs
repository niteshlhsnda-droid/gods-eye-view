import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TopoJsonImportError,
  parseTopoJsonText,
  topoJsonToGeoJson,
} from './topoJsonImport.js';

const throwsTopo = (fn, pattern) =>
  assert.throws(fn, (error) => {
    assert.ok(error instanceof TopoJsonImportError, error?.message);
    assert.match(error.message, pattern);
    return true;
  });

test('quantized arcs decode through the transform', () => {
  const topology = {
    type: 'Topology',
    transform: { scale: [0.1, 0.1], translate: [10, 20] },
    arcs: [
      [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
      [
        [10, 10],
        [-10, 0],
        [0, -10],
      ],
    ],
    objects: {
      square: { type: 'Polygon', arcs: [[0, 1]] },
    },
  };
  const out = topoJsonToGeoJson(topology);
  assert.equal(out.type, 'FeatureCollection');
  assert.equal(out.features.length, 1);
  assert.deepEqual(out.features[0].geometry, {
    type: 'Polygon',
    coordinates: [
      [
        [10, 20],
        [11, 20],
        [11, 21],
        [10, 21],
        [10, 20],
      ],
    ],
  });
  assert.equal(out.features[0].properties.name, 'square');
});

test('shared arcs decode once per reference and reverse on negative indices', () => {
  const topology = {
    type: 'Topology',
    arcs: [
      [
        [0, 0],
        [10, 0],
      ],
      [
        [10, 0],
        [10, 10],
      ],
      [
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [10, 0],
        [20, 0],
        [20, 10],
        [10, 10],
      ],
    ],
    objects: {
      left: { type: 'Polygon', arcs: [[0, 1, 2]] },
      right: { type: 'Polygon', arcs: [[3, 2, 0]] },
      edge: { type: 'LineString', arcs: [-2] },
      edges: { type: 'MultiLineString', arcs: [[-2], [0]] },
    },
  };
  const out = topoJsonToGeoJson(topology);
  const byName = Object.fromEntries(
    out.features.map((feature) => [feature.properties.name, feature.geometry]),
  );
  assert.deepEqual(byName.left.coordinates, [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ]);
  assert.deepEqual(byName.right.coordinates, [
    [
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [0, 10],
      [0, 0],
      [10, 0],
    ],
  ]);
  assert.deepEqual(byName.edge.coordinates, [
    [10, 10],
    [10, 0],
  ]);
  assert.deepEqual(byName.edges.coordinates, [
    [
      [10, 10],
      [10, 0],
    ],
    [
      [0, 0],
      [10, 0],
    ],
  ]);
});

test('Point coordinates are absolute, never delta-accumulated', () => {
  const topology = {
    type: 'Topology',
    transform: { scale: [2, 3], translate: [10, 20] },
    arcs: [],
    objects: {
      one: { type: 'Point', coordinates: [1, 2] },
      many: {
        type: 'MultiPoint',
        coordinates: [
          [0, 0],
          [0, 0],
          [1, 1],
        ],
      },
    },
  };
  const out = topoJsonToGeoJson(topology);
  assert.deepEqual(out.features[0].geometry, {
    type: 'Point',
    coordinates: [12, 26],
  });
  assert.deepEqual(out.features[1].geometry, {
    type: 'MultiPoint',
    coordinates: [
      [10, 20],
      [10, 20],
      [12, 23],
    ],
  });
});

test('MultiPolygon, GeometryCollection, null geometry and names', () => {
  const topology = {
    type: 'Topology',
    arcs: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
    objects: {
      named: {
        type: 'Point',
        coordinates: [5, 5],
        properties: { name: 'Mine', extra: 1 },
      },
      unnamed: { type: 'Point', coordinates: [6, 6] },
      empty: null,
      multi: { type: 'MultiPolygon', arcs: [[[0]], [[0]]] },
      coll: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [7, 7] },
          null,
          {
            type: 'GeometryCollection',
            geometries: [{ type: 'Point', coordinates: [8, 8] }],
          },
        ],
      },
    },
  };
  const out = topoJsonToGeoJson(topology);
  const byName = Object.fromEntries(
    out.features.map((feature) => [feature.properties.name, feature]),
  );
  assert.equal(byName.Mine.properties.extra, 1);
  assert.equal(byName.unnamed.geometry.coordinates[0], 6);
  assert.equal(byName.empty.geometry, null);
  assert.deepEqual(byName.multi.geometry.coordinates, [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  ]);
  assert.deepEqual(byName.coll.geometry, {
    type: 'GeometryCollection',
    geometries: [
      { type: 'Point', coordinates: [7, 7] },
      {
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [8, 8] }],
      },
    ],
  });
});

test('a BOM-prefixed TopoJSON text parses', () => {
  const out = parseTopoJsonText(
    '\uFEFF{"type":"Topology","arcs":[],"objects":{"p":{"type":"Point","coordinates":[1,2]}}}',
  );
  assert.equal(out.features[0].geometry.coordinates[0], 1);
});

test('non-TopoJSON input is refused with a TopoJSON reason', () => {
  throwsTopo(() => parseTopoJsonText('not json'), /not valid JSON/);
  throwsTopo(
    () => parseTopoJsonText('{"type":"FeatureCollection","features":[]}'),
    /not TopoJSON/,
  );
  throwsTopo(
    () => topoJsonToGeoJson({ type: 'Topology', objects: {} }),
    /no arcs list/,
  );
  throwsTopo(
    () => topoJsonToGeoJson({ type: 'Topology', arcs: [] }),
    /no objects/,
  );
  throwsTopo(
    () => topoJsonToGeoJson({ type: 'Topology', arcs: [], objects: {} }),
    /no objects/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson({
        type: 'Topology',
        arcs: [],
        objects: { p: { type: 'Point', coordinates: [1, 2] } },
        transform: { scale: [1] },
      }),
    /invalid transform/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson({
        type: 'Topology',
        arcs: [],
        objects: { c: { type: 'Circle', coordinates: [1, 2] } },
      }),
    /unsupported geometry/,
  );
});

test('malformed arcs and rings are refused, not repaired', () => {
  const base = (arcs, objects) => ({ type: 'Topology', arcs, objects });
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        base(
          [
            [
              [0, 0],
              [1, 1],
            ],
          ],
          { l: { type: 'LineString', arcs: [5] } },
        ),
      ),
    /arc that does not exist/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        base(
          [
            [
              [0, 0],
              [1, 1],
            ],
          ],
          { l: { type: 'LineString', arcs: [1.5] } },
        ),
      ),
    /not an integer/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        base([[[0, 0]]], { l: { type: 'LineString', arcs: [0] } }),
      ),
    /fewer than two points/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        base(
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
          ],
          { p: { type: 'Polygon', arcs: [[0]] } },
        ),
      ),
    /does not close/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        base(
          [
            [
              [0, 0],
              [1, 0],
              [0, 0],
            ],
          ],
          { p: { type: 'Polygon', arcs: [[0]] } },
        ),
      ),
    /fewer than four points/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        base(
          [
            [
              [0, 0],
              [1, 1],
            ],
          ],
          { p: { type: 'Polygon', arcs: [] } },
        ),
      ),
    /no rings/,
  );
});

test('invalid coordinates are refused, including 3D positions', () => {
  const base = (arcs, objects) => ({ type: 'Topology', arcs, objects });
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        base(
          [
            [
              [0, 0],
              [200, 0],
            ],
          ],
          { l: { type: 'LineString', arcs: [0] } },
        ),
      ),
    /invalid coordinates/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        base(
          [
            [
              [0, 0, 0],
              [1, 1, 1],
            ],
          ],
          { l: { type: 'LineString', arcs: [0] } },
        ),
      ),
    /invalid coordinates/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson({
        type: 'Topology',
        arcs: [],
        objects: { p: { type: 'Point', coordinates: [0, 100] } },
      }),
    /invalid coordinates/,
  );
});

test('caps refuse amplification and excess features', () => {
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        {
          type: 'Topology',
          arcs: [
            [
              [0, 0],
              [1, 1],
            ],
          ],
          objects: { l: { type: 'LineString', arcs: [0, 0, 0, 0, 0] } },
        },
        { maxPositions: 4 },
      ),
    /more than 4 points/,
  );
  throwsTopo(
    () =>
      topoJsonToGeoJson(
        {
          type: 'Topology',
          arcs: [],
          objects: {
            a: { type: 'Point', coordinates: [0, 0] },
            b: { type: 'Point', coordinates: [1, 1] },
          },
        },
        { maxFeatures: 1 },
      ),
    /more than 1 features/,
  );
});

test('deeply nested GeometryCollections are refused', () => {
  let inner = { type: 'Point', coordinates: [0, 0] };
  for (let i = 0; i < 40; i++)
    inner = { type: 'GeometryCollection', geometries: [inner] };
  throwsTopo(
    () =>
      topoJsonToGeoJson({
        type: 'Topology',
        arcs: [],
        objects: { deep: inner },
      }),
    /nested too deeply/,
  );
});
