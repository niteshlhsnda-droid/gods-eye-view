/**
 * Vertical-rate plausibility check: a cross-check between an ADS-B
 * aircraft's reported vertical rate and its own altitude history,
 * judged against the transmitter's OWN claimed vertical-rate
 * accuracy — not a fixed tolerance.
 *
 * Each ADS-B fix carries an altitude and a vertical rate (positive =
 * climb). The reported rate is (near-)instantaneous; the altitude
 * history gives the AVERAGE rate over the window between two fixes.
 * Comparing one instantaneous rate against the average assumes the
 * rate was steady over the window, which fails on every normal climb
 * entry and level-off. This check instead compares the MEAN of the
 * two endpoint reported rates against the derived average rate:
 * under constant vertical acceleration the mean of the endpoint
 * rates equals the average rate EXACTLY, so ordinary acceleration
 * cancels and only genuine inconsistency remains. The residual is
 * bounded by the claimed rate accuracy, altitude quantization, and
 * (when supplied) altitude accuracy — all derived below.
 *
 * Tolerance composition (all in m/s):
 * - Accuracy allowance: the mean of the two fixes' claimed
 *   vertical-rate accuracies. The judged quantity is the mean of two
 *   reported rates, so worst-case aligned errors average, they do
 *   not sum. A per-fix `vertRateAccuracyMps` wins; a fix without
 *   one falls back to the caller's feed-level `vertRateAccuracyMps`
 *   option; without either, the documented default applies.
 *   DO-260B defines NO per-fix vertical-rate accuracy category
 *   (NACv covers horizontal velocity only), so a "claimed" accuracy
 *   here is whatever the feed supplies — a transponder-reported
 *   figure, a feed-level calibration, or the default. The default
 *   (2.0 m/s, ~394 fpm) is a conservative budget for filtered
 *   transponder vertical rates, tight enough to catch gross
 *   inconsistency (reporting a climb while descending) while not
 *   flagging normal filtered-rate noise.
 * - Quantization allowance: `altQuantizationM / dtS`. Each altitude
 *   reading rounds to its least-significant bit, so the differenced
 *   altitude can be off by up to one full LSB and the derived rate
 *   by up to one LSB per second of window. Default LSB 7.62 m
 *   (25 ft, the finer ADS-B barometric quantization); callers whose
 *   feed quantizes to 100 ft (30.48 m) must pass that instead.
 * - Altitude-accuracy allowance: the sum of the fixes' supplied
 *   `altAccuracyM` values, divided by `dtS`. Each altitude error
 *   shifts the difference by up to its own bound, so the rate error
 *   is the sum over `dtS` — not the mean. This is how a caller
 *   using geometric altitude accounts for GVA-scale noise (pass the
 *   GVA bound as `altAccuracyM`); a caller using barometric altitude
 *   leaves it absent. A fix without one contributes nothing — the
 *   term only ever grows the tolerance, never tightens it.
 * - Floor: the tolerance never drops below `minToleranceMps`
 *   (default 1.0 m/s, ~197 fpm), which absorbs unmodelled altitude
 *   noise and jerk (change of acceleration) over the window. This
 *   keeps over-tight claimed accuracies from manufacturing
 *   violations out of noise.
 *
 * The comparison is strict (>): a discrepancy exactly at the
 * tolerance is consistent.
 *
 * What no prior check sees:
 * - The NACv / velocity-consistency checks judge HORIZONTAL speed
 *   against derived horizontal speed and never read vertical rate
 *   or altitude. A transponder with a coherent horizontal velocity
 *   and a fabricated vertical rate passes them; only this check
 *   notices.
 * - The baro-geometric drift check judges the CHANGE in the
 *   baro-minus-geometric difference and never reads vertical rate.
 *   A transponder whose two altitude sources agree perfectly while
 *   its reported vertical rate contradicts both passes it.
 * - The altitude-divergence check judges the ABSOLUTE baro-geom
 *   divergence against fixed bands and never reads vertical rate.
 * - The kinematic checks (teleport, acceleration-plausibility /
 *   trajectory-break, containment-jump) judge horizontal motion
 *   and never read vertical rate. A spoof or glitch that moves
 *   only the vertical-rate channel passes them.
 * - The quality-field checks (NIC/NACp claim-consistency, SIL/SDA,
 *   quality-drop) judge quality fields against each other or
 *   against their own history and never test a reported rate
 *   against the altitude history.
 *
 * Caller contract: both fixes must use the SAME altitude source
 * (both barometric or both geometric). Mixing sources mixes the
 * baro-geometric offset into the derived rate and manufactures
 * violations. The window is gated by `maxIntervalMs` (default
 * 60 s): beyond it the near-constant-acceleration assumption
 * weakens, so the pair is unjudged rather than guessed at.
 * On-ground state is irrelevant — a "climb" reported while parked
 * is still an inconsistency — so no ground flag is read.
 *
 * What this is NOT:
 * - Not a verdict on either fix. A violation says the reported
 *   rates and the altitude history do not cohere, not which one is
 *   wrong — a stale reported rate trips it just as a jumped
 *   altitude does.
 * - Not a spoof detector by itself. Benign causes also produce
 *   violations: a transponder that overstates its vertical-rate
 *   accuracy (tight claim, loose reality) trips the edge by
 *   mis-reporting, not by attack; a decoder that pairs a vertical
 *   rate from one message with altitudes from another manufactures
 *   an inconsistency the transmitter never sent; and a claimed
 *   accuracy is a 95%-style bound, so even a fully honest
 *   transmitter exceeds it some of the time by construction — a
 *   single-pair exceedance is weak evidence, which is why
 *   corroboration (below) is the sky-event test.
 * - Not a level-flight or climb-performance check. It never judges
 *   whether the rate itself is plausible for the aircraft type —
 *   only whether the reported rates cohere with the altitude
 *   change the same aircraft reported.
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
 * (carrying the altitude, vertical rate, and any claimed accuracy
 * through normalization, which currently keeps only NIC/NACp) is a
 * separate step.
 */

/** Maximum fix spacing: beyond this, the steady-acceleration assumption weakens. */
export const VERT_RATE_MAX_INTERVAL_MS = 60_000;
/** Corroboration window: violations this close count as one sky event. */
export const VERT_RATE_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must violate inside one window to corroborate. */
export const VERT_RATE_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: the reported vertical rates contradict the altitude change. */
export const VERT_RATE_SIGNAL = 'vertical-rate-inconsistency';
/** Secondary, unvalidated reading of a corroborated violation set. */
export const VERT_RATE_INTERPRETATION = 'suspected-vertical-rate-inconsistency';
/** Default claimed vertical-rate accuracy (m/s) when no claim is supplied. */
export const VERT_RATE_DEFAULT_ACCURACY_MPS = 2.0;
/** Default altitude least-significant bit (m): 25 ft ADS-B quantization. */
export const VERT_RATE_DEFAULT_ALT_QUANTIZATION_M = 7.62;
/** Tolerance floor (m/s): absorbs unmodelled altitude noise and jerk. */
export const VERT_RATE_MIN_TOLERANCE_MPS = 1.0;
/** Feet per minute in one metre per second (1 m = 100 / 2.54 / 12 ft). */
export const VERT_RATE_FPM_PER_MPS = 196.8503937;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a field is present (null/undefined count as absent). */
const present = (value) => value !== undefined && value !== null;

/** Whether a fix field is a usable number (metres, m/s, or ms). */
function isMeasure(value) {
  return finite(value);
}

/** Whether a claimed accuracy is usable (finite and non-negative). */
function isAccuracy(value) {
  return finite(value) && value >= 0;
}

/** Hex to stamp on events: the fix's own hex, else the caller's. */
function eventHex(fix, fallbackHex) {
  if (typeof fix?.hex === 'string') return fix.hex;
  if (typeof fallbackHex === 'string') return fallbackHex;
  return null;
}

/**
 * Vertical-rate plausibility verdict over two consecutive fixes
 * from one aircraft. Judged when both altitudes, both vertical
 * rates, and both timestamps are usable, the timestamps are
 * non-decreasing with a positive gap, the interval sits inside
 * [0, maxIntervalMs], and all accuracy/allowance inputs are valid.
 *
 * @param {{altM?: number, vertRateMps?: number,
 *   vertRateAccuracyMps?: number, altAccuracyM?: number,
 *   atMs?: number}} prev - The earlier fix (altitude in metres,
 *   vertical rate in m/s, positive = climb).
 * @param {{altM?: number, vertRateMps?: number,
 *   vertRateAccuracyMps?: number, altAccuracyM?: number,
 *   atMs?: number}} curr - The later fix (same units, same
 *   altitude source as `prev`).
 * @param {{maxIntervalMs?: number, vertRateAccuracyMps?: number,
 *   altQuantizationM?: number, minToleranceMps?: number}} [options] -
 *   Interval gate; feed-level vertical-rate accuracy used when a
 *   fix carries none; altitude least-significant bit in metres;
 *   tolerance floor in m/s.
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: null, reason: string|null, dtS: number|null,
 *   derivedRateMps: number|null, meanReportedRateMps: number|null,
 *   discrepancyMps: number|null, toleranceMps: number|null,
 *   accuracyAllowanceMps: number|null,
 *   quantizationAllowanceMps: number|null,
 *   altAccuracyAllowanceMps: number|null, prevVertRateMps: number|null,
 *   currVertRateMps: number|null}} The verdict.
 * @throws {TypeError} When either fix is null or not an object.
 */
export function checkVerticalRate(
  prev,
  curr,
  {
    maxIntervalMs = VERT_RATE_MAX_INTERVAL_MS,
    vertRateAccuracyMps: feedAccuracyMps,
    altQuantizationM = VERT_RATE_DEFAULT_ALT_QUANTIZATION_M,
    minToleranceMps = VERT_RATE_MIN_TOLERANCE_MPS,
  } = {},
) {
  if (prev === null || typeof prev !== 'object') {
    throw new TypeError('checkVerticalRate requires a previous fix object');
  }
  if (curr === null || typeof curr !== 'object') {
    throw new TypeError('checkVerticalRate requires a current fix object');
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    dtS: null,
    derivedRateMps: null,
    meanReportedRateMps: null,
    discrepancyMps: null,
    toleranceMps: null,
    accuracyAllowanceMps: null,
    quantizationAllowanceMps: null,
    altAccuracyAllowanceMps: null,
    prevVertRateMps: null,
    currVertRateMps: null,
  };
  if (
    (present(prev.altM) && !isMeasure(prev.altM)) ||
    (present(curr.altM) && !isMeasure(curr.altM))
  ) {
    return { ...base, reason: 'invalid-altitude' };
  }
  if (!present(prev.altM) || !present(curr.altM)) {
    return { ...base, reason: 'missing-altitude' };
  }
  if (
    (present(prev.vertRateMps) && !isMeasure(prev.vertRateMps)) ||
    (present(curr.vertRateMps) && !isMeasure(curr.vertRateMps))
  ) {
    return { ...base, reason: 'invalid-rate' };
  }
  if (!present(prev.vertRateMps) || !present(curr.vertRateMps)) {
    return { ...base, reason: 'missing-rate' };
  }
  if (
    (present(prev.vertRateAccuracyMps) &&
      !isAccuracy(prev.vertRateAccuracyMps)) ||
    (present(curr.vertRateAccuracyMps) &&
      !isAccuracy(curr.vertRateAccuracyMps)) ||
    (present(prev.altAccuracyM) && !isAccuracy(prev.altAccuracyM)) ||
    (present(curr.altAccuracyM) && !isAccuracy(curr.altAccuracyM))
  ) {
    return {
      ...base,
      prevVertRateMps: prev.vertRateMps,
      currVertRateMps: curr.vertRateMps,
      reason: 'invalid-accuracy',
    };
  }
  if (
    !finite(maxIntervalMs) ||
    maxIntervalMs <= 0 ||
    !isAccuracy(altQuantizationM) ||
    !isAccuracy(minToleranceMps) ||
    (present(feedAccuracyMps) && !isAccuracy(feedAccuracyMps))
  ) {
    return {
      ...base,
      prevVertRateMps: prev.vertRateMps,
      currVertRateMps: curr.vertRateMps,
      reason: 'invalid-option',
    };
  }
  if (!finite(prev.atMs) || !finite(curr.atMs)) {
    return {
      ...base,
      prevVertRateMps: prev.vertRateMps,
      currVertRateMps: curr.vertRateMps,
      reason: 'invalid-time',
    };
  }
  const dtS = (curr.atMs - prev.atMs) / 1000;
  const timed = {
    ...base,
    dtS,
    prevVertRateMps: prev.vertRateMps,
    currVertRateMps: curr.vertRateMps,
  };
  if (dtS < 0) {
    return { ...timed, reason: 'negative-dt' };
  }
  if (dtS === 0) {
    return { ...timed, reason: 'zero-dt' };
  }
  const derivedRateMps = (curr.altM - prev.altM) / dtS;
  const meanReportedRateMps = (prev.vertRateMps + curr.vertRateMps) / 2;
  const discrepancyMps = Math.abs(meanReportedRateMps - derivedRateMps);
  if (dtS * 1000 > maxIntervalMs) {
    return {
      ...timed,
      derivedRateMps,
      meanReportedRateMps,
      discrepancyMps,
      reason: 'interval-too-long',
    };
  }
  const effectivePrevAccuracy = present(prev.vertRateAccuracyMps)
    ? prev.vertRateAccuracyMps
    : present(feedAccuracyMps)
      ? feedAccuracyMps
      : VERT_RATE_DEFAULT_ACCURACY_MPS;
  const effectiveCurrAccuracy = present(curr.vertRateAccuracyMps)
    ? curr.vertRateAccuracyMps
    : present(feedAccuracyMps)
      ? feedAccuracyMps
      : VERT_RATE_DEFAULT_ACCURACY_MPS;
  const accuracyAllowanceMps =
    (effectivePrevAccuracy + effectiveCurrAccuracy) / 2;
  const quantizationAllowanceMps = altQuantizationM / dtS;
  const altAccuracyAllowanceMps =
    (present(prev.altAccuracyM) ? prev.altAccuracyM : 0) / dtS +
    (present(curr.altAccuracyM) ? curr.altAccuracyM : 0) / dtS;
  const toleranceMps = Math.max(
    minToleranceMps,
    accuracyAllowanceMps + quantizationAllowanceMps + altAccuracyAllowanceMps,
  );
  const anomalous = discrepancyMps > toleranceMps;
  return {
    ...timed,
    judged: true,
    anomalous,
    signals: anomalous ? [VERT_RATE_SIGNAL] : [],
    derivedRateMps,
    meanReportedRateMps,
    discrepancyMps,
    toleranceMps,
    accuracyAllowanceMps,
    quantizationAllowanceMps,
    altAccuracyAllowanceMps,
  };
}

/**
 * Detect vertical-rate inconsistency events across fixes from one
 * aircraft. Fixes are judged in timestamp order (a sorted copy;
 * input order is never assumed). One event per violating
 * consecutive pair. Fixes that cannot be judged yield no event for
 * their adjacent pairs; the chain is judged pair-by-pair. Events
 * carry NO interpretation: that judgment lives only on the
 * corroborated summary.
 *
 * @param {{altM?: number, vertRateMps?: number,
 *   vertRateAccuracyMps?: number, altAccuracyM?: number,
 *   atMs?: number, hex?: string}[]} fixes - Fixes from one aircraft
 *   (any order).
 * @param {{maxIntervalMs?: number, vertRateAccuracyMps?: number,
 *   altQuantizationM?: number, minToleranceMps?: number,
 *   hex?: string}} [options] - Check options, plus hex to stamp on
 *   events when the fixes do not carry one.
 * @returns {{hex: string|null, prevAtMs: number, atMs: number,
 *   derivedRateMps: number, meanReportedRateMps: number,
 *   discrepancyMps: number, toleranceMps: number,
 *   signal: string}[]} Violation events, in timestamp order.
 * @throws {TypeError} When `fixes` is not an array, or when an
 *   option is invalid (non-finite or negative).
 */
export function detectVerticalRateEvents(
  fixes,
  {
    maxIntervalMs = VERT_RATE_MAX_INTERVAL_MS,
    vertRateAccuracyMps: feedAccuracyMps,
    altQuantizationM = VERT_RATE_DEFAULT_ALT_QUANTIZATION_M,
    minToleranceMps = VERT_RATE_MIN_TOLERANCE_MPS,
    hex = null,
  } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectVerticalRateEvents requires an array');
  }
  if (
    !finite(maxIntervalMs) ||
    maxIntervalMs <= 0 ||
    !isAccuracy(altQuantizationM) ||
    !isAccuracy(minToleranceMps) ||
    (present(feedAccuracyMps) && !isAccuracy(feedAccuracyMps))
  ) {
    throw new TypeError('detectVerticalRateEvents requires valid options');
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
      verdict = checkVerticalRate(prev, curr, {
        maxIntervalMs,
        vertRateAccuracyMps: feedAccuracyMps,
        altQuantizationM,
        minToleranceMps,
      });
    } catch {
      continue;
    }
    if (!verdict.anomalous) continue;
    events.push({
      hex: eventHex(curr, eventHex(prev, hex)),
      prevAtMs: prev.atMs,
      atMs: curr.atMs,
      derivedRateMps: verdict.derivedRateMps,
      meanReportedRateMps: verdict.meanReportedRateMps,
      discrepancyMps: verdict.discrepancyMps,
      toleranceMps: verdict.toleranceMps,
      signal: VERT_RATE_SIGNAL,
    });
  }
  return events;
}

/**
 * Summarize vertical-rate inconsistency events across aircraft.
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
export function summarizeVerticalRateEvents(
  events,
  {
    windowMs = VERT_RATE_CORROBORATION_WINDOW_MS,
    minAircraft = VERT_RATE_CORROBORATION_MIN_AIRCRAFT,
  } = {},
) {
  if (!finite(windowMs) || windowMs < 0) {
    throw new TypeError(
      'summarizeVerticalRateEvents requires a finite non-negative windowMs',
    );
  }
  if (!Number.isInteger(minAircraft) || minAircraft < 1) {
    throw new TypeError(
      'summarizeVerticalRateEvents requires an integer minAircraft >= 1',
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
    interpretation: corroborated ? VERT_RATE_INTERPRETATION : null,
  };
}
