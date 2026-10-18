import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAdsbLolAircraftState,
  normalizeAdsbLolPointResponse,
} from './adsbLolFallback.js';

test('normalizes adsb.lol units into an OpenSky-compatible state vector', () => {
  const state = normalizeAdsbLolAircraftState({
    hex: 'A1B2C3',
    flight: 'UAL123 ',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    alt_geom: 10200,
    gs: 200,
    track: 90,
    baro_rate: 600,
    seen_pos: 2,
    seen: 1,
    category: 'A3',
  }, 1000);

  assert.equal(state[0], 'a1b2c3');
  assert.equal(state[1], 'UAL123');
  assert.equal(state[2], null);
  assert.equal(state[3], 998);
  assert.equal(state[5], -97);
  assert.equal(state[6], 30);
  assert.equal(state[7], 3048);
  assert.ok(Math.abs(state[9] - 102.8888) < 0.001);
  assert.equal(state[10], 90);
  assert.ok(Math.abs(state[11] - 3.048) < 0.001);
  assert.equal(state[13], 3108.96);
  assert.equal(state[17], 4);
});

test('keeps grounded fallback contacts and rejects rows without positions', () => {
  const normalized = normalizeAdsbLolPointResponse({
    now: 1_700_000_000_000,
    ac: [
      { hex: 'abc123', lat: 0, lon: 0, alt_baro: 'ground', gs: 8 },
      { hex: 'def456', lat: null, lon: 10, alt_baro: 5000 },
    ],
  });

  assert.equal(normalized.time, 1_700_000_000);
  assert.equal(normalized.states.length, 1);
  assert.equal(normalized.states[0][7], null);
  assert.equal(normalized.states[0][8], true);
});

test('empty-but-valid adsb.lol point responses are valid snapshots, never errors', () => {
  // Probe-verified empty shape: adsb.lol returns {"ac":[],"total":0} for
  // genuinely empty skies (mid-ocean 0,-30; Svalbard 78.22,15.63). An empty
  // response is a successful observation of zero aircraft — the caller must
  // treat it as valid, never as a failure to retry. Same principle as the
  // empty-vessel-coverage rule in CHANGELOG.md: an explicitly current,
  // complete empty snapshot clears stale contacts instead of erroring.
  for (const payload of [
    { now: 1_700_000_000, ac: [], total: 0 },
    { now: 1_700_000_000_000, ac: [], total: 0 },
  ]) {
    const normalized = normalizeAdsbLolPointResponse(payload);
    assert.equal(normalized.time, 1_700_000_000);
    assert.deepEqual(normalized.states, []);
  }
});

test('empty adsb.lol point response without now still yields an empty snapshot', () => {
  // No `now` in the payload: the normalizer falls back to the wall clock
  // for the snapshot time. The snapshot is still valid-empty, not an error.
  const before = Math.floor(Date.now() / 1000);
  const normalized = normalizeAdsbLolPointResponse({ ac: [], total: 0 });
  const after = Math.floor(Date.now() / 1000);
  assert.deepEqual(normalized.states, []);
  assert.ok(
    normalized.time >= before && normalized.time <= after,
    `snapshot time ${normalized.time} within [${before}, ${after}]`,
  );
});
