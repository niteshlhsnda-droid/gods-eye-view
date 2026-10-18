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

test('layerFeedState treats outage status synonyms as unavailable', () => {
  assert.equal(layerFeedState({ status: 'offline' }), 'unavailable');
  assert.equal(layerFeedState({ status: 'down' }), 'unavailable');
  assert.equal(layerFeedState({ status: 'error' }), 'unavailable');
  // Status is lowercased before matching, so casing never changes the state.
  assert.equal(layerFeedState({ status: 'UNAVAILABLE' }), 'unavailable');
  assert.equal(layerFeedState({ status: 'Stale' }), 'stale');
  assert.equal(layerFeedState({ status: 'FALLBACK' }), 'fallback');
  assert.equal(layerFeedState({ status: 'Zoom-In' }), 'nominal');
});

test('layerFeedState accepts every presented-error field, not just error', () => {
  // No prior data: any presented error reads UNAVAILABLE.
  assert.equal(layerFeedState({ lastError: 'feed down' }), 'unavailable');
  assert.equal(
    layerFeedState({ managerRefreshError: 'refresh rejected' }),
    'unavailable',
  );
  assert.equal(layerFeedState({ unavailable: true }), 'unavailable');
  assert.equal(layerFeedState({ available: false }), 'unavailable');
  // Prior data survives: the same fields read DEGRADED instead.
  assert.equal(
    layerFeedState({ lastError: 'feed down', count: 3 }),
    'degraded',
  );
  assert.equal(
    layerFeedState({ managerRefreshError: 'refresh rejected', count: 3 }),
    'degraded',
  );
  assert.equal(layerFeedState({ unavailable: true, count: 3 }), 'degraded');
  assert.equal(layerFeedState({ available: false, count: 3 }), 'degraded');
});

test('layerFeedState prior data comes from count or lastUpdate, with Number coercion', () => {
  // lastUpdate alone counts as prior data even with count 0.
  assert.equal(
    layerFeedState({ error: 'feed down', count: 0, lastUpdate: 1 }),
    'degraded',
  );
  // lastUpdate 0 is falsy, so it is NOT prior data.
  assert.equal(
    layerFeedState({ error: 'feed down', lastUpdate: 0 }),
    'unavailable',
  );
  // count is Number-coerced: '5' counts, '0' and NaN do not.
  assert.equal(layerFeedState({ error: 'feed down', count: '5' }), 'degraded');
  assert.equal(
    layerFeedState({ error: 'feed down', count: '0' }),
    'unavailable',
  );
  assert.equal(
    layerFeedState({ error: 'feed down', count: Number.NaN }),
    'unavailable',
  );
});

test('layerFeedState fallback triggers beyond mode sim and bare adsb.lol', () => {
  assert.equal(layerFeedState({ fallback: true, count: 3 }), 'fallback');
  assert.equal(layerFeedState({ status: 'fallback', count: 3 }), 'fallback');
  assert.equal(
    layerFeedState({ source: 'my fallback feed', count: 3 }),
    'fallback',
  );
  assert.equal(
    layerFeedState({ coverage: 'fallback coverage', count: 3 }),
    'fallback',
  );
  // Source/coverage matching is case-insensitive.
  assert.equal(
    layerFeedState({ source: 'FALLBACK feed', count: 3 }),
    'fallback',
  );
  assert.equal(layerFeedState({ source: 'ADSB.LOL', count: 3 }), 'fallback');
  assert.equal(layerFeedState({ coverage: 'adsb.lol', count: 3 }), 'fallback');
  // Explicit fallback:false guards ONLY the adsb.lol rule — the literal
  // word 'fallback' in source/coverage still reads FALLBACK.
  assert.equal(
    layerFeedState({
      fallback: false,
      source: 'my fallback feed',
      count: 3,
    }),
    'fallback',
  );
  // The adsb.lol match is exact-token matching (Cycle 3 spoof fix): a
  // hyphen- or dot-attached lookalike is its own token and does NOT
  // classify as the fallback provider. Genuine subdomains (*.adsb.lol)
  // still match — see the branch's own tests.
  assert.equal(
    layerFeedState({ source: 'not-adsb.lol.evil.com', count: 5 }),
    'nominal',
  );
});

test('layerFeedState degraded and partial flags and their precedence', () => {
  assert.equal(layerFeedState({ degraded: true, count: 3 }), 'degraded');
  assert.equal(layerFeedState({ partial: true, count: 3 }), 'partial');
  assert.equal(layerFeedState({ partial: false, count: 3 }), 'nominal');
  // stale beats degraded beats partial.
  assert.equal(
    layerFeedState({ stale: true, degraded: true, count: 3 }),
    'stale',
  );
  assert.equal(
    layerFeedState({ stale: true, partial: true, count: 3 }),
    'stale',
  );
  assert.equal(
    layerFeedState({ degraded: true, partial: true, count: 3 }),
    'degraded',
  );
});

test('layerFeedState precedence: unavailable > loading > guidance > fallback > stale', () => {
  // Declared outage beats loading; error-without-data beats loading.
  assert.equal(
    layerFeedState({ status: 'unavailable', loading: true }),
    'unavailable',
  );
  assert.equal(
    layerFeedState({ error: 'feed down', loading: true }),
    'unavailable',
  );
  // Loading beats fallback and stale.
  assert.equal(
    layerFeedState({ loading: true, fallback: true, count: 5 }),
    'loading',
  );
  assert.equal(
    layerFeedState({ loading: true, stale: true, count: 5 }),
    'loading',
  );
  // Guidance beats fallback and degraded — waiting on the user is not a fault.
  assert.equal(
    layerFeedState({ status: 'zoom-in', fallback: true, count: 5 }),
    'nominal',
  );
  assert.equal(
    layerFeedState({ status: 'empty', degraded: true, count: 5 }),
    'nominal',
  );
  // Guidance rescues even an error with no prior data (no guidance status
  // would read UNAVAILABLE); the idle+stale carve-out still reads STALE.
  assert.equal(layerFeedState({ status: 'zoom-in', error: 'x' }), 'nominal');
  assert.equal(
    layerFeedState({ status: 'idle', stale: true, count: 5 }),
    'stale',
  );
  // Fallback beats stale and degraded.
  assert.equal(
    layerFeedState({ fallback: true, stale: true, count: 3 }),
    'fallback',
  );
  assert.equal(
    layerFeedState({ status: 'fallback', stale: true, count: 5 }),
    'fallback',
  );
  assert.equal(
    layerFeedState({
      error: 'partial group failure',
      fallback: true,
      count: 3,
    }),
    'fallback',
  );
  // A stale status beats a degraded error with prior data.
  assert.equal(
    layerFeedState({ status: 'stale', error: 'feed down', count: 5 }),
    'stale',
  );
});

test('layerFeedState defaults missing stats to nominal', () => {
  assert.equal(layerFeedState(), 'nominal');
  assert.equal(layerFeedState(null), 'nominal');
  assert.equal(layerFeedState({}), 'nominal');
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
