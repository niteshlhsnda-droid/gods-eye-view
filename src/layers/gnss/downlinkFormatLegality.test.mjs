import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DF_TC_OUT_OF_SCOPE_DFS,
  DF_TC_RESERVED_TYPE_CODES,
  DF_TC_SCOPE_DFS,
  DF_TC_SIGNAL_ILLEGAL_DF_TC_COMBO,
  DF_TC_SIGNAL_RESERVED_TC,
  DF_TC_SIGNAL_UNKNOWN_DF,
  DF_TC_TYPE_CODE_DFS,
  auditDownlinkFormatPairs,
  classifyDownlinkFormatLegality,
  describeTypeCode,
} from './downlinkFormatLegality.js';

test('assigned type codes on DF 17/18 are legal, including the version-2 status messages', () => {
  // TC 1–4/5–8/9–18/19/20–22 are the position/velocity/identity core;
  // TC 28/29/31 are ASSIGNED version-2 messages (aircraft status, target
  // state and status, operational status) — the research-corrected table
  // deliberately keeps them out of the reserved set.
  for (const tc of [1, 4, 5, 8, 9, 18, 19, 20, 22, 28, 29, 31]) {
    for (const df of [17, 18]) {
      const verdict = classifyDownlinkFormatLegality(df, tc);
      assert.equal(verdict.legal, true, `DF ${df} TC ${tc}`);
      assert.deepEqual(verdict.signals, []);
      assert.equal(verdict.reason, null);
    }
  }
  // A DF 17 emergency squitter (TC 28 subtype 1) must never be flagged.
  assert.equal(
    describeTypeCode(28),
    'aircraft status (emergency/priority, ACAS RA)',
  );
});

test('reserved type codes on DF 17/18/19 are flagged', () => {
  for (const tc of DF_TC_RESERVED_TYPE_CODES) {
    for (const df of DF_TC_TYPE_CODE_DFS) {
      const verdict = classifyDownlinkFormatLegality(df, tc);
      assert.equal(verdict.legal, false, `DF ${df} TC ${tc}`);
      assert.deepEqual(verdict.signals, [DF_TC_SIGNAL_RESERVED_TC]);
      assert.equal(verdict.reason, 'reserved-type-code');
      assert.equal(verdict.df, df);
      assert.equal(verdict.tc, tc);
    }
  }
});

test('reserved-set boundaries are exact', () => {
  // 22 assigned, 23 reserved; 27 reserved, 28 assigned; 30 reserved,
  // 31 assigned. TC 0 is unassigned (no type code).
  assert.equal(classifyDownlinkFormatLegality(17, 22).legal, true);
  assert.equal(classifyDownlinkFormatLegality(17, 23).legal, false);
  assert.equal(classifyDownlinkFormatLegality(18, 27).legal, false);
  assert.equal(classifyDownlinkFormatLegality(18, 28).legal, true);
  assert.equal(classifyDownlinkFormatLegality(17, 30).legal, false);
  assert.equal(classifyDownlinkFormatLegality(17, 31).legal, true);
  const zero = classifyDownlinkFormatLegality(17, 0);
  assert.equal(zero.legal, false);
  assert.deepEqual(zero.signals, [DF_TC_SIGNAL_RESERVED_TC]);
});

test('a missing type code on a TC-carrying DF is legal', () => {
  // A decoder that only extracted the DF reports tc null — not illegal.
  const verdict = classifyDownlinkFormatLegality(17);
  assert.equal(verdict.legal, true);
  assert.deepEqual(verdict.signals, []);
  assert.equal(verdict.tc, null);
});

test('a type code on DF 20/21 is an illegal combo: those bits are MB Comm-B data', () => {
  // DF 20/21 are roll-call replies; bits 33–88 are the MB field, so any
  // "type code" sliced from bits 33–37 is a decoding error.
  for (const df of [20, 21]) {
    const verdict = classifyDownlinkFormatLegality(df, 9);
    assert.equal(verdict.legal, false, `DF ${df}`);
    assert.deepEqual(verdict.signals, [DF_TC_SIGNAL_ILLEGAL_DF_TC_COMBO]);
    assert.equal(verdict.reason, 'type-code-not-applicable');
    // Without a TC these are the normal, legal roll-call replies.
    assert.equal(classifyDownlinkFormatLegality(df, null).legal, true);
  }
});

test('a type code on DF 4/5/11/24 is an illegal combo', () => {
  // DF 4/5/11 are 56-bit: bits 33–37 do not exist. DF 24 uses them for
  // the MD Comm-D message.
  for (const df of [4, 5, 11, 24]) {
    const verdict = classifyDownlinkFormatLegality(df, 4);
    assert.equal(verdict.legal, false, `DF ${df}`);
    assert.deepEqual(verdict.signals, [DF_TC_SIGNAL_ILLEGAL_DF_TC_COMBO]);
    assert.equal(classifyDownlinkFormatLegality(df).legal, true);
  }
});

test('undefined downlink formats are unknown-df', () => {
  for (const df of [1, 2, 3, 6, 7, 8, 9, 10, 12, 22, 23, 25, 31]) {
    const verdict = classifyDownlinkFormatLegality(df, 9);
    assert.equal(verdict.legal, false, `DF ${df}`);
    assert.deepEqual(verdict.signals, [DF_TC_SIGNAL_UNKNOWN_DF]);
    assert.equal(verdict.reason, 'undefined-downlink-format');
  }
});

test('defined but out-of-scope formats (DF 0/16 air-air) are unknown-df with their own reason', () => {
  for (const df of DF_TC_OUT_OF_SCOPE_DFS) {
    const verdict = classifyDownlinkFormatLegality(df, null);
    assert.equal(verdict.legal, false, `DF ${df}`);
    assert.deepEqual(verdict.signals, [DF_TC_SIGNAL_UNKNOWN_DF]);
    assert.equal(verdict.reason, 'out-of-scope-downlink-format');
  }
});

test('an unknown DF short-circuits before any TC judgment', () => {
  // Even a reserved TC on an unknown DF reports only unknown-df.
  const verdict = classifyDownlinkFormatLegality(7, 30);
  assert.deepEqual(verdict.signals, [DF_TC_SIGNAL_UNKNOWN_DF]);
});

test('invalid input returns null, never throws', () => {
  assert.equal(classifyDownlinkFormatLegality('17', 9), null);
  assert.equal(classifyDownlinkFormatLegality(17.5, 9), null);
  assert.equal(classifyDownlinkFormatLegality(-1, 9), null);
  assert.equal(classifyDownlinkFormatLegality(32, 9), null);
  assert.equal(classifyDownlinkFormatLegality(NaN, 9), null);
  assert.equal(classifyDownlinkFormatLegality(undefined), null);
  assert.equal(classifyDownlinkFormatLegality(17, 32), null);
  assert.equal(classifyDownlinkFormatLegality(17, 1.5), null);
  assert.equal(classifyDownlinkFormatLegality(17, '9'), null);
  assert.equal(classifyDownlinkFormatLegality(17, NaN), null);
});

test('describeTypeCode names every code and rejects invalid input', () => {
  assert.equal(describeTypeCode(9), 'airborne position (barometric altitude)');
  assert.equal(describeTypeCode(19), 'airborne velocities');
  assert.equal(describeTypeCode(31), 'aircraft operational status');
  assert.equal(describeTypeCode(23), 'reserved (test-message slot)');
  assert.equal(describeTypeCode(0), 'unassigned (no type code)');
  assert.equal(describeTypeCode(32), null);
  assert.equal(describeTypeCode('9'), null);
  assert.equal(describeTypeCode(null), null);
});

test('scope constants are frozen and complete', () => {
  assert.deepEqual([...DF_TC_SCOPE_DFS], [4, 5, 11, 17, 18, 19, 20, 21, 24]);
  assert.deepEqual([...DF_TC_TYPE_CODE_DFS], [17, 18, 19]);
  assert.deepEqual([...DF_TC_RESERVED_TYPE_CODES], [0, 23, 24, 25, 26, 27, 30]);
  assert.throws(() => {
    DF_TC_RESERVED_TYPE_CODES.push(99);
  }, TypeError);
});

test('audit aggregates a mixed batch with histogram and traceable offenders', () => {
  const summary = auditDownlinkFormatPairs([
    { df: 17, tc: 9, hex: 'a1b2c3', atMs: 1000 },
    { df: 17, tc: 30, hex: 'deadbe', atMs: 2000 },
    { df: 20, tc: 9, hex: 'cafe01', atMs: 3000 },
    { df: 7, tc: 9, hex: 'badf00', atMs: 4000 },
    { df: 21, tc: null },
    { df: 'x', tc: 9 },
    { df: 17, tc: 31 },
  ]);
  assert.equal(summary.pairCount, 6);
  assert.equal(summary.legalCount, 3);
  assert.equal(summary.illegalCount, 3);
  assert.equal(summary.invalidCount, 1);
  assert.deepEqual(summary.signalCounts, {
    [DF_TC_SIGNAL_RESERVED_TC]: 1,
    [DF_TC_SIGNAL_ILLEGAL_DF_TC_COMBO]: 1,
    [DF_TC_SIGNAL_UNKNOWN_DF]: 1,
  });
  assert.equal(summary.illegalPairs.length, 3);
  assert.deepEqual(summary.illegalPairs[0], {
    index: 1,
    df: 17,
    tc: 30,
    hex: 'deadbe',
    atMs: 2000,
    signals: [DF_TC_SIGNAL_RESERVED_TC],
    reason: 'reserved-type-code',
  });
  assert.equal(summary.illegalPairs[1].reason, 'type-code-not-applicable');
  assert.equal(summary.illegalPairs[2].reason, 'undefined-downlink-format');
});

test('audit handles empty and non-array input', () => {
  assert.deepEqual(auditDownlinkFormatPairs([]), {
    pairCount: 0,
    legalCount: 0,
    illegalCount: 0,
    invalidCount: 0,
    signalCounts: {},
    illegalPairs: [],
  });
  assert.equal(auditDownlinkFormatPairs(null).pairCount, 0);
  assert.equal(auditDownlinkFormatPairs(undefined).pairCount, 0);
});

test('audit echoes null hex/atMs when the caller supplies none', () => {
  const [offender] = auditDownlinkFormatPairs([{ df: 4, tc: 1 }]).illegalPairs;
  assert.equal(offender.hex, null);
  assert.equal(offender.atMs, null);
});

test('a realistic noisy-capture batch: only the true violations surface', () => {
  // A plausible RF capture: identity, surface, airborne, velocity,
  // emergency status, operational status — all legal — plus one
  // bit-flipped TC 30 and one decoder slicing TC off a DF 20 reply.
  const batch = [
    { df: 17, tc: 2 },
    { df: 17, tc: 6 },
    { df: 17, tc: 11 },
    { df: 18, tc: 19 },
    { df: 17, tc: 28 },
    { df: 17, tc: 31 },
    { df: 17, tc: 30 },
    { df: 20, tc: 11 },
    { df: 20, tc: null },
    { df: 11, tc: null },
  ];
  const summary = auditDownlinkFormatPairs(batch);
  assert.equal(summary.pairCount, 10);
  assert.equal(summary.legalCount, 8);
  assert.equal(summary.illegalCount, 2);
  assert.deepEqual(
    summary.illegalPairs.map((pair) => pair.tc),
    [30, 11],
  );
  assert.deepEqual(
    summary.illegalPairs.map((pair) => pair.signals[0]),
    [DF_TC_SIGNAL_RESERVED_TC, DF_TC_SIGNAL_ILLEGAL_DF_TC_COMBO],
  );
});
