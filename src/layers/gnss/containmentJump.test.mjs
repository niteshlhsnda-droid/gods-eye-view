import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTAINMENT_JUMP_MAX_SPEED_MPS,
  CONTAINMENT_JUMP_SIGNAL,
  CONTAINMENT_JUMP_INTERPRETATION,
  containmentRadiusM,
  checkContainmentJump,
  detectContainmentJumpEvents,
  summarizeContainmentJumpEvents,
} from './containmentJump.js';

/** Independent haversine (test-side, not imported from the module). */
function haversineM(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(((b.lon - a.lon + 540) % 360) - 180);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const fix = (overrides = {}) => ({
  lat: 0,
  lon: 0,
  nic: 11,
  atMs: 1_000,
  ...overrides,
});

test('containmentRadiusM maps the DO-260B NIC table', () => {
  assert.equal(containmentRadiusM(11), 7.5);
  assert.equal(containmentRadiusM(10), 25);
  assert.equal(containmentRadiusM(9), 75);
  assert.equal(containmentRadiusM(8), 0.1 * 1852);
  assert.equal(containmentRadiusM(1), 20 * 1852);
  assert.equal(containmentRadiusM(0), null);
  assert.equal(containmentRadiusM(12), null);
  assert.equal(containmentRadiusM(7.5), null);
  assert.equal(containmentRadiusM(undefined), null);
});

test('small move inside tight containment is consistent', () => {
  const verdict = checkContainmentJump(fix(), fix({ lon: 0.001, atMs: 2000 }));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.deepEqual(verdict.signals, []);
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.reason, null);
  assert.ok(verdict.distanceM > 100 && verdict.distanceM < 120);
  assert.equal(verdict.allowedM, 7.5 + 7.5 + 340 * 1);
});

test('large jump past tight containment is a violation', () => {
  const verdict = checkContainmentJump(fix(), fix({ lon: 0.01, atMs: 2000 }));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, true);
  assert.deepEqual(verdict.signals, [CONTAINMENT_JUMP_SIGNAL]);
  assert.equal(verdict.interpretation, CONTAINMENT_JUMP_INTERPRETATION);
  assert.ok(verdict.distanceM > 1100 && verdict.distanceM < 1120);
  assert.equal(verdict.allowedM, 15 + 340);
  assert.ok(verdict.excessM > 0);
  assert.ok(verdict.ratio > 1);
});

test('same jump is consistent when both fixes claim poor integrity', () => {
  const verdict = checkContainmentJump(
    fix({ nic: 1 }),
    fix({ nic: 1, lon: 0.01, atMs: 2000 }),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.allowedM, 2 * 20 * 1852 + 340);
});

test('NIC 0 on either side cannot be judged', () => {
  assert.equal(
    checkContainmentJump(fix({ nic: 0 }), fix({ lon: 0.01, atMs: 2000 }))
      .reason,
    'unknown-containment',
  );
  assert.equal(
    checkContainmentJump(fix(), fix({ nic: 0, lon: 0.01, atMs: 2000 })).reason,
    'unknown-containment',
  );
});

test('missing NIC cannot be judged', () => {
  const noNic = fix();
  delete noNic.nic;
  assert.equal(
    checkContainmentJump(noNic, fix({ atMs: 2000 })).reason,
    'missing-quality',
  );
});

test('out-of-range NIC is invalid quality', () => {
  assert.equal(
    checkContainmentJump(fix({ nic: 12 }), fix({ atMs: 2000 })).reason,
    'invalid-quality',
  );
  assert.equal(
    checkContainmentJump(fix({ nic: 7.5 }), fix({ atMs: 2000 })).reason,
    'invalid-quality',
  );
});

test('out-of-range position is invalid', () => {
  assert.equal(
    checkContainmentJump(fix({ lat: 91 }), fix({ atMs: 2000 })).reason,
    'invalid-position',
  );
  assert.equal(
    checkContainmentJump(fix(), fix({ lon: 181, atMs: 2000 })).reason,
    'invalid-position',
  );
});

test('missing timestamp is invalid time', () => {
  const noTime = fix();
  delete noTime.atMs;
  assert.equal(
    checkContainmentJump(noTime, fix({ atMs: 2000 })).reason,
    'invalid-time',
  );
});

test('earlier second fix is negative-dt', () => {
  assert.equal(
    checkContainmentJump(fix({ atMs: 2000 }), fix({ atMs: 1000 })).reason,
    'negative-dt',
  );
});

test('same timestamp: same place consistent, far place violation', () => {
  const same = checkContainmentJump(fix(), fix({ atMs: 1000 }));
  assert.equal(same.judged, true);
  assert.equal(same.anomalous, false);
  assert.equal(same.allowedM, 15);
  const far = checkContainmentJump(fix(), fix({ lon: 0.01, atMs: 1000 }));
  assert.equal(far.anomalous, true);
  assert.equal(far.dtS, 0);
});

test('edge is strict: distance exactly equal to allowed is consistent', () => {
  const prev = fix();
  const curr = fix({ lon: 0.01, atMs: 2000 });
  const distance = haversineM(prev, curr);
  // vmax that makes allowed exactly equal the distance: consistent.
  const exact = checkContainmentJump(prev, curr, {
    maxSpeedMps: distance - 15,
  });
  assert.equal(exact.judged, true);
  assert.equal(exact.anomalous, false);
  // A hair slower: allowed drops below the distance: violation.
  const below = checkContainmentJump(prev, curr, {
    maxSpeedMps: distance - 15 - 0.001,
  });
  assert.equal(below.anomalous, true);
});

test('maxSpeedMps option is honoured', () => {
  const prev = fix();
  const curr = fix({ lon: 0.005, atMs: 2000 }); // ~556 m in 1 s
  assert.equal(checkContainmentJump(prev, curr).anomalous, true);
  assert.equal(
    checkContainmentJump(prev, curr, { maxSpeedMps: 600 }).anomalous,
    false,
  );
});

test('antimeridian crossing measures the short way', () => {
  const verdict = checkContainmentJump(
    fix({ lon: 179.999 }),
    fix({ lon: -179.999, atMs: 2000 }),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.ok(verdict.distanceM > 200 && verdict.distanceM < 250);
});

test('checkContainmentJump throws on non-object fixes', () => {
  assert.throws(() => checkContainmentJump(null, fix()), TypeError);
  assert.throws(() => checkContainmentJump(fix(), 'nope'), TypeError);
});

test('detect sorts by time and reports one event per violating pair', () => {
  const events = detectContainmentJumpEvents([
    fix({ lon: 0.02, atMs: 3000, hex: 'ABC123' }),
    fix({ lon: 0.01, atMs: 2000, hex: 'ABC123' }),
    fix({ atMs: 1000, hex: 'ABC123' }),
  ]);
  // Pair (1000 -> 2000): 0.01 deg in 1 s = violation.
  // Pair (2000 -> 3000): same 0.01 deg in 1 s = violation.
  assert.equal(events.length, 2);
  assert.equal(events[0].prevAtMs, 1000);
  assert.equal(events[0].atMs, 2000);
  assert.equal(events[0].hex, 'ABC123');
  assert.equal(events[0].signal, CONTAINMENT_JUMP_SIGNAL);
  assert.equal(events[1].atMs, 3000);
});

test('detect skips unjudgeable fixes and uses the fallback hex', () => {
  const events = detectContainmentJumpEvents(
    [
      fix({ nic: 0, atMs: 1000 }),
      fix({ lon: 0.01, atMs: 2000 }),
      fix({ lon: 0.0101, atMs: 3000 }),
    ],
    { hex: 'FALLBACK' },
  );
  // Pair (1000 -> 2000): NIC 0, skipped. Pair (2000 -> 3000): tiny
  // move, consistent. No events.
  assert.deepEqual(events, []);
  // A violating pair with no hex on either fix gets the fallback.
  const fallback = detectContainmentJumpEvents(
    [fix(), fix({ lon: 0.01, atMs: 2000 })],
    { hex: 'FALLBACK' },
  );
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].hex, 'FALLBACK');
});

test('detect throws on a non-array', () => {
  assert.throws(() => detectContainmentJumpEvents(null), TypeError);
});

test('summarize: empty set, lone aircraft, corroborated set', () => {
  const empty = summarizeContainmentJumpEvents([]);
  assert.deepEqual(
    (({ count, aircraftCount, corroborated, interpretation }) => ({
      count,
      aircraftCount,
      corroborated,
      interpretation,
    }))(empty),
    { count: 0, aircraftCount: 0, corroborated: false, interpretation: null },
  );
  const lone = summarizeContainmentJumpEvents([
    { hex: 'AAAAAA', atMs: 1000 },
    { hex: 'AAAAAA', atMs: 2000 },
  ]);
  assert.equal(lone.count, 2);
  assert.equal(lone.aircraftCount, 1);
  assert.equal(lone.corroborated, false);
  // Lone events never carry the sky-event interpretation on their own.
  assert.equal(lone.interpretation, null);
  const corroborated = summarizeContainmentJumpEvents([
    { hex: 'AAAAAA', atMs: 1000 },
    { hex: 'BBBBBB', atMs: 2000 },
  ]);
  assert.equal(corroborated.corroborated, true);
  assert.equal(corroborated.interpretation, CONTAINMENT_JUMP_INTERPRETATION);
  assert.equal(corroborated.firstAtMs, 1000);
  assert.equal(corroborated.lastAtMs, 2000);
});

test('summarize: distinct aircraft outside the window do not corroborate', () => {
  const summary = summarizeContainmentJumpEvents([
    { hex: 'AAAAAA', atMs: 0 },
    { hex: 'BBBBBB', atMs: 300_001 },
  ]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
  assert.equal(summary.aircraftCount, 2);
});

test('summarize ignores events without a finite timestamp', () => {
  const summary = summarizeContainmentJumpEvents([
    { hex: 'AAAAAA', atMs: 1000 },
    { hex: 'BBBBBB' },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.corroborated, false);
});

test('default max speed constant is 340 m/s', () => {
  assert.equal(CONTAINMENT_JUMP_MAX_SPEED_MPS, 340);
});
