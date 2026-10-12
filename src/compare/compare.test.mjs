import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComparisonSpec,
  computeAreaDelta,
  comparisonHud,
  describeDelta,
  clampSplitPosition,
} from './compareModel.js';
import { createComparisonSession, syncCameras } from './compareView.js';

const square = (x0, y0, x1, y1) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

const stubTurf = {
  area(geojson) {
    const coords = geojson.coordinates[0];
    let sum = 0;
    for (let i = 0; i < coords.length - 1; i++)
      sum += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
    return Math.abs(sum / 2) * 1e6;
  },
  difference() {
    return null;
  },
};

test('createComparisonSpec defaults to split mode with a derived title', () => {
  const spec = createComparisonSpec({
    before: { label: 'Pre-flood', day: '2026-09-01' },
    after: { label: 'Post-flood', day: '2026-09-03' },
  });
  assert.equal(spec.mode, 'split');
  assert.equal(spec.title, 'Pre-flood vs Post-flood');
  assert.ok(spec.id.startsWith('cmp-'));
  assert.equal(spec.before.day, '2026-09-01');
});

test('createComparisonSpec rejects unknown modes and missing panes', () => {
  assert.throws(() => createComparisonSpec({ after: { label: 'b' } }), /before/);
  assert.throws(
    () =>
      createComparisonSpec({
        before: { label: 'a' },
        after: { label: 'b' },
        mode: 'grid',
      }),
    /unsupported compare mode/,
  );
});

test('computeAreaDelta reports flood-area delta in km²', () => {
  const delta = computeAreaDelta(stubTurf, square(0, 0, 1, 1), square(0, 0, 1, 2));
  assert.equal(delta.beforeKm2, 1);
  assert.equal(delta.afterKm2, 2);
  assert.equal(delta.deltaKm2, 1);
  assert.equal(delta.pctChange, 100);
  assert.equal(delta.addedKm2, 0);
});

test('computeAreaDelta returns nulls when turf or geometry is missing', () => {
  assert.deepEqual(computeAreaDelta(null, square(0, 0, 1, 1), square(0, 0, 1, 2)).deltaKm2, null);
  assert.deepEqual(computeAreaDelta(stubTurf, null, square(0, 0, 1, 2)).deltaKm2, null);
  assert.deepEqual(computeAreaDelta(stubTurf, { type: 'Point' }, { type: 'Point' }).deltaKm2, null);
});

test('describeDelta renders a human-readable delta line', () => {
  const text = describeDelta({ deltaKm2: 12.4, pctChange: 38.2 });
  assert.match(text, /\+12\.4 km²/);
  assert.match(text, /\+38%/);
  assert.equal(describeDelta({ deltaKm2: null }), 'No comparable geometry');
});

test('clampSplitPosition bounds the divider', () => {
  assert.equal(clampSplitPosition(0.3), 0.3);
  assert.equal(clampSplitPosition(-1), 0);
  assert.equal(clampSplitPosition(2), 1);
  assert.equal(clampSplitPosition('x'), 0.5);
});

test('comparisonHud bundles labels and delta text', () => {
  const spec = createComparisonSpec({
    before: { label: 'Before' },
    after: { label: 'After' },
  });
  const hud = comparisonHud(spec, computeAreaDelta(stubTurf, square(0, 0, 1, 1), square(0, 0, 1, 2)));
  assert.equal(hud.before.label, 'Before');
  assert.match(hud.deltaText, /km²/);
});

test('createComparisonSession split mode pins left/right layers and cleans up', async () => {
  const added = [];
  const Cesium = { SplitDirection: { LEFT: 1, RIGHT: 2, NONE: 0 } };
  const viewer = {
    scene: {},
    imageryLayers: {
      add: (layer) => added.push(layer),
      remove: (layer) => {
        const i = added.indexOf(layer);
        if (i >= 0) added.splice(i, 1);
      },
    },
  };
  const splits = [];
  const spec = createComparisonSpec({
    before: { label: 'Pre', product: 'VIIRS', day: '2026-09-01' },
    after: { label: 'Post', product: 'VIIRS', day: '2026-09-03' },
  });
  const session = await createComparisonSession({
    spec,
    Cesium,
    viewer,
    layerFactory: async ({ product, day }) => ({ product, day }),
    createSplit: (options) => {
      splits.push(options);
      return { destroy: () => {} };
    },
    turf: stubTurf,
  });
  assert.equal(added.length, 2);
  assert.equal(added[0].splitDirection, 1);
  assert.equal(added[1].splitDirection, 2);
  assert.equal(splits[0].beforeLabel, 'Pre');
  const hud = session.hud();
  assert.ok(hud.title.includes('Pre vs Post'));
  await session.destroy();
  assert.equal(added.length, 0);
});

test('syncCameras mirrors pose and disposes cleanly', () => {
  const makeCamera = () => ({
    position: { clone: () => ({ x: 1, y: 2, z: 3 }) },
    heading: 1,
    pitch: 2,
    roll: 3,
    changed: {
      listeners: [],
      addEventListener(fn) {
        this.listeners.push(fn);
        return fn;
      },
      removeEventListener(fn) {
        this.listeners = this.listeners.filter((l) => l !== fn);
      },
      fire() {
        for (const fn of this.listeners) fn();
      },
    },
  });
  const a = { camera: makeCamera(), scene: {} };
  const b = { camera: makeCamera(), scene: {} };
  b.camera.heading = 9;
  const dispose = syncCameras(a, b);
  a.camera.changed.fire();
  assert.equal(b.camera.heading, 1);
  dispose();
  assert.equal(a.camera.changed.listeners.length, 0);
  assert.equal(b.camera.changed.listeners.length, 0);
});
