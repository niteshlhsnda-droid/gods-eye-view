import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RAW_ALTITUDE_SIGNAL_IMPOSSIBLE,
  rawAltitudePlausibility,
} from './rawAltitudePlausibility.js';

// The 1090MHz Riddle §5.5.1 worked example: DF17, TC11, altitude field
// `1100001 1 1000`, Q=1, N=1560 → 38000 ft.
const RIDDLE_MESSAGE = '8D40621D58C382D690C8AC2863A7';

test('Riddle example decodes: Q=1 binary field is consistent at 38000 ft', () => {
  const result = rawAltitudePlausibility({ hex: RIDDLE_MESSAGE });
  assert.equal(result.judged, true);
  assert.equal(result.consistent, true);
  assert.deepEqual(result.signals, []);
  assert.equal(result.interpretation, null);
  assert.equal(result.downlinkFormat, 17);
  assert.equal(result.typeCode, 11);
  assert.equal(result.altitudeFieldBits, '110000111000');
  assert.equal(result.encoding, 'binary-25ft');
  assert.equal(result.decodedAltitudeFt, 38000);
  assert.equal(result.hex, RIDDLE_MESSAGE.toLowerCase());
});

test('Q=1 extremes are consistent: N=2047 → 50175 ft, N=0 → -1000 ft', () => {
  const max = rawAltitudePlausibility({ hex: '8D40621D58FFF2D690C8AC2863A7' });
  assert.equal(max.judged, true);
  assert.equal(max.consistent, true);
  assert.equal(max.decodedAltitudeFt, 50175);

  const min = rawAltitudePlausibility({ hex: '8D40621D580102D690C8AC2863A7' });
  assert.equal(min.judged, true);
  assert.equal(min.consistent, true);
  assert.equal(min.decodedAltitudeFt, -1000);
});

test('valid Gillham patterns are consistent with decoded altitudes', () => {
  // ac12 0xC82: C1+C4, A1, B4 → hand-verified decode to 30000 ft.
  const mid = rawAltitudePlausibility({ hex: '8D40621D58C822D690C8AC2863A7' });
  assert.equal(mid.judged, true);
  assert.equal(mid.consistent, true);
  assert.equal(mid.encoding, 'gillham-100ft');
  assert.equal(mid.decodedAltitudeFt, 30000);

  // ac12 0x88A → 0 ft; ac12 0xA04 → 126700 ft (hand-verified).
  const zero = rawAltitudePlausibility({ hex: '8D40621D5888A2D690C8AC2863A7' });
  assert.equal(zero.consistent, true);
  assert.equal(zero.decodedAltitudeFt, 0);

  const high = rawAltitudePlausibility({ hex: '8D40621D58A042D690C8AC2863A7' });
  assert.equal(high.consistent, true);
  assert.equal(high.decodedAltitudeFt, 126700);
});

test('C2 set alone is an illegal C-bit Gray state', () => {
  const result = rawAltitudePlausibility({ hex: '8D40621D582002D690C8AC2863A7' });
  assert.equal(result.judged, true);
  assert.equal(result.consistent, false);
  assert.deepEqual(result.signals, [RAW_ALTITUDE_SIGNAL_IMPOSSIBLE]);
  assert.equal(result.interpretation, null);
  assert.equal(result.decodedAltitudeFt, null);
  assert.ok(result.reason.includes('illegal C-bit Gray state'));
});

test('Gillham field with no C bits set is impossible', () => {
  const result = rawAltitudePlausibility({ hex: '8D40621D584002D690C8AC2863A7' });
  assert.equal(result.judged, true);
  assert.equal(result.consistent, false);
  assert.deepEqual(result.signals, [RAW_ALTITUDE_SIGNAL_IMPOSSIBLE]);
  assert.ok(result.reason.includes('no C1/C2/C4 bit set'));
});

test('Gillham pattern decoding below -1200 ft is impossible', () => {
  // ac12 0x0A80: all C bits set, no A/B/D pulses → -1300 ft.
  const result = rawAltitudePlausibility({ hex: '8D40621D58A802D690C8AC2863A7' });
  assert.equal(result.judged, true);
  assert.equal(result.consistent, false);
  assert.deepEqual(result.signals, [RAW_ALTITUDE_SIGNAL_IMPOSSIBLE]);
  assert.ok(result.reason.includes('-1200 ft'));
});

test('all-zero altitude field is unavailable, not a violation', () => {
  const result = rawAltitudePlausibility({ hex: '8D40621D580002D690C8AC2863A7' });
  assert.equal(result.judged, false);
  assert.equal(result.consistent, true);
  assert.deepEqual(result.signals, []);
  assert.ok(result.reason.includes('unavailable'));
});

test('non-DF17 message is unjudgeable', () => {
  const result = rawAltitudePlausibility({ hex: '5D40621D58C382D690C8AC2863A7' });
  assert.equal(result.downlinkFormat, 11);
  assert.equal(result.judged, false);
  assert.equal(result.consistent, true);
  assert.deepEqual(result.signals, []);
  assert.ok(result.reason.includes('no ADS-B airborne-position altitude field'));
});

test('DF17 identification message (TC 4) is unjudgeable', () => {
  const result = rawAltitudePlausibility({ hex: '8D40621D20C382D690C8AC2863A7' });
  assert.equal(result.typeCode, 4);
  assert.equal(result.judged, false);
  assert.deepEqual(result.signals, []);
  assert.ok(result.reason.includes('no barometric altitude field'));
});

test('hex input is normalised to lowercase in the echoed result', () => {
  const result = rawAltitudePlausibility({ hex: RIDDLE_MESSAGE });
  assert.equal(result.hex, '8d40621d58c382d690c8ac2863a7');
});

test('invalid inputs return null and never throw', () => {
  assert.equal(rawAltitudePlausibility(null), null);
  assert.equal(rawAltitudePlausibility(undefined), null);
  assert.equal(rawAltitudePlausibility([]), null);
  assert.equal(rawAltitudePlausibility({}), null);
  assert.equal(rawAltitudePlausibility({ hex: null }), null);
  assert.equal(rawAltitudePlausibility({ hex: 123 }), null);
  assert.equal(rawAltitudePlausibility({ hex: '8D40' }), null);
  assert.equal(
    rawAltitudePlausibility({ hex: `${RIDDLE_MESSAGE}00` }),
    null,
  );
  assert.equal(
    rawAltitudePlausibility({ hex: `ZZ${RIDDLE_MESSAGE.slice(2)}` }),
    null,
  );
  // 56-bit message: well-formed Mode-S, but not a 112-bit squitter.
  assert.equal(
    rawAltitudePlausibility({ hex: RIDDLE_MESSAGE.slice(0, 14) }),
    null,
  );
});
