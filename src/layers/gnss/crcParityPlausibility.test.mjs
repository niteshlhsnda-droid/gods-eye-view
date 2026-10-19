import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRC24_GENERATOR_POLY,
  CRC_CORROBORATED_INTERPRETATION,
  CRC_LONG_REPLY_DFS,
  CRC_SHORT_REPLY_DFS,
  CRC_SIGNAL_ATTRIBUTION_MISMATCH,
  CRC_SIGNAL_MALFORMED,
  CRC_SIGNAL_MISMATCH,
  CRC_SIGNAL_OK,
  CRC_SIGNAL_UNJUDGEABLE,
  CRC_SQUITTER_DFS,
  ICAO24_MASK,
  checkCrcParity,
  crc24Residue,
  hexToBitArray,
  summarizeCrcParity,
} from './crcParityPlausibility.js';

// Vectors from the published pyModeS test suite
// (tests/test_c_common.py, tests/test_py_common.py): valid DF 17
// messages must yield residue 0; valid DF 20/21 messages must yield
// their documented ICAO24 address; the corrupted DF 17 must not.
const DF17_VALID = [
  ['8D406B902015A678D4D220AA4BDA', 0x406b90],
  ['8d8960ed58bf053cf11bc5932b7d', 0x8960ed],
  ['8d45cab390c39509496ca9a32912', 0x45cab3],
  ['8d74802958c904e6ef4ba0184d5c', 0x748029],
  // Pair from the ADS-B Decoding Guide (kode.naiv.no), ICAO 40621D.
  ['8D40621D58C382D690C8AC2863A7', 0x40621d],
  ['8D40621D58C386435CC412692AD6', 0x40621d],
];
const DF17_CORRUPT = '8d4ca251204994b1c36e60a5343d';
// DF 17 vector 2 with its last parity nibble flipped: still addressed to
// 0x8960ed, but the envelope is broken.
const DF17_CORRUPT_B = '8d8960ed58bf053cf11bc5932b7e';
const DF2021_VALID = [
  // NOTE: the secondary source lists a fourth vector,
  // 'c80b2dca34aa21dd821a04cb64d4' -> residue 10719924, but its DF field
  // reads 25 (0xC8 = 11001), not 20/21 — likely a transcription artifact.
  // It is kept in the residue-level test below (the residue property is
  // what that test asserts) but excluded from the DF 20/21 verdict tests.
  ['a800089d8094e33a6004e4b8a522', 4805588],
  ['a8000614a50b6d32bed000bbe0ed', 5659991],
  ['a0000410bc900010a40000f5f477', 11727682],
];
// Residue-level only (see the DF-25 note above).
const DF2021_RESIDUE_ONLY = [['c80b2dca34aa21dd821a04cb64d4', 10719924]];
// Forged offline by flipping the DF bits of a valid DF 17 and re-stamping
// the parity (CRC of the first 88 bits); round-trips verified residue 0.
const DF18_FORGED = '95406b902015a678d4d2201107be';
// Forged offline: DF 24 with parity = CRC XOR 0x406b90; residue 0x406b90.
const DF24_FORGED = 'c5406b902015a678d4d220352d64';

test('crc24Residue is 0 for intact extended squitters', () => {
  for (const [hex] of DF17_VALID) {
    assert.equal(crc24Residue(hexToBitArray(hex)), 0, hex);
  }
  assert.equal(crc24Residue(hexToBitArray(DF18_FORGED)), 0);
});

test('crc24Residue recovers the ICAO24 for address/parity replies', () => {
  for (const [hex, address] of [...DF2021_VALID, ...DF2021_RESIDUE_ONLY]) {
    assert.equal(crc24Residue(hexToBitArray(hex)), address, hex);
  }
  assert.equal(crc24Residue(hexToBitArray(DF24_FORGED)), 0x406b90);
});

test('crc24Residue is non-zero for a corrupted message', () => {
  const residue = crc24Residue(hexToBitArray(DF17_CORRUPT));
  assert.notEqual(residue, 0);
  assert.equal(residue, 0x10);
});

test('a single flipped bit breaks a valid DF 17', () => {
  const bits = hexToBitArray(DF17_VALID[0][0]);
  bits[100] ^= 1;
  assert.notEqual(crc24Residue(bits), 0);
});

test('generator polynomial matches the Mode-S CRC-24', () => {
  assert.equal(CRC24_GENERATOR_POLY, 0x1fff409);
  assert.equal(ICAO24_MASK, 0xffffff);
  assert.deepEqual([...CRC_SQUITTER_DFS], [17, 18]);
  assert.deepEqual([...CRC_SHORT_REPLY_DFS], [0, 4, 5, 16]);
  assert.deepEqual([...CRC_LONG_REPLY_DFS], [20, 21, 24]);
  assert.equal(Object.isFrozen(CRC_SQUITTER_DFS), true);
  assert.equal(Object.isFrozen(CRC_SHORT_REPLY_DFS), true);
  assert.equal(Object.isFrozen(CRC_LONG_REPLY_DFS), true);
});

test('hexToBitArray parses and rejects', () => {
  assert.deepEqual(hexToBitArray('0F'), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual(hexToBitArray('0x0F'), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(hexToBitArray('0G'), null);
  assert.equal(hexToBitArray('F'), null); // odd length
  assert.equal(hexToBitArray(''), null);
  assert.equal(hexToBitArray(null), null);
  assert.equal(hexToBitArray(1234), null);
});

test('valid DF 17 messages are crc-ok with the embedded address', () => {
  for (const [hex, address] of DF17_VALID) {
    const verdict = checkCrcParity({ hex });
    assert.equal(verdict.judged, true, hex);
    assert.equal(verdict.plausible, true, hex);
    assert.deepEqual(verdict.signals, [CRC_SIGNAL_OK], hex);
    assert.equal(verdict.df, 17, hex);
    assert.equal(verdict.bitLength, 112, hex);
    assert.equal(verdict.residue, 0, hex);
    assert.equal(verdict.expectedResidue, 0, hex);
    assert.equal(verdict.embeddedIcao24, address, hex);
    assert.equal(verdict.interpretation, null, hex);
  }
});

test('corrupted DF 17 is a crc-mismatch, never a pass', () => {
  const verdict = checkCrcParity({ hex: DF17_CORRUPT });
  assert.equal(verdict.judged, true);
  assert.equal(verdict.plausible, false);
  assert.deepEqual(verdict.signals, [CRC_SIGNAL_MISMATCH]);
  assert.equal(verdict.residue, 0x10);
  assert.equal(verdict.interpretation, null);
});

test('forged DF 18 passes the residue-zero rule', () => {
  const verdict = checkCrcParity({ hex: DF18_FORGED });
  assert.equal(verdict.df, 18);
  assert.equal(verdict.plausible, true);
  assert.deepEqual(verdict.signals, [CRC_SIGNAL_OK]);
  assert.equal(verdict.embeddedIcao24, 0x406b90);
});

test('matching claimed address stays crc-ok; wrong claim is attribution-mismatch', () => {
  const [hex, address] = DF17_VALID[0];
  const match = checkCrcParity({ hex, claimedIcao24: address });
  assert.equal(match.plausible, true);
  assert.deepEqual(match.signals, [CRC_SIGNAL_OK]);
  assert.equal(match.claimedIcao24, address);

  const wrong = checkCrcParity({ hex, claimedIcao24: 0x40621d });
  assert.equal(wrong.plausible, true); // envelope intact; filing is wrong
  assert.deepEqual(wrong.signals, [
    CRC_SIGNAL_OK,
    CRC_SIGNAL_ATTRIBUTION_MISMATCH,
  ]);
  assert.equal(wrong.interpretation, null);
});

test('bad claimed addresses are malformed, not mismatches', () => {
  const [hex] = DF17_VALID[0];
  for (const claimedIcao24 of ['406b90', -1, 0x1000000, 1.5, NaN]) {
    const verdict = checkCrcParity({ hex, claimedIcao24 });
    assert.deepEqual(verdict.signals, [CRC_SIGNAL_MALFORMED]);
    assert.equal(verdict.judged, false);
    assert.equal(verdict.reason, 'bad-claimed-address');
  }
});

test('DF 20/21 residues are judged against the claimed address', () => {
  for (const [hex, address] of DF2021_VALID) {
    const ok = checkCrcParity({ hex, claimedIcao24: address });
    assert.equal(ok.judged, true, hex);
    assert.equal(ok.plausible, true, hex);
    assert.deepEqual(ok.signals, [CRC_SIGNAL_OK], hex);
    assert.equal(ok.expectedResidue, address, hex);
    assert.equal(ok.recoveredAddress, address, hex);

    const wrong = checkCrcParity({ hex, claimedIcao24: address ^ 0xffffff });
    assert.equal(wrong.plausible, false, hex);
    assert.deepEqual(wrong.signals, [CRC_SIGNAL_MISMATCH], hex);
    assert.equal(wrong.interpretation, null, hex);
  }
});

test('address/parity reply without a claimed address is unjudgeable but recovers it', () => {
  const [hex, address] = DF2021_VALID[0];
  const verdict = checkCrcParity({ hex });
  assert.equal(verdict.judged, false);
  assert.equal(verdict.plausible, false);
  assert.deepEqual(verdict.signals, [CRC_SIGNAL_UNJUDGEABLE]);
  assert.equal(verdict.recoveredAddress, address);
  assert.equal(verdict.reason, 'needs-claimed-address');
});

// Forged offline: 56-bit DF 5 short reply, parity = CRC XOR 0x406b90.
const DF5_FORGED = '2800000060135e';

test('forged DF 24 is judged against the claimed address', () => {
  const ok = checkCrcParity({ hex: DF24_FORGED, claimedIcao24: 0x406b90 });
  assert.equal(ok.df, 24);
  assert.equal(ok.plausible, true);
  assert.deepEqual(ok.signals, [CRC_SIGNAL_OK]);
  const wrong = checkCrcParity({ hex: DF24_FORGED, claimedIcao24: 1 });
  assert.deepEqual(wrong.signals, [CRC_SIGNAL_MISMATCH]);
});

test('56-bit short replies use the same address/parity rule', () => {
  const ok = checkCrcParity({ hex: DF5_FORGED, claimedIcao24: 0x406b90 });
  assert.equal(ok.df, 5);
  assert.equal(ok.bitLength, 56);
  assert.equal(ok.plausible, true);
  assert.deepEqual(ok.signals, [CRC_SIGNAL_OK]);
  assert.equal(ok.recoveredAddress, 0x406b90);
  const wrong = checkCrcParity({ hex: DF5_FORGED, claimedIcao24: 0x123456 });
  assert.deepEqual(wrong.signals, [CRC_SIGNAL_MISMATCH]);
  assert.equal(wrong.interpretation, null);
});

test('malformed inputs never judge', () => {
  const cases = [
    [{ hex: '8D' }, 'length-df-mismatch'], // 8 bits, DF 17 needs 112
    [{ hex: '8D406B902015A6' }, 'length-df-mismatch'], // 56 bits, DF 17
    [{ hex: '20' + '00'.repeat(13) }, 'length-df-mismatch'], // DF 4, 112 bits
    [{ hex: 'ZZZZ' }, 'not-hex'],
    [{ hex: '' }, 'not-hex'],
    [{}, 'not-hex'],
    [null, 'not-hex'],
  ];
  for (const [input, reason] of cases) {
    const verdict = checkCrcParity(input);
    assert.deepEqual(verdict.signals, [CRC_SIGNAL_MALFORMED]);
    assert.equal(verdict.judged, false);
    assert.equal(verdict.plausible, false);
    assert.equal(verdict.reason, reason);
    assert.equal(verdict.interpretation, null);
  }
});

test('DF 11 and DF 19 are unjudgeable with documented reasons', () => {
  const df11 = checkCrcParity({ hex: '5D' + '00'.repeat(6) });
  assert.equal(df11.df, 11);
  assert.equal(df11.judged, false);
  assert.deepEqual(df11.signals, [CRC_SIGNAL_UNJUDGEABLE]);
  assert.equal(df11.reason, 'df11-interrogator-overlay');

  const df19 = checkCrcParity({ hex: '9D' + '00'.repeat(13) });
  assert.equal(df19.df, 19);
  assert.equal(df19.judged, false);
  assert.deepEqual(df19.signals, [CRC_SIGNAL_UNJUDGEABLE]);
  assert.equal(df19.reason, 'df-out-of-scope');
});

test('out-of-scope DF is unjudgeable even with an intact-looking residue', () => {
  // The secondary source's fourth Comm-B vector reads DF 25; the residue
  // property holds but the DF is outside the audit.
  const [hex] = DF2021_RESIDUE_ONLY[0];
  const verdict = checkCrcParity({ hex, claimedIcao24: 10719924 });
  assert.equal(verdict.df, 25);
  assert.equal(verdict.judged, false);
  assert.deepEqual(verdict.signals, [CRC_SIGNAL_UNJUDGEABLE]);
  assert.equal(verdict.reason, 'df-out-of-scope');
  assert.equal(verdict.interpretation, null);
});
test('per-message verdicts never carry interpretation', () => {
  const verdicts = [
    checkCrcParity({ hex: DF17_VALID[0][0] }),
    checkCrcParity({ hex: DF17_CORRUPT }),
    checkCrcParity({ hex: DF18_FORGED }),
    checkCrcParity({ hex: DF2021_VALID[0][0], claimedIcao24: 1 }),
    checkCrcParity({ hex: 'ZZ' }),
    checkCrcParity({ hex: '5D' + '00'.repeat(6) }),
  ];
  for (const verdict of verdicts) {
    assert.equal(verdict.interpretation, null);
  }
});

test('summarize: mismatches on two aircraft corroborate', () => {
  const summary = summarizeCrcParity([
    { hex: DF17_CORRUPT, atMs: 1000 },
    { hex: DF17_VALID[0][0], atMs: 1000 },
    { hex: DF17_CORRUPT_B, atMs: 2000 },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.judged, 3);
  assert.equal(summary.ok, 1);
  assert.equal(summary.mismatch, 2);
  assert.equal(summary.corroborated, true);
  assert.equal(summary.interpretation, CRC_CORROBORATED_INTERPRETATION);
  assert.deepEqual(
    [...summary.mismatchAircraft].sort((a, b) => a - b),
    [0x4ca251, 0x8960ed].sort((a, b) => a - b),
  );
});

test('summarize: a lone mismatch is an observed fact only', () => {
  const summary = summarizeCrcParity([
    { hex: DF17_CORRUPT, atMs: 1000 },
    { hex: DF17_VALID[0][0], atMs: 1000 },
  ]);
  assert.equal(summary.mismatch, 1);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize: window separates far-apart mismatches', () => {
  const a = { hex: DF17_CORRUPT, atMs: 0 };
  const b = { hex: DF17_CORRUPT_B, atMs: 600000 };
  const tight = summarizeCrcParity([a, b]);
  assert.equal(tight.corroborated, false);
  assert.equal(tight.interpretation, null);
  const wide = summarizeCrcParity([a, b], { windowMs: 600001 });
  assert.equal(wide.corroborated, true);
  assert.equal(wide.interpretation, CRC_CORROBORATED_INTERPRETATION);
});

test('summarize: malformed and unjudgeable entries never corroborate', () => {
  const summary = summarizeCrcParity([
    { hex: 'ZZ' },
    { hex: '5D' + '00'.repeat(6) },
    { hex: DF2021_VALID[0][0] }, // no claimed address -> unjudgeable
    { hex: DF17_CORRUPT },
  ]);
  assert.equal(summary.malformed, 1);
  assert.equal(summary.unjudgeable, 2);
  assert.equal(summary.mismatch, 1);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});

test('summarize: all-ok batch has no interpretation', () => {
  const summary = summarizeCrcParity(DF17_VALID.map(([hex]) => ({ hex })));
  assert.equal(summary.ok, DF17_VALID.length);
  assert.equal(summary.mismatch, 0);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
});
