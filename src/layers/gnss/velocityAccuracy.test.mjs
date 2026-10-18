import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOT_TO_MPS,
  VELOCITY_ACCURACY_SIGNAL,
  VELOCITY_ACCURACY_INTERPRETATION,
  nacvBoundMps,
  checkVelocityAccuracy,
  detectVelocityAccuracyEvents,
  summarizeVelocityAccuracyEvents,
} from './velocityAccuracy.js';

/** Longitude (degrees) at the equator giving `speedMps` over `dtS`. */
function lonForSpeed(speedMps, dtS) {
  return ((speedMps * dtS) / 6_371_000) * (180 / Math.PI);
}

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

const REPORTED_KT = 400;
const REPORTED_MPS = REPORTED_KT * KNOT_TO_MPS;
const DT_S = 60;

const fix = (overrides = {}) => ({
  lat: 0,
  lon: 0,
  gs: REPORTED_KT,
  nacv: 4,
  atMs: 0,
  ...overrides,
});

/** Later fix whose implied speed is `speedMps` over DT_S. */
const laterAt = (speedMps, overrides = {}) =>
  fix({ lon: lonForSpeed(speedMps, DT_S), atMs: DT_S * 1000, ...overrides });

test('nacvBoundMps maps the DO-260B NACv table', () => {
  assert.equal(nacvBoundMps(4), 0.3);
  assert.equal(nacvBoundMps(3), 1);
  assert.equal(nacvBoundMps(2), 3);
  assert.equal(nacvBoundMps(1), 10);
  assert.equal(nacvBoundMps(0), null);
  assert.equal(nacvBoundMps(5), null);
  assert.equal(nacvBoundMps(2.5), null);
  assert.equal(nacvBoundMps(undefined), null);
});

test('KNOT_TO_MPS is exact by definition', () => {
  assert.equal(KNOT_TO_MPS, 1852 / 3600);
});

test('steady pair with derived speed equal to reported is consistent', () => {
  const verdict = checkVelocityAccuracy(fix(), laterAt(REPORTED_MPS));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.deepEqual(verdict.signals, []);
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.reason, null);
  assert.ok(Math.abs(verdict.derivedSpeedMps - REPORTED_MPS) < 1e-6);
  assert.equal(verdict.allowanceMps, 0.3);
  assert.equal(verdict.excessMps, 0);
  assert.equal(verdict.ratio, null);
  assert.equal(verdict.nacvBoundMps, 0.3);
});

test('steady acceleration inside the reported band is consistent', () => {
  // Reported speeds span 380-420 kt; the derived mean sits inside.
  const prev = fix({ gs: 380 });
  const curr = laterAt(((380 + 420) / 2) * KNOT_TO_MPS, { gs: 420 });
  const verdict = checkVelocityAccuracy(prev, curr);
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
});

test('tight NACv flags a 5 m/s discrepancy a fixed tolerance would pass', () => {
  // velocityConsistency tolerates 15 m/s + 10% here (~35 m/s); the
  // NACv 4 claim allows only 0.3 m/s past the band.
  const verdict = checkVelocityAccuracy(fix(), laterAt(REPORTED_MPS + 5.3));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, true);
  assert.deepEqual(verdict.signals, [VELOCITY_ACCURACY_SIGNAL]);
  assert.equal(verdict.interpretation, VELOCITY_ACCURACY_INTERPRETATION);
  assert.ok(verdict.excessMps > 4.9 && verdict.excessMps < 5.1);
  assert.ok(verdict.ratio > 1);
});

test('the same 5 m/s discrepancy passes under loose NACv 1', () => {
  const verdict = checkVelocityAccuracy(
    fix({ nacv: 1 }),
    laterAt(REPORTED_MPS + 5.3, { nacv: 1 }),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.allowanceMps, 10);
});

test('low-side violation: positions barely move while velocity claims speed', () => {
  const verdict = checkVelocityAccuracy(fix(), laterAt(REPORTED_MPS - 5.3));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, true);
  assert.ok(verdict.excessMps > 4.9 && verdict.excessMps < 5.1);
  assert.ok(verdict.ratio > 1);
});

test('discrepancy just inside the allowance passes, just outside flags', () => {
  const inside = checkVelocityAccuracy(fix(), laterAt(REPORTED_MPS + 0.2));
  assert.equal(inside.anomalous, false);
  const outside = checkVelocityAccuracy(fix(), laterAt(REPORTED_MPS + 0.7));
  assert.equal(outside.anomalous, true);
  assert.ok(outside.excessMps > 0.3 && outside.excessMps < 0.5);
});

test('NACv 0 on either side cannot be judged', () => {
  assert.equal(
    checkVelocityAccuracy(fix({ nacv: 0 }), laterAt(REPORTED_MPS)).reason,
    'unknown-accuracy',
  );
  assert.equal(
    checkVelocityAccuracy(fix(), laterAt(REPORTED_MPS, { nacv: 0 })).reason,
    'unknown-accuracy',
  );
});

test('missing NACv cannot be judged', () => {
  const noNacv = fix();
  delete noNacv.nacv;
  assert.equal(
    checkVelocityAccuracy(noNacv, laterAt(REPORTED_MPS)).reason,
    'missing-quality',
  );
});

test('out-of-range NACv is invalid quality', () => {
  assert.equal(
    checkVelocityAccuracy(fix({ nacv: 5 }), laterAt(REPORTED_MPS)).reason,
    'invalid-quality',
  );
  assert.equal(
    checkVelocityAccuracy(fix({ nacv: 2.5 }), laterAt(REPORTED_MPS)).reason,
    'invalid-quality',
  );
});

test('missing ground speed cannot be judged', () => {
  const noGs = fix();
  delete noGs.gs;
  assert.equal(
    checkVelocityAccuracy(noGs, laterAt(REPORTED_MPS)).reason,
    'missing-velocity',
  );
});

test('negative or non-numeric ground speed is invalid velocity', () => {
  assert.equal(
    checkVelocityAccuracy(fix({ gs: -1 }), laterAt(REPORTED_MPS)).reason,
    'invalid-velocity',
  );
  assert.equal(
    checkVelocityAccuracy(fix({ gs: 'fast' }), laterAt(REPORTED_MPS)).reason,
    'invalid-velocity',
  );
});

test('out-of-range position is invalid', () => {
  assert.equal(
    checkVelocityAccuracy(fix({ lat: 91 }), laterAt(REPORTED_MPS)).reason,
    'invalid-position',
  );
  assert.equal(
    checkVelocityAccuracy(fix(), laterAt(REPORTED_MPS, { lon: 181 })).reason,
    'invalid-position',
  );
});

test('missing timestamp is invalid time', () => {
  const noTime = fix();
  delete noTime.atMs;
  assert.equal(
    checkVelocityAccuracy(noTime, laterAt(REPORTED_MPS)).reason,
    'invalid-time',
  );
});

test('earlier second fix is negative-dt', () => {
  assert.equal(
    checkVelocityAccuracy(fix({ atMs: 60_000 }), fix({ atMs: 0 })).reason,
    'negative-dt',
  );
});

test('interval gates: too short and too long are not judged', () => {
  assert.equal(
    checkVelocityAccuracy(fix(), fix({ atMs: 4_000 })).reason,
    'interval-too-short',
  );
  assert.equal(
    checkVelocityAccuracy(fix(), fix({ atMs: 121_000 })).reason,
    'interval-too-long',
  );
  // Interval edges themselves are judged (5 s and 120 s inclusive).
  assert.equal(checkVelocityAccuracy(fix(), fix({ atMs: 5_000 })).judged, true);
  assert.equal(
    checkVelocityAccuracy(fix(), fix({ atMs: 120_000 })).judged,
    true,
  );
});

test('timingUncertaintyS widens the allowance for whole-second timestamps', () => {
  const pair = [fix(), laterAt(REPORTED_MPS + 5.3)];
  assert.equal(checkVelocityAccuracy(...pair).anomalous, true);
  // 2 s granularity over 60 s adds ~7 m/s of timing allowance: passes.
  assert.equal(
    checkVelocityAccuracy(...pair, { timingUncertaintyS: 2 }).anomalous,
    false,
  );
  assert.ok(
    checkVelocityAccuracy(...pair, { timingUncertaintyS: 2 }).allowanceMps > 7,
  );
});

test('timing granularity exceeding the interval is not judged', () => {
  assert.equal(
    checkVelocityAccuracy(fix(), laterAt(REPORTED_MPS), {
      timingUncertaintyS: 60,
    }).reason,
    'timing-uncertainty-exceeds-interval',
  );
});

test('antimeridian crossing measures the short way', () => {
  const distance = haversineM(
    { lat: 0, lon: 179.999 },
    { lat: 0, lon: -179.999 },
  );
  // Report the ground speed the short-way hop actually implies; a
  // long-way-around distance would imply ~333,000 m/s and violate.
  const impliedKt = distance / 60 / KNOT_TO_MPS;
  const verdict = checkVelocityAccuracy(
    fix({ lon: 179.999, gs: impliedKt }),
    fix({ lon: -179.999, gs: impliedKt, atMs: 60_000 }),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.ok(Math.abs(verdict.derivedSpeedMps - distance / 60) < 1e-6);
});

test('checkVelocityAccuracy throws on non-object fixes', () => {
  assert.throws(() => checkVelocityAccuracy(null, fix()), TypeError);
  assert.throws(() => checkVelocityAccuracy(fix(), 'nope'), TypeError);
});

test('detect sorts by time and reports one event per violating pair', () => {
  const step = lonForSpeed(REPORTED_MPS + 5.3, DT_S);
  const events = detectVelocityAccuracyEvents([
    fix({ lon: 2 * step, atMs: 120_000, hex: 'ABC123' }),
    fix({ lon: step, atMs: 60_000, hex: 'ABC123' }),
    fix({ atMs: 0, hex: 'ABC123' }),
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].prevAtMs, 0);
  assert.equal(events[0].atMs, 60_000);
  assert.equal(events[0].hex, 'ABC123');
  assert.equal(events[0].signal, VELOCITY_ACCURACY_SIGNAL);
  assert.equal(events[1].atMs, 120_000);
});

test('detect skips unjudgeable fixes and uses the fallback hex', () => {
  const firstLon = lonForSpeed(REPORTED_MPS, DT_S);
  const stepLon = lonForSpeed(REPORTED_MPS + 5.3, DT_S);
  const events = detectVelocityAccuracyEvents(
    [
      fix({ nacv: 0, atMs: 0 }),
      fix({ lon: firstLon, atMs: 60_000 }),
      fix({ lon: firstLon + stepLon, atMs: 120_000 }),
    ],
    { hex: 'FALLBACK' },
  );
  // Pair (0 -> 60 s): NACv 0, skipped. Pair (60 -> 120 s): a 5.3 m/s
  // discrepancy past the NACv 4 allowance: a violation — and with no
  // hex on either fix, the event carries the fallback.
  assert.equal(events.length, 1);
  assert.equal(events[0].hex, 'FALLBACK');
  // A consistent pair yields no events.
  assert.deepEqual(
    detectVelocityAccuracyEvents([fix(), laterAt(REPORTED_MPS)]),
    [],
  );
});

test('detect throws on a non-array', () => {
  assert.throws(() => detectVelocityAccuracyEvents(null), TypeError);
});

test('summarize: empty set, lone aircraft, corroborated set', () => {
  const empty = summarizeVelocityAccuracyEvents([]);
  assert.deepEqual(
    (({ count, aircraftCount, corroborated, interpretation }) => ({
      count,
      aircraftCount,
      corroborated,
      interpretation,
    }))(empty),
    { count: 0, aircraftCount: 0, corroborated: false, interpretation: null },
  );
  const lone = summarizeVelocityAccuracyEvents([
    { hex: 'AAAAAA', atMs: 1000 },
    { hex: 'AAAAAA', atMs: 2000 },
  ]);
  assert.equal(lone.count, 2);
  assert.equal(lone.aircraftCount, 1);
  assert.equal(lone.corroborated, false);
  assert.equal(lone.interpretation, null);
  const corroborated = summarizeVelocityAccuracyEvents([
    { hex: 'AAAAAA', atMs: 1000 },
    { hex: 'BBBBBB', atMs: 2000 },
  ]);
  assert.equal(corroborated.corroborated, true);
  assert.equal(corroborated.interpretation, VELOCITY_ACCURACY_INTERPRETATION);
  assert.equal(corroborated.firstAtMs, 1000);
  assert.equal(corroborated.lastAtMs, 2000);
});

test('summarize: distinct aircraft outside the window do not corroborate', () => {
  const summary = summarizeVelocityAccuracyEvents([
    { hex: 'AAAAAA', atMs: 0 },
    { hex: 'BBBBBB', atMs: 300_001 },
  ]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
  assert.equal(summary.aircraftCount, 2);
});

test('summarize ignores events without a finite timestamp', () => {
  const summary = summarizeVelocityAccuracyEvents([
    { hex: 'AAAAAA', atMs: 1000 },
    { hex: 'BBBBBB' },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.corroborated, false);
});
