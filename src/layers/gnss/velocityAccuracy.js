/**
 * NACv velocity-accuracy claim consistency: a cross-check between an
 * ADS-B aircraft's reported velocity and the motion its own successive
 * position fixes imply, judged against the transmitter's OWN claimed
 * velocity accuracy — not a fixed tolerance.
 *
 * Each ADS-B fix carries a NACv (Navigation Accuracy Category for
 * Velocity): a 95% bound on the error of its reported velocity. Take
 * two consecutive fixes from one aircraft, dt apart. The positions
 * imply an average speed (great-circle distance over elapsed time).
 * Under steady flight the derived average speed sits inside the band
 * spanned by the two reported ground speeds, widened by the NACv
 * allowance. A derived speed outside that widened band means at least
 * one of the three claims is wrong: a reported speed, a NACv, or a
 * position (a stale position drags the derived speed down; a jumped
 * position pushes it up).
 *
 * What no prior check sees:
 * - The velocity-consistency check (velocityConsistency) judges the
 *   SAME derived-versus-reported comparison against a FIXED tolerance
 *   (15 m/s floor + 10% of the faster reported speed) and never reads
 *   NACv. A 5 m/s discrepancy on a fix pair claiming NACv 4 (95%
 *   velocity error under 0.3 m/s) passes it — the fixed tolerance
 *   swallows a 16x claim violation — while a 20 m/s discrepancy on a
 *   pair claiming NACv 1 (bound 10 m/s) is judged against 15 m/s +
 *   10%, not against the claim. This check judges the discrepancy
 *   against the claims on the two fixes: tight-NACv fixes convict
 *   small discrepancies, loose-NACv fixes are never convicted by this
 *   check for discrepancies their own bound allows.
 * - The NIC/NACp claim-consistency check (qualityConsistency) judges
 *   quality fields against each other on ONE fix and never reads
 *   velocity or positions. A transponder that reports a coherent
 *   NIC/NACp pair with a tight NACv while its velocity fields drift
 *   passes it; only this check tests the velocity claim against the
 *   motion the positions imply.
 * - The kinematic checks (teleport, acceleration, containment-jump)
 *   judge positions against fixed speed/containment limits and never
 *   read the velocity fields at all. A spoofer that fakes positions
 *   along a flyable path with a plausible implied speed passes them;
 *   if its reported velocity fields disagree with that path by more
 *   than its NACv allows, only this check notices.
 * - The quality-drop check compares an aircraft's quality fields
 *   against its OWN earlier fields. This check compares velocity
 *   against motion, so a transponder that has reported a tight NACv
 *   since power-on — no drop, no change — still fails here when its
 *   reported velocity disagrees with where its positions say it went.
 *
 * Threshold derivation: the allowance is the looser of the two fixes'
 * NACv bounds (each reported speed is within its own bound of truth
 * at 95%, so the band spanned by the two reported speeds is within
 * the looser bound of the true band), plus an optional timing
 * allowance for callers whose timestamps carry whole-second
 * granularity (see `timingUncertaintyS`). The band itself — [min, max]
 * of the two reported speeds — absorbs steady acceleration or
 * deceleration, exactly as in velocityConsistency: the derived figure
 * is an AVERAGE over the interval while each reported speed is
 * INSTANTANEOUS. The comparison is strict (>): a derived speed
 * exactly at the widened band edge is consistent.
 *
 * Tables are DO-260B (Version 2) NACv 95% velocity-error bounds:
 * 1 < 10 m/s, 2 < 3 m/s, 3 < 1 m/s, 4 < 0.3 m/s. NACv 0 claims no
 * velocity accuracy (unknown) and cannot be judged.
 *
 * What this is NOT:
 * - Not a verdict on either fix. A violation says at least one of
 *   the three claims (reported speeds, NACv, positions) is wrong, not
 *   which one — a stale position with an honest velocity and NACv
 *   trips the low side just as a wrong velocity does.
 * - Not a spoof detector by itself. Benign causes also produce
 *   violations: a transponder that overstates NACv (tight claim,
 *   loose reality) trips the edge by mis-reporting, not by attack;
 *   a decoder that pairs a velocity message with the wrong position
 *   message manufactures a mismatch the transmitter never sent;
 *   a manoeuvre inside the interval (a turn or a speed change that
 *   is not steady) separates the average from the instantaneous
 *   speeds beyond the band.
 * - Not a course check. Track/course agreement is velocityConsistency's
 *   job; this module judges SPEED ONLY, so a fix pair with missing or
 *   wild tracks is still judged on speed.
 * - Not an on-ground exclusion. Ground state is irrelevant to whether
 *   a velocity claim coheres with the motion the positions imply, so
 *   on-ground fixes are judged like any other — unlike the kinematic
 *   checks, where ground handling bends tracks for benign reasons.
 *   (On-ground speeds are near zero on both sides, so ground pairs
 *   are consistent unless one side is stale or mis-set.)
 *
 * The event is a secondary, unvalidated signal — never a verdict.
 * One aircraft violating is a receiver/transponder event until
 * corroborated: violations from several distinct aircraft inside one
 * window are the sky-event test. Unlike some earlier summarize
 * helpers, `summarizeVelocityAccuracyEvents` sets `interpretation`
 * ONLY when corroborated, so a lone event never reads as a sky
 * event on its own.
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring
 * (carrying `gs` / `nac_v` through normalization, which currently
 * drops both) is a separate step.
 */

/** 1 knot in metres per second, exact by definition (1 kt = 1852/3600 m/s). */
export const KNOT_TO_MPS = 1852 / 3600;
/**
 * DO-260B NACv 95% velocity-error bounds in metres per second, indexed
 * by NACv. Index 0 is null: NACv 0 claims no velocity accuracy (unknown).
 */
const NACV_BOUND_MPS = Object.freeze([null, 10, 3, 1, 0.3]);
/** Mean Earth radius in metres, for the haversine distance. */
const EARTH_RADIUS_M = 6_371_000;
/** Minimum fix spacing: below this, whole-second timing error dominates. */
export const VELOCITY_ACCURACY_MIN_INTERVAL_MS = 5_000;
/** Maximum fix spacing: beyond this, velocity may legitimately change. */
export const VELOCITY_ACCURACY_MAX_INTERVAL_MS = 120_000;
/** Corroboration window: violations this close count as one sky event. */
export const VELOCITY_ACCURACY_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must violate inside one window to corroborate. */
export const VELOCITY_ACCURACY_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: derived speed contradicts the NACv-claimed accuracy. */
export const VELOCITY_ACCURACY_SIGNAL = 'velocity-accuracy-exceeded';
/** Secondary, unvalidated reading of a corroborated violation set. */
export const VELOCITY_ACCURACY_INTERPRETATION = 'suspected-velocity-misreport';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a quality field is a usable DO-260B NACv category (integer 0-4). */
function isNacv(value) {
  return finite(value) && Number.isInteger(value) && value >= 0 && value <= 4;
}

/** Whether a fix carries a usable position. */
function isPosition(fix) {
  return (
    finite(fix?.lat) &&
    Math.abs(fix.lat) <= 90 &&
    finite(fix?.lon) &&
    Math.abs(fix.lon) <= 180
  );
}

/** Whether a fix carries a usable reported ground speed (knots). */
function isGroundSpeed(value) {
  return finite(value) && value >= 0;
}

/**
 * NACv 95% velocity-error bound in metres per second, or null when the
 * NACv claims no accuracy (0) or is not a usable category.
 *
 * @param {number} nacv - DO-260B Navigation Accuracy Category for Velocity (0-4).
 * @returns {number|null} Velocity-error bound in m/s, or null.
 */
export function nacvBoundMps(nacv) {
  if (!isNacv(nacv)) return null;
  return NACV_BOUND_MPS[nacv];
}

/** Great-circle distance in metres between two positions. */
function haversineM(prev, curr) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(curr.lat - prev.lat);
  const dLon = toRad(((curr.lon - prev.lon + 540) % 360) - 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(prev.lat)) *
      Math.cos(toRad(curr.lat)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Hex to stamp on events: the fix's own hex, else the caller's. */
function eventHex(fix, fallbackHex) {
  if (typeof fix?.hex === 'string') return fix.hex;
  if (typeof fallbackHex === 'string') return fallbackHex;
  return null;
}

/**
 * NACv velocity-accuracy verdict over two consecutive fixes from one
 * aircraft. Judged when both positions, both ground speeds, both
 * NACvs, and both timestamps are usable, the timestamps are
 * non-decreasing, and the interval sits inside
 * [minIntervalMs, maxIntervalMs].
 *
 * @param {{lat?: number, lon?: number, gs?: number, nacv?: number,
 *   atMs?: number}} prev - The earlier fix (`gs` in knots).
 * @param {{lat?: number, lon?: number, gs?: number, nacv?: number,
 *   atMs?: number}} curr - The later fix (`gs` in knots).
 * @param {{minIntervalMs?: number, maxIntervalMs?: number,
 *   timingUncertaintyS?: number}} [options] - Interval gates, and the
 *   timestamp granularity in seconds (default 0: timestamps taken as
 *   exact; pass 1 when `atMs` derives from whole-second `seen_pos`
 *   ages, so the derived speed carries a first-order timing
 *   allowance of derivedSpeed * timingUncertaintyS / dtS).
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: string|null, reason: string|null, dtS: number|null,
 *   derivedSpeedMps: number|null, reportedMinMps: number|null,
 *   reportedMaxMps: number|null, allowanceMps: number|null,
 *   excessMps: number|null, ratio: number|null, nacvPrev: number|null,
 *   nacvCurr: number|null, nacvBoundMps: number|null,
 *   timingUncertaintyS: number}} The verdict.
 * @throws {TypeError} When either fix is null or not an object.
 */
export function checkVelocityAccuracy(
  prev,
  curr,
  {
    minIntervalMs = VELOCITY_ACCURACY_MIN_INTERVAL_MS,
    maxIntervalMs = VELOCITY_ACCURACY_MAX_INTERVAL_MS,
    timingUncertaintyS = 0,
  } = {},
) {
  if (prev === null || typeof prev !== 'object') {
    throw new TypeError('checkVelocityAccuracy requires a previous fix object');
  }
  if (curr === null || typeof curr !== 'object') {
    throw new TypeError('checkVelocityAccuracy requires a current fix object');
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    dtS: null,
    derivedSpeedMps: null,
    reportedMinMps: null,
    reportedMaxMps: null,
    allowanceMps: null,
    excessMps: null,
    ratio: null,
    nacvPrev: null,
    nacvCurr: null,
    nacvBoundMps: null,
    timingUncertaintyS,
  };
  if (!isPosition(prev) || !isPosition(curr)) {
    return { ...base, reason: 'invalid-position' };
  }
  if (!isNacv(prev.nacv) || !isNacv(curr.nacv)) {
    if (
      (prev.nacv !== undefined && prev.nacv !== null && !isNacv(prev.nacv)) ||
      (curr.nacv !== undefined && curr.nacv !== null && !isNacv(curr.nacv))
    ) {
      return { ...base, reason: 'invalid-quality' };
    }
    return { ...base, reason: 'missing-quality' };
  }
  if (prev.nacv === 0 || curr.nacv === 0) {
    return {
      ...base,
      nacvPrev: prev.nacv,
      nacvCurr: curr.nacv,
      reason: 'unknown-accuracy',
    };
  }
  if (!isGroundSpeed(prev.gs) || !isGroundSpeed(curr.gs)) {
    if (
      (prev.gs !== undefined && prev.gs !== null && !isGroundSpeed(prev.gs)) ||
      (curr.gs !== undefined && curr.gs !== null && !isGroundSpeed(curr.gs))
    ) {
      return { ...base, reason: 'invalid-velocity' };
    }
    return { ...base, reason: 'missing-velocity' };
  }
  if (!finite(prev.atMs) || !finite(curr.atMs)) {
    return { ...base, reason: 'invalid-time' };
  }
  const dtS = (curr.atMs - prev.atMs) / 1000;
  if (dtS < 0) {
    return { ...base, reason: 'negative-dt' };
  }
  if (dtS * 1000 < minIntervalMs) {
    return { ...base, dtS, reason: 'interval-too-short' };
  }
  if (dtS * 1000 > maxIntervalMs) {
    return { ...base, dtS, reason: 'interval-too-long' };
  }
  if (timingUncertaintyS >= dtS) {
    // The timestamp granularity exceeds the interval itself: the
    // derived speed is pure timing noise, not evidence.
    return { ...base, dtS, reason: 'timing-uncertainty-exceeds-interval' };
  }
  const reportedPrevMps = prev.gs * KNOT_TO_MPS;
  const reportedCurrMps = curr.gs * KNOT_TO_MPS;
  const reportedMinMps = Math.min(reportedPrevMps, reportedCurrMps);
  const reportedMaxMps = Math.max(reportedPrevMps, reportedCurrMps);
  const derivedSpeedMps = haversineM(prev, curr) / dtS;
  const boundMps = Math.max(
    NACV_BOUND_MPS[prev.nacv],
    NACV_BOUND_MPS[curr.nacv],
  );
  // First-order timing allowance: the derived speed moves by about
  // derived * (timingUncertainty / dt) when the interval is off by
  // the timestamp granularity.
  const timingAllowanceMps = derivedSpeedMps * (timingUncertaintyS / dtS);
  const allowanceMps = boundMps + timingAllowanceMps;
  const lowerMps = reportedMinMps - allowanceMps;
  const upperMps = reportedMaxMps + allowanceMps;
  let excessMps = 0;
  let ratio = null;
  if (derivedSpeedMps > upperMps) {
    excessMps = derivedSpeedMps - upperMps;
    ratio = upperMps > 0 ? derivedSpeedMps / upperMps : null;
  } else if (derivedSpeedMps < lowerMps) {
    excessMps = lowerMps - derivedSpeedMps;
    ratio = derivedSpeedMps > 0 ? lowerMps / derivedSpeedMps : null;
  }
  const anomalous = excessMps > 0;
  return {
    ...base,
    judged: true,
    anomalous,
    signals: anomalous ? [VELOCITY_ACCURACY_SIGNAL] : [],
    interpretation: anomalous ? VELOCITY_ACCURACY_INTERPRETATION : null,
    dtS,
    derivedSpeedMps,
    reportedMinMps,
    reportedMaxMps,
    allowanceMps,
    excessMps,
    ratio,
    nacvPrev: prev.nacv,
    nacvCurr: curr.nacv,
    nacvBoundMps: boundMps,
  };
}

/**
 * Detect NACv velocity-accuracy events across fixes from one aircraft.
 * Fixes are judged in timestamp order (a sorted copy; input order is
 * never assumed). One event per violating consecutive pair. Fixes
 * that cannot be judged yield no event for their adjacent pairs; the
 * chain is judged pair-by-pair.
 *
 * @param {{lat?: number, lon?: number, gs?: number, nacv?: number,
 *   atMs?: number, hex?: string}[]} fixes - Fixes from one aircraft
 *   (any order).
 * @param {{minIntervalMs?: number, maxIntervalMs?: number,
 *   timingUncertaintyS?: number, hex?: string}} [options] - Interval
 *   gates, timestamp granularity, and hex to stamp on events when the
 *   fixes do not carry one.
 * @returns {{hex: string|null, prevAtMs: number, atMs: number,
 *   derivedSpeedMps: number, reportedMinMps: number,
 *   reportedMaxMps: number, allowanceMps: number, excessMps: number,
 *   ratio: number|null, signal: string, interpretation: string}[]}
 *   Violation events, in timestamp order.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectVelocityAccuracyEvents(
  fixes,
  {
    minIntervalMs = VELOCITY_ACCURACY_MIN_INTERVAL_MS,
    maxIntervalMs = VELOCITY_ACCURACY_MAX_INTERVAL_MS,
    timingUncertaintyS = 0,
    hex = null,
  } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectVelocityAccuracyEvents requires an array');
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
      verdict = checkVelocityAccuracy(prev, curr, {
        minIntervalMs,
        maxIntervalMs,
        timingUncertaintyS,
      });
    } catch {
      continue;
    }
    if (!verdict.anomalous) continue;
    events.push({
      hex: eventHex(curr, eventHex(prev, hex)),
      prevAtMs: prev.atMs,
      atMs: curr.atMs,
      derivedSpeedMps: verdict.derivedSpeedMps,
      reportedMinMps: verdict.reportedMinMps,
      reportedMaxMps: verdict.reportedMaxMps,
      allowanceMps: verdict.allowanceMps,
      excessMps: verdict.excessMps,
      ratio: verdict.ratio,
      signal: VELOCITY_ACCURACY_SIGNAL,
      interpretation: VELOCITY_ACCURACY_INTERPRETATION,
    });
  }
  return events;
}

/**
 * Summarize NACv velocity-accuracy events across aircraft.
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
 */
export function summarizeVelocityAccuracyEvents(
  events,
  {
    windowMs = VELOCITY_ACCURACY_CORROBORATION_WINDOW_MS,
    minAircraft = VELOCITY_ACCURACY_CORROBORATION_MIN_AIRCRAFT,
  } = {},
) {
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
    interpretation: corroborated ? VELOCITY_ACCURACY_INTERPRETATION : null,
  };
}
