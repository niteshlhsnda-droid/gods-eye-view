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
  // The adsb.lol match is a case-insensitive word-boundary regex, not a
  // domain anchor — pinned as current behavior, not endorsed.
  assert.equal(
    layerFeedState({ source: 'not-adsb.lol.evil.com', count: 5 }),
    'fallback',
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
