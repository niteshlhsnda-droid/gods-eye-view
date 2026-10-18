import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEAD_RECKONING_MIN_INTERVAL_MS,
  DEAD_RECKONING_MAX_INTERVAL_MS,
  DEAD_RECKONING_CORROBORATION_WINDOW_MS,
  DEAD_RECKONING_CORROBORATION_MIN_AIRCRAFT,
  DEAD_RECKONING_SIGNAL,
  DEAD_RECKONING_INTERPRETATION,
  DEAD_RECKONING_MIN_TOLERANCE_M,
  DEAD_RECKONING_KNOT_TO_MPS,
  checkDeadReckoning,
  detectDeadReckoningEvents,
  summarizeDeadReckoningEvents,
} from './deadReckoning.js';

const DT_MS = 10_000;
const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;
/** Knots for a given speed in m/s. */
const kt = (mps) => mps / DEAD_RECKONING_KNOT_TO_MPS;
/** Latitude reached by moving `northM` metres north from `lat`. */
const moveNorth = (lat, northM) => lat + toDeg(northM / EARTH_RADIUS_M);
/** Longitude reached by moving `eastM` metres east from (lat, lon). */
const moveEast = (lat, lon, eastM) =>
  lon + toDeg(eastM / (EARTH_RADIUS_M * Math.cos(toRad(lat))));

/** Fix at (lat, lon) reporting gs knots on track degrees. */
const fix = (lat, lon, gsKt, trackDeg, overrides = {}) => ({
  lat,
  lon,
  gs: gsKt,
  track: trackDeg,
  nacp: 11,
  nacv: 4,
  atMs: 0,
  ...overrides,
});

/** Later fix (DT_MS on) at (lat, lon) reporting gs knots on track. */
const later = (lat, lon, gsKt, trackDeg, overrides = {}) =>
  fix(lat, lon, gsKt, trackDeg, { atMs: DT_MS, ...overrides });

/** Haversine distance (m) — an independent check on the module's local-tangent displacement. */
function haversineM(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

test('constants match the documented defaults', () => {
  assert.equal(DEAD_RECKONING_MIN_INTERVAL_MS, 5_000);
  assert.equal(DEAD_RECKONING_MAX_INTERVAL_MS, 60_000);
  assert.equal(DEAD_RECKONING_CORROBORATION_WINDOW_MS, 300_000);
  assert.equal(DEAD_RECKONING_CORROBORATION_MIN_AIRCRAFT, 2);
  assert.equal(DEAD_RECKONING_MIN_TOLERANCE_M, 10);
  assert.ok(Math.abs(DEAD_RECKONING_KNOT_TO_MPS - 1852 / 3600) < 1e-15);
});

test('a parked aircraft is consistent', () => {
  const verdict = checkDeadReckoning(fix(0, 0, 0, 0), later(0, 0, 0, 0));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.deepEqual(verdict.signals, []);
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.reason, null);
  assert.equal(verdict.dtS, 10);
  assert.equal(verdict.displacementM, 0);
  assert.equal(verdict.predictedM, 0);
  assert.equal(verdict.residualM, 0);
  assert.equal(verdict.positionAllowanceM, 6);
  assert.ok(Math.abs(verdict.velocityAllowanceM - 3) < 1e-12);
  assert.equal(verdict.timingAllowanceM, 0);
  assert.equal(verdict.turnAllowanceM, 0);
  // Claims sum 6 + 3 = 9, so the 10 m floor binds.
  assert.equal(verdict.toleranceM, 10);
  assert.equal(verdict.epuPrevM, 3);
  assert.equal(verdict.epuCurrM, 3);
  assert.ok(Math.abs(verdict.meanNacvBoundMps - 0.3) < 1e-12);
  assert.equal(verdict.meanSpeedMps, 0);
  assert.equal(verdict.trackChangeDeg, 0);
});

test('steady straight flight is consistent', () => {
  // 500 kt north for 10 s covers 500 * KNOT * 10 metres.
  const distM = 500 * DEAD_RECKONING_KNOT_TO_MPS * 10;
  const verdict = checkDeadReckoning(
    fix(0, 0, 500, 0),
    later(moveNorth(0, distM), 0, 500, 0),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.ok(Math.abs(verdict.displacementM - distM) < 1e-6);
  assert.ok(Math.abs(verdict.predictedM - distM) < 1e-6);
  assert.ok(verdict.residualM < 1e-6);
  // Independent haversine agrees with the local-tangent displacement.
  assert.ok(
    Math.abs(verdict.displacementM - haversineM(0, 0, moveNorth(0, distM), 0)) <
      0.01,
  );
});

test('constant acceleration cancels in the mean: speeding up is consistent', () => {
  // 400 kt -> 600 kt over 10 s at constant acceleration covers the
  // mean-speed distance: 500 kt x 10 s. An endpoint-only prediction
  // would miss by (600 - 500) kt x 10 s = 514 m; the mean sees 0.
  const distM = 500 * DEAD_RECKONING_KNOT_TO_MPS * 10;
  const verdict = checkDeadReckoning(
    fix(0, 0, 400, 0),
    later(moveNorth(0, distM), 0, 600, 0),
  );
  assert.equal(verdict.anomalous, false);
  assert.ok(verdict.residualM < 1e-6);
});

test('constant acceleration cancels in the mean: slowing down is consistent', () => {
  const distM = 500 * DEAD_RECKONING_KNOT_TO_MPS * 10;
  const verdict = checkDeadReckoning(
    fix(0, 0, 600, 0),
    later(moveNorth(0, distM), 0, 400, 0),
  );
  assert.equal(verdict.anomalous, false);
  assert.ok(verdict.residualM < 1e-6);
});

test('a steady standard-rate turn is consistent via the turn allowance', () => {
  // 250 m/s, 3 deg/s for 10 s = 30 deg of turn. True displacement is
  // the chord: v*dt*sinc(15 deg) along the 15 deg bisector.
  const speedMps = 250;
  const chordM = speedMps * 10 * (Math.sin(toRad(15)) / toRad(15));
  const northM = chordM * Math.cos(toRad(15));
  const eastM = chordM * Math.sin(toRad(15));
  const lat2 = moveNorth(0, northM);
  const lon2 = moveEast(0, 0, eastM);
  const verdict = checkDeadReckoning(
    fix(0, 0, kt(speedMps), 0),
    later(lat2, lon2, kt(speedMps), 30),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.trackChangeDeg, 30);
  // Residual equals the turn allowance: trapezoid undershoots chord.
  assert.ok(Math.abs(verdict.residualM - verdict.turnAllowanceM) < 1e-3);
  const expectedTurnAllowance =
    speedMps * 10 * (Math.sin(toRad(15)) / toRad(15) - Math.cos(toRad(15)));
  assert.ok(Math.abs(verdict.turnAllowanceM - expectedTurnAllowance) < 1e-6);
  assert.ok(verdict.toleranceM > verdict.turnAllowanceM);
});

test('a velocity vector rotated 90 deg from the positions is anomalous despite the turn allowance', () => {
  const distM = 500 * DEAD_RECKONING_KNOT_TO_MPS * 10;
  const verdict = checkDeadReckoning(
    fix(0, 0, 500, 0),
    later(moveNorth(0, distM), 0, 500, 90),
  );
  assert.equal(verdict.anomalous, true);
  assert.deepEqual(verdict.signals, [DEAD_RECKONING_SIGNAL]);
  // Residual (~1819 m) far exceeds the 90-deg turn allowance (~497 m).
  assert.ok(verdict.residualM > 1500);
  assert.ok(verdict.turnAllowanceM > 400 && verdict.turnAllowanceM < 600);
  assert.ok(verdict.residualM > verdict.toleranceM);
});

test('a stale position is caught: frozen fixes reporting flight', () => {
  // Both fixes at the same spot while both report 500 kt north.
  // Containment-jump and teleport never fire (no displacement), but
  // dead-reckoning predicts ~2572 m of travel against ~0 m actual.
  const verdict = checkDeadReckoning(fix(0, 0, 500, 0), later(0, 0, 500, 0));
  assert.equal(verdict.anomalous, true);
  assert.ok(
    Math.abs(verdict.residualM - 500 * DEAD_RECKONING_KNOT_TO_MPS * 10) < 1e-9,
  );
  assert.equal(verdict.displacementM, 0);
});

test('a jumped position is caught', () => {
  const verdict = checkDeadReckoning(
    fix(0, 0, 0, 0),
    later(moveNorth(0, 500), 0, 0, 0),
  );
  assert.equal(verdict.anomalous, true);
  assert.ok(Math.abs(verdict.residualM - 500) < 1e-6);
});

test('a pure direction error is caught even though the speed is right', () => {
  // Positions travel at a 10 deg bearing while both velocities report
  // track 0 at the matching speed. A speed-only check (velocityAccuracy)
  // sees derived speed == reported speed and passes; the vector
  // residual (~448 m) fails here.
  const distM = 500 * DEAD_RECKONING_KNOT_TO_MPS * 10;
  const northM = distM * Math.cos(toRad(10));
  const eastM = distM * Math.sin(toRad(10));
  const lat2 = moveNorth(0, northM);
  const lon2 = moveEast(0, 0, eastM);
  const verdict = checkDeadReckoning(
    fix(0, 0, 500, 0),
    later(lat2, lon2, 500, 0),
  );
  assert.equal(verdict.anomalous, true);
  assert.ok(verdict.residualM > 400);
  // Derived speed still equals the reported speed.
  assert.ok(
    Math.abs(verdict.displacementM / 10 - 500 * DEAD_RECKONING_KNOT_TO_MPS) <
      1e-6,
  );
  assert.equal(verdict.turnAllowanceM, 0);
});

test('a residual exactly at the tolerance is consistent (strict comparison)', () => {
  // Bit-identical construction: the tolerance is set to the exact
  // residual the module computes for a 0.001 deg north step, so
  // residual === tolerance and strict (>) comparison must pass.
  const dLat = 0.001;
  const expectedResidual = EARTH_RADIUS_M * ((dLat * Math.PI) / 180);
  const verdict = checkDeadReckoning(fix(0, 0, 0, 0), later(dLat, 0, 0, 0), {
    minToleranceM: expectedResidual,
  });
  assert.equal(verdict.judged, true);
  assert.equal(verdict.residualM, verdict.toleranceM);
  assert.equal(verdict.anomalous, false);
});

test('a residual just above the tolerance is anomalous', () => {
  const dLat = 0.001;
  const expectedResidual = EARTH_RADIUS_M * ((dLat * Math.PI) / 180);
  const verdict = checkDeadReckoning(fix(0, 0, 0, 0), later(dLat, 0, 0, 0), {
    minToleranceM: expectedResidual - 1,
  });
  assert.equal(verdict.anomalous, true);
  assert.ok(verdict.residualM - verdict.toleranceM > 0.9);
});

test('looser claimed accuracy widens the bound', () => {
  const prev = fix(0, 0, 0, 0, { nacp: 1, nacv: 1 });
  const curr = later(moveNorth(0, 500), 0, 0, 0, { nacp: 1, nacv: 1 });
  const verdict = checkDeadReckoning(prev, curr);
  assert.equal(verdict.positionAllowanceM, 2 * 10 * 1852);
  assert.ok(Math.abs(verdict.velocityAllowanceM - 100) < 1e-9);
  assert.equal(verdict.anomalous, false);
  // The same 500 m residual fails under the tight default claims.
  const strict = checkDeadReckoning(
    fix(0, 0, 0, 0),
    later(moveNorth(0, 500), 0, 0, 0),
  );
  assert.equal(strict.anomalous, true);
});

test('asymmetric NACv bounds average, they do not sum', () => {
  const verdict = checkDeadReckoning(
    fix(0, 0, 0, 0, { nacv: 1 }),
    later(0, 0, 0, 0, { nacv: 4 }),
  );
  assert.equal(verdict.meanNacvBoundMps, (10 + 0.3) / 2);
  assert.ok(Math.abs(verdict.velocityAllowanceM - 51.5) < 1e-9);
});

test('timing uncertainty widens the bound by mean speed x uncertainty', () => {
  const distM = 500 * DEAD_RECKONING_KNOT_TO_MPS * 10;
  const extraM = 200;
  const prev = fix(0, 0, 500, 0);
  const curr = later(moveNorth(0, distM + extraM), 0, 500, 0);
  const strict = checkDeadReckoning(prev, curr);
  assert.equal(strict.anomalous, true);
  assert.ok(Math.abs(strict.residualM - extraM) < 1e-6);
  const timed = checkDeadReckoning(prev, curr, { timingUncertaintyS: 1 });
  assert.ok(
    Math.abs(timed.timingAllowanceM - 500 * DEAD_RECKONING_KNOT_TO_MPS) < 1e-9,
  );
  assert.equal(timed.anomalous, false);
});

test('the tolerance floor binds under over-tight claimed accuracy', () => {
  // Claims sum 9 m; a 9.5 m residual fails the claims but the 10 m
  // floor holds it consistent.
  const verdict = checkDeadReckoning(
    fix(0, 0, 0, 0),
    later(moveNorth(0, 9.5), 0, 0, 0),
  );
  assert.equal(verdict.toleranceM, 10);
  assert.equal(verdict.anomalous, false);
});

test('missing position is missing-position, out-of-range is invalid-position', () => {
  const missing = checkDeadReckoning(
    fix(0, 0, 0, 0, { lat: undefined }),
    later(0, 0, 0, 0),
  );
  assert.equal(missing.reason, 'missing-position');
  const outOfRange = checkDeadReckoning(fix(91, 0, 0, 0), later(0, 0, 0, 0));
  assert.equal(outOfRange.reason, 'invalid-position');
  const nanLon = checkDeadReckoning(
    fix(0, Number.NaN, 0, 0),
    later(0, 0, 0, 0),
  );
  assert.equal(nanLon.reason, 'invalid-position');
});

test('missing velocity is missing-velocity, negative speed is invalid-velocity', () => {
  const missing = checkDeadReckoning(
    fix(0, 0, 0, 0, { gs: undefined }),
    later(0, 0, 0, 0),
  );
  assert.equal(missing.reason, 'missing-velocity');
  const negative = checkDeadReckoning(fix(0, 0, -5, 0), later(0, 0, 0, 0));
  assert.equal(negative.reason, 'invalid-velocity');
  const badTrack = checkDeadReckoning(fix(0, 0, 0, 361), later(0, 0, 0, 0));
  assert.equal(badTrack.reason, 'invalid-velocity');
  const nanTrack = checkDeadReckoning(
    fix(0, 0, 0, Number.NaN),
    later(0, 0, 0, 0),
  );
  assert.equal(nanTrack.reason, 'invalid-velocity');
});

test('track 360 is accepted as north', () => {
  const verdict = checkDeadReckoning(fix(0, 0, 0, 360), later(0, 0, 0, 360));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
});

test('missing quality is missing-quality, out-of-range is invalid-quality', () => {
  const missing = checkDeadReckoning(
    fix(0, 0, 0, 0, { nacp: undefined }),
    later(0, 0, 0, 0),
  );
  assert.equal(missing.reason, 'missing-quality');
  const badNacp = checkDeadReckoning(
    fix(0, 0, 0, 0, { nacp: 12 }),
    later(0, 0, 0, 0),
  );
  assert.equal(badNacp.reason, 'invalid-quality');
  const badNacv = checkDeadReckoning(
    fix(0, 0, 0, 0, { nacv: 5 }),
    later(0, 0, 0, 0),
  );
  assert.equal(badNacv.reason, 'invalid-quality');
  const fractional = checkDeadReckoning(
    fix(0, 0, 0, 0, { nacp: 1.5 }),
    later(0, 0, 0, 0),
  );
  assert.equal(fractional.reason, 'invalid-quality');
});

test('NACp 0 / NACv 0 claim no accuracy and are unjudged', () => {
  const unknownAccuracy = checkDeadReckoning(
    fix(0, 0, 0, 0, { nacp: 0 }),
    later(0, 0, 0, 0),
  );
  assert.equal(unknownAccuracy.reason, 'unknown-accuracy');
  const unknownVelocity = checkDeadReckoning(
    fix(0, 0, 0, 0, { nacv: 0 }),
    later(0, 0, 0, 0),
  );
  assert.equal(unknownVelocity.reason, 'unknown-velocity-accuracy');
});

test('invalid options are invalid-option, never a NaN tolerance', () => {
  const prev = fix(0, 0, 0, 0);
  const curr = later(0, 0, 0, 0);
  for (const options of [
    { minIntervalMs: -1 },
    { minIntervalMs: Number.NaN },
    { maxIntervalMs: 0 },
    { maxIntervalMs: Number.NaN },
    { timingUncertaintyS: -1 },
    { timingUncertaintyS: Number.NaN },
    { minToleranceM: -1 },
    { minToleranceM: Number.NaN },
  ]) {
    const verdict = checkDeadReckoning(prev, curr, options);
    assert.equal(verdict.judged, false);
    assert.equal(verdict.reason, 'invalid-option');
    assert.equal(verdict.toleranceM, null);
  }
});

test('invalid timestamps and intervals are unjudged', () => {
  const noTime = checkDeadReckoning(
    fix(0, 0, 0, 0, { atMs: undefined }),
    later(0, 0, 0, 0),
  );
  assert.equal(noTime.reason, 'invalid-time');
  const negative = checkDeadReckoning(
    fix(0, 0, 0, 0),
    fix(0, 0, 0, 0, { atMs: -1000 }),
  );
  assert.equal(negative.reason, 'negative-dt');
  const zero = checkDeadReckoning(fix(0, 0, 0, 0), fix(0, 0, 0, 0));
  assert.equal(zero.reason, 'zero-dt');
  const tooShort = checkDeadReckoning(
    fix(0, 0, 0, 0),
    fix(0, 0, 0, 0, { atMs: DEAD_RECKONING_MIN_INTERVAL_MS - 1 }),
  );
  assert.equal(tooShort.reason, 'interval-too-short');
  assert.equal(tooShort.residualM, 0);
  const tooLong = checkDeadReckoning(
    fix(0, 0, 0, 0),
    fix(0, 0, 0, 0, { atMs: DEAD_RECKONING_MAX_INTERVAL_MS + 1 }),
  );
  assert.equal(tooLong.reason, 'interval-too-long');
  assert.equal(tooLong.residualM, 0);
  const atMax = checkDeadReckoning(
    fix(0, 0, 0, 0),
    fix(0, 0, 0, 0, { atMs: DEAD_RECKONING_MAX_INTERVAL_MS }),
  );
  assert.equal(atMax.judged, true);
  const atMin = checkDeadReckoning(
    fix(0, 0, 0, 0),
    fix(0, 0, 0, 0, { atMs: DEAD_RECKONING_MIN_INTERVAL_MS }),
  );
  assert.equal(atMin.judged, true);
});

test('check throws TypeError on null or non-object fixes', () => {
  assert.throws(() => checkDeadReckoning(null, later(0, 0, 0, 0)), TypeError);
  assert.throws(() => checkDeadReckoning(fix(0, 0, 0, 0), 'nope'), TypeError);
});

test('an antimeridian crossing is consistent (longitude wraps)', () => {
  // 0.001 deg east across 180 deg = ~111.19 m; fly east at the
  // matching speed so the prediction agrees with the displacement.
  const distM = EARTH_RADIUS_M * toRad(0.001);
  const speedMps = distM / 10;
  const verdict = checkDeadReckoning(
    fix(0, 179.9995, kt(speedMps), 90),
    later(0, -179.9995, kt(speedMps), 90),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.ok(Math.abs(verdict.displacementM - distM) < 1e-6);
  assert.ok(verdict.residualM < 1e-6);
});

test('southern-hemisphere flight is consistent', () => {
  const distM = 100 * 10;
  const verdict = checkDeadReckoning(
    fix(-33, 151, kt(100), 0),
    later(moveNorth(-33, distM), 151, kt(100), 0),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.ok(verdict.residualM < 1e-6);
});

test('detect with fewer than two fixes yields no events', () => {
  assert.deepEqual(detectDeadReckoningEvents([]), []);
  assert.deepEqual(detectDeadReckoningEvents([fix(0, 0, 0, 0)]), []);
});

test('detect emits one event per violating pair, in timestamp order', () => {
  // Frozen positions reporting 500 kt north: every pair violates.
  const fixes = [
    later(0, 0, 500, 0, { atMs: DT_MS, hex: 'abc' }),
    fix(0, 0, 500, 0, { hex: 'abc' }),
    later(0, 0, 500, 0, { atMs: 2 * DT_MS, hex: 'abc' }),
  ];
  const events = detectDeadReckoningEvents(fixes);
  assert.equal(events.length, 2);
  assert.equal(events[0].atMs, DT_MS);
  assert.equal(events[0].hex, 'abc');
  assert.equal(events[0].displacementM, 0);
  assert.ok(
    Math.abs(events[0].residualM - 500 * DEAD_RECKONING_KNOT_TO_MPS * 10) <
      1e-9,
  );
  assert.equal(events[0].signal, DEAD_RECKONING_SIGNAL);
  // Events carry NO interpretation: that judgment is summary-level only.
  assert.ok(!('interpretation' in events[0]));
  assert.equal(events[1].atMs, 2 * DT_MS);
});

test('detect skips unjudged pairs and uses the fallback hex', () => {
  const fixes = [
    fix(0, 0, 500, 0, { nacp: undefined }),
    later(0, 0, 500, 0),
    later(0, 0, 500, 0, { atMs: 2 * DT_MS }),
  ];
  const events = detectDeadReckoningEvents(fixes, { hex: 'fallback' });
  assert.equal(events.length, 1);
  assert.equal(events[0].hex, 'fallback');
});

test('detect throws TypeError on a non-array or invalid options', () => {
  assert.throws(() => detectDeadReckoningEvents(null), TypeError);
  assert.throws(
    () => detectDeadReckoningEvents([], { maxIntervalMs: -1 }),
    TypeError,
  );
  assert.throws(
    () => detectDeadReckoningEvents([], { timingUncertaintyS: Number.NaN }),
    TypeError,
  );
});

test('summarize: empty and lone events never corroborate', () => {
  const empty = summarizeDeadReckoningEvents([]);
  assert.deepEqual(empty, {
    count: 0,
    aircraftCount: 0,
    corroborated: false,
    windowMs: DEAD_RECKONING_CORROBORATION_WINDOW_MS,
    firstAtMs: null,
    lastAtMs: null,
    interpretation: null,
  });
  const lone = summarizeDeadReckoningEvents([{ hex: 'a1', atMs: 1000 }]);
  assert.equal(lone.corroborated, false);
  assert.equal(lone.interpretation, null);
  assert.equal(lone.aircraftCount, 1);
});

test('summarize: two distinct aircraft inside the window corroborate', () => {
  const summary = summarizeDeadReckoningEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a2', atMs: 2000 },
  ]);
  assert.equal(summary.corroborated, true);
  assert.equal(summary.interpretation, DEAD_RECKONING_INTERPRETATION);
  assert.equal(summary.aircraftCount, 2);
  assert.equal(summary.firstAtMs, 1000);
  assert.equal(summary.lastAtMs, 2000);
});

test('summarize: two events from one aircraft never corroborate', () => {
  const summary = summarizeDeadReckoningEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a1', atMs: 2000 },
  ]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize: two aircraft outside the window do not corroborate', () => {
  const summary = summarizeDeadReckoningEvents([
    { hex: 'a1', atMs: 0 },
    { hex: 'a2', atMs: DEAD_RECKONING_CORROBORATION_WINDOW_MS + 1 },
  ]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize ignores events without a finite timestamp', () => {
  const summary = summarizeDeadReckoningEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a2' },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.corroborated, false);
});

test('summarize throws TypeError on invalid corroboration options', () => {
  assert.throws(
    () => summarizeDeadReckoningEvents([], { windowMs: Number.NaN }),
    TypeError,
  );
  assert.throws(
    () => summarizeDeadReckoningEvents([], { windowMs: -1 }),
    TypeError,
  );
  assert.throws(
    () => summarizeDeadReckoningEvents([], { minAircraft: 0 }),
    TypeError,
  );
  assert.throws(
    () => summarizeDeadReckoningEvents([], { minAircraft: 1.5 }),
    TypeError,
  );
});
