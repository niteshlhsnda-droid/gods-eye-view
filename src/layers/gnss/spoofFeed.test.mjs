import assert from 'node:assert/strict';
import test from 'node:test';
import { createGnssIntegrityLayer } from './index.js';
import {
  SPOOF_FEED_MAX_CLUSTER_AIRCRAFT,
  createSpoofFeedTracker,
} from './spoofFeed.js';

const T0 = 1_000_000;
const row = (overrides = {}) => ({
  hex: 'abc123',
  lat: 50,
  lon: 30,
  gpsLost: false,
  seenPosS: 1,
  degraded: false,
  ...overrides,
});

test('a cluster of five aircraft within 3 km reports once', () => {
  const tracker = createSpoofFeedTracker();
  const rows = [0, 1, 2, 3, 4].map((i) =>
    row({ hex: `ac${i}`, lat: 50 + i * 0.001, lon: 30 }),
  );
  const summary = tracker.analyze(rows, {
    observedAt: T0,
    nowMs: T0,
  });
  assert.equal(summary.clusters.length, 1);
  assert.equal(summary.clusters[0].count, 5);
  assert.equal(summary.clusters[0].signal, 'spoof-cluster');
  assert.equal(
    summary.clusters[0].interpretation,
    'suspected-gnss-spoofing',
  );
  assert.equal(summary.clusterSkipped, null);
});

test('four aircraft in one spot are not a cluster', () => {
  const tracker = createSpoofFeedTracker();
  const rows = [0, 1, 2, 3].map((i) =>
    row({ hex: `ac${i}`, lat: 50, lon: 30 }),
  );
  const summary = tracker.analyze(rows, {
    observedAt: T0,
    nowMs: T0,
  });
  assert.deepEqual(summary.clusters, []);
});

test('a 200 km jump between successive fixes is a teleport; a small move is not', () => {
  const tracker = createSpoofFeedTracker();
  tracker.analyze([row()], { observedAt: T0, nowMs: T0 });
  const jumped = tracker.analyze([row({ lat: 52 })], {
    observedAt: T0 + 60_000,
    nowMs: T0 + 60_000,
  });
  assert.equal(jumped.teleport.length, 1);
  assert.equal(jumped.teleport[0].hex, 'abc123');
  assert.equal(jumped.teleport[0].signal, 'teleport');
  assert.equal(jumped.teleportJudged, 1);

  const tracker2 = createSpoofFeedTracker();
  tracker2.analyze([row()], { observedAt: T0, nowMs: T0 });
  const moved = tracker2.analyze([row({ lat: 50.01 })], {
    observedAt: T0 + 60_000,
    nowMs: T0 + 60_000,
  });
  assert.deepEqual(moved.teleport, []);
  assert.equal(moved.teleportJudged, 1);
});

test('a fix older than 30 s at snapshot time is stale; a fresh fix is not', () => {
  const tracker = createSpoofFeedTracker();
  const stale = tracker.analyze([row({ seenPosS: 45 })], {
    observedAt: T0,
    nowMs: T0,
  });
  assert.equal(stale.stale.length, 1);
  assert.equal(stale.stale[0].hex, 'abc123');
  assert.equal(stale.stale[0].signal, 'stale-position');
  assert.equal(stale.staleJudged, 1);

  const tracker2 = createSpoofFeedTracker();
  const fresh = tracker2.analyze([row({ seenPosS: 10 })], {
    observedAt: T0,
    nowMs: T0,
  });
  assert.deepEqual(fresh.stale, []);
});

test('stale is judged in the observation frame, not at analysis time', () => {
  // A replay analysed 120 s after it was observed still judges each fix
  // by its age when observed (5 s), so it does not report every row stale.
  const tracker = createSpoofFeedTracker();
  const summary = tracker.analyze([row({ seenPosS: 5 })], {
    observedAt: T0,
    nowMs: T0 + 120_000,
  });
  assert.deepEqual(summary.stale, []);
});

test('GPS-lost rows are not judged for teleport or stale but count in clusters', () => {
  const tracker = createSpoofFeedTracker();
  tracker.analyze([row()], { observedAt: T0, nowMs: T0 });
  const rows = [
    row({ gpsLost: true, seenPosS: null, lat: 52 }),
    ...[0, 1, 2, 3, 4].map((i) =>
      row({ hex: `lost${i}`, gpsLost: true, seenPosS: null }),
    ),
  ];
  const summary = tracker.analyze(rows, {
    observedAt: T0 + 60_000,
    nowMs: T0 + 60_000,
  });
  assert.deepEqual(summary.teleport, []);
  assert.deepEqual(summary.stale, []);
  assert.equal(summary.clusters.length, 1);
  assert.equal(summary.clusters[0].count, 5);
});

test('beyond the teleport gap a step is unobserved flight, not a jump', () => {
  const tracker = createSpoofFeedTracker();
  tracker.analyze([row()], { observedAt: T0, nowMs: T0 });
  const summary = tracker.analyze([row({ lat: 52 })], {
    observedAt: T0 + 10 * 60_000,
    nowMs: T0 + 10 * 60_000,
  });
  assert.deepEqual(summary.teleport, []);
  assert.equal(summary.teleportJudged, 0);
});

test('an out-of-order replay is not judged and never overwrites the newer fix', () => {
  const tracker = createSpoofFeedTracker();
  tracker.analyze([row()], { observedAt: T0, nowMs: T0 });
  const replay = tracker.analyze([row({ lat: 52 })], {
    observedAt: T0 - 60_000,
    nowMs: T0 + 1000,
  });
  assert.deepEqual(replay.teleport, []);
  // The newer fix still stands: a later 200 km jump from it is a teleport.
  const jumped = tracker.analyze([row({ lat: 52 })], {
    observedAt: T0 + 60_000,
    nowMs: T0 + 60_000,
  });
  assert.equal(jumped.teleport.length, 1);
});

test('the O(n^2) cluster cap skips clusters but still judges teleport and stale', () => {
  const tracker = createSpoofFeedTracker({ maxClusterAircraft: 3 });
  const rows = [
    row({ hex: 'stale1', seenPosS: 45 }),
    row({ hex: 'c1', lat: 50, lon: 30 }),
    row({ hex: 'c2', lat: 50, lon: 30 }),
    row({ hex: 'c3', lat: 50, lon: 30 }),
    row({ hex: 'c4', lat: 50, lon: 30 }),
  ];
  const summary = tracker.analyze(rows, {
    observedAt: T0,
    nowMs: T0,
  });
  assert.equal(summary.clusterSkipped, 'snapshot-too-large');
  assert.deepEqual(summary.clusters, []);
  assert.equal(summary.stale.length, 1);
  assert.equal(
    SPOOF_FEED_MAX_CLUSTER_AIRCRAFT,
    1000,
    'the default cap stays documented and explicit',
  );
});

test('absent aircraft lose their previous fix after the TTL', () => {
  const tracker = createSpoofFeedTracker({
    prevFixTtlMs: 1000,
    maxTeleportGapMs: 60 * 60_000,
  });
  tracker.analyze([row()], { observedAt: T0, nowMs: T0 });
  // One empty snapshot past the TTL prunes the stored fix…
  tracker.analyze([], { observedAt: T0 + 2000, nowMs: T0 + 2000 });
  // …so the reappearance is a first sighting, not a teleport.
  const summary = tracker.analyze([row({ lat: 52 })], {
    observedAt: T0 + 3000,
    nowMs: T0 + 3000,
  });
  assert.deepEqual(summary.teleport, []);
  assert.equal(summary.teleportJudged, 0);
});

test('a late-analysed replay keeps its fixes for the next snapshot', () => {
  const tracker = createSpoofFeedTracker();
  // A replay observed at T0 but analysed 11 min later: pruning runs in
  // the observation frame, so the fix it just stored (TTL 10 min)
  // survives for the next snapshot's teleport judgement.
  tracker.analyze([row()], { observedAt: T0, nowMs: T0 + 11 * 60_000 });
  const jumped = tracker.analyze([row({ lat: 52 })], {
    observedAt: T0 + 60_000,
    nowMs: T0 + 12 * 60_000,
  });
  assert.equal(jumped.teleport.length, 1);
  assert.equal(jumped.teleportJudged, 1);
});

test('the retained-fix bound evicts the least-recently-updated aircraft', () => {
  const tracker = createSpoofFeedTracker({
    maxPrevFixes: 2,
    maxTeleportGapMs: 60 * 60_000,
    prevFixTtlMs: 60 * 60_000,
  });
  tracker.analyze([row({ hex: 'a' }), row({ hex: 'b' })], {
    observedAt: T0,
    nowMs: T0,
  });
  // `a` updates, so it is the most recent; `c` arriving next evicts `b`.
  tracker.analyze([row({ hex: 'a' })], {
    observedAt: T0 + 60_000,
    nowMs: T0 + 60_000,
  });
  tracker.analyze([row({ hex: 'c', lat: 51 })], {
    observedAt: T0 + 120_000,
    nowMs: T0 + 120_000,
  });
  const jumped = tracker.analyze([row({ hex: 'a', lat: 52 })], {
    observedAt: T0 + 180_000,
    nowMs: T0 + 180_000,
  });
  assert.equal(jumped.teleport.length, 1);
});

test('rows without an identity still get a stale verdict; malformed rows are skipped', () => {
  const tracker = createSpoofFeedTracker();
  const summary = tracker.analyze(
    [
      row({ hex: undefined, seenPosS: 45 }),
      null,
      row({ hex: 'bad', lat: Number.NaN }),
      row({ hex: 'bad2', lat: 95 }),
    ],
    { observedAt: T0, nowMs: T0 },
  );
  assert.equal(summary.stale.length, 1);
  assert.equal(summary.stale[0].hex, null);
  assert.equal(summary.aircraft, 4);
});

test('legacy rows without seenPosS are dated by the snapshot', () => {
  const tracker = createSpoofFeedTracker();
  const { seenPosS: _dropped, ...legacy } = row();
  tracker.analyze([legacy], { observedAt: T0, nowMs: T0 });
  const summary = tracker.analyze([{ ...legacy, lat: 52 }], {
    observedAt: T0 + 60_000,
    nowMs: T0 + 60_000,
  });
  assert.equal(summary.teleport.length, 1);
  assert.deepEqual(summary.stale, []);
});

test('a disabled tracker analyses nothing', () => {
  const tracker = createSpoofFeedTracker({ enabled: false });
  const summary = tracker.analyze(
    [row({ seenPosS: 45 }), row({ hex: 'x', seenPosS: 45 })],
    { observedAt: T0, nowMs: T0 },
  );
  assert.equal(summary.enabled, false);
  assert.deepEqual(summary.teleport, []);
  assert.deepEqual(summary.stale, []);
  assert.deepEqual(summary.clusters, []);
});

test('reset forgets previous fixes and restores the empty summary', () => {
  const tracker = createSpoofFeedTracker();
  tracker.analyze([row()], { observedAt: T0, nowMs: T0 });
  tracker.reset();
  assert.equal(tracker.summary().analyzedAt, null);
  const summary = tracker.analyze([row({ lat: 52 })], {
    observedAt: T0 + 60_000,
    nowMs: T0 + 60_000,
  });
  assert.deepEqual(summary.teleport, []);
});

test('non-array rows and non-finite times are refused', () => {
  const tracker = createSpoofFeedTracker();
  assert.throws(() => tracker.analyze(null, { observedAt: T0, nowMs: T0 }), {
    name: 'TypeError',
  });
  assert.throws(
    () => tracker.analyze([], { observedAt: Number.NaN, nowMs: T0 }),
    { name: 'TypeError' },
  );
});

function layerHarness({ spoofSignals } = {}) {
  const viewer = {
    camera: {
      moveEnd: { addEventListener: () => () => {} },
      changed: { addEventListener: () => () => {} },
    },
    scene: {
      groundPrimitives: { add: () => {}, remove: () => {} },
      requestRender: () => {},
    },
  };
  let clock = T0;
  let snapshot = { rows: [], ageMs: 0 };
  const layer = createGnssIntegrityLayer({
    source: {
      async getSnapshot() {
        return { ageMs: 0, ...snapshot };
      },
    },
    viewAnchor: () => ({ latitude: 50, longitude: 30 }),
    now: () => clock,
    monotonicNow: () => clock,
    ...(spoofSignals === undefined ? {} : { spoofSignals }),
  });
  layer.init(viewer);
  layer.enable();
  return {
    layer,
    setSnapshot(value) {
      snapshot = value;
      return snapshot;
    },
    advance(ms) {
      clock += ms;
    },
    async update() {
      await layer.update(undefined, {});
    },
    destroy() {
      layer.destroy();
    },
  };
}

test('the layer surfaces spoof findings in getStats without changing cells', async () => {
  const h = layerHarness();
  try {
    h.setSnapshot({
      rows: [
        row(),
        row({ hex: 'd1', lat: 50.01 }),
        row({ hex: 'd2', lat: 50.02 }),
      ],
    });
    await h.update();
    assert.deepEqual(h.layer.getStats().spoofSignals.teleport, []);
    h.advance(60_000);
    h.setSnapshot({
      rows: [
        row({ lat: 52 }),
        row({ hex: 'stale1', lat: 50.03, seenPosS: 45 }),
      ],
    });
    await h.update();
    const stats = h.layer.getStats();
    assert.equal(stats.spoofSignals.teleport.length, 1);
    assert.equal(stats.spoofSignals.teleport[0].hex, 'abc123');
    assert.equal(stats.spoofSignals.stale.length, 1);
    assert.equal(stats.spoofSignals.stale[0].hex, 'stale1');
    // Findings are stats-only: the teleported aircraft's old cell still
    // bins from its earlier observation, and no cell is moved or re-levelled.
    assert.equal(stats.count, 1);
  } finally {
    h.destroy();
  }
});

test('the layer reports a cluster in getStats', async () => {
  const h = layerHarness();
  try {
    h.setSnapshot({
      rows: [0, 1, 2, 3, 4].map((i) =>
        row({ hex: `ac${i}`, lat: 50 + i * 0.001, lon: 30 }),
      ),
    });
    await h.update();
    const { spoofSignals } = h.layer.getStats();
    assert.equal(spoofSignals.clusters.length, 1);
    assert.equal(spoofSignals.clusters[0].count, 5);
  } finally {
    h.destroy();
  }
});

test('spoofSignals:false disables the feed wiring at the layer', async () => {
  const h = layerHarness({ spoofSignals: false });
  try {
    h.setSnapshot({ rows: [row({ seenPosS: 45 })] });
    await h.update();
    assert.equal(h.layer.getStats().spoofSignals.enabled, false);
    assert.deepEqual(h.layer.getStats().spoofSignals.stale, []);
  } finally {
    h.destroy();
  }
});
