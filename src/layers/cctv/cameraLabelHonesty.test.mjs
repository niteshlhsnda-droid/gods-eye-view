import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_LABEL,
  DEFAULT_STALE_AFTER_MS,
  cameraFeedHonestyLabel,
} from './cameraLabelHonesty.js';

// Fixed clock keeps every assertion deterministic.
const NOW = 1_790_000_000_000;
const MIN = 60_000;

test('LIVE: HLS with working pipeline and a fresh frame streams now', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - 9_000,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.LIVE);
  assert.match(out.reason, /HLS streaming/);
  assert.match(out.reason, /last good frame 9s ago/);
});

test('LIVE: feed type match is case-insensitive', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'HLS',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - 1_000,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.LIVE);
});

test('LIVE: HLS with unknown health but a fresh segment is still LIVE', () => {
  // The fresh segment itself is the evidence of a live transport; an
  // unreported health flag is absence of evidence, not evidence of failure.
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: null,
    lastGoodFetchMs: NOW - 5_000,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.LIVE);
});

test('STALE: a failed fetch pipeline blocks LIVE even for fresh HLS', () => {
  // The Oct-15 banner case: badge must agree with the fetch-failure banner.
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: 'failed',
    lastGoodFetchMs: NOW - 30_000,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.STALE);
  assert.match(out.reason, /fetch pipeline failing/);
  assert.match(out.reason, /30s ago/);
});

test('STALE: frozen HLS playlist (last good frame older than threshold)', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - 20 * MIN,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.STALE);
  assert.match(out.reason, /stale feed/);
});

test('STALE: exact threshold boundary is not stale, one ms past is', () => {
  const at = cameraFeedHonestyLabel({
    feedType: 'image',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - DEFAULT_STALE_AFTER_MS,
    refreshCadenceMs: MIN,
    nowMs: NOW,
  });
  assert.equal(at.label, CAMERA_LABEL.CONTINUOUS);

  const past = cameraFeedHonestyLabel({
    feedType: 'image',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - DEFAULT_STALE_AFTER_MS - 1,
    refreshCadenceMs: MIN,
    nowMs: NOW,
  });
  assert.equal(past.label, CAMERA_LABEL.STALE);
});

test('CONTINUOUS: looping mp4/webm clips are never LIVE', () => {
  for (const feedType of ['mp4', 'MP4', 'webm']) {
    const out = cameraFeedHonestyLabel({
      feedType,
      healthStatus: 'ok',
      lastGoodFetchMs: NOW - 45_000,
      nowMs: NOW,
    });
    assert.equal(out.label, CAMERA_LABEL.CONTINUOUS, feedType);
    assert.match(out.reason, /looped clip/);
  }
});

test('CONTINUOUS: fresh snapshot re-fetched on cadence names the cadence', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'image',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - 20_000,
    refreshCadenceMs: MIN,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.CONTINUOUS);
  assert.match(out.reason, /snapshot refresh/);
  assert.match(out.reason, /refreshed every 1m/);
  assert.match(out.reason, /20s ago/);
});

test('CONTINUOUS: unknown feed types degrade to snapshot semantics', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'webrtc',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - 10_000,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.CONTINUOUS);
  assert.match(out.reason, /snapshot refresh/);
});

test('STALE: stale snapshot when last good fetch is past the threshold', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'mjpeg',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - 3 * 60 * MIN,
    refreshCadenceMs: MIN,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.STALE);
  assert.match(out.reason, /stale feed/);
});

test('STALE: custom stale threshold is honored', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - 10 * MIN,
    staleThresholdMs: 5 * MIN,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.STALE);
});

test('STALE: invalid threshold falls back to the default instead of mislabeling', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW - 10 * MIN,
    staleThresholdMs: -100,
    nowMs: NOW,
  });
  // 10 min < default 15 min threshold: still LIVE, not STALE.
  assert.equal(out.label, CAMERA_LABEL.LIVE);
});

test('UNKNOWN: no frame ever received and unknown health claims nothing', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: null,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.UNKNOWN);
  assert.match(out.reason, /no frame received yet/);
});

test('UNKNOWN: failed pipeline with zero good frames stays UNKNOWN, not STALE', () => {
  // STALE means "the picture is out of date"; with no picture at all the
  // honest label is UNKNOWN.
  const out = cameraFeedHonestyLabel({
    feedType: 'image',
    healthStatus: 'failed',
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.UNKNOWN);
  assert.match(out.reason, /fetch pipeline failing/);
});

test('UNKNOWN: missing/empty metadata is defensive UNKNOWN', () => {
  assert.equal(cameraFeedHonestyLabel().label, CAMERA_LABEL.UNKNOWN);
  assert.equal(cameraFeedHonestyLabel(undefined).label, CAMERA_LABEL.UNKNOWN);
  assert.equal(cameraFeedHonestyLabel(null).label, CAMERA_LABEL.UNKNOWN);
  assert.equal(cameraFeedHonestyLabel({}).label, CAMERA_LABEL.UNKNOWN);
});

test('LIVE: future lastGoodFetchMs is clock skew, clamped, not trusted as fresher', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: 'ok',
    lastGoodFetchMs: NOW + 5 * MIN,
    nowMs: NOW,
  });
  assert.equal(out.label, CAMERA_LABEL.LIVE);
  assert.match(out.reason, /last good frame 0s ago/);
});

test('LIVE: default clock (nowMs omitted) works against the real clock', () => {
  const out = cameraFeedHonestyLabel({
    feedType: 'hls',
    healthStatus: 'ok',
    lastGoodFetchMs: Date.now() - 1_000,
  });
  assert.equal(out.label, CAMERA_LABEL.LIVE);
});
