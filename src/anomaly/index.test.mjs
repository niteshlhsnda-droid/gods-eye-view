import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies, ANOMALY_TYPES } from './index.js';

const HOUR = 3600_000;
const NOW = 1_790_000_000_000;

test('detectAnomalies merges all detectors and ranks critical first', () => {
  const events = detectAnomalies(
    {
      aircraft: [{ icao24: 'a1', squawk: '7700' }],
      vessels: [
        {
          mmsi: '123456789',
          name: 'EVER QUIET',
          lastSeenMs: NOW - 9 * HOUR,
          sampleCount: 40,
        },
      ],
      quakes: Array.from({ length: 6 }, (_, i) => ({
        id: `q${i}`,
        mag: 4.5,
        timeMs: NOW - (6 - i) * HOUR,
        lat: 35.68 + i * 0.01,
        lon: 139.69 + i * 0.01,
      })),
    },
    { now: NOW },
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ['emergency-squawk', 'ais-dark-gap', 'quake-swarm'],
  );
});

test('detectAnomalies is quiet on a clean snapshot', () => {
  assert.deepEqual(
    detectAnomalies(
      {
        aircraft: [{ icao24: 'a1', squawk: '1200' }],
        vessels: [{ mmsi: '1', lastSeenMs: NOW - HOUR, sampleCount: 40 }],
        quakes: [{ id: 'q1', mag: 3.0, timeMs: NOW - HOUR, lat: 10, lon: 10 }],
      },
      { now: NOW },
    ),
    [],
  );
});

test('the engine advertises exactly its three types', () => {
  assert.deepEqual(
    [...ANOMALY_TYPES],
    ['emergency-squawk', 'ais-dark-gap', 'quake-swarm'],
  );
});
