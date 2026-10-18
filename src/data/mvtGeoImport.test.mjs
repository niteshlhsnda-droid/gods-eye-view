import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMvtTileCoords,
  isMvtBytes,
  MAX_MVT_BYTES,
  MAX_MVT_FEATURES,
  MAX_MVT_POSITIONS,
  parseMvtTileToGeoJson,
} from './mvtGeoImport.js';

// Minimal MVT encoder for test fixtures: builds the same bytes a tile
// server (Tippecanoe, pg_tileserv, Martin) would emit, per the Mapbox
// Vector Tile Specification v2.1.

function writeVarint(out, value) {
  let x = BigInt(value);
  if (x < 0n) x += 1n << 64n;
  while (x >= 0x80n) {
    out.push(Number(x & 0x7fn) | 0x80);
    x >>= 7n;
  }
  out.push(Number(x));
}

function pushAll(out, values) {
  for (let i = 0; i < values.length; i++) out.push(values[i]);
}

function fieldBytes(fieldNo, wire, payload) {
  const out = [];
  writeVarint(out, (fieldNo << 3) | wire);
  if (wire === 0) {
    writeVarint(out, payload);
  } else if (wire === 2) {
    writeVarint(out, payload.length);
    pushAll(out, payload);
  } else if (wire === 5) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, payload, true);
    pushAll(out, new Uint8Array(buf));
  } else if (wire === 1) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, payload, true);
    pushAll(out, new Uint8Array(buf));
  }
  return out;
}

const utf8 = (s) => [...new TextEncoder().encode(s)];

function zigzag(n) {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

// Geometry command words from absolute tile-space points. `ops` is a
// list of ['move'|'line'|'close', ...points].
function encodeGeometry(ops) {
  const out = [];
  let cx = 0;
  let cy = 0;
  for (const [op, ...pts] of ops) {
    if (op === 'close') {
      out.push((1 << 3) | 7);
      continue;
    }
    const id = op === 'move' ? 1 : 2;
    out.push((pts.length << 3) | id);
    for (const [x, y] of pts) {
      out.push(zigzag(x - cx), zigzag(y - cy));
      cx = x;
      cy = y;
    }
  }
  const packed = [];
  for (const w of out) writeVarint(packed, w);
  return packed;
}

function encodeValue(kind, value) {
  // kind: 'string' | 'float' | 'double' | 'int' | 'uint' | 'sint' | 'bool'
  if (kind === 'string') return fieldBytes(1, 2, utf8(value));
  if (kind === 'float') return fieldBytes(2, 5, value);
  if (kind === 'double') return fieldBytes(3, 1, value);
  if (kind === 'int') return fieldBytes(4, 0, value);
  if (kind === 'uint') return fieldBytes(5, 0, value);
  if (kind === 'sint')
    return fieldBytes(6, 0, value >= 0 ? value * 2 : -value * 2 - 1);
  if (kind === 'bool') return fieldBytes(7, 0, value ? 1 : 0);
  throw new Error(`bad value kind ${kind}`);
}

function encodeFeature({ id, tags = [], type, geometry }) {
  const out = [];
  if (id !== undefined) pushAll(out, fieldBytes(1, 0, id));
  if (tags.length) {
    const packed = [];
    for (const t of tags) writeVarint(packed, t);
    pushAll(out, fieldBytes(2, 2, packed));
  }
  pushAll(out, fieldBytes(3, 0, type));
  pushAll(out, fieldBytes(4, 2, geometry));
  return out;
}

function encodeLayer({
  name = 'test',
  version = 2,
  extent = 4096,
  keys = [],
  values = [],
  features = [],
}) {
  const out = [];
  pushAll(out, fieldBytes(15, 0, version));
  pushAll(out, fieldBytes(1, 2, utf8(name)));
  for (const f of features) pushAll(out, fieldBytes(2, 2, f));
  for (const k of keys) pushAll(out, fieldBytes(3, 2, utf8(k)));
  for (const v of values) pushAll(out, fieldBytes(4, 2, v));
  pushAll(out, fieldBytes(5, 0, extent));
  return out;
}

function encodeTile(layers) {
  const out = [];
  for (const l of layers) pushAll(out, fieldBytes(3, 2, l));
  return Uint8Array.from(out);
}

const tileOpts = { z: 0, x: 0, y: 0 };

// A square drawn clockwise in tile space (y down): (0,0) -> (10,0) ->
// (10,10) -> (0,10). Positive shoelace area => exterior ring per spec.
const squareOps = [
  ['move', [100, 100]],
  ['line', [200, 100], [200, 200], [100, 200]],
  ['close'],
];

test('point feature decodes to WGS 84 lon/lat', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({
          type: 1,
          geometry: encodeGeometry([['move', [2048, 2048]]]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.features.length, 1);
  // z0 tile centre is lon 0 / lat 0.
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Point',
    coordinates: [0, 0],
  });
});

test('tile corner maps to the Web Mercator edge', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({
          type: 1,
          geometry: encodeGeometry([['move', [0, 0]]]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  assert.deepEqual(fc.features[0].geometry.coordinates, [-180, 85.0511288]);
});

test('multiple MoveTo on a point feature becomes a MultiPoint', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({
          type: 1,
          geometry: encodeGeometry([['move', [0, 0], [4096, 4096]]]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  assert.equal(fc.features[0].geometry.type, 'MultiPoint');
  assert.equal(fc.features[0].geometry.coordinates.length, 2);
});

test('linestring decodes, and two parts become a MultiLineString', () => {
  const line = (x0) => [
    ['move', [x0, 100]],
    ['line', [x0 + 50, 100], [x0 + 50, 150]],
  ];
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({ type: 2, geometry: encodeGeometry(line(100)) }),
        encodeFeature({
          type: 2,
          geometry: encodeGeometry([...line(100), ...line(300)]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  assert.equal(fc.features[0].geometry.type, 'LineString');
  assert.equal(fc.features[0].geometry.coordinates.length, 3);
  assert.equal(fc.features[1].geometry.type, 'MultiLineString');
  assert.equal(fc.features[1].geometry.coordinates.length, 2);
});

test('polygon ring is explicitly closed; tile winding is preserved', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({ type: 3, geometry: encodeGeometry(squareOps) }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  const ring = fc.features[0].geometry.coordinates[0];
  assert.equal(fc.features[0].geometry.type, 'Polygon');
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  // The square is clockwise in tile space (y down); the tile-to-lon/lat
  // map keeps the visual layout, so the exterior stays clockwise.
  // Winding is preserved, not rewritten to the RFC 7946 right-hand rule.
  let area = 0;
  for (let i = 0; i + 1 < ring.length; i++)
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  assert.ok(area < 0);
});

test('hole attaches to its exterior; two exteriors become MultiPolygon', () => {
  const hole = [
    ['move', [120, 120]],
    ['line', [120, 180], [180, 180], [180, 120]],
    ['close'],
  ]; // counter-clockwise in tile space => hole
  const other = [
    ['move', [1000, 1000]],
    ['line', [1100, 1000], [1100, 1100], [1000, 1100]],
    ['close'],
  ];
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({
          type: 3,
          geometry: encodeGeometry([...squareOps, ...hole]),
        }),
        encodeFeature({
          type: 3,
          geometry: encodeGeometry([...squareOps, ...other]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  assert.equal(fc.features[0].geometry.type, 'Polygon');
  assert.equal(fc.features[0].geometry.coordinates.length, 2);
  assert.equal(fc.features[1].geometry.type, 'MultiPolygon');
  assert.equal(fc.features[1].geometry.coordinates.length, 2);
});

test('tags decode to properties and the feature id is kept', () => {
  const tile = encodeTile([
    encodeLayer({
      keys: ['name', 'height', 'open', 'code'],
      values: [
        encodeValue('string', 'hall'),
        encodeValue('double', 12.5),
        encodeValue('bool', true),
        encodeValue('int', 7),
      ],
      features: [
        encodeFeature({
          id: 42,
          tags: [0, 0, 1, 1, 2, 2, 3, 3],
          type: 1,
          geometry: encodeGeometry([['move', [2048, 2048]]]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  const f = fc.features[0];
  assert.equal(f.id, 42);
  assert.deepEqual(f.properties, {
    name: 'hall',
    height: 12.5,
    open: true,
    code: 7,
  });
});

test('int64 beyond 2^53 - 1 becomes a string, not a rounded number', () => {
  const big = 2n ** 63n - 1n;
  const tile = encodeTile([
    encodeLayer({
      keys: ['uid'],
      values: [encodeValue('int', big)],
      features: [
        encodeFeature({
          tags: [0, 0],
          type: 1,
          geometry: encodeGeometry([['move', [1, 1]]]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  assert.equal(fc.features[0].properties.uid, '9223372036854775807');
});

test('layer option selects one layer; default merges all layers', () => {
  const mk = (name) =>
    encodeLayer({
      name,
      features: [
        encodeFeature({
          type: 1,
          geometry: encodeGeometry([['move', [1, 1]]]),
        }),
      ],
    });
  const tile = encodeTile([mk('roads'), mk('water')]);
  const all = parseMvtTileToGeoJson(tile, tileOpts);
  assert.equal(all.features.length, 2);
  const roads = parseMvtTileToGeoJson(tile, { ...tileOpts, layer: 'roads' });
  assert.equal(roads.features.length, 1);
  const missing = parseMvtTileToGeoJson(tile, { ...tileOpts, layer: 'nope' });
  assert.equal(missing.features.length, 0);
  assert.equal(missing.type, 'FeatureCollection');
});

test('UNKNOWN-typed features are skipped, empty geometry becomes null', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({ type: 0, geometry: encodeGeometry([]) }),
        encodeFeature({ type: 1, geometry: encodeGeometry([]) }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].geometry, null);
});

test('degenerate zero-area ring is dropped, leaving a null geometry', () => {
  const flat = [['move', [50, 50]], ['line', [60, 50], [70, 50]], ['close']];
  const tile = encodeTile([
    encodeLayer({
      features: [encodeFeature({ type: 3, geometry: encodeGeometry(flat) })],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].geometry, null);
});

test('explicit tile coords win over the file name', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({
          type: 1,
          geometry: encodeGeometry([['move', [0, 0]]]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, {
    z: 1,
    x: 1,
    y: 1,
    name: '0/0/0.mvt',
  });
  // z1 x1 y1 tile origin is lon 0 / lat 0.
  assert.deepEqual(fc.features[0].geometry.coordinates, [0, 0]);
});

test('buffer overhang past the world edge is clamped', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({
          type: 1,
          geometry: encodeGeometry([['move', [-500, 2048]]]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, tileOpts);
  const [lon] = fc.features[0].geometry.coordinates;
  assert.equal(lon, -180);
});

test('detectMvtTileCoords sniffs z/x/y from tile-style names', () => {
  assert.deepEqual(detectMvtTileCoords('14/8801/5371.mvt'), {
    z: 14,
    x: 8801,
    y: 5371,
  });
  assert.deepEqual(
    detectMvtTileCoords('https://tiles.example.com/14/8801/5371.pbf'),
    { z: 14, x: 8801, y: 5371 },
  );
  assert.deepEqual(detectMvtTileCoords('14-8801-5371.mvt'), {
    z: 14,
    x: 8801,
    y: 5371,
  });
  assert.equal(detectMvtTileCoords('14/8801/5371.geojson'), null);
  assert.equal(detectMvtTileCoords('14/8801/99999.mvt'), null);
  assert.equal(detectMvtTileCoords('no-coords-here.mvt'), null);
  assert.equal(detectMvtTileCoords(''), null);
});

test('tile coords may come from the file name', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({
          type: 1,
          geometry: encodeGeometry([['move', [0, 0]]]),
        }),
      ],
    }),
  ]);
  const fc = parseMvtTileToGeoJson(tile, { name: 'tiles/0/0/0.mvt' });
  assert.deepEqual(fc.features[0].geometry.coordinates, [-180, 85.0511288]);
});

test('isMvtBytes sniffs tiles and rejects everything else', () => {
  const tile = encodeTile([
    encodeLayer({
      features: [
        encodeFeature({
          type: 1,
          geometry: encodeGeometry([['move', [1, 1]]]),
        }),
      ],
    }),
  ]);
  assert.equal(isMvtBytes(tile), true);
  assert.equal(isMvtBytes(new Uint8Array(0)), false);
  assert.equal(
    isMvtBytes(Uint8Array.from(utf8('{"type":"FeatureCollection"}'))),
    false,
  );
  assert.equal(isMvtBytes(Uint8Array.from([8, 1, 16, 2])), false);
  assert.equal(isMvtBytes('not bytes'), false);
});

for (const [label, mutate] of [
  ['empty buffer', () => new Uint8Array(0)],
  ['non-Uint8Array input', () => 'bytes'],
  ['truncated varint', () => Uint8Array.from([0x1a, 0x80])],
  ['truncated field payload', () => Uint8Array.from([0x1a, 0x05, 0x01])],
  ['group wire type', () => Uint8Array.from([0x1b, 0x1c])],
  [
    'unknown command id',
    () => {
      const words = [];
      writeVarint(words, (1 << 3) | 3);
      const layer = encodeLayer({
        features: [encodeFeature({ type: 2, geometry: words })],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'LineTo before any MoveTo',
    () => {
      const layer = encodeLayer({
        features: [
          encodeFeature({
            type: 2,
            geometry: encodeGeometry([['line', [5, 5]]]),
          }),
        ],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'MoveTo while a polygon ring is open',
    () => {
      const layer = encodeLayer({
        features: [
          encodeFeature({
            type: 3,
            geometry: encodeGeometry([
              ['move', [1, 1]],
              ['line', [2, 2]],
              ['move', [3, 3]],
              ['line', [4, 4]],
              ['close'],
            ]),
          }),
        ],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'ClosePath with no open ring',
    () => {
      const layer = encodeLayer({
        features: [
          encodeFeature({ type: 3, geometry: encodeGeometry([['close']]) }),
        ],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'ring with fewer than 3 points',
    () => {
      const layer = encodeLayer({
        features: [
          encodeFeature({
            type: 3,
            geometry: encodeGeometry([
              ['move', [1, 1]],
              ['line', [2, 2]],
              ['close'],
            ]),
          }),
        ],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'hole before any exterior ring',
    () => {
      const ccw = [
        ['move', [120, 120]],
        ['line', [120, 180], [180, 180], [180, 120]],
        ['close'],
      ];
      const layer = encodeLayer({
        features: [encodeFeature({ type: 3, geometry: encodeGeometry(ccw) })],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'tag index past the keys table',
    () => {
      const layer = encodeLayer({
        keys: ['a'],
        values: [encodeValue('string', 'x')],
        features: [
          encodeFeature({
            tags: [9, 0],
            type: 1,
            geometry: encodeGeometry([['move', [1, 1]]]),
          }),
        ],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'odd tag count',
    () => {
      const layer = encodeLayer({
        keys: ['a'],
        values: [encodeValue('string', 'x')],
        features: [
          encodeFeature({
            tags: [0],
            type: 1,
            geometry: encodeGeometry([['move', [1, 1]]]),
          }),
        ],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'layer without a name',
    () => {
      const layer = encodeLayer({ name: '' });
      return encodeTile([layer]);
    },
  ],
  [
    'unsupported layer version',
    () => {
      const layer = encodeLayer({ version: 3 });
      return encodeTile([layer]);
    },
  ],
  [
    'geometry type 9',
    () => {
      const layer = encodeLayer({
        features: [
          encodeFeature({
            type: 9,
            geometry: encodeGeometry([['move', [1, 1]]]),
          }),
        ],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'command params run past the stream',
    () => {
      const words = [];
      writeVarint(words, (5 << 3) | 1);
      writeVarint(words, 2);
      const layer = encodeLayer({
        features: [encodeFeature({ type: 1, geometry: words })],
      });
      return encodeTile([layer]);
    },
  ],
  [
    'invalid tile coords in options',
    () => {
      const layer = encodeLayer({
        features: [
          encodeFeature({
            type: 1,
            geometry: encodeGeometry([['move', [1, 1]]]),
          }),
        ],
      });
      return { bytes: encodeTile([layer]), opts: { z: 2, x: 9, y: 0 } };
    },
  ],
  [
    'no tile coords and no sniffable name',
    () => {
      const layer = encodeLayer({
        features: [
          encodeFeature({
            type: 1,
            geometry: encodeGeometry([['move', [1, 1]]]),
          }),
        ],
      });
      return { bytes: encodeTile([layer]), opts: { name: 'roads.geojson' } };
    },
  ],
]) {
  test(`malformed input returns null, never throws: ${label}`, () => {
    const made = mutate();
    const bytes = made && made.bytes ? made.bytes : made;
    const opts = (made && made.opts) || tileOpts;
    assert.equal(parseMvtTileToGeoJson(bytes, opts), null);
  });
}

test('position budget refuses adversarial geometry', () => {
  const words = [];
  writeVarint(words, ((MAX_MVT_POSITIONS + 1) << 3) | 1);
  for (let k = 0; k <= MAX_MVT_POSITIONS; k++) {
    writeVarint(words, 2); // zigzag(1)
    writeVarint(words, 0); // zigzag(0)
  }
  const layer = encodeLayer({
    features: [encodeFeature({ type: 1, geometry: words })],
  });
  const tile = encodeTile([layer]);
  assert.equal(parseMvtTileToGeoJson(tile, tileOpts), null);
});

test('feature budget refuses adversarial feature counts', () => {
  const features = [];
  for (let k = 0; k <= MAX_MVT_FEATURES; k++) {
    features.push(
      encodeFeature({ type: 1, geometry: encodeGeometry([['move', [1, 1]]]) }),
    );
  }
  const tile = encodeTile([encodeLayer({ features })]);
  assert.equal(parseMvtTileToGeoJson(tile, tileOpts), null);
});

test('oversized buffers are refused without parsing', () => {
  const bytes = new Uint8Array(MAX_MVT_BYTES + 1);
  assert.equal(parseMvtTileToGeoJson(bytes, tileOpts), null);
  assert.equal(isMvtBytes(bytes), false);
});
