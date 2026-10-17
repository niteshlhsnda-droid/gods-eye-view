import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEED_LATENCY_WINDOW,
  clearFeedLatency,
  feedLatencyStats,
  layerFeedState,
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

test('layerFeedState still reads the genuine fallback labels', () => {
  // Exact provider token, the shipped `adsb.lol fallback` label, and the
  // CCTV label all keep classifying as fallback.
  assert.equal(
    layerFeedState({ source: 'adsb.lol', count: 10, lastUpdate: 1 }),
    'fallback',
  );
  assert.equal(
    layerFeedState({ source: 'adsb.lol fallback', count: 10, lastUpdate: 1 }),
    'fallback',
  );
  assert.equal(
    layerFeedState({
      source: 'CCTV + Street View fallback',
      count: 10,
      lastUpdate: 1,
    }),
    'fallback',
  );
  // A genuine adsb.lol subdomain is still adsb.lol infrastructure.
  assert.equal(
    layerFeedState({ source: 'api.adsb.lol', count: 10, lastUpdate: 1 }),
    'fallback',
  );
  // Punctuation around the token does not hide it.
  assert.equal(
    layerFeedState({ source: '(adsb.lol)', count: 10, lastUpdate: 1 }),
    'fallback',
  );
  // An explicitly primary adsb.lol feed still wins over the label.
  assert.equal(
    layerFeedState({
      source: 'adsb.lol',
      fallback: false,
      count: 10,
      lastUpdate: 1,
    }),
    'nominal',
  );
});

test('layerFeedState rejects smuggled adsb.lol / fallback substrings', () => {
  // Source/coverage arrive in HTTP response headers, so a hostile or sloppy
  // server must not flip the chip to FALLBACK by embedding the magic
  // substring in an unrelated label. Each of these used to match the old
  // /\badsb\.lol\b/i and /\bfallback\b/i substring regexes.
  const spoofed = [
    // adsb.lol as a subdomain/prefix of an attacker domain.
    'adsb.lol.evil.com',
    'adsb.lol.attacker.io feed',
    // Hyphen-attached lookalikes.
    'x-adsb.lol',
    'evil-adsb.lol feed',
    'notadsb.lol',
    // adsb.lol buried in a path.
    'evil.com/adsb.lol',
    // fallback smuggled the same way.
    'fallback.evil.com',
    'no-fallback primary',
    'geoid-fallback',
    'fallback-free primary feed',
  ];
  for (const source of spoofed) {
    assert.equal(
      layerFeedState({ source, count: 10, lastUpdate: 1 }),
      'nominal',
      `spoofed label must not read fallback: ${source}`,
    );
  }
  // The same smuggle via coverage instead of source.
  assert.equal(
    layerFeedState({
      source: 'OpenSky Network',
      coverage: 'adsb.lol.evil.com mirror',
      count: 10,
      lastUpdate: 1,
    }),
    'nominal',
  );
  // Known limitation, pinned: token matching is not English parsing, so a
  // hypothetical `no fallback needed` label would still read fallback. No
  // shipped label negates like that; the smuggle vectors above are closed.
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
