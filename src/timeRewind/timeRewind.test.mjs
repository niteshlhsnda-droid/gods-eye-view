import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimeline,
  createScrubber,
  visibleEvents,
  playheadProgress,
  formatPlayhead,
  SHOCKWAVE_LIFETIME_MS,
} from './scrubberModel.js';
import { buildUsgsHistoryUrl } from './historySource.js';
import { planShockwaves, magnitudeColor, replaySummary } from './replayView.js';

const events = () => [
  { stableId: 'a', lat: 10, lon: 20, mag: 5.1, place: 'A', time: 1000 },
  { stableId: 'b', lat: 11, lon: 21, mag: 6.4, place: 'B', time: 2000 },
  { stableId: 'c', lat: 12, lon: 22, mag: 7.2, place: 'C', time: 3000 },
];

test('buildTimeline sorts events and exposes the window', () => {
  const timeline = buildTimeline([events()[2], events()[0], events()[1]]);
  assert.deepEqual(timeline.events.map((e) => e.stableId), ['a', 'b', 'c']);
  assert.equal(timeline.startMs, 1000);
  assert.equal(timeline.endMs, 3000);
});

test('visibleEvents returns only living shockwaves at the playhead', () => {
  const timeline = buildTimeline(events());
  assert.equal(visibleEvents(timeline, 999).length, 0);
  assert.equal(visibleEvents(timeline, 1500).length, 1);
  assert.equal(visibleEvents(timeline, 2500).length, 2);
  assert.equal(
    visibleEvents(timeline, SHOCKWAVE_LIFETIME_MS + 4000).length,
    0,
  );
});

test('playheadProgress tracks event completion fraction', () => {
  const timeline = buildTimeline(events());
  assert.equal(playheadProgress(timeline, 1500), 1 / 3);
  assert.equal(playheadProgress(timeline, 99999), 1);
});

test('createScrubber plays, ticks with speed multiplier, pauses and seeks', () => {
  const timeline = buildTimeline(events());
  const seen = [];
  const scrubber = createScrubber(timeline, {
    speed: 1000,
    onTick: (state) => seen.push(state.playing),
  });
  assert.equal(scrubber.play(), true);
  scrubber.tick(10000);
  scrubber.tick(10010); // 10 wall ms × 1000 = 10,000 timeline ms
  assert.ok(scrubber.state.playheadMs >= 11000);
  scrubber.pause();
  const frozen = scrubber.state.playheadMs;
  scrubber.tick(20000);
  assert.equal(scrubber.state.playheadMs, frozen);
  scrubber.seek(2000);
  assert.equal(scrubber.state.playheadMs, 2000);
  assert.ok(seen.length > 0);
});

test('createScrubber stops at the end of the timeline', () => {
  const timeline = buildTimeline(events());
  const scrubber = createScrubber(timeline, { speed: 1e9 });
  scrubber.play();
  scrubber.tick(1000);
  scrubber.tick(2000);
  assert.equal(scrubber.state.playing, false);
  assert.equal(scrubber.progress(), 1);
});

test('createScrubber setSpeed clamps to sane bounds', () => {
  const scrubber = createScrubber(buildTimeline(events()));
  scrubber.setSpeed(1e9);
  assert.equal(scrubber.state.speed, 3600);
  scrubber.setSpeed(-5);
  assert.equal(scrubber.state.speed, 0.25);
});

test('formatPlayhead renders a compact UTC label', () => {
  assert.equal(formatPlayhead(0), '1970-01-01 00:00 UTC');
  assert.equal(formatPlayhead(NaN), '—');
});

test('buildUsgsHistoryUrl targets the USGS FDSN history endpoint', () => {
  const url = buildUsgsHistoryUrl({
    startTime: new Date('2026-09-12T00:00:00Z'),
    endTime: new Date('2026-10-12T00:00:00Z'),
    minMagnitude: 5,
  });
  assert.ok(url.startsWith('https://earthquake.usgs.gov/fdsnws/event/1/query?'));
  assert.match(url, /format=geojson/);
  assert.match(url, /minmagnitude=5/);
  assert.match(url, /orderby=time/);
  assert.throws(() => buildUsgsHistoryUrl({}), /startTime/);
});

test('planShockwaves expands and fades rings by age and magnitude', () => {
  const sameTime = [
    { stableId: 'small', lat: 10, lon: 20, mag: 5.0, time: 1000 },
    { stableId: 'big', lat: 11, lon: 21, mag: 7.0, time: 1000 },
  ];
  const descriptors = planShockwaves(sameTime, 1000 + 5000, SHOCKWAVE_LIFETIME_MS);
  const big = descriptors.find((d) => d.id === 'big');
  const small = descriptors.find((d) => d.id === 'small');
  assert.ok(big.radiusKm > 0);
  assert.ok(big.alpha < 1 && big.alpha > 0);
  assert.equal(big.color, magnitudeColor(7.0));
  assert.ok(big.radiusKm > small.radiusKm, 'bigger quakes get bigger rings');
});

test('magnitudeColor escalates with magnitude', () => {
  assert.equal(magnitudeColor(4.9), '#34c759');
  assert.equal(magnitudeColor(5.5), '#ffcc00');
  assert.equal(magnitudeColor(6.5), '#ff9500');
  assert.equal(magnitudeColor(7.5), '#ff3b30');
});

test('replaySummary counts reached events and peak magnitude', () => {
  const timeline = buildTimeline(events());
  const summary = replaySummary(timeline, 2500);
  assert.deepEqual(summary, {
    total: 3,
    reached: 2,
    peakMagnitude: 6.4,
    maxMagnitude: null,
  });
});
