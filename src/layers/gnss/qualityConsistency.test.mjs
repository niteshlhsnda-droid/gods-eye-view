import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUALITY_CONSISTENCY_INTERPRETATION,
  QUALITY_CONSISTENCY_MAX_RATIO,
  QUALITY_CONSISTENCY_SIGNAL,
  detectQualityConsistencyEvents,
  qualityConsistencyCheck,
  summarizeQualityConsistencyEvents,
} from './qualityConsistency.js';

test('typical coherent pairs pass: tight NIC with tighter NACp', () => {
  // NIC 7 (Rc < 0.2 NM) with NACp 9 (EPU < 30 m): ratio ~0.08.
  const airline = qualityConsistencyCheck({ nic: 7, nacp: 9 });
  assert.equal(airline.judged, true);
  assert.equal(airline.anomalous, false);
  assert.deepEqual(airline.signals, []);
  assert.equal(airline.interpretation, null);
  assert.equal(airline.reason, null);
  assert.ok(airline.ratio < 0.1);
  assert.ok(airline.ratio > 0.07);

  // NIC 8 with NACp 10, NIC 9 with NACp 11: same shape, tighter.
  assert.equal(qualityConsistencyCheck({ nic: 8, nacp: 10 }).anomalous, false);
  assert.equal(qualityConsistencyCheck({ nic: 9, nacp: 11 }).anomalous, false);
});

test('matched loose pairs pass: equal categories are coherent', () => {
  // NIC 5 (Rc < 1 NM) with NACp 5 (EPU < 0.5 NM): ratio 0.5.
  const loose = qualityConsistencyCheck({ nic: 5, nacp: 5 });
  assert.equal(loose.judged, true);
  assert.equal(loose.anomalous, false);
  assert.ok(loose.ratio > 0.49);
  assert.ok(loose.ratio < 0.51);
  assert.equal(qualityConsistencyCheck({ nic: 1, nacp: 1 }).anomalous, false);
});

test('tight NIC with loose NACp is incoherent', () => {
  // NIC 10 (Rc < 25 m) with NACp 7 (EPU < 0.1 NM): ratio ~7.4.
  const result = qualityConsistencyCheck({ nic: 10, nacp: 7 });
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, true);
  assert.deepEqual(result.signals, [QUALITY_CONSISTENCY_SIGNAL]);
  assert.equal(result.interpretation, QUALITY_CONSISTENCY_INTERPRETATION);
  assert.equal(result.containmentRadiusM, 25);
  assert.ok(result.epuBoundM > 185);
  assert.ok(result.epuBoundM < 186);
  assert.ok(result.ratio > 7.3);
  assert.ok(result.ratio < 7.5);

  // NIC 9 (Rc < 75 m) with NACp 6 (EPU < 0.3 NM): ratio ~7.4.
  assert.equal(qualityConsistencyCheck({ nic: 9, nacp: 6 }).anomalous, true);
  // NIC 8 (Rc < 0.1 NM) with NACp 5 (EPU < 0.5 NM): ratio 5.0.
  assert.equal(qualityConsistencyCheck({ nic: 8, nacp: 5 }).anomalous, true);
  // NIC 11 (Rc < 7.5 m) with NACp 8 (EPU < 0.05 NM): ratio ~12.3.
  assert.equal(qualityConsistencyCheck({ nic: 11, nacp: 8 }).anomalous, true);
});

test('the exact edge ratio 4.0 passes: the edge is strict', () => {
  // NIC 11 (Rc < 7.5 m) with NACp 9 (EPU < 30 m): 30 / 7.5 = 4.0.
  const boundary = qualityConsistencyCheck({ nic: 11, nacp: 9 });
  assert.equal(boundary.judged, true);
  assert.equal(boundary.anomalous, false);
  assert.equal(boundary.ratio, 4);
  assert.deepEqual(boundary.signals, []);
});

test('just inside the edge passes, just outside fails', () => {
  // NIC 10 (Rc < 25 m) with NACp 8 (EPU < 0.05 NM): ratio ~3.7.
  const inside = qualityConsistencyCheck({ nic: 10, nacp: 8 });
  assert.equal(inside.anomalous, false);
  assert.ok(inside.ratio > 3.6);
  assert.ok(inside.ratio < 3.8);
  // NIC 10 with NACp 7 (EPU < 0.1 NM): ratio ~7.4.
  assert.equal(qualityConsistencyCheck({ nic: 10, nacp: 7 }).anomalous, true);
});

test('NIC 0 is unknown-containment, never anomalous', () => {
  const result = qualityConsistencyCheck({ nic: 0, nacp: 11 });
  assert.equal(result.judged, false);
  assert.equal(result.anomalous, false);
  assert.equal(result.reason, 'unknown-containment');
  assert.deepEqual(result.signals, []);
  // Even the records.js unknown exception pair (NIC 0, NACp >= 10) is
  // unknown containment here, not an inconsistency.
  assert.equal(
    qualityConsistencyCheck({ nic: 0, nacp: 10 }).reason,
    'unknown-containment',
  );
});

test('NACp 0 is unknown-accuracy, never anomalous', () => {
  const result = qualityConsistencyCheck({ nic: 11, nacp: 0 });
  assert.equal(result.judged, false);
  assert.equal(result.anomalous, false);
  assert.equal(result.reason, 'unknown-accuracy');
});

test('missing fields are missing-quality, never anomalous', () => {
  assert.equal(qualityConsistencyCheck({}).reason, 'missing-quality');
  assert.equal(qualityConsistencyCheck({ nic: 7 }).reason, 'missing-quality');
  assert.equal(qualityConsistencyCheck({ nacp: 9 }).reason, 'missing-quality');
  assert.equal(
    qualityConsistencyCheck({ nic: null, nacp: null }).reason,
    'missing-quality',
  );
  for (const result of [
    qualityConsistencyCheck({}),
    qualityConsistencyCheck({ nic: 7 }),
    qualityConsistencyCheck({ nacp: 9 }),
  ]) {
    assert.equal(result.judged, false);
    assert.equal(result.anomalous, false);
  }
});

test('out-of-range or non-integer categories are invalid-quality', () => {
  for (const fix of [
    { nic: 12, nacp: 9 },
    { nic: 7, nacp: 12 },
    { nic: -1, nacp: 9 },
    { nic: 7.5, nacp: 9 },
    { nic: '7', nacp: 9 },
    { nic: Number.NaN, nacp: 9 },
  ]) {
    const result = qualityConsistencyCheck(fix);
    assert.equal(result.judged, false);
    assert.equal(result.anomalous, false);
    assert.equal(result.reason, 'invalid-quality');
  }
});

test('an on-ground fix is still judged: ground state is irrelevant', () => {
  const result = qualityConsistencyCheck({
    nic: 10,
    nacp: 7,
    onGround: true,
  });
  assert.equal(result.judged, true);
  assert.equal(result.anomalous, true);
  assert.equal(
    qualityConsistencyCheck({ nic: 7, nacp: 9, onGround: true }).anomalous,
    false,
  );
});

test('detect yields one event per incoherent fix, in input order', () => {
  const fixes = [
    { nic: 7, nacp: 9, hex: 'aaa111', atMs: 0 },
    { nic: 10, nacp: 7, hex: 'bbb222', atMs: 10_000 },
    { nic: 0, nacp: 11, hex: 'ccc333', atMs: 20_000 },
    { nic: 9, nacp: 6, hex: 'ddd444', atMs: 30_000 },
    { nic: 7, nacp: 9, hex: 'eee555', atMs: 40_000 },
  ];
  const events = detectQualityConsistencyEvents(fixes);
  assert.equal(events.length, 2);
  assert.equal(events[0].hex, 'bbb222');
  assert.equal(events[0].atMs, 10_000);
  assert.equal(events[0].nic, 10);
  assert.equal(events[0].nacp, 7);
  assert.equal(events[0].signal, QUALITY_CONSISTENCY_SIGNAL);
  assert.equal(events[0].interpretation, QUALITY_CONSISTENCY_INTERPRETATION);
  assert.ok(events[0].ratio > 7.3);
  assert.equal(events[1].hex, 'ddd444');
  assert.equal(events[1].atMs, 30_000);
});

test('detect skips null, non-object, and unjudgeable fixes', () => {
  const events = detectQualityConsistencyEvents([
    null,
    'nope',
    { nic: 10, nacp: 7, hex: 'aaa111', atMs: 0 },
    {},
    { nic: 12, nacp: 7 },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].hex, 'aaa111');
});

test('detect stamps the hex from the fix, else the caller option', () => {
  const withHex = detectQualityConsistencyEvents([
    { nic: 10, nacp: 7, hex: 'abc123', atMs: 0 },
  ]);
  assert.equal(withHex[0].hex, 'abc123');
  const withoutHex = detectQualityConsistencyEvents(
    [{ nic: 10, nacp: 7, atMs: 0 }],
    { hex: 'def456' },
  );
  assert.equal(withoutHex[0].hex, 'def456');
  const noHex = detectQualityConsistencyEvents([{ nic: 10, nacp: 7, atMs: 0 }]);
  assert.equal(noHex[0].hex, null);
});

test('detect keeps atMs null when the fix carries none', () => {
  const events = detectQualityConsistencyEvents([{ nic: 10, nacp: 7 }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].atMs, null);
});

test('a caller-supplied edge is honoured', () => {
  const fix = { nic: 10, nacp: 7 }; // ratio ~7.4
  assert.equal(qualityConsistencyCheck(fix, { maxRatio: 8 }).anomalous, false);
  assert.equal(
    detectQualityConsistencyEvents([fix], { maxRatio: 8 }).length,
    0,
  );
  assert.ok(QUALITY_CONSISTENCY_MAX_RATIO < 8);
});

test('two aircraft misreporting together corroborate; one alone does not', () => {
  const first = detectQualityConsistencyEvents([
    { nic: 10, nacp: 7, hex: 'aaa111', atMs: 0 },
  ]);
  const second = detectQualityConsistencyEvents([
    { nic: 9, nacp: 6, hex: 'bbb222', atMs: 60_000 },
  ]);
  const both = summarizeQualityConsistencyEvents([...first, ...second]);
  assert.equal(both.count, 2);
  assert.equal(both.aircraftCount, 2);
  assert.equal(both.corroborated, true);
  assert.equal(both.interpretation, QUALITY_CONSISTENCY_INTERPRETATION);

  const oneAircraft = summarizeQualityConsistencyEvents([
    ...first,
    ...detectQualityConsistencyEvents([
      { nic: 9, nacp: 6, hex: 'aaa111', atMs: 60_000 },
    ]),
  ]);
  assert.equal(oneAircraft.aircraftCount, 1);
  assert.equal(oneAircraft.corroborated, false);
});

test('misreports far apart in time do not corroborate', () => {
  const first = detectQualityConsistencyEvents([
    { nic: 10, nacp: 7, hex: 'aaa111', atMs: 0 },
  ]);
  const later = detectQualityConsistencyEvents([
    { nic: 9, nacp: 6, hex: 'bbb222', atMs: 600_000 },
  ]);
  const summary = summarizeQualityConsistencyEvents([...first, ...later]);
  assert.equal(summary.corroborated, false);
});

test('summarize ignores events without a finite timestamp', () => {
  const summary = summarizeQualityConsistencyEvents([
    { hex: 'aaa111', atMs: null },
    { hex: 'bbb222', atMs: Number.NaN },
  ]);
  assert.equal(summary.count, 0);
  assert.equal(summary.aircraftCount, 0);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize with no events is empty, never corroborated', () => {
  const summary = summarizeQualityConsistencyEvents([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.aircraftCount, 0);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.firstAtMs, null);
  assert.equal(summary.lastAtMs, null);
  assert.equal(summary.interpretation, null);
  assert.equal(summary.windowMs, 300_000);
  assert.equal(summarizeQualityConsistencyEvents([]).interpretation, null);
});

test('invalid input throws where the lane throws', () => {
  assert.throws(() => qualityConsistencyCheck(null), TypeError);
  assert.throws(() => qualityConsistencyCheck('nope'), TypeError);
  assert.throws(() => detectQualityConsistencyEvents(null), TypeError);
  assert.doesNotThrow(() => summarizeQualityConsistencyEvents(null));
  assert.doesNotThrow(() => summarizeQualityConsistencyEvents(undefined));
});
