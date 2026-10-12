import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAisDarkGaps,
  DEFAULT_DARK_GAP_THRESHOLD_MS,
} from './aisDarkGaps.js';

const HOUR = 3600_000;
const NOW = 1_790_000_000_000;

test('a tracked vessel that goes dark is reported', () => {
  const vessels = [
    {
      mmsi: '123456789',
      name: 'EVER QUIET',
      lastSeenMs: NOW - 9 * HOUR,
      sampleCount: 40,
      lastLat: 25.6,
      lastLon: -79.9,
    },
  ];
  const [event] = detectAisDarkGaps(vessels, { now: NOW });
  assert.equal(event.type, 'ais-dark-gap');
  assert.equal(event.severity, 'high');
  assert.match(event.title, /EVER QUIET/);
  assert.match(event.detail, /9\.0 hours ago/);
  assert.match(event.detail, /25\.60°N/);
  assert.equal(event.ref.mmsi, '123456789');
  assert.equal(event.ref.lastSeenMs, NOW - 9 * HOUR);
});

test('vessels with thin history are not dark gaps', () => {
  const vessels = [
    { mmsi: '1', lastSeenMs: NOW - 9 * HOUR, sampleCount: 1 },
    { mmsi: '2', lastSeenMs: NOW - 9 * HOUR, sampleCount: 2 },
    { mmsi: '3', lastSeenMs: NOW - 9 * HOUR },
  ];
  assert.deepEqual(detectAisDarkGaps(vessels, { now: NOW }), []);
});

test('recently seen vessels are not dark gaps', () => {
  const vessels = [
    { mmsi: '1', lastSeenMs: NOW - 5 * HOUR, sampleCount: 50 },
    { mmsi: '2', lastSeenMs: NOW, sampleCount: 50 },
  ];
  assert.deepEqual(detectAisDarkGaps(vessels, { now: NOW }), []);
});

test('future timestamps and bad records are ignored', () => {
  const vessels = [
    { mmsi: '1', lastSeenMs: NOW + HOUR, sampleCount: 50 },
    { mmsi: '2', lastSeenMs: 'not-a-time', sampleCount: 50 },
    { mmsi: '', lastSeenMs: NOW - 9 * HOUR, sampleCount: 50 },
    null,
  ];
  assert.deepEqual(detectAisDarkGaps(vessels, { now: NOW }), []);
});

test('the default threshold is six hours', () => {
  assert.equal(DEFAULT_DARK_GAP_THRESHOLD_MS, 6 * HOUR);
});
