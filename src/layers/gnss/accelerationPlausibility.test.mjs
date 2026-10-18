import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCELERATION_INTERPRETATION,
  ACCELERATION_MAX_PLAUSIBLE_MPS2,
  ACCELERATION_SIGNAL_TRAJECTORY_BREAK,
  accelerationPlausibilityCheck,
  detectAccelerationEvents,
  summarizeAccelerationEvents,
} from './accelerationPlausibility.js';

/** IUGG mean Earth radius, metres (same as the module). */
const EARTH_MEAN_RADIUS_M = 6_371_008.8;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;
const normalizeLon = (lon) => ((lon + 540) % 360) - 180;

/**
 * Great-circle destination: one step of `distanceM` from `fix` along
 * `headingDeg`, `dtMs` later. Exact enough that a constant-heading,
 * constant-speed path has ~zero triple acceleration.
 */
function stepFix(fix, headingDeg, distanceM, dtMs) {
  const d = distanceM / EARTH_MEAN_RADIUS_M;
  const theta = toRad(headingDeg);
  const lat1 = toRad(fix.lat);
  const lon1 = toRad(fix.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: toDeg(lat2),
    lon: normalizeLon(toDeg(lon2)),
    atMs: fix.atMs + dtMs,
  };
}

/** `count` fixes at constant speed and heading, 10 s apart. */
function straightFixes(count, speedMps = 250, headingDeg = 90) {
  const fixes = [{ lat: 0, lon: 0, atMs: 0 }];
  for (let i = 1; i < count; i += 1) {
    fixes.push(stepFix(fixes[i - 1], headingDeg, speedMps * 10, 10_000));
  }
  return fixes;
}

/** Straight flight, then an instant turn at the corner fix. */
function turningFixes(countBefore, countAfter, turnDeg = 90) {
  const fixes = straightFixes(countBefore, 250, 90);
  for (let i = 1; i < countAfter; i += 1) {
    fixes.push(stepFix(fixes[fixes.length - 1], turnDeg, 250 * 10, 10_000));
  }
  return fixes;
}

test('straight constant-velocity flight is judged, not anomalous', () => {
  const fixes = straightFixes(7);
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, false);
  assert.deepEqual(result.signals, []);
  assert.equal(result.interpretation, null);
  assert.equal(result.reason, null);
  assert.equal(result.evaluatedTriples, 5);
  assert.equal(result.anomalousTriples, 0);
  assert.ok(result.maxAccelerationMps2 < 1);
  assert.deepEqual(detectAccelerationEvents(fixes), []);
});

test('a gentle 1.5 deg/s turn stays below the edge', () => {
  const fixes = [{ lat: 0, lon: 0, atMs: 0 }];
  let heading = 90;
  for (let i = 1; i < 7; i += 1) {
    fixes.push(stepFix(fixes[i - 1], heading, 250 * 10, 10_000));
    heading += 15; // 1.5 deg/s over each 10 s interval
  }
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, false);
  assert.ok(result.maxAccelerationMps2 > 3);
  assert.ok(result.maxAccelerationMps2 < 12);
});

test('gentle longitudinal acceleration stays below the edge', () => {
  const fixes = [{ lat: 0, lon: 0, atMs: 0 }];
  const speeds = [200, 220, 240, 260, 280];
  for (const speed of speeds) {
    fixes.push(stepFix(fixes[fixes.length - 1], 90, speed * 10, 10_000));
  }
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, false);
  assert.ok(result.maxAccelerationMps2 > 1);
  assert.ok(result.maxAccelerationMps2 < 3);
});

test('an instant 90-degree turn is a trajectory break', () => {
  const fixes = turningFixes(5, 4, 0);
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, true);
  assert.deepEqual(result.signals, [ACCELERATION_SIGNAL_TRAJECTORY_BREAK]);
  assert.equal(result.interpretation, ACCELERATION_INTERPRETATION);
  assert.equal(result.anomalousTriples, 1);
  // Velocity vector rotates 90 deg at 250 m/s: dv = 250*sqrt(2) over 10 s.
  assert.ok(result.maxAccelerationMps2 > 34);
  assert.ok(result.maxAccelerationMps2 < 37);
  const events = detectAccelerationEvents(fixes);
  assert.equal(events.length, 1);
  assert.equal(events[0].signal, ACCELERATION_SIGNAL_TRAJECTORY_BREAK);
  assert.equal(events[0].interpretation, ACCELERATION_INTERPRETATION);
  assert.equal(events[0].atMs, fixes[5].atMs);
  assert.equal(events[0].middleAtMs, fixes[4].atMs);
  assert.equal(events[0].hex, null);
});

test('an instant 180-degree reversal is a trajectory break', () => {
  const fixes = turningFixes(5, 4, 270);
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.anomalous, true);
  // dv = 500 m/s over 10 s.
  assert.ok(result.maxAccelerationMps2 > 49);
  assert.ok(result.maxAccelerationMps2 < 51);
  assert.equal(detectAccelerationEvents(fixes).length, 1);
});

test('a single 3 km offset fix yields three events, one bad fix', () => {
  const fixes = straightFixes(7);
  const offset = { ...fixes[3], lat: fixes[3].lat + 3000 / 111_195 };
  fixes[3] = offset;
  const events = detectAccelerationEvents(fixes);
  assert.equal(events.length, 3);
  assert.ok(events.every((event) => event.accelerationMps2 > 20));
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.anomalousTriples, 3);
});

test('a moderate 1.5 km offset fix yields one event (through only)', () => {
  const fixes = straightFixes(7);
  fixes[3] = { ...fixes[3], lat: fixes[3].lat + 1500 / 111_195 };
  const events = detectAccelerationEvents(fixes);
  assert.equal(events.length, 1);
  assert.ok(events[0].accelerationMps2 > 20);
});

test('a parked aircraft is excluded, never flagged', () => {
  const fixes = straightFixes(7).map((fix) => ({ ...fix, onGround: true }));
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, false);
  assert.equal(result.anomalous, false);
  assert.deepEqual(result.signals, []);
  assert.equal(result.reason, 'on-ground');
  assert.deepEqual(detectAccelerationEvents(fixes), []);
});

test('a parked fix with wild coordinates is dropped, not judged', () => {
  const fixes = straightFixes(7);
  fixes.splice(3, 0, { lat: 10, lon: 10, atMs: 25_000, onGround: true });
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, false);
  assert.deepEqual(detectAccelerationEvents(fixes), []);
});

test('an empty history is insufficient-data, never anomalous', () => {
  const result = accelerationPlausibilityCheck([]);
  assert.equal(result.judged, false);
  assert.equal(result.anomalous, false);
  assert.equal(result.reason, 'insufficient-data');
  assert.deepEqual(detectAccelerationEvents([]), []);
});

test('fewer than three usable fixes is insufficient-data', () => {
  const result = accelerationPlausibilityCheck(straightFixes(2));
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'insufficient-data');
});

test('fixes without timestamps report missing-timestamp', () => {
  const result = accelerationPlausibilityCheck([{ lat: 0, lon: 0 }]);
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'missing-timestamp');
});

test('fixes with invalid coordinates are skipped, never judged', () => {
  const fixes = straightFixes(5);
  fixes.push({ lat: 999, lon: 0, atMs: 50_000 });
  fixes.push({ lat: Number.NaN, lon: 0, atMs: 60_000 });
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, false);
});

test('intervals below the 10 s floor are not judged', () => {
  const fixes = [{ lat: 0, lon: 0, atMs: 0 }];
  for (let i = 1; i < 7; i += 1) {
    fixes.push(stepFix(fixes[i - 1], i < 4 ? 90 : 0, 250 * 2, 2_000));
  }
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'insufficient-data');
  assert.deepEqual(detectAccelerationEvents(fixes), []);
});

test('intervals above the 120 s ceiling are not judged', () => {
  const fixes = turningFixes(4, 3, 0).map((fix, i) => ({
    ...fix,
    atMs: i * 200_000,
  }));
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'insufficient-data');
});

test('duplicate timestamps are skipped, never a divide-by-zero', () => {
  const fixes = straightFixes(6);
  fixes.splice(3, 0, { ...fixes[2] });
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, false);
  assert.ok(Number.isFinite(result.maxAccelerationMps2));
});

test('unsorted input judges the same as sorted input', () => {
  const sorted = turningFixes(5, 4, 0);
  const shuffled = [...sorted].reverse();
  assert.deepEqual(
    accelerationPlausibilityCheck(shuffled),
    accelerationPlausibilityCheck(sorted),
  );
  assert.deepEqual(
    detectAccelerationEvents(shuffled),
    detectAccelerationEvents(sorted),
  );
});

test('a straight flight across the date line does not false-positive', () => {
  const fixes = [{ lat: 0, lon: 179.97, atMs: 0 }];
  for (let i = 1; i < 7; i += 1) {
    fixes.push(stepFix(fixes[i - 1], 90, 250 * 10, 10_000));
  }
  assert.ok(fixes.some((fix) => fix.lon < 0));
  const result = accelerationPlausibilityCheck(fixes);
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, false);
  assert.ok(result.maxAccelerationMps2 < 1);
});

test('events stamp the hex from the fix, else the caller option', () => {
  const withHex = turningFixes(5, 4, 0).map((fix) => ({
    ...fix,
    hex: 'abc123',
  }));
  assert.equal(detectAccelerationEvents(withHex)[0].hex, 'abc123');
  const withoutHex = turningFixes(5, 4, 0);
  assert.equal(
    detectAccelerationEvents(withoutHex, { hex: 'def456' })[0].hex,
    'def456',
  );
});

test('a caller-supplied edge is honoured', () => {
  const fixes = turningFixes(5, 4, 0);
  const strict = accelerationPlausibilityCheck(fixes, {
    maxPlausibleMps2: 40,
  });
  assert.equal(strict.anomalous, false);
  assert.deepEqual(
    detectAccelerationEvents(fixes, { maxPlausibleMps2: 40 }),
    [],
  );
  assert.ok(ACCELERATION_MAX_PLAUSIBLE_MPS2 < 40);
});

test('two aircraft breaking together corroborate; one alone does not', () => {
  const first = detectAccelerationEvents(
    turningFixes(5, 4, 0).map((fix) => ({ ...fix, hex: 'aaa111' })),
  );
  const second = detectAccelerationEvents(
    turningFixes(5, 4, 0).map((fix) => ({ ...fix, hex: 'bbb222' })),
  );
  const both = summarizeAccelerationEvents([...first, ...second]);
  assert.equal(both.count, 2);
  assert.equal(both.aircraftCount, 2);
  assert.equal(both.corroborated, true);
  assert.equal(both.interpretation, ACCELERATION_INTERPRETATION);

  const oneAircraft = summarizeAccelerationEvents([
    ...first,
    ...detectAccelerationEvents(
      turningFixes(5, 4, 270).map((fix, i) => ({
        ...fix,
        hex: 'aaa111',
        atMs: fix.atMs + 60_000,
      })),
    ),
  ]);
  assert.equal(oneAircraft.aircraftCount, 1);
  assert.equal(oneAircraft.corroborated, false);
});

test('breaks far apart in time do not corroborate', () => {
  const first = detectAccelerationEvents(
    turningFixes(5, 4, 0).map((fix) => ({ ...fix, hex: 'aaa111' })),
  );
  const later = detectAccelerationEvents(
    turningFixes(5, 4, 0).map((fix) => ({
      ...fix,
      hex: 'bbb222',
      atMs: fix.atMs + 600_000,
    })),
  );
  const summary = summarizeAccelerationEvents([...first, ...later]);
  assert.equal(summary.corroborated, false);
});

test('summarize with no events is empty, never corroborated', () => {
  const summary = summarizeAccelerationEvents([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.aircraftCount, 0);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.firstAtMs, null);
  assert.equal(summary.lastAtMs, null);
  assert.equal(summary.interpretation, null);
});

test('non-array input throws TypeError', () => {
  assert.throws(() => accelerationPlausibilityCheck(null), TypeError);
  assert.throws(() => detectAccelerationEvents('nope'), TypeError);
  assert.doesNotThrow(() => summarizeAccelerationEvents(null));
});
