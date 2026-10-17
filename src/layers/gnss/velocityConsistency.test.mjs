import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KNOT_TO_MPS,
  VELOCITY_CONSISTENCY_INTERPRETATION,
  VELOCITY_COURSE_TOLERANCE_DEG,
  VELOCITY_MAX_INTERVAL_MS,
  VELOCITY_MAX_TRACK_CHANGE_DEG,
  VELOCITY_MIN_INTERVAL_MS,
  VELOCITY_SIGNAL_COURSE_MISMATCH,
  VELOCITY_SIGNAL_SPEED_MISMATCH,
  summarizeVelocityConsistency,
  velocityConsistencyCheck,
} from './velocityConsistency.js';

/**
 * Fix pairs on the equator/prime meridian. Due north 0.09 degrees in
 * 60 s is 10,008 m at 166.8 m/s (324 kt) on a 0-degree bearing; due
 * east 0.02 degrees in 60 s is 2,224 m at 37.1 m/s (72 kt).
 */
const fix = (overrides = {}) => ({
  lat: 0,
  lon: 0,
  atMs: 0,
  gsKt: 324,
  trackDeg: 0,
  ...overrides,
});
const northFix = (overrides = {}) =>
  fix({ lat: 0.09, atMs: 60_000, ...overrides });

test('steady flight is consistent with matching speed and course', () => {
  const result = velocityConsistencyCheck(fix(), northFix());
  assert.equal(result.judged, true);
  assert.equal(result.consistent, true);
  assert.equal(result.speedMismatch, false);
  assert.equal(result.courseMismatch, false);
  assert.deepEqual(result.signals, []);
  assert.equal(result.interpretation, null);
  assert.equal(result.reason, null);
  assert.ok(Math.abs(result.derivedSpeedMps - 166.8) < 0.5);
  assert.equal(result.derivedCourseDeg, 0);
  assert.equal(result.dtMs, 60_000);
});

test('a slow drift mismatches speed while staying far below teleport edges', () => {
  // 1 km in 60 s is 16.7 m/s — nowhere near the Cycle 2 teleport edges
  // (500 m/s or 150 km) — yet it contradicts a reported 450 kt.
  const result = velocityConsistencyCheck(
    fix({ gsKt: 450, trackDeg: 90 }),
    fix({ lat: 0, lon: 0.009, atMs: 60_000, gsKt: 450, trackDeg: 90 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.consistent, false);
  assert.equal(result.speedMismatch, true);
  assert.equal(result.courseMismatch, false);
  assert.deepEqual(result.signals, [VELOCITY_SIGNAL_SPEED_MISMATCH]);
  assert.equal(result.interpretation, VELOCITY_CONSISTENCY_INTERPRETATION);
  assert.ok(Math.abs(result.derivedSpeedMps - 16.7) < 0.5);
});

test('a frozen position with live velocity mismatches speed, course unjudged', () => {
  const result = velocityConsistencyCheck(
    fix({ gsKt: 250 }),
    fix({ atMs: 60_000, gsKt: 250 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.consistent, false);
  assert.equal(result.speedMismatch, true);
  // Zero displacement leaves no bearing to judge.
  assert.equal(result.courseMismatch, null);
  assert.equal(result.derivedCourseDeg, null);
  assert.deepEqual(result.signals, [VELOCITY_SIGNAL_SPEED_MISMATCH]);
});

test('a wrong reported track mismatches course while speed agrees', () => {
  const result = velocityConsistencyCheck(
    fix({ trackDeg: 90 }),
    northFix({ trackDeg: 90 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.consistent, false);
  assert.equal(result.speedMismatch, false);
  assert.equal(result.courseMismatch, true);
  assert.deepEqual(result.signals, [VELOCITY_SIGNAL_COURSE_MISMATCH]);
  assert.equal(result.interpretation, VELOCITY_CONSISTENCY_INTERPRETATION);
});

test('steady acceleration stays inside the reported speed band', () => {
  // 250 kt average over 60 s (0.0694 degrees north) sits between the
  // reported 200 kt and 300 kt, so no mismatch despite the change.
  const result = velocityConsistencyCheck(
    fix({ gsKt: 200 }),
    fix({ lat: 0.0694, atMs: 60_000, gsKt: 300 }),
  );
  assert.equal(result.consistent, true);
  assert.equal(result.speedMismatch, false);
  assert.ok(Math.abs(result.derivedSpeedMps - 250 * KNOT_TO_MPS) < 1);
});

test('course is not judged while the aircraft is turning', () => {
  const result = velocityConsistencyCheck(
    fix({ trackDeg: 0 }),
    northFix({ trackDeg: 90 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.consistent, true);
  assert.equal(result.speedMismatch, false);
  assert.equal(result.courseMismatch, null);
  assert.equal(result.derivedCourseDeg, null);
});

test('track wrap-around uses the circular mean, not the arithmetic mean', () => {
  // 355 -> 5 is a 10-degree change across north, not a 350-degree one.
  const result = velocityConsistencyCheck(
    fix({ trackDeg: 355 }),
    northFix({ trackDeg: 5 }),
  );
  assert.equal(result.courseMismatch, false);
  assert.equal(result.consistent, true);
});

test('a course exactly at the tolerance is consistent, one degree past is not', () => {
  const atEdge = velocityConsistencyCheck(
    fix({ trackDeg: VELOCITY_COURSE_TOLERANCE_DEG }),
    northFix({ trackDeg: VELOCITY_COURSE_TOLERANCE_DEG }),
  );
  assert.equal(atEdge.courseMismatch, false);
  const pastEdge = velocityConsistencyCheck(
    fix({ trackDeg: VELOCITY_COURSE_TOLERANCE_DEG + 1 }),
    northFix({ trackDeg: VELOCITY_COURSE_TOLERANCE_DEG + 1 }),
  );
  assert.equal(pastEdge.courseMismatch, true);
});

test('the date line is crossed the short way for distance and bearing', () => {
  const result = velocityConsistencyCheck(
    fix({ lon: 179.99, gsKt: 72, trackDeg: 90 }),
    fix({ lon: -179.99, atMs: 60_000, gsKt: 72, trackDeg: 90 }),
  );
  assert.equal(result.consistent, true);
  assert.ok(Math.abs(result.derivedSpeedMps - 37.1) < 0.5);
  assert.ok(Math.abs(result.derivedCourseDeg - 90) < 0.5);
});

test('interval edges: 5 s and 120 s judge, outside does not', () => {
  const atMin = velocityConsistencyCheck(
    fix(),
    fix({ lat: 0.0075, atMs: VELOCITY_MIN_INTERVAL_MS }),
  );
  assert.equal(atMin.judged, true);
  assert.equal(
    velocityConsistencyCheck(fix(), fix({ atMs: VELOCITY_MIN_INTERVAL_MS - 1 }))
      .reason,
    'interval-too-short',
  );
  const atMax = velocityConsistencyCheck(
    fix(),
    fix({ lat: 0.09, atMs: VELOCITY_MAX_INTERVAL_MS }),
  );
  assert.equal(atMax.judged, true);
  assert.equal(
    velocityConsistencyCheck(fix(), fix({ atMs: VELOCITY_MAX_INTERVAL_MS + 1 }))
      .reason,
    'interval-too-long',
  );
});

test('duplicate or out-of-order fixes are not judged', () => {
  for (const dtMs of [0, -1_000]) {
    const result = velocityConsistencyCheck(fix(), fix({ atMs: dtMs }));
    assert.equal(result.judged, false);
    assert.equal(result.consistent, null);
    assert.equal(result.reason, 'duplicate-or-reordered');
  }
});

test('missing fields leave the affected sub-check unjudged, never evidence', () => {
  const neither = velocityConsistencyCheck(
    fix({ gsKt: undefined, trackDeg: undefined }),
    northFix({ gsKt: undefined, trackDeg: undefined }),
  );
  assert.equal(neither.judged, false);
  assert.equal(neither.reason, 'insufficient');

  const speedOnly = velocityConsistencyCheck(
    fix({ trackDeg: undefined }),
    northFix({ trackDeg: undefined }),
  );
  assert.equal(speedOnly.judged, true);
  assert.equal(speedOnly.speedMismatch, false);
  assert.equal(speedOnly.courseMismatch, null);
  assert.equal(speedOnly.consistent, true);

  const courseOnly = velocityConsistencyCheck(
    fix({ gsKt: undefined }),
    northFix({ gsKt: undefined }),
  );
  assert.equal(courseOnly.judged, true);
  assert.equal(courseOnly.speedMismatch, null);
  assert.equal(courseOnly.courseMismatch, false);
  assert.equal(courseOnly.consistent, true);
});

test('a displacement under 500 m leaves the course unjudged', () => {
  const result = velocityConsistencyCheck(
    fix({ gsKt: 3.6 }),
    fix({ lon: 0.001, atMs: 60_000, gsKt: 3.6 }),
  );
  assert.equal(result.judged, true);
  assert.equal(result.speedMismatch, false);
  assert.equal(result.courseMismatch, null);
  assert.equal(result.derivedCourseDeg, null);
});

test('a track change just over the straight-flight edge skips the course check', () => {
  const result = velocityConsistencyCheck(
    fix({ trackDeg: 0 }),
    northFix({ trackDeg: VELOCITY_MAX_TRACK_CHANGE_DEG + 1 }),
  );
  assert.equal(result.courseMismatch, null);
  assert.equal(result.speedMismatch, false);
});

test('invalid fixes throw instead of judging', () => {
  assert.throws(
    () => velocityConsistencyCheck(fix({ lat: 91 }), northFix()),
    RangeError,
  );
  assert.throws(
    () => velocityConsistencyCheck(fix(), northFix({ atMs: Number.NaN })),
    TypeError,
  );
  assert.throws(() => velocityConsistencyCheck(null, northFix()), TypeError);
  assert.throws(() => velocityConsistencyCheck(fix(), null), TypeError);
});

test('results are frozen, including the signals array', () => {
  const result = velocityConsistencyCheck(fix(), northFix());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.signals), true);
});

test('summarize counts each outcome and caps the mismatch hex list', () => {
  const summary = summarizeVelocityConsistency(
    [
      { hex: 'aaaaaa', prev: fix(), next: northFix() },
      {
        hex: 'bbbbbb',
        prev: fix({ gsKt: 450, trackDeg: 90 }),
        next: fix({ lon: 0.009, atMs: 60_000, gsKt: 450, trackDeg: 90 }),
      },
      {
        hex: 'cccccc',
        prev: fix({ trackDeg: 90 }),
        next: northFix({ trackDeg: 90 }),
      },
      {
        hex: 'dddddd',
        prev: fix({ gsKt: undefined, trackDeg: undefined }),
        next: northFix({ gsKt: undefined, trackDeg: undefined }),
      },
      { hex: 'eeeeee', prev: fix({ lat: 91 }), next: northFix() },
      { hex: 'bbbbbb', prev: fix({ trackDeg: 90 }), next: northFix() },
      {
        prev: fix({ gsKt: 450 }),
        next: fix({ lon: 0.009, atMs: 60_000, gsKt: 450 }),
      },
    ],
    { maxMismatchHexes: 2 },
  );
  assert.deepEqual(summary, {
    total: 7,
    judged: 5,
    consistent: 2,
    speedMismatch: 2,
    courseMismatch: 2,
    mismatch: 3,
    insufficient: 2,
    mismatchHexes: ['bbbbbb', 'cccccc'],
  });
});

test('an empty batch summarizes to zero without throwing', () => {
  assert.deepEqual(summarizeVelocityConsistency([]), {
    total: 0,
    judged: 0,
    consistent: 0,
    speedMismatch: 0,
    courseMismatch: 0,
    mismatch: 0,
    insufficient: 0,
    mismatchHexes: [],
  });
  assert.deepEqual(summarizeVelocityConsistency(), {
    total: 0,
    judged: 0,
    consistent: 0,
    speedMismatch: 0,
    courseMismatch: 0,
    mismatch: 0,
    insufficient: 0,
    mismatchHexes: [],
  });
});
