import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALTITUDE_ENCODING_CORROBORATION_MIN_AIRCRAFT,
  ALTITUDE_ENCODING_CORROBORATION_WINDOW_MS,
  ALTITUDE_ENCODING_INTERPRETATION,
  ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE,
  ALTITUDE_ENCODING_SIGNAL_QUANTIZATION,
  altitudeEncodingPlausibilityCheck,
  detectAltitudeEncodingEvents,
  summarizeAltitudeEncodingEvents,
} from './altitudeEncodingPlausibility.js';

/** One airborne fix with a barometric altitude, 10 s after `prevAtMs`. */
const fix = (alt, atMs = 0, extra = {}) => ({ atMs, alt, ...extra });

test('multiples of 25 ft pass, including 25-ft steps a Gillham encoder cannot emit', () => {
  // 35,025 ft proves the binary Q=1 encoding path: a multiple of 25 that
  // is not a multiple of 100 must still be judged clean.
  const verdict = altitudeEncodingPlausibilityCheck([
    fix(35000, 0),
    fix(35025, 10000),
    fix(35050, 20000),
    fix(35075, 30000),
    fix(35100, 40000),
  ]);
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.deepEqual(verdict.signals, []);
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.evaluatedFixes, 5);
  assert.equal(verdict.violatingFixes, 0);
  assert.equal(verdict.fixCount, 5);
});

test('a non-25-ft-multiple altitude is a quantization violation', () => {
  const verdict = altitudeEncodingPlausibilityCheck([
    fix(35000, 0),
    fix(35012, 10000),
    fix(35000, 20000),
  ]);
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, true);
  assert.deepEqual(verdict.signals, [ALTITUDE_ENCODING_SIGNAL_QUANTIZATION]);
  // The per-aircraft verdict is facts only: no interpretation.
  assert.equal(verdict.interpretation, null);
  assert.equal(verdict.evaluatedFixes, 3);
  assert.equal(verdict.violatingFixes, 1);
});

test('an altitude above the binary ceiling with non-100-ft granularity is impossible', () => {
  // 60,025 ft: above 50,175 ft the binary Q=1 encoding cannot reach, and
  // the Gillham encoding — the only one that reaches that high — emits
  // 100-ft multiples only.
  const verdict = altitudeEncodingPlausibilityCheck([fix(60025, 0)]);
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, true);
  assert.deepEqual(verdict.signals, [ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE]);
});

test('the same altitude band is clean when the granularity matches Gillham', () => {
  // High-altitude military traffic (U-2, RQ-4) flies above the binary
  // ceiling on Gillham encoders: 100-ft multiples there are plausible.
  const verdict = altitudeEncodingPlausibilityCheck([
    fix(60000, 0),
    fix(60100, 10000),
  ]);
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
});

test('encoding-range edges are inclusive', () => {
  assert.equal(
    altitudeEncodingPlausibilityCheck([fix(-1000, 0)]).anomalous,
    false,
    'binary/Gillham floor',
  );
  assert.equal(
    altitudeEncodingPlausibilityCheck([fix(50175, 0)]).anomalous,
    false,
    'binary ceiling',
  );
  assert.equal(
    altitudeEncodingPlausibilityCheck([fix(50200, 0)]).anomalous,
    false,
    'just above the binary ceiling on a 100-ft multiple',
  );
  assert.equal(
    altitudeEncodingPlausibilityCheck([fix(126700, 0)]).anomalous,
    false,
    'Gillham ceiling',
  );
});

test('altitudes outside both encodings are impossible, on both sides', () => {
  assert.deepEqual(
    altitudeEncodingPlausibilityCheck([fix(-1025, 0)]).signals,
    [ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE],
    '-1,025 ft is a clean 25-ft multiple, yet below every encoding floor',
  );
  assert.deepEqual(
    altitudeEncodingPlausibilityCheck([fix(126800, 0)]).signals,
    [ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE],
    '126,800 ft is a clean 100-ft multiple, yet above the Gillham ceiling',
  );
  assert.deepEqual(
    altitudeEncodingPlausibilityCheck([fix(130000, 0)]).signals,
    [ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE],
  );
});

test('one fix can violate both encoding rules at once', () => {
  // 60,013 ft: not a 25-ft multiple AND above the binary ceiling with
  // non-100-ft granularity.
  const verdict = altitudeEncodingPlausibilityCheck([fix(60013, 0)]);
  assert.equal(verdict.anomalous, true);
  assert.deepEqual(verdict.signals, [
    ALTITUDE_ENCODING_SIGNAL_QUANTIZATION,
    ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE,
  ]);
});

test('on-ground fixes are excluded, and the readsb "ground" string is skipped', () => {
  const verdict = altitudeEncodingPlausibilityCheck([
    fix(35013, 0, { onGround: true }),
    { atMs: 10000, alt: 'ground' },
    fix(35000, 20000),
  ]);
  assert.equal(verdict.judged, true);
  assert.equal(verdict.anomalous, false);
  assert.equal(verdict.evaluatedFixes, 1);
});

test('no usable altitude means no verdict, with the reason recorded', () => {
  assert.deepEqual(
    altitudeEncodingPlausibilityCheck([]),
    {
      judged: false,
      anomalous: false,
      signals: [],
      interpretation: null,
      reason: 'insufficient-data',
      evaluatedFixes: 0,
      violatingFixes: 0,
      fixCount: 0,
    },
  );
  const parked = altitudeEncodingPlausibilityCheck([
    fix(35013, 0, { onGround: true }),
  ]);
  assert.equal(parked.judged, false);
  assert.equal(parked.reason, 'on-ground');
  const noAlt = altitudeEncodingPlausibilityCheck([
    { atMs: 0 },
    { atMs: 10000, alt: 'ground' },
  ]);
  assert.equal(noAlt.judged, false);
  assert.equal(noAlt.reason, 'insufficient-data');
  assert.throws(
    () => altitudeEncodingPlausibilityCheck('nope'),
    TypeError,
  );
});

test('events are one per violating fix, earliest first, carrying facts alone', () => {
  const events = detectAltitudeEncodingEvents(
    [
      fix(35012, 30000, { hex: 'a1b2c3' }),
      fix(35000, 10000, { hex: 'a1b2c3' }),
      fix(60025, 20000, { hex: 'a1b2c3' }),
    ],
    { hex: 'fallback' },
  );
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    hex: 'a1b2c3',
    atMs: 20000,
    alt: 60025,
    signals: [ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE],
  });
  assert.deepEqual(events[1].signals, [ALTITUDE_ENCODING_SIGNAL_QUANTIZATION]);
  assert.equal(events[1].atMs, 30000);
  assert.ok(!('interpretation' in events[0]), 'events carry no interpretation');
});

test('event hex falls back to the caller option, then null', () => {
  const [withFallback] = detectAltitudeEncodingEvents([fix(35012, 0)], {
    hex: 'abc123',
  });
  assert.equal(withFallback.hex, 'abc123');
  const [without] = detectAltitudeEncodingEvents([fix(35012, 0)]);
  assert.equal(without.hex, null);
});

test('a fabricated high-altitude climb in odd steps is fully flagged', () => {
  // A spoofer generating altitudes without knowing the encoding: 41-ft
  // steps from a non-25-ft start, above the binary ceiling, violate both
  // rules on every fix (41 is coprime to 25, so no step lands on a
  // 25-ft multiple; 13/54/95/36/77/18 mod 100 are never 0).
  const spoofed = [];
  for (let i = 0; i < 6; i += 1) {
    spoofed.push(fix(59013 + i * 41, i * 10000, { hex: 'sp00f1' }));
  }
  const verdict = altitudeEncodingPlausibilityCheck(spoofed);
  assert.equal(verdict.anomalous, true);
  assert.equal(verdict.violatingFixes, 6);
  const events = detectAltitudeEncodingEvents(spoofed, { hex: 'sp00f1' });
  assert.equal(events.length, 6);
  for (const event of events) {
    assert.deepEqual(event.signals, [
      ALTITUDE_ENCODING_SIGNAL_QUANTIZATION,
      ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE,
    ]);
  }
});

test('a single aircraft violating never corroborates itself', () => {
  const events = detectAltitudeEncodingEvents(
    [fix(35012, 0), fix(35013, 10000), fix(60025, 20000)],
    { hex: 'solo' },
  );
  const summary = summarizeAltitudeEncodingEvents(events);
  assert.equal(summary.count, 3);
  assert.equal(summary.aircraftCount, 1);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
  assert.equal(summary.firstAtMs, 0);
  assert.equal(summary.lastAtMs, 20000);
  assert.equal(summary.windowMs, ALTITUDE_ENCODING_CORROBORATION_WINDOW_MS);
});

test('two distinct aircraft violating inside one window corroborate', () => {
  const first = detectAltitudeEncodingEvents([fix(35012, 0)], { hex: 'aa' });
  const second = detectAltitudeEncodingEvents([fix(60025, 60000)], {
    hex: 'bb',
  });
  const summary = summarizeAltitudeEncodingEvents([...first, ...second]);
  assert.equal(summary.count, 2);
  assert.equal(summary.aircraftCount, 2);
  assert.equal(summary.corroborated, true);
  assert.equal(summary.interpretation, ALTITUDE_ENCODING_INTERPRETATION);
});

test('violations outside the window do not corroborate', () => {
  const first = detectAltitudeEncodingEvents([fix(35012, 0)], { hex: 'aa' });
  const second = detectAltitudeEncodingEvents(
    [fix(35013, ALTITUDE_ENCODING_CORROBORATION_WINDOW_MS + 1)],
    { hex: 'bb' },
  );
  const summary = summarizeAltitudeEncodingEvents([...first, ...second]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
  assert.equal(summary.aircraftCount, 2);
});

test('corroboration counts distinct aircraft, not events', () => {
  const events = detectAltitudeEncodingEvents(
    [fix(35012, 0), fix(35013, 10000)],
    { hex: 'aa' },
  );
  const summary = summarizeAltitudeEncodingEvents(events, { minAircraft: 2 });
  assert.equal(summary.count, 2);
  assert.equal(summary.aircraftCount, 1);
  assert.equal(summary.corroborated, false);
});

test('summary ignores events without a finite timestamp and handles empty input', () => {
  const summary = summarizeAltitudeEncodingEvents([
    { hex: 'aa', atMs: NaN },
    { hex: 'bb' },
    { hex: 'cc', atMs: 5000 },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.aircraftCount, 1);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.interpretation, null);
  const empty = summarizeAltitudeEncodingEvents([]);
  assert.deepEqual(empty, {
    count: 0,
    aircraftCount: 0,
    corroborated: false,
    windowMs: ALTITUDE_ENCODING_CORROBORATION_WINDOW_MS,
    firstAtMs: null,
    lastAtMs: null,
    interpretation: null,
  });
  assert.equal(
    summarizeAltitudeEncodingEvents(null).count,
    0,
    'non-array input is empty, not an error',
  );
});

test('the distinct-aircraft bar is configurable', () => {
  const events = [
    ...detectAltitudeEncodingEvents([fix(35012, 0)], { hex: 'aa' }),
    ...detectAltitudeEncodingEvents([fix(35013, 10000)], { hex: 'bb' }),
    ...detectAltitudeEncodingEvents([fix(35014, 20000)], { hex: 'cc' }),
  ];
  const two = summarizeAltitudeEncodingEvents(events, { minAircraft: 2 });
  assert.equal(two.corroborated, true);
  const four = summarizeAltitudeEncodingEvents(events, { minAircraft: 4 });
  assert.equal(four.corroborated, false);
  assert.equal(
    ALTITUDE_ENCODING_CORROBORATION_MIN_AIRCRAFT,
    2,
    'default bar stays pinned',
  );
});
