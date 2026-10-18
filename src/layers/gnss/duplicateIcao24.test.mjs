import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUPLICATE_ICAO24_INTERPRETATION,
  DUPLICATE_ICAO24_MAX_SPEED_MPS,
  DUPLICATE_ICAO24_POSITION_TOLERANCE_M,
  DUPLICATE_ICAO24_RESERVED_HEXES,
  DUPLICATE_ICAO24_SIGNAL_CALLSIGN_DIVERGENT,
  DUPLICATE_ICAO24_SIGNAL_CONFLICT,
  DUPLICATE_ICAO24_SIGNAL_RESERVED_ADDRESS,
  DUPLICATE_ICAO24_WINDOW_MS,
  duplicateIcao24Pair,
  normalizeCallsign,
  normalizeIcao24,
  summarizeDuplicateIcao24,
} from './duplicateIcao24.js';

const fix = (overrides = {}) => ({
  lat: 0,
  lon: 0,
  atMs: 0,
  hex: 'A835AF',
  ...overrides,
});

test('two simultaneous tracks one degree apart conflict', () => {
  // 1 degree of longitude at the equator is ~111 km: no airframe covers
  // that in 0 s, even at the 300 m/s ceiling.
  const result = duplicateIcao24Pair(fix(), fix({ lon: 1 }));
  assert.equal(result.judged, true);
  assert.equal(result.conflict, true);
  assert.equal(result.consistent, false);
  assert.deepEqual(result.signals, [DUPLICATE_ICAO24_SIGNAL_CONFLICT]);
  assert.equal(result.hex, 'A835AF');
  assert.equal(result.reservedAddress, false);
  assert.equal(result.dtMs, 0);
  assert.ok(Math.abs(result.separationM - 111_195) < 60);
  // A lone pair is the observed fact only; the spoofing reading needs
  // corroboration by >=2 distinct aircraft (see the summary).
  assert.equal(result.interpretation, null);
  assert.equal(result.reason, null);
});

test('two reports of the same position are consistent', () => {
  const result = duplicateIcao24Pair(fix(), fix({ atMs: 30_000 }));
  assert.equal(result.judged, true);
  assert.equal(result.conflict, false);
  assert.equal(result.consistent, true);
  assert.deepEqual(result.signals, []);
  assert.equal(result.separationM, 0);
  assert.equal(result.dtMs, 30_000);
});

test('movement within one airframe bounds is consistent', () => {
  // 10 km in 60 s is 167 m/s — inside tolerance + 60 s * 300 m/s = 20 km.
  const result = duplicateIcao24Pair(
    fix(),
    fix({ lon: 10 / 111.195, atMs: 60_000 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.conflict, false);
  assert.equal(result.consistent, true);
});

test('a 25 km jump in 60 s conflicts', () => {
  // 25 km > 2 km tolerance + 18 km of movement allowance.
  const result = duplicateIcao24Pair(
    fix(),
    fix({ lon: 25 / 111.195, atMs: 60_000 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.conflict, true);
  assert.deepEqual(result.signals, [DUPLICATE_ICAO24_SIGNAL_CONFLICT]);
});

test('separation inside the 2 km merge tolerance does not conflict', () => {
  // 0.01 deg of longitude is ~1.1 km < 2 km tolerance at dt = 0.
  const result = duplicateIcao24Pair(fix(), fix({ lon: 0.01 }));
  assert.equal(result.judged, true);
  assert.equal(result.conflict, false);
  assert.equal(result.consistent, true);
});

test('separation just beyond the merge tolerance conflicts at dt = 0', () => {
  // 0.02 deg of longitude is ~2.2 km > 2 km tolerance.
  const result = duplicateIcao24Pair(fix(), fix({ lon: 0.02 }));
  assert.equal(result.judged, true);
  assert.equal(result.conflict, true);
});

test('pairs at the window edge are judged; beyond it they are not', () => {
  const atEdge = duplicateIcao24Pair(
    fix(),
    fix({ lon: 1, atMs: DUPLICATE_ICAO24_WINDOW_MS }),
  );
  assert.equal(atEdge.judged, true);
  const pastEdge = duplicateIcao24Pair(
    fix(),
    fix({ lon: 1, atMs: DUPLICATE_ICAO24_WINDOW_MS + 1 }),
  );
  assert.equal(pastEdge.judged, false);
  assert.equal(pastEdge.reason, 'outside-window');
  assert.equal(pastEdge.conflict, null);
});

test('different claimed addresses are not a duplicate', () => {
  const result = duplicateIcao24Pair(fix(), fix({ hex: 'BEEF42' }));
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'address-mismatch');
  assert.equal(result.hex, null);
});

test('non-24-bit-hex addresses are invalid, never thrown', () => {
  for (const hex of ['ZZZZZZ', 'A83', 'A835AF1', '', '  ', null, 12345]) {
    const result = duplicateIcao24Pair(fix({ hex }), fix());
    assert.equal(result.judged, false, `hex ${JSON.stringify(hex)}`);
    assert.equal(result.reason, 'invalid-address');
  }
});

test('hex variants normalize to the canonical form', () => {
  const result = duplicateIcao24Pair(
    fix({ hex: 'a835af' }),
    fix({ hex: '0xA835AF' }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.hex, 'A835AF');
  assert.equal(normalizeIcao24(' 0xa835af '), 'A835AF');
  assert.equal(normalizeIcao24('FFFFFF'), 'FFFFFF');
  assert.equal(normalizeIcao24('nope'), null);
  assert.equal(normalizeIcao24(null), null);
});

test('all-zeros address raises the reserved-address signal without conflict', () => {
  assert.deepEqual([...DUPLICATE_ICAO24_RESERVED_HEXES], ['000000', 'FFFFFF']);
  const result = duplicateIcao24Pair(
    fix({ hex: '000000' }),
    fix({ hex: '000000' }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.conflict, false);
  assert.equal(result.reservedAddress, true);
  assert.deepEqual(result.signals, [DUPLICATE_ICAO24_SIGNAL_RESERVED_ADDRESS]);
  assert.equal(result.consistent, false);
});

test('all-ones address conflicts combine both signals', () => {
  const result = duplicateIcao24Pair(
    fix({ hex: 'FFFFFF' }),
    fix({ hex: 'FFFFFF', lon: 1 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.conflict, true);
  assert.equal(result.reservedAddress, true);
  assert.deepEqual(result.signals, [
    DUPLICATE_ICAO24_SIGNAL_CONFLICT,
    DUPLICATE_ICAO24_SIGNAL_RESERVED_ADDRESS,
  ]);
});

test('divergent callsigns on a conflicted pair are an observed fact', () => {
  const result = duplicateIcao24Pair(
    fix({ callsign: 'BAW123' }),
    fix({ lon: 1, callsign: 'DLH456' }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.conflict, true);
  assert.equal(result.callsignDivergent, true);
  assert.deepEqual(result.signals, [
    DUPLICATE_ICAO24_SIGNAL_CONFLICT,
    DUPLICATE_ICAO24_SIGNAL_CALLSIGN_DIVERGENT,
  ]);
});

test('matching callsigns do not raise the divergent signal', () => {
  const result = duplicateIcao24Pair(
    fix({ callsign: ' baw123 ' }),
    fix({ lon: 1, callsign: 'BAW123' }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.callsignDivergent, false);
  assert.deepEqual(result.signals, [DUPLICATE_ICAO24_SIGNAL_CONFLICT]);
});

test('absent callsigns leave divergence unknown', () => {
  const result = duplicateIcao24Pair(fix(), fix({ lon: 1 }));
  assert.equal(result.callsignDivergent, null);
  assert.deepEqual(result.signals, [DUPLICATE_ICAO24_SIGNAL_CONFLICT]);
  assert.equal(normalizeCallsign('   '), null);
  assert.equal(normalizeCallsign(null), null);
});

test('bad fixes are not judged, never thrown', () => {
  // Address checks run before fix validation, so a missing fix object
  // surfaces as an invalid address; corrupt coordinates/timestamps of an
  // otherwise well-formed pair surface as an invalid fix.
  const fixCases = [
    [fix({ lat: NaN }), fix()],
    [fix(), fix({ lon: 200 })],
    [fix({ atMs: Infinity }), fix()],
    [fix({ atMs: undefined }), fix()],
  ];
  for (const [a, b] of fixCases) {
    const result = duplicateIcao24Pair(a, b);
    assert.equal(result.judged, false);
    assert.equal(result.reason, 'invalid-fix');
    assert.equal(result.interpretation, null);
  }
  for (const [a, b] of [
    [null, fix()],
    [fix(), 'not-an-object'],
    [undefined, undefined],
  ]) {
    const result = duplicateIcao24Pair(a, b);
    assert.equal(result.judged, false);
    assert.equal(result.reason, 'invalid-address');
    assert.equal(result.interpretation, null);
  }
});

test('summary: two conflicted pairs corroborate the spoofing reading', () => {
  const summary = summarizeDuplicateIcao24([
    { hex: 'A835AF', a: fix(), b: fix({ lon: 1 }) },
    {
      hex: 'BEEF42',
      a: fix({ hex: 'BEEF42' }),
      b: fix({ hex: 'BEEF42', lon: 1 }),
    },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.judged, 2);
  assert.equal(summary.conflict, 2);
  assert.equal(summary.conflictPairs, 2);
  assert.deepEqual(summary.conflictHexes, ['A835AF', 'BEEF42']);
  assert.equal(summary.insufficient, 0);
  assert.equal(summary.interpretation, DUPLICATE_ICAO24_INTERPRETATION);
});

test('summary: one conflicted pair with divergent callsigns corroborates', () => {
  const summary = summarizeDuplicateIcao24([
    {
      hex: 'A835AF',
      a: fix({ callsign: 'BAW123' }),
      b: fix({ lon: 1, callsign: 'DLH456' }),
    },
  ]);
  assert.equal(summary.conflictPairs, 1);
  assert.equal(summary.interpretation, DUPLICATE_ICAO24_INTERPRETATION);
});

test('summary: a lone conflicted pair without corroboration carries no interpretation', () => {
  const summary = summarizeDuplicateIcao24([
    { hex: 'A835AF', a: fix(), b: fix({ lon: 1 }) },
    { hex: 'BEEF42', a: fix({ hex: 'BEEF42' }), b: fix({ hex: 'BEEF42' }) },
  ]);
  assert.equal(summary.judged, 2);
  assert.equal(summary.conflict, 1);
  assert.equal(summary.conflictPairs, 1);
  assert.deepEqual(summary.conflictHexes, ['A835AF']);
  assert.equal(summary.interpretation, null);
});

test('summary: bad entries are insufficient, never evidence', () => {
  const summary = summarizeDuplicateIcao24([
    null,
    undefined,
    { hex: 'A835AF' },
    { hex: 'A835AF', a: fix(), b: fix({ hex: 'BEEF42' }) },
    { hex: 'A835AF', a: fix({ hex: 'ZZZZZZ' }), b: fix({ hex: 'ZZZZZZ' }) },
    'not-an-object',
  ]);
  assert.equal(summary.total, 6);
  assert.equal(summary.judged, 0);
  assert.equal(summary.conflict, 0);
  assert.equal(summary.insufficient, 6);
  assert.equal(summary.interpretation, null);
});

test('summary: conflict hex list is capped', () => {
  const pairs = Array.from({ length: 5 }, (_, i) => {
    const hex = `A835A${i}`;
    return { hex, a: fix({ hex }), b: fix({ hex, lon: 1 }) };
  });
  const summary = summarizeDuplicateIcao24(pairs, { maxConflictHexes: 2 });
  assert.equal(summary.conflict, 5);
  assert.deepEqual(summary.conflictHexes, ['A835A0', 'A835A1']);
  assert.equal(summary.interpretation, DUPLICATE_ICAO24_INTERPRETATION);
});

test('summary: empty input summarizes to zeros', () => {
  for (const input of [undefined, null, []]) {
    const summary = summarizeDuplicateIcao24(input);
    assert.deepEqual(summary, {
      total: 0,
      judged: 0,
      conflict: 0,
      conflictPairs: 0,
      insufficient: 0,
      conflictHexes: [],
      interpretation: null,
    });
  }
});

test('thresholds are pinned', () => {
  assert.equal(DUPLICATE_ICAO24_WINDOW_MS, 60_000);
  assert.equal(DUPLICATE_ICAO24_MAX_SPEED_MPS, 300);
  assert.equal(DUPLICATE_ICAO24_POSITION_TOLERANCE_M, 2_000);
});
