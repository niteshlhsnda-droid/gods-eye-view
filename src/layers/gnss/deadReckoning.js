/**
 * Dead-reckoning consistency: a VECTOR cross-check between an ADS-B
 * aircraft's reported velocity and the motion its own successive
 * position fixes imply, judged against the transmitter's OWN claimed
 * position and velocity accuracy — not fixed tolerances.
 *
 * Each ADS-B fix carries two independent statements about motion: the
 * position itself, and the reported ground speed (`gs`, knots) and
 * track from the velocity message. Between two fixes, the positions
 * imply an actual displacement; the reported velocities imply a
 * predicted displacement. This check compares the two as VECTORS:
 * predicted displacement = MEAN of the two endpoint velocity vectors
 * x elapsed time. Under constant (vector) acceleration the mean of
 * the endpoint velocities equals the average velocity EXACTLY, so
 * ordinary acceleration — a climb entry, a level-off, a steady
 * speed-up — cancels instead of false-positiveing the way an
 * endpoint-only prediction would. The residual is the magnitude of
 * (actual displacement - predicted displacement), judged against a
 * tolerance built from the fixes' own claims:
 *
 * Tolerance composition (all in metres):
 * - Position allowance: EPU(prev) + EPU(curr), the DO-260B NACp 95%
 *   bounds of the two fixes. Each reported position can sit up to
 *   its EPU from truth, so the differenced displacement can be off
 *   by up to the SUM — not the mean. A fix without a usable NACp
 *   cannot be judged at all (NACp 0 claims no accuracy).
 * - Velocity allowance: mean NACv bound x dtS. Each reported
 *   velocity can sit up to its own DO-260B NACv 95% bound from
 *   truth, so the MEAN velocity can be off by up to the MEAN of the
 *   two bounds, and the predicted displacement by that mean times
 *   dtS. The mean — not the looser bound, not the sum — is the
 *   triangle-inequality bound on the mean of two errors. NACv 0
 *   claims no velocity accuracy, so a pair carrying it is unjudged.
 * - Timing allowance: mean reported speed x `timingUncertaintyS`.
 *   When timestamps carry whole-second granularity the elapsed time
 *   is uncertain, and the predicted displacement is off by up to
 *   speed x timing error. Default 0 (sub-second timestamps); callers
 *   with whole-second timestamps should pass ~1.0.
 * - Turn allowance: meanSpeed x dtS x (sinc(dTrack/2) - cos(dTrack/2)),
 *   where dTrack is the absolute change in reported track between
 *   the fixes and sinc(x) = sin(x)/x. A steady turn rotates the
 *   acceleration vector, so the constant-acceleration (trapezoid)
 *   prediction undershoots the true chord: the true displacement of
 *   a constant-speed turn through dTrack is v x dt x sinc(dTrack/2)
 *   along the bisector, while the trapezoid prediction is
 *   v x dt x cos(dTrack/2) along the same bisector. Their
 *   difference is exactly this allowance — derived from the fixes'
 *   own reported track change, not a fudge factor. It is zero for
 *   straight flight (dTrack = 0) and grows with turn rate, so
 *   ordinary standard-rate turns stay consistent while a velocity
 *   vector rotated away from the positions still fails: the
 *   residual of a rotated velocity grows faster than this
 *   allowance (a 90-degree rotation at 250 m/s over 5 s leaves a
 *   ~883 m residual against a ~241 m allowance).
 * - Floor: the tolerance never drops below `minToleranceM`
 *   (default 10 m), which absorbs unmodelled jerk (change of
 *   acceleration, which neither the trapezoid nor the steady-turn
 *   model captures), CPR quantization, and rounding.
 *
 * The comparison is strict (>): a residual exactly at the tolerance
 * is consistent.
 *
 * What no prior check sees:
 * - The velocity-consistency check (velocityConsistency) judges the
 *   SAME position-versus-velocity comparison as two SCALAR sub-checks
 *   against FIXED tolerances (15 m/s + 10% speed, 30-degree course),
 *   and gates its course sub-check on near-straight flight. A pair
 *   claiming NACp 11 + NACv 4 (EPU < 3 m, velocity error < 0.3 m/s)
 *   with a 25 m vector residual passes both fixed sub-checks — the
 *   residual is 0.4 m/s over 60 s and the course error can sit
 *   inside 30 degrees — while exceeding its own claims by 3x. Only
 *   this check judges the VECTOR residual against the claims.
 * - The NACv velocity-accuracy check (velocityAccuracy) judges SPEED
 *   ONLY: derived average speed against the reported-speed band
 *   widened by NACv. A pure DIRECTION error — right speed, wrong
 *   heading — leaves the derived speed inside the band and passes
 *   it; the vector residual here catches it because the
 *   perpendicular component counts.
 * - The containment-jump check (containmentJump) judges displacement
 *   against the claimed containment radius Rc and never reads
 *   velocity. A pair with near-identical positions (stale or frozen
 *   fixes) passes it — displacement under Rc — while its velocity
 *   fields report 250 m/s of flight; the predicted displacement
 *   here is ~1250 m against an actual ~0 m, so only this check
 *   notices the stale-position case. Teleport likewise needs a
 *   jump; a frozen feed never jumps.
 * - The acceleration-plausibility check judges position-only fix
 *   triples and never reads the velocity fields or any accuracy
 *   claim. A spoofer that fakes positions along a flyable path
 *   passes it; if its reported velocities disagree with that path
 *   by more than its NACp + NACv claims allow, only this check
 *   notices.
 * - The quality-field checks (NIC/NACp claim-consistency, SIL/SDA,
 *   quality-drop) judge quality fields against each other or
 *   against their own history on ONE fix and never test positions
 *   against velocities. A transponder with coherent quality fields
 *   and a tight NACv whose velocity vector points away from where
 *   its positions went passes them all.
 * - The vertical checks (vertical-rate, baro-geometric drift,
 *   altitude-divergence) judge the vertical channel only and never
 *   read horizontal position or velocity.
 *
 * Caller contract: both fixes must carry lat/lon, ground speed,
 * track, NACp, and NACv from the SAME aircraft. The window is gated
 * by `minIntervalMs` (default 5 s: below this, timing and
 * quantization noise dominate) and `maxIntervalMs` (default 60 s:
 * beyond it the near-constant-acceleration model weakens, so the
 * pair is unjudged rather than guessed at). On-ground state is
 * irrelevant — a parked aircraft reporting motion is still an
 * inconsistency — so no ground flag is read.
 *
 * What this is NOT:
 * - Not a verdict on either fix. A violation says the reported
 *   velocities and the positions do not cohere, not which one is
 *   wrong — a stale position trips it just as a rotated velocity
 *   does.
 * - Not a spoof detector by itself. Benign causes also produce
 *   violations: a transponder that overstates its NACp/NACv (tight
 *   claims, loose reality) trips the edge by mis-reporting, not by
 *   attack; a decoder that pairs a velocity message with the wrong
 *   position message manufactures an inconsistency the transmitter
 *   never sent; a combined manoeuvre (speed change AND turn
 *   together, or jerk inside the window) separates the trapezoid
 *   prediction from the true path beyond the steady-turn model;
 *   and the claimed bounds are 95%-style bounds, so even a fully
 *   honest transmitter exceeds them some of the time by
 *   construction — a single-pair exceedance is weak evidence, which
 *   is why corroboration (below) is the sky-event test.
 * - Not a heading-accuracy check. It never judges whether a track is
 *   plausible for the aircraft type — only whether the reported
 *   velocities cohere with the displacement the same aircraft
 *   reported.
 *
 * The event is a secondary, unvalidated signal — never a verdict.
 * One aircraft violating is a receiver/transponder event until
 * corroborated: violations from several distinct aircraft inside one
 * window are the sky-event test. `interpretation` is a
 * summary-level judgment: per-pair verdicts and per-aircraft events
 * NEVER carry it, so a lone event never reads as a sky event on its
 * own.
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring
 * (carrying gs / track / NACv through normalization, which currently
 * keeps only NIC/NACp) is a separate step.
 */

/** Minimum fix spacing: below this, timing/quantization noise dominates. */
export const DEAD_RECKONING_MIN_INTERVAL_MS = 5_000;
/** Maximum fix spacing: beyond this, the near-constant-acceleration model weakens. */
export const DEAD_RECKONING_MAX_INTERVAL_MS = 60_000;
/** Corroboration window: violations this close count as one sky event. */
export const DEAD_RECKONING_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must violate inside one window to corroborate. */
export const DEAD_RECKONING_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: reported velocities contradict the positions' displacement. */
export const DEAD_RECKONING_SIGNAL = 'dead-reckoning-inconsistency';
/** Secondary, unvalidated reading of a corroborated violation set. */
export const DEAD_RECKONING_INTERPRETATION =
  'suspected-position-velocity-misreport';
/** Tolerance floor (m): absorbs unmodelled jerk, quantization, rounding. */
export const DEAD_RECKONING_MIN_TOLERANCE_M = 10;
/** 1 knot in metres per second, exact by definition (1 kt = 1852/3600 m/s). */
export const DEAD_RECKONING_KNOT_TO_MPS = 1852 / 3600;
/** Metres per nautical mile, exact by definition. */
const NM_M = 1852;
/** Mean Earth radius in metres, for the local-tangent displacement. */
const EARTH_RADIUS_M = 6_371_000;
/**
 * DO-260B NACp 95% accuracy (EPU) bounds in metres, indexed by NACp.
 * Index 0 is null: NACp 0 claims no accuracy (unknown).
 */
const NACP_EPU_M = Object.freeze([
  null,
  10 * NM_M,
  4 * NM_M,
  2 * NM_M,
  1 * NM_M,
  0.5 * NM_M,
  0.3 * NM_M,
  0.1 * NM_M,
  0.05 * NM_M,
  30,
  10,
  3,
]);
/**
 * DO-260B NACv 95% velocity-error bounds in metres per second, indexed
 * by NACv. Index 0 is null: NACv 0 claims no velocity accuracy (unknown).
 */
const NACV_BOUND_MPS = Object.freeze([null, 10, 3, 1, 0.3]);

const toRad = (deg) => (deg * Math.PI) / 180;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a field is present (null/undefined count as absent). */
const present = (value) => value !== undefined && value !== null;

/** Normalize a longitude delta in degrees to [-180, 180]. */
function wrapLonDeltaDeg(delta) {
  let wrapped = delta % 360;
  if (wrapped > 180) wrapped -= 360;
  if (wrapped < -180) wrapped += 360;
  return wrapped;
}

/** Wrap an angle in degrees to [-180, 180). */
function wrapDeg(angle) {
  let wrapped = (angle + 180) % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped - 180;
}

/** Whether a fix carries a usable position. */
function isPosition(fix) {
  return (
    finite(fix?.lat) &&
    fix.lat >= -90 &&
    fix.lat <= 90 &&
    finite(fix?.lon) &&
    fix.lon >= -180 &&
    fix.lon <= 180
  );
}

/** Whether a fix carries a usable reported velocity (knots, degrees). */
function isVelocity(fix) {
  return (
    finite(fix?.gs) &&
    fix.gs >= 0 &&
    finite(fix?.track) &&
    fix.track >= 0 &&
    fix.track <= 360
  );
}

/** Whether a quality field is a usable DO-260B category. */
function isNacp(value) {
  return finite(value) && Number.isInteger(value) && value >= 0 && value <= 11;
}

/** Whether a velocity-accuracy field is a usable DO-260B NACv (0-4). */
function isNacv(value) {
  return finite(value) && Number.isInteger(value) && value >= 0 && value <= 4;
}

/** Whether a tolerance/allowance input is usable (finite and non-negative). */
function isAllowance(value) {
  return finite(value) && value >= 0;
}

/** Hex to stamp on events: the fix's own hex, else the caller's. */
function eventHex(fix, fallbackHex) {
  if (typeof fix?.hex === 'string') return fix.hex;
  if (typeof fallbackHex === 'string') return fallbackHex;
  return null;
}

/** sinc(x) = sin(x)/x, with sinc(0) = 1. */
function sinc(x) {
  if (x === 0) return 1;
  return Math.sin(x) / x;
}

/**
 * Dead-reckoning verdict over two consecutive fixes from one aircraft.
 * Judged when both positions, both velocities, both quality claims,
 * and both timestamps are usable, the timestamps are non-decreasing
 * with a positive gap, the interval sits inside
 * [minIntervalMs, maxIntervalMs], and all allowance inputs are valid.
 *
 * @param {{lat?: number, lon?: number, gs?: number, track?: number,
 *   nacp?: number, nacv?: number, atMs?: number}} prev - The earlier
 *   fix (lat/lon degrees, ground speed knots, track degrees
 *   clockwise from north, DO-260B NACp/NACv categories).
 * @param {{lat?: number, lon?: number, gs?: number, track?: number,
 *   nacp?: number, nacv?: number, atMs?: number}} curr - The later
 *   fix (same units).
 * @param {{minIntervalMs?: number, maxIntervalMs?: number,
 *   timingUncertaintyS?: number, minToleranceM?: number}} [options] -
 *   Interval gates; timestamp-granularity allowance in seconds;
 *   tolerance floor in metres.
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: null, reason: string|null, dtS: number|null,
 *   displacementM: number|null, predictedM: number|null,
 *   residualM: number|null, toleranceM: number|null,
 *   positionAllowanceM: number|null, velocityAllowanceM: number|null,
 *   timingAllowanceM: number|null, turnAllowanceM: number|null,
 *   epuPrevM: number|null, epuCurrM: number|null,
 *   meanNacvBoundMps: number|null, meanSpeedMps: number|null,
 *   trackChangeDeg: number|null, prevGsKt: number|null,
 *   currGsKt: number|null, prevTrackDeg: number|null,
 *   currTrackDeg: number|null, prevNacp: number|null,
 *   currNacp: number|null, prevNacv: number|null,
 *   currNacv: number|null}} The verdict.
 * @throws {TypeError} When either fix is null or not an object.
 */
export function checkDeadReckoning(
  prev,
  curr,
  {
    minIntervalMs = DEAD_RECKONING_MIN_INTERVAL_MS,
    maxIntervalMs = DEAD_RECKONING_MAX_INTERVAL_MS,
    timingUncertaintyS = 0,
    minToleranceM = DEAD_RECKONING_MIN_TOLERANCE_M,
  } = {},
) {
  if (prev === null || typeof prev !== 'object') {
    throw new TypeError('checkDeadReckoning requires a previous fix object');
  }
  if (curr === null || typeof curr !== 'object') {
    throw new TypeError('checkDeadReckoning requires a current fix object');
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    dtS: null,
    displacementM: null,
    predictedM: null,
    residualM: null,
    toleranceM: null,
    positionAllowanceM: null,
    velocityAllowanceM: null,
    timingAllowanceM: null,
    turnAllowanceM: null,
    epuPrevM: null,
    epuCurrM: null,
    meanNacvBoundMps: null,
    meanSpeedMps: null,
    trackChangeDeg: null,
    prevGsKt: finite(prev.gs) ? prev.gs : null,
    currGsKt: finite(curr.gs) ? curr.gs : null,
    prevTrackDeg: finite(prev.track) ? prev.track : null,
    currTrackDeg: finite(curr.track) ? curr.track : null,
    prevNacp: isNacp(prev.nacp) ? prev.nacp : null,
    currNacp: isNacp(curr.nacp) ? curr.nacp : null,
    prevNacv: isNacv(prev.nacv) ? prev.nacv : null,
    currNacv: isNacv(curr.nacv) ? curr.nacv : null,
  };
  if (
    (present(prev.lat) && !finite(prev.lat)) ||
    (present(prev.lon) && !finite(prev.lon)) ||
    (present(curr.lat) && !finite(curr.lat)) ||
    (present(curr.lon) && !finite(curr.lon)) ||
    (present(prev.lat) && (prev.lat < -90 || prev.lat > 90)) ||
    (present(curr.lat) && (curr.lat < -90 || curr.lat > 90)) ||
    (present(prev.lon) && (prev.lon < -180 || prev.lon > 180)) ||
    (present(curr.lon) && (curr.lon < -180 || curr.lon > 180))
  ) {
    return { ...base, reason: 'invalid-position' };
  }
  if (!isPosition(prev) || !isPosition(curr)) {
    return { ...base, reason: 'missing-position' };
  }
  if (
    (present(prev.gs) && (!finite(prev.gs) || prev.gs < 0)) ||
    (present(curr.gs) && (!finite(curr.gs) || curr.gs < 0)) ||
    (present(prev.track) &&
      (!finite(prev.track) || prev.track < 0 || prev.track > 360)) ||
    (present(curr.track) &&
      (!finite(curr.track) || curr.track < 0 || curr.track > 360))
  ) {
    return { ...base, reason: 'invalid-velocity' };
  }
  if (!isVelocity(prev) || !isVelocity(curr)) {
    return { ...base, reason: 'missing-velocity' };
  }
  if (
    (present(prev.nacp) && !isNacp(prev.nacp)) ||
    (present(curr.nacp) && !isNacp(curr.nacp)) ||
    (present(prev.nacv) && !isNacv(prev.nacv)) ||
    (present(curr.nacv) && !isNacv(curr.nacv))
  ) {
    return { ...base, reason: 'invalid-quality' };
  }
  if (!isNacp(prev.nacp) || !isNacp(curr.nacp) || !isNacv(prev.nacv) || !isNacv(curr.nacv)) {
    return { ...base, reason: 'missing-quality' };
  }
  if (prev.nacp === 0 || curr.nacp === 0) {
    return { ...base, reason: 'unknown-accuracy' };
  }
  if (prev.nacv === 0 || curr.nacv === 0) {
    return { ...base, reason: 'unknown-velocity-accuracy' };
  }
  if (
    !finite(minIntervalMs) ||
    minIntervalMs < 0 ||
    !finite(maxIntervalMs) ||
    maxIntervalMs <= 0 ||
    !isAllowance(timingUncertaintyS) ||
    !isAllowance(minToleranceM)
  ) {
    return { ...base, reason: 'invalid-option' };
  }
  if (!finite(prev.atMs) || !finite(curr.atMs)) {
    return { ...base, reason: 'invalid-time' };
  }
  const dtS = (curr.atMs - prev.atMs) / 1000;
  const timed = { ...base, dtS };
  if (dtS < 0) {
    return { ...timed, reason: 'negative-dt' };
  }
  if (dtS === 0) {
    return { ...timed, reason: 'zero-dt' };
  }
  // Geometry: actual displacement on the local tangent plane, and the
  // mean-velocity prediction. Both vectors share the same frame, so
  // the residual is frame-independent for small steps.
  const dLatRad = toRad(curr.lat - prev.lat);
  const dLonRad = toRad(wrapLonDeltaDeg(curr.lon - prev.lon));
  const meanLatRad = toRad((prev.lat + curr.lat) / 2);
  const actualEastM = EARTH_RADIUS_M * Math.cos(meanLatRad) * dLonRad;
  const actualNorthM = EARTH_RADIUS_M * dLatRad;
  const prevSpeedMps = prev.gs * DEAD_RECKONING_KNOT_TO_MPS;
  const currSpeedMps = curr.gs * DEAD_RECKONING_KNOT_TO_MPS;
  const prevEastMps = prevSpeedMps * Math.sin(toRad(prev.track));
  const prevNorthMps = prevSpeedMps * Math.cos(toRad(prev.track));
  const currEastMps = currSpeedMps * Math.sin(toRad(curr.track));
  const currNorthMps = currSpeedMps * Math.cos(toRad(curr.track));
  const meanEastMps = (prevEastMps + currEastMps) / 2;
  const meanNorthMps = (prevNorthMps + currNorthMps) / 2;
  const predictedEastM = meanEastMps * dtS;
  const predictedNorthM = meanNorthMps * dtS;
  const displacementM = Math.hypot(actualEastM, actualNorthM);
  const predictedM = Math.hypot(predictedEastM, predictedNorthM);
  const residualM = Math.hypot(
    actualEastM - predictedEastM,
    actualNorthM - predictedNorthM,
  );
  const meanSpeedMps = (prevSpeedMps + currSpeedMps) / 2;
  const trackChangeDeg = Math.abs(wrapDeg(curr.track - prev.track));
  // Steady-turn correction: trapezoid prediction undershoots the true
  // chord of a constant-speed turn by v*dt*(sinc(d/2) - cos(d/2)).
  const turnAllowanceM =
    meanSpeedMps *
    dtS *
    (sinc(toRad(trackChangeDeg) / 2) - Math.cos(toRad(trackChangeDeg) / 2));
  const geometry = {
    ...timed,
    displacementM,
    predictedM,
    residualM,
    meanSpeedMps,
    trackChangeDeg,
    turnAllowanceM,
  };
  if (dtS * 1000 < minIntervalMs) {
    return { ...geometry, reason: 'interval-too-short' };
  }
  if (dtS * 1000 > maxIntervalMs) {
    return { ...geometry, reason: 'interval-too-long' };
  }
  const epuPrevM = NACP_EPU_M[prev.nacp];
  const epuCurrM = NACP_EPU_M[curr.nacp];
  const positionAllowanceM = epuPrevM + epuCurrM;
  const meanNacvBoundMps = (NACV_BOUND_MPS[prev.nacv] + NACV_BOUND_MPS[curr.nacv]) / 2;
  const velocityAllowanceM = meanNacvBoundMps * dtS;
  const timingAllowanceM = meanSpeedMps * timingUncertaintyS;
  const toleranceM = Math.max(
    minToleranceM,
    positionAllowanceM + velocityAllowanceM + timingAllowanceM + turnAllowanceM,
  );
  const anomalous = residualM > toleranceM;
  return {
    ...geometry,
    judged: true,
    anomalous,
    signals: anomalous ? [DEAD_RECKONING_SIGNAL] : [],
    toleranceM,
    positionAllowanceM,
    velocityAllowanceM,
    timingAllowanceM,
    epuPrevM,
    epuCurrM,
    meanNacvBoundMps,
  };
}

/**
 * Detect dead-reckoning inconsistency events across fixes from one
 * aircraft. Fixes are judged in timestamp order (a sorted copy;
 * input order is never assumed). One event per violating
 * consecutive pair. Fixes that cannot be judged yield no event for
 * their adjacent pairs; the chain is judged pair-by-pair. Events
 * carry NO interpretation: that judgment lives only on the
 * corroborated summary.
 *
 * @param {{lat?: number, lon?: number, gs?: number, track?: number,
 *   nacp?: number, nacv?: number, atMs?: number, hex?: string}[]}
 *   fixes - Fixes from one aircraft (any order).
 * @param {{minIntervalMs?: number, maxIntervalMs?: number,
 *   timingUncertaintyS?: number, minToleranceM?: number,
 *   hex?: string}} [options] - Check options, plus hex to stamp on
 *   events when the fixes do not carry one.
 * @returns {{hex: string|null, prevAtMs: number, atMs: number,
 *   residualM: number, toleranceM: number, displacementM: number,
 *   predictedM: number, signal: string}[]} Violation events, in
 *   timestamp order.
 * @throws {TypeError} When `fixes` is not an array, or when an
 *   option is invalid (non-finite or negative).
 */
export function detectDeadReckoningEvents(
  fixes,
  {
    minIntervalMs = DEAD_RECKONING_MIN_INTERVAL_MS,
    maxIntervalMs = DEAD_RECKONING_MAX_INTERVAL_MS,
    timingUncertaintyS = 0,
    minToleranceM = DEAD_RECKONING_MIN_TOLERANCE_M,
    hex = null,
  } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectDeadReckoningEvents requires an array');
  }
  if (
    !finite(minIntervalMs) ||
    minIntervalMs < 0 ||
    !finite(maxIntervalMs) ||
    maxIntervalMs <= 0 ||
    !isAllowance(timingUncertaintyS) ||
    !isAllowance(minToleranceM)
  ) {
    throw new TypeError('detectDeadReckoningEvents requires valid options');
  }
  const ordered = fixes
    .filter((fix) => fix !== null && typeof fix === 'object')
    .filter((fix) => finite(fix.atMs))
    .sort((a, b) => a.atMs - b.atMs);
  const events = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    let verdict;
    try {
      verdict = checkDeadReckoning(prev, curr, {
        minIntervalMs,
        maxIntervalMs,
        timingUncertaintyS,
        minToleranceM,
      });
    } catch {
      continue;
    }
    if (!verdict.anomalous) continue;
    events.push({
      hex: eventHex(curr, eventHex(prev, hex)),
      prevAtMs: prev.atMs,
      atMs: curr.atMs,
      residualM: verdict.residualM,
      toleranceM: verdict.toleranceM,
      displacementM: verdict.displacementM,
      predictedM: verdict.predictedM,
      signal: DEAD_RECKONING_SIGNAL,
    });
  }
  return events;
}

/**
 * Summarize dead-reckoning inconsistency events across aircraft.
 * Corroboration is the sky-event test: at least `minAircraft`
 * DISTINCT aircraft violating inside one sliding `windowMs` window.
 * Two events from one aircraft never corroborate each other.
 * Events without a finite timestamp are malformed and ignored.
 * `interpretation` is set ONLY when corroborated, so a lone event
 * never reads as a sky event on its own.
 *
 * @param {{hex?: string|null, atMs?: number}[]} events - Violation
 *   events.
 * @param {{windowMs?: number, minAircraft?: number}} [options] -
 *   Corroboration window and distinct-aircraft bar.
 * @returns {{count: number, aircraftCount: number, corroborated: boolean,
 *   windowMs: number, firstAtMs: number|null, lastAtMs: number|null,
 *   interpretation: string|null}} The summary.
 * @throws {TypeError} When `windowMs` is not a finite non-negative
 *   number or `minAircraft` is not an integer >= 1.
 */
export function summarizeDeadReckoningEvents(
  events,
  {
    windowMs = DEAD_RECKONING_CORROBORATION_WINDOW_MS,
    minAircraft = DEAD_RECKONING_CORROBORATION_MIN_AIRCRAFT,
  } = {},
) {
  if (!finite(windowMs) || windowMs < 0) {
    throw new TypeError(
      'summarizeDeadReckoningEvents requires a finite non-negative windowMs',
    );
  }
  if (!Number.isInteger(minAircraft) || minAircraft < 1) {
    throw new TypeError(
      'summarizeDeadReckoningEvents requires an integer minAircraft >= 1',
    );
  }
  const usable = (Array.isArray(events) ? events : []).filter((event) =>
    finite(event?.atMs),
  );
  const ordered = [...usable].sort((a, b) => a.atMs - b.atMs);
  const aircraft = new Set(
    ordered.map((event) => event?.hex).filter((hex) => typeof hex === 'string'),
  );
  let corroborated = false;
  for (let start = 0; start < ordered.length && !corroborated; start += 1) {
    const windowAircraft = new Set();
    for (let i = start; i < ordered.length; i += 1) {
      if (ordered[i].atMs - ordered[start].atMs > windowMs) break;
      if (typeof ordered[i]?.hex === 'string') {
        windowAircraft.add(ordered[i].hex);
      }
      if (windowAircraft.size >= minAircraft) {
        corroborated = true;
        break;
      }
    }
  }
  return {
    count: ordered.length,
    aircraftCount: aircraft.size,
    corroborated,
    windowMs,
    firstAtMs: ordered.length ? ordered[0].atMs : null,
    lastAtMs: ordered.length ? ordered[ordered.length - 1].atMs : null,
    interpretation: corroborated ? DEAD_RECKONING_INTERPRETATION : null,
  };
}
