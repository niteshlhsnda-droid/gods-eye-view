import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTEGRITY_ASSURANCE_CORROBORATION_MIN_AIRCRAFT,
  INTEGRITY_ASSURANCE_CORROBORATION_WINDOW_MS,
  INTEGRITY_ASSURANCE_INTERPRETATION,
  INTEGRITY_ASSURANCE_REASONS,
  INTEGRITY_ASSURANCE_SIGNAL,
  INTEGRITY_UNASSURED_SIGNAL,
  detectIntegrityAssuranceEvents,
  integrityAssuranceCheck,
  summarizeIntegrityAssuranceEvents,
} from './integrityAssurance.js';

test('typical coherent triples pass: full integrity with real assurance', () => {
  // NIC 11 with SIL 3 and SDA 2: the textbook ADS-B Out report.
  const airline = integrityAssuranceCheck({ nic: 11, sil: 3, sda: 2 });
  assert.equal(airline.judged, true);
  assert.equal(airline.anomalous, false);
  assert.deepEqual(airline.signals, []);
  assert.equal(airline.interpretation, null);
  assert.equal(airline.reason, null);
  assert.deepEqual(airline.reasons, []);
  assert.equal(airline.severity, null);

  // SIL 3 with SDA 3 (hazardous assurance) also satisfies pairing.
  assert.equal(
    integrityAssuranceCheck({ nic: 8, sil: 3, sda: 3 }).anomalous,
    false,
  );
  // Mid-range claims cohere.
  assert.equal(
    integrityAssuranceCheck({ nic: 8, sil: 2, sda: 2 }).anomalous,
    false,
  );
  assert.equal(
    integrityAssuranceCheck({ nic: 7, sil: 1, sda: 1 }).anomalous,
    false,
  );
});

test('absence of a claim is coherent: SIL 0 never trips any rule', () => {
  // Unknown containment, unknown integrity, no assurance: weak, coherent.
  assert.equal(
    integrityAssuranceCheck({ nic: 0, sil: 0, sda: 0 }).anomalous,
    false,
  );
  // Tight containment with no integrity claim is coherent.
  assert.equal(
    integrityAssuranceCheck({ nic: 11, sil: 0, sda: 0 }).anomalous,
    false,
  );
  // High design assurance with no quantified integrity claim is coherent.
  assert.equal(
    integrityAssuranceCheck({ nic: 11, sil: 0, sda: 3 }).anomalous,
    false,
  );
});

test('SIL over unknown containment is incoherent at every claimed SIL', () => {
  for (const sil of [1, 2, 3]) {
    const result = integrityAssuranceCheck({ nic: 0, sil, sda: 2 });
    assert.equal(result.judged, true);
    assert.equal(result.anomalous, true);
    assert.deepEqual(result.signals, [INTEGRITY_ASSURANCE_SIGNAL]);
    assert.equal(result.interpretation, INTEGRITY_ASSURANCE_INTERPRETATION);
    assert.deepEqual(result.reasons, [
      INTEGRITY_ASSURANCE_REASONS.UNKNOWN_CONTAINMENT,
    ]);
    assert.equal(result.severity, 'incoherent');
  }
});

test('SIL 3 with SDA below 2 violates the DO-260B pairing rule', () => {
  for (const sda of [0, 1]) {
    const result = integrityAssuranceCheck({ nic: 11, sil: 3, sda });
    assert.equal(result.judged, true);
    assert.equal(result.anomalous, true);
    assert.equal(result.severity, 'incoherent');
    assert.ok(
      result.reasons.includes(INTEGRITY_ASSURANCE_REASONS.SIL3_WITHOUT_SDA),
    );
  }
  // Edge: SIL 3 with SDA exactly 2 satisfies the pairing rule.
  assert.equal(
    integrityAssuranceCheck({ nic: 11, sil: 3, sda: 2 }).anomalous,
    false,
  );
});

test('SIL 3 with SDA 0 fires only the pairing rule, never the warning', () => {
  // The unassured warning covers SIL 1–2 only; SIL 3 + SDA 0 must not
  // double-fire as both incoherent and unassured.
  const result = integrityAssuranceCheck({ nic: 11, sil: 3, sda: 0 });
  assert.deepEqual(result.reasons, [
    INTEGRITY_ASSURANCE_REASONS.SIL3_WITHOUT_SDA,
  ]);
  assert.deepEqual(result.signals, [INTEGRITY_ASSURANCE_SIGNAL]);
});

test('SIL 1–2 with SDA 0 is unassured: warning, not incoherence', () => {
  for (const sil of [1, 2]) {
    const result = integrityAssuranceCheck({ nic: 11, sil, sda: 0 });
    assert.equal(result.judged, true);
    assert.equal(result.anomalous, true);
    assert.deepEqual(result.signals, [INTEGRITY_UNASSURED_SIGNAL]);
    assert.equal(result.interpretation, INTEGRITY_ASSURANCE_INTERPRETATION);
    assert.deepEqual(result.reasons, [INTEGRITY_ASSURANCE_REASONS.UNASSURED]);
    assert.equal(result.severity, 'unassured');
  }
  // SIL 1–2 with any real assurance (SDA 1+) passes.
  assert.equal(
    integrityAssuranceCheck({ nic: 11, sil: 2, sda: 1 }).anomalous,
    false,
  );
});

test('two incoherent rules can fire together on one fix', () => {
  // NIC 0 + SIL 3 + SDA 0: unknown containment AND pairing violation.
  const result = integrityAssuranceCheck({ nic: 0, sil: 3, sda: 0 });
  assert.deepEqual(result.reasons, [
    INTEGRITY_ASSURANCE_REASONS.UNKNOWN_CONTAINMENT,
    INTEGRITY_ASSURANCE_REASONS.SIL3_WITHOUT_SDA,
  ]);
  assert.equal(result.severity, 'incoherent');
  assert.deepEqual(result.signals, [INTEGRITY_ASSURANCE_SIGNAL]);
});

test('partial fixes are judged on the rules their fields support', () => {
  // No NIC: the SDA rules still judge SIL 3 + SDA 0.
  const noNic = integrityAssuranceCheck({ sil: 3, sda: 0 });
  assert.equal(noNic.judged, true);
  assert.equal(noNic.anomalous, true);
  assert.equal(noNic.nic, null);
  // No SDA: the NIC rule still judges SIL over unknown containment.
  const noSda = integrityAssuranceCheck({ nic: 0, sil: 1 });
  assert.equal(noSda.judged, true);
  assert.equal(noSda.anomalous, true);
  assert.equal(noSda.sda, null);
  // No NIC and coherent SDA pair: judged, passes.
  assert.equal(integrityAssuranceCheck({ sil: 2, sda: 2 }).anomalous, false);
  // No SDA and known containment: judged, passes.
  assert.equal(integrityAssuranceCheck({ nic: 11, sil: 2 }).anomalous, false);
});

test('unjudgeable fixes record the reason instead of a verdict', () => {
  // No SIL: every rule needs SIL, so nothing is evaluable.
  const noSil = integrityAssuranceCheck({ nic: 11, sda: 2 });
  assert.equal(noSil.judged, false);
  assert.equal(noSil.anomalous, false);
  assert.equal(noSil.reason, 'missing-quality');
  // Nothing at all.
  assert.equal(integrityAssuranceCheck({}).reason, 'missing-quality');
  // NIC + SDA without SIL is still missing-quality.
  assert.equal(
    integrityAssuranceCheck({ nic: 0, sda: 0 }).reason,
    'missing-quality',
  );
});

test('present-but-invalid fields are not judged at all', () => {
  for (const fix of [
    { nic: 11, sil: 4, sda: 2 },
    { nic: 11, sil: 3, sda: 4 },
    { nic: 12, sil: 3, sda: 2 },
    { nic: 11, sil: -1, sda: 2 },
    { nic: 11, sil: 2.5, sda: 2 },
    { nic: 'high', sil: 3, sda: 2 },
  ]) {
    const result = integrityAssuranceCheck(fix);
    assert.equal(result.judged, false);
    assert.equal(result.anomalous, false);
    assert.equal(result.reason, 'invalid-quality');
  }
  // An invalid field poisons even a rule that does not need it.
  assert.equal(
    integrityAssuranceCheck({ sil: 3, sda: 0, nic: 99 }).reason,
    'invalid-quality',
  );
});

test('a non-object fix throws', () => {
  assert.throws(() => integrityAssuranceCheck(null), /requires a fix object/);
  assert.throws(
    () => integrityAssuranceCheck('nic=11'),
    /requires a fix object/,
  );
});

test('detect emits one event per bad fix, in input order', () => {
  const fixes = [
    { hex: 'aaaaaa', atMs: 1000, nic: 11, sil: 3, sda: 2 },
    { hex: 'bbbbbb', atMs: 2000, nic: 0, sil: 2, sda: 2 },
    { hex: 'cccccc', atMs: 3000, nic: 11, sil: 1, sda: 0 },
    { hex: 'dddddd', atMs: 4000 },
    null,
  ];
  const events = detectIntegrityAssuranceEvents(fixes);
  assert.equal(events.length, 2);
  assert.equal(events[0].hex, 'bbbbbb');
  assert.equal(events[0].atMs, 2000);
  assert.deepEqual(events[0].reasons, [
    INTEGRITY_ASSURANCE_REASONS.UNKNOWN_CONTAINMENT,
  ]);
  assert.equal(events[0].severity, 'incoherent');
  assert.equal(events[0].signal, INTEGRITY_ASSURANCE_SIGNAL);
  assert.equal(events[1].hex, 'cccccc');
  assert.equal(events[1].severity, 'unassured');
  assert.equal(events[1].signal, INTEGRITY_UNASSURED_SIGNAL);
  assert.equal(events[1].interpretation, INTEGRITY_ASSURANCE_INTERPRETATION);
});

test('detect stamps the fallback hex and nulls a missing timestamp', () => {
  const events = detectIntegrityAssuranceEvents([{ nic: 0, sil: 1, sda: 2 }], {
    hex: 'fallback',
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].hex, 'fallback');
  assert.equal(events[0].atMs, null);
});

test('detect requires an array', () => {
  assert.throws(
    () => detectIntegrityAssuranceEvents(null),
    /requires an array/,
  );
});

test('summarize corroborates only distinct aircraft inside one window', () => {
  const now = 1_000_000;
  const twoAircraft = [
    { hex: 'aaaaaa', atMs: now },
    { hex: 'bbbbbb', atMs: now + 1000 },
  ];
  const summary = summarizeIntegrityAssuranceEvents(twoAircraft);
  assert.equal(summary.corroborated, true);
  assert.equal(summary.count, 2);
  assert.equal(summary.aircraftCount, 2);
  assert.equal(summary.windowMs, INTEGRITY_ASSURANCE_CORROBORATION_WINDOW_MS);
  assert.equal(summary.firstAtMs, now);
  assert.equal(summary.lastAtMs, now + 1000);

  // Two events from ONE aircraft never corroborate each other.
  const oneAircraft = [
    { hex: 'aaaaaa', atMs: now },
    { hex: 'aaaaaa', atMs: now + 1000 },
  ];
  assert.equal(
    summarizeIntegrityAssuranceEvents(oneAircraft).corroborated,
    false,
  );

  // Two aircraft farther apart than the window never corroborate.
  const farApart = [
    { hex: 'aaaaaa', atMs: now },
    {
      hex: 'bbbbbb',
      atMs: now + INTEGRITY_ASSURANCE_CORROBORATION_WINDOW_MS + 1,
    },
  ];
  assert.equal(summarizeIntegrityAssuranceEvents(farApart).corroborated, false);

  // The corroboration bar is configurable.
  assert.equal(
    summarizeIntegrityAssuranceEvents(twoAircraft, { minAircraft: 3 })
      .corroborated,
    false,
  );
  assert.equal(INTEGRITY_ASSURANCE_CORROBORATION_MIN_AIRCRAFT, 2);
});

test('summarize ignores timestamp-less events and handles empty input', () => {
  const summary = summarizeIntegrityAssuranceEvents([
    { hex: 'aaaaaa', atMs: null },
    { hex: 'bbbbbb' },
  ]);
  assert.equal(summary.count, 0);
  assert.equal(summary.aircraftCount, 0);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.firstAtMs, null);
  assert.equal(summary.lastAtMs, null);
  assert.equal(summary.interpretation, null);

  const empty = summarizeIntegrityAssuranceEvents([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.corroborated, false);
});
