import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BARO_GEOM_DRIFT_MAX_INTERVAL_MS,
  BARO_GEOM_DRIFT_CORROBORATION_WINDOW_MS,
  BARO_GEOM_DRIFT_CORROBORATION_MIN_AIRCRAFT,
  BARO_GEOM_DRIFT_SIGNAL,
  BARO_GEOM_DRIFT_INTERPRETATION,
  gvaBoundM,
  checkBaroGeomDrift,
  detectBaroGeomDriftEvents,
  summarizeBaroGeomDriftEvents,
} from './baroGeomDrift.js';

const DT_MS = 60_000;

/** Fix with baro/geom altitudes implying `differenceM`, GVA 2. */
const fix = (differenceM, overrides = {}) => ({
  baroAltM: 1000 + differenceM,
  geomAltM: 1000,
  gva: 2,
  atMs: 0,
  ...overrides,
});

/** Later fix (DT_MS on) with the given difference and GVA. */
const later = (differenceM, overrides = {}) =>
  fix(differenceM, { atMs: DT_MS, ...overrides });

test('gvaBoundM maps the DO-260B GVA table', () => {
  assert.equal(gvaBoundM(2), 45);
  assert.equal(gvaBoundM(1), 150);
  assert.equal(gvaBoundM(0), null);
  assert.equal(gvaBoundM(3), null);
  assert.equal(gvaBoundM(4), null);
  assert.equal(gvaBoundM(1.5), null);
  assert.equal(gvaBoundM(undefined), null);
  assert.equal(gvaBoundM('2'), null);
});

test('corroboration constants match the sibling modules', () => {
  assert.equal(BARO_GEOM_DRIFT_MAX_INTERVAL_MS, 120_000);
  assert.equal(BARO_GEOM_DRIFT_CORROBORATION_WINDOW_MS, 300_000);
  assert.equal(BARO_GEOM_DRIFT_CORROBORATION_MIN_AIRCRAFT, 2);
});

test('unchanged difference is consistent with a zero jump', () => {
  const verdict = checkBaroGeomDrift(fix(50), later(50));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.deepEqual(verdict.signals, []);
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.reason, null);
  assert.equal(verdict.prevDifferenceM, 50);
  assert.equal(verdict.differenceM, 50);
  assert.equal(verdict.jumpM, 0);
  assert.equal(verdict.boundM, 90);
  assert.equal(verdict.excessM, 0);
  assert.equal(verdict.ratio, null);
  assert.equal(verdict.gvaBoundM, 90);
});

test('a constant 300 m absolute offset passes: only the jump is judged', () => {
  // Cycle 4 fixed-band divergence would flag this; differencing must not.
  const verdict = checkBaroGeomDrift(fix(300), later(300));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.jumpM, 0);
});

test('equal climb in both altitudes is consistent: true motion cancels', () => {
  const prev = fix(50);
  const curr = {
    baroAltM: prev.baroAltM + 1000,
    geomAltM: prev.geomAltM + 1000,
    gva: 2,
    atMs: DT_MS,
  };
  const verdict = checkBaroGeomDrift(prev, curr);
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.jumpM, 0);
});

test('a jump just above the GVA-sum bound is anomalous', () => {
  // GVA 2 + GVA 2 = 90 m bound; jump 91 m.
  const verdict = checkBaroGeomDrift(fix(0), later(91));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, true);
  assert.deepEqual(verdict.signals, [BARO_GEOM_DRIFT_SIGNAL]);
  // Per-pair verdicts never carry an interpretation.
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.jumpM, 91);
  assert.equal(verdict.boundM, 90);
  assert.equal(verdict.excessM, 1);
  assert.ok(Math.abs(verdict.ratio - 91 / 90) < 1e-12);
});

test('a jump exactly at the bound is consistent (strict comparison)', () => {
  const verdict = checkBaroGeomDrift(fix(0), later(90));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.excessM, 0);
  assert.equal(verdict.ratio, null);
});

test('a jump below the bound is consistent', () => {
  const verdict = checkBaroGeomDrift(fix(0), later(89));
  assert.equal(verdict.anomalous, false);
});

test('a downward jump counts the same as an upward one', () => {
  const verdict = checkBaroGeomDrift(fix(100), later(0));
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, true);
  assert.equal(verdict.jumpM, 100);
  assert.equal(verdict.excessM, 10);
});

test('looser GVA widens the bound: GVA 1 + GVA 1 = 300 m', () => {
  const prev = fix(0, { gva: 1 });
  const curr = later(200, { gva: 1 });
  const verdict = checkBaroGeomDrift(prev, curr);
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.boundM, 300);
  const over = checkBaroGeomDrift(prev, later(301, { gva: 1 }));
  assert.equal(over.anomalous, true);
  assert.equal(over.excessM, 1);
});

test('mixed GVA sums both fixes bounds: GVA 1 + GVA 2 = 195 m', () => {
  const verdict = checkBaroGeomDrift(
    fix(0, { gva: 1 }),
    later(196, { gva: 2 }),
  );
  assert.equal(verdict.boundM, 195);
  assert.equal(verdict.anomalous, true);
  assert.equal(verdict.gvaBoundM, 195);
});

test('GVA 0 is unknown and unjudged', () => {
  const verdict = checkBaroGeomDrift(
    fix(0, { gva: 0 }),
    later(5000, { gva: 2 }),
  );
  assert.equal(verdict.judged, false);
  assert.equal(verdict.reason, 'unknown-accuracy');
  assert.equal(verdict.gvaPrev, 0);
});

test('GVA 3 is reserved and unjudged', () => {
  const verdict = checkBaroGeomDrift(
    fix(0, { gva: 3 }),
    later(5000, { gva: 2 }),
  );
  assert.equal(verdict.judged, false);
  assert.equal(verdict.reason, 'gva-reserved');
});

test('missing GVA is missing-quality, out-of-range GVA is invalid-quality', () => {
  const missing = checkBaroGeomDrift(
    fix(0, { gva: undefined }),
    later(5000, { gva: 2 }),
  );
  assert.equal(missing.judged, false);
  assert.equal(missing.reason, 'missing-quality');
  const invalid = checkBaroGeomDrift(
    fix(0, { gva: 4 }),
    later(5000, { gva: 2 }),
  );
  assert.equal(invalid.reason, 'invalid-quality');
});

test('missing altitude is missing-altitude, NaN altitude is invalid-altitude', () => {
  const missing = checkBaroGeomDrift(
    { geomAltM: 1000, gva: 2, atMs: 0 },
    later(0),
  );
  assert.equal(missing.reason, 'missing-altitude');
  const invalid = checkBaroGeomDrift(
    fix(0, { geomAltM: Number.NaN }),
    later(0),
  );
  assert.equal(invalid.reason, 'invalid-altitude');
});

test('negative altitudes are allowed (below-sea-level terrain)', () => {
  const verdict = checkBaroGeomDrift(
    fix(10, { baroAltM: -400, geomAltM: -410 }),
    later(10, { baroAltM: -400, geomAltM: -410 }),
  );
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
});

test('invalid timestamps and intervals are unjudged', () => {
  const noTime = checkBaroGeomDrift(fix(0, { atMs: undefined }), later(5000));
  assert.equal(noTime.reason, 'invalid-time');
  const negative = checkBaroGeomDrift(fix(0), fix(5000, { atMs: -1000 }));
  assert.equal(negative.reason, 'negative-dt');
  const tooLong = checkBaroGeomDrift(
    fix(0),
    fix(5000, { atMs: BARO_GEOM_DRIFT_MAX_INTERVAL_MS + 1 }),
  );
  assert.equal(tooLong.reason, 'interval-too-long');
  const atMax = checkBaroGeomDrift(
    fix(0),
    fix(5000, { atMs: BARO_GEOM_DRIFT_MAX_INTERVAL_MS }),
  );
  assert.equal(atMax.judged, true);
});

test('an invalid barometric-drift allowance is unjudged, never NaN-bound', () => {
  const nan = checkBaroGeomDrift(fix(0), later(5000), {
    baroDriftAllowanceM: Number.NaN,
  });
  assert.equal(nan.judged, false);
  assert.equal(nan.reason, 'invalid-allowance');
  const negative = checkBaroGeomDrift(fix(0), later(5000), {
    baroDriftAllowanceM: -1,
  });
  assert.equal(negative.reason, 'invalid-allowance');
});

test('barometric-drift allowance widens the bound', () => {
  const strict = checkBaroGeomDrift(fix(0), later(100));
  assert.equal(strict.anomalous, true);
  const allowed = checkBaroGeomDrift(fix(0), later(100), {
    baroDriftAllowanceM: 20,
  });
  assert.equal(allowed.anomalous, false);
  assert.equal(allowed.boundM, 110);
  assert.equal(allowed.baroDriftAllowanceM, 20);
});

test('check throws TypeError on null or non-object fixes', () => {
  assert.throws(() => checkBaroGeomDrift(null, later(0)), TypeError);
  assert.throws(() => checkBaroGeomDrift(fix(0), 'nope'), TypeError);
});

test('detect emits one event per violating pair, in timestamp order', () => {
  const fixes = [
    later(500, { atMs: 2 * DT_MS, hex: 'abc' }),
    fix(0, { hex: 'abc' }),
    later(100, { atMs: 3 * DT_MS, hex: 'abc' }),
  ];
  const events = detectBaroGeomDriftEvents(fixes);
  assert.equal(events.length, 2);
  assert.equal(events[0].atMs, 2 * DT_MS);
  assert.equal(events[0].hex, 'abc');
  assert.equal(events[0].jumpM, 500);
  assert.equal(events[0].signal, BARO_GEOM_DRIFT_SIGNAL);
  // Events carry NO interpretation: that judgment is summary-level only.
  assert.ok(!('interpretation' in events[0]));
  assert.equal(events[1].atMs, 3 * DT_MS);
  assert.equal(events[1].jumpM, 400);
});

test('detect skips unjudged pairs and uses the fallback hex', () => {
  const fixes = [
    fix(0, { gva: 0 }),
    later(5000),
    later(5100, { atMs: 2 * DT_MS }),
  ];
  const events = detectBaroGeomDriftEvents(fixes, { hex: 'fallback' });
  assert.equal(events.length, 1);
  assert.equal(events[0].hex, 'fallback');
  assert.equal(events[0].jumpM, 100);
});

test('detect throws TypeError on a non-array', () => {
  assert.throws(() => detectBaroGeomDriftEvents(null), TypeError);
});

test('summarize: empty and lone events never corroborate', () => {
  const empty = summarizeBaroGeomDriftEvents([]);
  assert.deepEqual(empty, {
    count: 0,
    aircraftCount: 0,
    corroborated: false,
    windowMs: BARO_GEOM_DRIFT_CORROBORATION_WINDOW_MS,
    firstAtMs: null,
    lastAtMs: null,
    interpretation: null,
  });
  const lone = summarizeBaroGeomDriftEvents([{ hex: 'a1', atMs: 1000 }]);
  assert.equal(lone.corroborated, false);
  assert.equal(lone.interpretation, null);
  assert.equal(lone.aircraftCount, 1);
});

test('summarize: two distinct aircraft inside the window corroborate', () => {
  const summary = summarizeBaroGeomDriftEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a2', atMs: 2000 },
  ]);
  assert.equal(summary.corroborated, true);
  assert.equal(summary.interpretation, BARO_GEOM_DRIFT_INTERPRETATION);
  assert.equal(summary.aircraftCount, 2);
  assert.equal(summary.firstAtMs, 1000);
  assert.equal(summary.lastAtMs, 2000);
});

test('summarize: two events from one aircraft never corroborate', () => {
  const summary = summarizeBaroGeomDriftEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a1', atMs: 2000 },
  ]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize: two aircraft outside the window do not corroborate', () => {
  const summary = summarizeBaroGeomDriftEvents([
    { hex: 'a1', atMs: 0 },
    { hex: 'a2', atMs: BARO_GEOM_DRIFT_CORROBORATION_WINDOW_MS + 1 },
  ]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize ignores events without a finite timestamp', () => {
  const summary = summarizeBaroGeomDriftEvents([
    { hex: 'a1', atMs: 1000 },
    { hex: 'a2' },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.corroborated, false);
});
