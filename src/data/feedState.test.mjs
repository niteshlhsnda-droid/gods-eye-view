import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEED_LATENCY_WINDOW,
  clearFeedLatency,
  feedLatencyStats,
  recordFeedLatency,
  summarizeFeedLatency,
  timedLayerFetch,
} from './feedState.js';

const LAYER = 'test-feed-latency-layer';

test('feed latency history is empty before any recording', () => {
  clearFeedLatency(LAYER);
  assert.equal(feedLatencyStats(LAYER), null);
  assert.equal(summarizeFeedLatency(LAYER), null);
});

test('recordFeedLatency keeps a bounded rolling window', () => {
  clearFeedLatency(LAYER);
  for (let i = 1; i <= FEED_LATENCY_WINDOW + 4; i += 1) {
    recordFeedLatency(LAYER, i * 10);
  }
  const stats = feedLatencyStats(LAYER);
  assert.equal(stats.samples, FEED_LATENCY_WINDOW);
  // The four oldest samples were evicted; the kept window is 50..200.
  assert.equal(stats.maxMs, (FEED_LATENCY_WINDOW + 4) * 10);
  assert.equal(stats.lastMs, (FEED_LATENCY_WINDOW + 4) * 10);
  assert.ok(stats.avgMs > 50 && stats.avgMs < 210);
  assert.ok(stats.p50Ms >= 100 && stats.p50Ms <= 160);
  assert.match(
    summarizeFeedLatency(LAYER),
    /^avg \d+ms · p50 \d+ms · 16 samples$/,
  );
  clearFeedLatency(LAYER);
});

test('recordFeedLatency drops garbage without poisoning the history', () => {
  clearFeedLatency(LAYER);
  recordFeedLatency(LAYER, 320);
  recordFeedLatency(LAYER, Number.NaN);
  recordFeedLatency(LAYER, Number.POSITIVE_INFINITY);
  recordFeedLatency(LAYER, -50);
  recordFeedLatency(LAYER, undefined);
  recordFeedLatency('', 320);
  const stats = feedLatencyStats(LAYER);
  assert.equal(stats.samples, 1);
  assert.equal(stats.avgMs, 320);
  assert.equal(stats.p50Ms, 320);
  assert.equal(stats.maxMs, 320);
  assert.equal(stats.lastMs, 320);
  clearFeedLatency(LAYER);
});

test('summarizeFeedLatency pluralizes a single sample', () => {
  clearFeedLatency(LAYER);
  recordFeedLatency(LAYER, 88);
  assert.equal(summarizeFeedLatency(LAYER), 'avg 88ms · p50 88ms · 1 sample');
  clearFeedLatency(LAYER);
});

test('timedLayerFetch records successful fetches and rethrows failures', async () => {
  clearFeedLatency(LAYER);
  const ok = await timedLayerFetch(LAYER, async () => 'payload');
  assert.equal(ok, 'payload');
  const stats = feedLatencyStats(LAYER);
  assert.equal(stats.samples, 1);
  assert.ok(stats.lastMs >= 0);
  await assert.rejects(
    timedLayerFetch(LAYER, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  // A failed fetch is not recorded; its error state surfaces through the badge.
  assert.equal(feedLatencyStats(LAYER).samples, 1);
  clearFeedLatency(LAYER);
});

test('feed latency histories are isolated per layer', () => {
  const layerA = 'test-feed-latency-layer-a';
  const layerB = 'test-feed-latency-layer-b';
  clearFeedLatency(layerA);
  clearFeedLatency(layerB);
  recordFeedLatency(layerA, 100);
  recordFeedLatency(layerB, 400);
  recordFeedLatency(layerB, 500);
  assert.equal(feedLatencyStats(layerA).samples, 1);
  assert.equal(feedLatencyStats(layerA).avgMs, 100);
  assert.equal(feedLatencyStats(layerB).samples, 2);
  assert.equal(feedLatencyStats(layerB).avgMs, 450);
  // Clearing one layer leaves the other untouched.
  clearFeedLatency(layerA);
  assert.equal(feedLatencyStats(layerA), null);
  assert.equal(feedLatencyStats(layerB).samples, 2);
  clearFeedLatency(layerB);
});

test('feed latency layer ids are trimmed consistently', () => {
  const padded = '  test-feed-latency-trimmed  ';
  const trimmed = 'test-feed-latency-trimmed';
  clearFeedLatency(trimmed);
  recordFeedLatency(padded, 120);
  // Record trims, so the trimmed id sees the same history.
  assert.equal(feedLatencyStats(trimmed).samples, 1);
  assert.equal(feedLatencyStats(trimmed).avgMs, 120);
  // Clear trims too: a padded clear removes the trimmed history.
  clearFeedLatency(` ${trimmed} `);
  assert.equal(feedLatencyStats(trimmed), null);
});

test('feed latency drops recordings with an empty or missing layer id', () => {
  recordFeedLatency('', 100);
  recordFeedLatency(null, 100);
  recordFeedLatency(undefined, 100);
  recordFeedLatency(0, 100);
  assert.equal(feedLatencyStats(''), null);
  assert.equal(feedLatencyStats(null), null);
  assert.equal(feedLatencyStats(undefined), null);
  // No phantom history under the empty key either.
  assert.equal(summarizeFeedLatency(''), null);
});

test('feed latency records a zero duration instead of dropping it', () => {
  const zeroLayer = 'test-feed-latency-zero';
  clearFeedLatency(zeroLayer);
  recordFeedLatency(zeroLayer, 0);
  const stats = feedLatencyStats(zeroLayer);
  assert.equal(stats.samples, 1);
  assert.equal(stats.avgMs, 0);
  assert.equal(stats.p50Ms, 0);
  assert.equal(stats.maxMs, 0);
  assert.equal(stats.lastMs, 0);
  assert.equal(summarizeFeedLatency(zeroLayer), 'avg 0ms · p50 0ms · 1 sample');
  clearFeedLatency(zeroLayer);
});

test('feed latency coerces a numeric-string duration', () => {
  const stringLayer = 'test-feed-latency-string-duration';
  clearFeedLatency(stringLayer);
  recordFeedLatency(stringLayer, '320');
  const stats = feedLatencyStats(stringLayer);
  assert.equal(stats.samples, 1);
  assert.equal(stats.avgMs, 320);
  clearFeedLatency(stringLayer);
});

test('feed latency p50 is the upper median and avg rounds to the nearest ms', () => {
  const evenLayer = 'test-feed-latency-even';
  clearFeedLatency(evenLayer);
  for (const ms of [10, 20, 30, 40]) recordFeedLatency(evenLayer, ms);
  const even = feedLatencyStats(evenLayer);
  assert.equal(even.samples, 4);
  assert.equal(even.avgMs, 25);
  // Upper median: sorted[floor(4 / 2)] = sorted[2] = 30, not 25.
  assert.equal(even.p50Ms, 30);
  assert.equal(even.maxMs, 40);
  assert.equal(even.lastMs, 40);
  assert.equal(
    summarizeFeedLatency(evenLayer),
    'avg 25ms · p50 30ms · 4 samples',
  );
  clearFeedLatency(evenLayer);

  const roundingLayer = 'test-feed-latency-rounding';
  clearFeedLatency(roundingLayer);
  recordFeedLatency(roundingLayer, 10);
  recordFeedLatency(roundingLayer, 11);
  // avg 10.5 rounds half-up to 11 via Math.round.
  assert.equal(feedLatencyStats(roundingLayer).avgMs, 11);
  assert.equal(feedLatencyStats(roundingLayer).p50Ms, 11);
  clearFeedLatency(roundingLayer);
});

test('feed latency lastMs follows insertion order, maxMs and p50 follow sorted order', () => {
  const orderLayer = 'test-feed-latency-order';
  clearFeedLatency(orderLayer);
  recordFeedLatency(orderLayer, 500);
  recordFeedLatency(orderLayer, 100);
  const stats = feedLatencyStats(orderLayer);
  assert.equal(stats.samples, 2);
  assert.equal(stats.avgMs, 300);
  assert.equal(stats.maxMs, 500);
  assert.equal(stats.p50Ms, 500);
  // The most recent sample was 100, even though it is not the max.
  assert.equal(stats.lastMs, 100);
  clearFeedLatency(orderLayer);
});

test('timedLayerFetch rejects a synchronous throw without recording', async () => {
  const throwLayer = 'test-feed-latency-sync-throw';
  clearFeedLatency(throwLayer);
  await assert.rejects(
    timedLayerFetch(throwLayer, () => {
      throw new Error('sync boom');
    }),
    /sync boom/,
  );
  assert.equal(feedLatencyStats(throwLayer), null);
  clearFeedLatency(throwLayer);
});

test('timedLayerFetch accepts a synchronous return value and records it', async () => {
  const syncLayer = 'test-feed-latency-sync-value';
  clearFeedLatency(syncLayer);
  const value = await timedLayerFetch(syncLayer, () => 'sync payload');
  assert.equal(value, 'sync payload');
  const stats = feedLatencyStats(syncLayer);
  assert.equal(stats.samples, 1);
  assert.ok(stats.lastMs >= 0);
  clearFeedLatency(syncLayer);
});

test('clearFeedLatency on an unknown layer is a silent no-op', () => {
  const unknown = 'test-feed-latency-never-recorded';
  assert.doesNotThrow(() => clearFeedLatency(unknown));
  assert.doesNotThrow(() => clearFeedLatency(''));
  assert.equal(feedLatencyStats(unknown), null);
  assert.equal(summarizeFeedLatency(unknown), null);
});
