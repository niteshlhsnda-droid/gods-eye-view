import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPOOF_CLUSTER_MIN_AIRCRAFT,
  SPOOF_CLUSTER_RADIUS_KM,
  SPOOF_INTERPRETATION,
  SPOOF_SIGNAL_CLUSTER,
  SPOOF_SIGNAL_STALE,
  SPOOF_SIGNAL_TELEPORT,
  SPOOF_STALE_AGE_MS,
  SPOOF_TELEPORT_SPEED_MPS,
  SPOOF_TELEPORT_STEP_M,
  greatCircleDistanceM,
  spoofClusterCheck,
  staleCheck,
  teleportCheck,
} from './spoofSignals.js';

const T0 = 1_790_000_000_000;

test('dossier thresholds are exported verbatim', () => {
  assert.equal(SPOOF_TELEPORT_SPEED_MPS, 500);
  assert.equal(SPOOF_TELEPORT_STEP_M, 150_000);
  assert.equal(SPOOF_STALE_AGE_MS, 30_000);
  assert.equal(SPOOF_CLUSTER_MIN_AIRCRAFT, 5);
  assert.equal(SPOOF_CLUSTER_RADIUS_KM, 3);
});

test('haversine: one degree of latitude is ~111.2 km', () => {
  const d = greatCircleDistanceM(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111_195) / 111_195 < 0.005, `got ${d}`);
});

test('haversine crosses the date line the short way', () => {
  const d = greatCircleDistanceM(0, 179.999, 0, -179.999);
  assert.ok(d < 1000, `got ${d}`);
  assert.throws(() => greatCircleDistanceM(0, 0, 91, 0), RangeError);
});

test('teleport: a 200 km jump in 60 s is a teleport on both edges', () => {
  // 200 km north: ~1.798 deg of latitude.
  const result = teleportCheck(
    { lat: 0, lon: 0, atMs: T0 },
    { lat: 1.798, lon: 0, atMs: T0 + 60_000 },
  );
  assert.equal(result.judged, true);
  assert.equal(result.teleport, true);
  assert.equal(result.signal, SPOOF_SIGNAL_TELEPORT);
  assert.equal(result.interpretation, SPOOF_INTERPRETATION);
  assert.ok(result.distanceM > SPOOF_TELEPORT_STEP_M);
  assert.ok(result.speedMps > SPOOF_TELEPORT_SPEED_MPS);
  assert.match(result.reason, /jumped/);
});

test('teleport: a 151 km step is a teleport even at low implied speed', () => {
  const result = teleportCheck(
    { lat: 0, lon: 0, atMs: T0 },
    { lat: 1.358, lon: 0, atMs: T0 + 3600_000 },
  );
  assert.ok(
    result.distanceM > SPOOF_TELEPORT_STEP_M,
    `got ${result.distanceM}`,
  );
  assert.ok(result.speedMps < SPOOF_TELEPORT_SPEED_MPS);
  assert.equal(result.teleport, true);
});

test('teleport: a 100 km step in 60 s is a teleport by speed alone', () => {
  const result = teleportCheck(
    { lat: 0, lon: 0, atMs: T0 },
    { lat: 0.899, lon: 0, atMs: T0 + 60_000 },
  );
  assert.ok(result.distanceM < SPOOF_TELEPORT_STEP_M);
  assert.ok(result.speedMps > SPOOF_TELEPORT_SPEED_MPS);
  assert.equal(result.teleport, true);
});

test('teleport: a 10 km step in 60 s is ordinary movement', () => {
  const result = teleportCheck(
    { lat: 0, lon: 0, atMs: T0 },
    { lat: 0.09, lon: 0, atMs: T0 + 60_000 },
  );
  assert.equal(result.teleport, false);
  assert.equal(result.signal, null);
  assert.equal(result.interpretation, null);
  assert.match(result.reason, /within the movement bounds/);
});

test('teleport: the 500 m/s edge is strict — just under passes, just over trips', () => {
  // ~10 km in 21 s is ~476 m/s: under the edge, no teleport.
  const under = teleportCheck(
    { lat: 0, lon: 0, atMs: T0 },
    { lat: 0.089932, lon: 0, atMs: T0 + 21_000 },
  );
  assert.ok(under.speedMps < 500, `got ${under.speedMps}`);
  assert.equal(under.teleport, false);
  // The same step in 19 s is ~526 m/s: over the edge, teleport.
  const over = teleportCheck(
    { lat: 0, lon: 0, atMs: T0 },
    { lat: 0.089932, lon: 0, atMs: T0 + 19_000 },
  );
  assert.ok(over.speedMps > 500, `got ${over.speedMps}`);
  assert.equal(over.teleport, true);
});

test('teleport: duplicate and out-of-order fixes are not judged', () => {
  const dup = teleportCheck(
    { lat: 0, lon: 0, atMs: T0 },
    { lat: 1, lon: 0, atMs: T0 },
  );
  assert.equal(dup.judged, false);
  assert.equal(dup.teleport, false);
  assert.match(dup.reason, /duplicate/);
  const ooo = teleportCheck(
    { lat: 0, lon: 0, atMs: T0 + 1000 },
    { lat: 1, lon: 0, atMs: T0 },
  );
  assert.equal(ooo.judged, false);
  assert.match(ooo.reason, /out-of-order/);
});

test('teleport: invalid fixes throw', () => {
  assert.throws(
    () =>
      teleportCheck(
        { lat: 91, lon: 0, atMs: T0 },
        { lat: 0, lon: 0, atMs: T0 + 1000 },
      ),
    RangeError,
  );
  assert.throws(
    () =>
      teleportCheck(
        { lat: 0, lon: 0, atMs: NaN },
        { lat: 0, lon: 0, atMs: T0 + 1000 },
      ),
    TypeError,
  );
});

test('stale: older than 30 s is stale, 30 s exactly is not (strict >)', () => {
  const stale = staleCheck({ atMs: T0 }, T0 + 30_001);
  assert.equal(stale.stale, true);
  assert.equal(stale.signal, SPOOF_SIGNAL_STALE);
  assert.equal(stale.interpretation, SPOOF_INTERPRETATION);
  assert.equal(staleCheck({ atMs: T0 }, T0 + 30_000).stale, false);
  assert.equal(staleCheck({ atMs: T0 }, T0 + 29_000).stale, false);
});

test('stale: a future-dated fix is clock skew, not stale', () => {
  const result = staleCheck({ atMs: T0 + 5000 }, T0);
  assert.equal(result.stale, false);
  assert.equal(result.signal, null);
  assert.match(result.reason, /clock skew/);
});

test('stale: invalid inputs throw', () => {
  assert.throws(() => staleCheck({ atMs: NaN }, T0), TypeError);
  assert.throws(() => staleCheck({ atMs: T0 }, NaN), TypeError);
});

const clusterOf = (n, lat = 51.5, lon = -0.12, step = 0.001) =>
  Array.from({ length: n }, (_, i) => ({
    hex: `a${String(i).padStart(5, '0')}`,
    lat: lat + i * step,
    lon: lon + i * step,
  }));

test('cluster: five aircraft within ~1 km form one cluster', () => {
  const clusters = spoofClusterCheck(clusterOf(5));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 5);
  assert.equal(clusters[0].signal, SPOOF_SIGNAL_CLUSTER);
  assert.equal(clusters[0].interpretation, SPOOF_INTERPRETATION);
  assert.ok(clusters[0].maxRadiusKm <= SPOOF_CLUSTER_RADIUS_KM);
  assert.ok(Math.abs(clusters[0].centroid.lat - 51.502) < 0.01);
});

test('cluster: four aircraft are not a cluster', () => {
  assert.deepEqual(spoofClusterCheck(clusterOf(4)), []);
});

test('cluster: five aircraft spread far apart are not a cluster', () => {
  const spread = [0, 1, 2, 3, 4].map((i) => ({
    hex: `b${i}`,
    lat: 51.5 + i * 0.1,
    lon: -0.12,
  }));
  assert.deepEqual(spoofClusterCheck(spread), []);
});

test('cluster: two distant groups report as two clusters', () => {
  const london = clusterOf(5, 51.5, -0.12);
  const newYork = clusterOf(5, 40.7, -74.0).map((row, i) => ({
    ...row,
    hex: `n${String(i).padStart(5, '0')}`,
  }));
  const rows = [...london, ...newYork];
  const clusters = spoofClusterCheck(rows);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.map((c) => c.count).sort(), [5, 5]);
});

test('cluster: a line of aircraft 2.5 km apart does not chain into a cluster', () => {
  // Six aircraft over ~12.5 km: neighbours are within 3 km of each other,
  // but no 5 of them fit within 3 km of a shared centroid.
  const line = Array.from({ length: 6 }, (_, i) => ({
    hex: `c${i}`,
    lat: 51.5 + i * 0.0225,
    lon: -0.12,
  }));
  assert.deepEqual(spoofClusterCheck(line), []);
});

test('cluster: a date-line cluster stays on the date line', () => {
  const rows = [
    { hex: 'd0', lat: 0, lon: 179.999 },
    { hex: 'd1', lat: 0.001, lon: -179.999 },
    { hex: 'd2', lat: -0.001, lon: 179.998 },
    { hex: 'd3', lat: 0.002, lon: -179.998 },
    { hex: 'd4', lat: -0.002, lon: 179.997 },
  ];
  const clusters = spoofClusterCheck(rows);
  assert.equal(clusters.length, 1);
  assert.ok(Math.abs(Math.abs(clusters[0].centroid.lon) - 180) < 0.01);
});

test('cluster: malformed rows are skipped and a repeated hex counts once', () => {
  const rows = [
    ...clusterOf(5),
    { hex: 'a00000', lat: 51.5, lon: -0.12 }, // duplicate of first
    { hex: 'bad1', lat: NaN, lon: 0 },
    { hex: 'bad2', lat: 91, lon: 0 },
    null,
    'not-an-object',
  ];
  const clusters = spoofClusterCheck(rows);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 5);
});

test('cluster: one spoof event reports once, not once per seed', () => {
  const clusters = spoofClusterCheck(clusterOf(6));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 6);
});

test('cluster: threshold overrides are honoured', () => {
  assert.equal(spoofClusterCheck(clusterOf(5), { minAircraft: 6 }).length, 0);
  assert.equal(spoofClusterCheck(clusterOf(5), { radiusKm: 0.001 }).length, 0);
  assert.throws(() => spoofClusterCheck([], { minAircraft: 0 }), TypeError);
  assert.throws(() => spoofClusterCheck([], { radiusKm: 0 }), TypeError);
  assert.throws(() => spoofClusterCheck('nope'), TypeError);
});
