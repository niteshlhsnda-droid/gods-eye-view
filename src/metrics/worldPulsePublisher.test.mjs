import test from 'node:test';
import assert from 'node:assert/strict';
import { layerFeedState } from '../data/feedState.js';
import {
  FEED_HEALTH_CONTRACT_VERSION,
  FEED_HEALTH_WINDOW_KEY,
  readFeedHealth,
} from './feedHealthContract.js';
import {
  FEED_HEALTH_PUBLISH_MS,
  layerStatsToFeedEntry,
  publishLayerFeedHealth,
  startFeedHealthPublishing,
} from './worldPulsePublisher.js';

test('layerStatsToFeedEntry reuses the app layer-state normalizer', () => {
  const entry = layerStatsToFeedEntry({
    id: 'flights',
    label: 'Flights (ADS-B)',
    stats: { status: 'ok', count: 42, lastUpdate: '2026-10-12T18:00:00.000Z' },
  });
  assert.equal(entry.id, 'flights');
  assert.equal(entry.state, 'nominal');
  assert.equal(entry.grade, 'A');
  assert.equal(entry.messageCount, 42);
});

test('layerStatsToFeedEntry surfaces degraded and unavailable layers', () => {
  const degraded = layerStatsToFeedEntry({
    id: 'vessels',
    stats: { error: 'timeout', count: 0 },
  });
  assert.equal(degraded.grade, 'F');
  assert.equal(degraded.state, 'unavailable');

  const stale = layerStatsToFeedEntry({
    id: 'quakes',
    stats: { stale: true, count: 10 },
  });
  assert.equal(stale.state, 'stale');
  assert.equal(stale.grade, 'C');
});

test('layerStatsToFeedEntry mirrors layerFeedState for every input', () => {
  const cases = [
    { id: 'x' },
    { id: 'y', stats: {} },
    { id: 'z', stats: { stale: true, count: 3 } },
    { id: 'w', stats: { loading: true } },
  ];
  for (const layer of cases) {
    const entry = layerStatsToFeedEntry(layer);
    assert.equal(
      entry.state,
      layerFeedState(layer.stats || {}),
      `entry state must match layerFeedState for ${layer.id}`,
    );
  }
  assert.equal(layerStatsToFeedEntry().id, 'unknown');
});

test('publishLayerFeedHealth publishes a contract snapshot to the host', () => {
  const host = {};
  const { snapshot, published } = publishLayerFeedHealth({
    getLayers: () => [
      {
        id: 'flights',
        label: 'Flights',
        stats: { status: 'ok', count: 5 },
      },
      { id: 'vessels', label: 'Vessels', stats: { stale: true, count: 2 } },
    ],
    host,
    storage: null,
  });
  assert.deepEqual(published, { onHost: true, inStorage: false });
  assert.equal(snapshot.version, FEED_HEALTH_CONTRACT_VERSION);
  assert.equal(snapshot.feeds.length, 2);
  // Worst grade wins across the snapshot.
  assert.equal(snapshot.overall.grade, 'C');
  assert.equal(host[FEED_HEALTH_WINDOW_KEY], snapshot);
  assert.equal(readFeedHealth({ host }).overall.grade, 'C');
});

test('publishLayerFeedHealth survives a throwing getLayers', () => {
  const host = {};
  const { snapshot } = publishLayerFeedHealth({
    getLayers: () => {
      throw new Error('boom');
    },
    host,
  });
  assert.equal(snapshot.feeds.length, 0);
  assert.equal(snapshot.overall.grade, 'F');
});

test('startFeedHealthPublishing publishes immediately and returns a stopper', () => {
  const host = {};
  let calls = 0;
  const stop = startFeedHealthPublishing({
    getLayers: () => {
      calls += 1;
      return [{ id: 'flights', stats: { status: 'ok' } }];
    },
    host,
    intervalMs: 60_000,
  });
  assert.equal(calls, 1);
  assert.ok(host[FEED_HEALTH_WINDOW_KEY]);
  assert.equal(typeof stop, 'function');
  stop();
  assert.ok(FEED_HEALTH_PUBLISH_MS >= 15000);
});
