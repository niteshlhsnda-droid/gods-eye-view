/**
 * Baro-geometric difference-jump check: a cross-check between an ADS-B
 * aircraft's two altitude sources, judged against the transmitter's OWN
 * claimed geometric vertical accuracy — not a fixed tolerance, and not
 * the absolute baro/geometric divergence.
 *
 * Each ADS-B fix carries a barometric altitude (pressure altitude
 * referenced to the ISA standard 29.92 inHg) and a geometric altitude
 * (height above the WGS-84 ellipsoid), plus a GVA (Geometric Vertical
 * Accuracy): a 95% bound on the error of the geometric altitude. The
 * two altitudes are NOT directly comparable: they differ by geoid
 * separation plus non-standard temperature and pressure, so a pressure
 * altitude and a geometric altitude "can't be compared ... other than
 * as a test of reasonableness". That reasonableness test is exactly
 * what the earlier altitude-divergence check does (fixed 500/1500 ft
 * bands on the absolute divergence) — and it necessarily flags every
 * aircraft whose local geoid separation alone exceeds the band.
 *
 * This check judges something else: the CHANGE in the difference
 * between the two altitudes across two consecutive fixes from one
 * aircraft. Differencing cancels the quasi-static offsets (geoid
 * separation, mean pressure/temperature bias) and cancels true
 * vertical motion (a climb or descent moves both altitudes together),
 * leaving only geometric error drift, barometric error drift, and
 * quantization. A jump in the difference larger than the two fixes'
 * GVA bounds combined (plus the caller's barometric-drift allowance)
 * means at least one of the claims is wrong: a GVA, a barometric
 * altitude, or a geometric altitude.
 *
 * What no prior check sees:
 * - The altitude-divergence check judges the ABSOLUTE divergence
 *   against FIXED bands and never reads GVA. A transponder with a
 *   constant 300 m geoid/atmosphere offset fails it while its two
 *   altitude sources agree perfectly from fix to fix; conversely a
 *   sudden 100 m jump in one altitude source passes it (still inside
 *   the 500 ft band) while failing here when GVA claims <= 45 m.
 *   This check passes the constant offset (correctly — a constant
 *   offset is not evidence that anything is wrong) and convicts
 *   only the jump.
 * - The NIC/NACp claim-consistency check judges quality fields
 *   against each other on ONE fix and never reads altitudes. A
 *   transponder with a coherent NIC/NACp pair and a tight GVA whose
 *   geometric altitude jumps between fixes passes it; only this
 *   check tests the GVA claim against the altitude history.
 * - The kinematic checks (teleport, acceleration, containment-jump,
 *   velocity) judge horizontal motion and never read either
 *   altitude. A spoof or glitch that moves only the vertical
 *   channel passes them; only this check notices.
 * - The quality-drop check compares an aircraft's quality fields
 *   against its OWN earlier fields. This check compares altitudes
 *   against claimed accuracy, so a transponder that has reported a
 *   tight GVA since power-on — no drop, no change — still fails
 *   here when its altitude sources diverge by more than that GVA
 *   allows.
 *
 * Threshold derivation: the geometric error of each fix sits inside
 * its own GVA bound at 95%, so the change in the difference can move
 * by at most GVA(prev) + GVA(curr) from geometry alone (the errors
 * can oppose). Barometric error drift over a short interval is
 * covered by the caller's `baroDriftAllowanceM` (default 0: over
 * <= 120 s, genuine weather-driven pressure change moves a pressure
 * altitude by centimetres, and pilot QNH changes do NOT move it at
 * all — ADS-B transmits pressure altitude, not QNH-corrected
 * indicated altitude). The comparison is strict (>): a jump exactly
 * at the bound is consistent.
 *
 * No separate quantization term is needed. The tightest judgeable
 * bound (GVA 2 + GVA 2 = 90 m) already exceeds the worst-case
 * differenced quantization even under pessimistic assumptions: the
 * barometric LSB is 100 ft or 25 ft, so even if the geometric LSB
 * were as coarse as 100 ft, the worst differenced quantization is
 * 200 ft (~61 m) < 90 m. Quantization alone can never trip this
 * check.
 *
 * Tables are the DO-260B GVA 95% vertical-accuracy bounds, as
 * reproduced in EASA CS-ACNS and ICAO ADS-B guidance: 0 = unknown
 * or > 150 m, 1 = <= 150 m, 2 = <= 45 m (EASA prints "< 45 m";
 * treated as a 45 m bound), 3 = reserved. GVA 0 and GVA 3 cannot
 * be judged.
 *
 * NICbaro is deliberately NOT read. It records whether the
 * transmitter claims its barometric altitude has been cross-checked
 * on board; that claim changes neither the ground-side math nor the
 * verdict — a claimed cross-check neither bounds the jump nor
 * excuses it, and an unclaimed cross-check does not invalidate an
 * observed agreement. The onboard claim is orthogonal to whether
 * the two altitudes cohere with the claimed GVA.
 *
 * What this is NOT:
 * - Not a verdict on either fix. A violation says at least one of
 *   the three claims (GVA, barometric altitude, geometric altitude)
 *   is wrong, not which one — a stale geometric altitude with an
 *   honest GVA trips it just as an overstated GVA does.
 * - Not a spoof detector by itself. Benign causes also produce
 *   violations: a transponder that overstates GVA (tight claim,
 *   loose reality) trips the edge by mis-reporting, not by attack;
 *   a decoder that pairs a barometric altitude from one message
 *   with a geometric altitude from another manufactures a jump
 *   the transmitter never sent; a constellation change can shift
 *   the geometric error. And GVA is a 95% bound, so even a fully
 *   honest transmitter exceeds it ~5% of the time by construction
 *   — a single-pair exceedance is weak evidence, which is why
 *   corroboration (below) is the sky-event test.
 * - Not an absolute-offset check. A constant 300 m difference
 *   passes. Judging the absolute offset would require a geoid
 *   model and live MET data this module does not have; differencing
 *   is what makes the check sound without them.
 * - Not an on-ground exclusion. Ground state is irrelevant to
 *   whether the two altitude sources cohere with the claimed GVA,
 *   so on-ground fixes are judged like any other.
 *
 * The event is a secondary, unvalidated signal — never a verdict.
 * One aircraft violating is a receiver/transponder event until
 * corroborated: violations from several distinct aircraft inside one
 * window are the sky-event test. `interpretation` is a
 * summary-level judgment: per-pair verdicts and per-aircraft events
 * NEVER carry it, so a lone event never reads as a sky event on its
 * own (unlike some earlier modules, whose per-event interpretation
 * field said otherwise).
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring
 * (carrying `alt_baro` / `alt_geom` / `gva` through normalization,
 * which currently drops all three) is a separate step.
 */

/**
 * DO-260B GVA 95% vertical-accuracy bounds in metres, indexed by
 * GVA. Index 0 is null (unknown) and index 3 is null (reserved).
 */
const GVA_BOUND_M = Object.freeze([null, 150, 45]);
/** Maximum fix spacing: beyond this, weather evolution can move the difference. */
export const BARO_GEOM_DRIFT_MAX_INTERVAL_MS = 120_000;
/** Corroboration window: violations this close count as one sky event. */
export const BARO_GEOM_DRIFT_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must violate inside one window to corroborate. */
export const BARO_GEOM_DRIFT_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: the baro-geometric difference jumped beyond the claimed GVA. */
export const BARO_GEOM_DRIFT_SIGNAL = 'baro-geom-difference-jump';
/** Secondary, unvalidated reading of a corroborated violation set. */
export const BARO_GEOM_DRIFT_INTERPRETATION =
  'suspected-altitude-source-inconsistency';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a quality field is a usable DO-260B GVA category (integer 0-3). */
function isGva(value) {
  return finite(value) && Number.isInteger(value) && value >= 0 && value <= 3;
}

/** Whether a fix carries a usable altitude (metres; negatives allowed). */
function isAltitude(value) {
  return finite(value);
}

/**
 * DO-260B GVA 95% vertical-accuracy bound in metres, or null when
 * the GVA claims no accuracy (0), is reserved (3), or is not a
 * usable category.
 *
 * @param {number} gva - DO-260B Geometric Vertical Accuracy (0-3).
 * @returns {number|null} Vertical-accuracy bound in metres, or null.
 */
export function gvaBoundM(gva) {
  if (!isGva(gva)) return null;
  if (gva === 0 || gva === 3) return null;
  return GVA_BOUND_M[gva];
}

/** Hex to stamp on events: the fix's own hex, else the caller's. */
function eventHex(fix, fallbackHex) {
  if (typeof fix?.hex === 'string') return fix.hex;
  if (typeof fallbackHex === 'string') return fallbackHex;
  return null;
}

/**
 * Baro-geometric difference-jump verdict over two consecutive fixes
 * from one aircraft. Judged when both barometric and geometric
 * altitudes, both GVAs, and both timestamps are usable, the
 * timestamps are non-decreasing, the interval sits inside
 * [0, maxIntervalMs], and the barometric-drift allowance is valid.
 *
 * @param {{baroAltM?: number, geomAltM?: number, gva?: number,
 *   atMs?: number}} prev - The earlier fix (altitudes in metres).
 * @param {{baroAltM?: number, geomAltM?: number, gva?: number,
 *   atMs?: number}} curr - The later fix (altitudes in metres).
 * @param {{maxIntervalMs?: number,
 *   baroDriftAllowanceM?: number}} [options] - Interval gate, and
 *   the barometric error drift the caller budgets over the
 *   interval in metres (default 0: genuine weather-driven drift
 *   over <= 120 s is centimetre-scale; pass a larger budget when
 *   the feed's barometric source is known to wander).
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: null, reason: string|null, dtS: number|null,
 *   prevDifferenceM: number|null, differenceM: number|null,
 *   jumpM: number|null, boundM: number|null, excessM: number|null,
 *   ratio: number|null, gvaPrev: number|null, gvaCurr: number|null,
 *   gvaBoundM: number|null, baroDriftAllowanceM: number}} The verdict.
 * @throws {TypeError} When either fix is null or not an object.
 */
export function checkBaroGeomDrift(
  prev,
  curr,
  {
    maxIntervalMs = BARO_GEOM_DRIFT_MAX_INTERVAL_MS,
    baroDriftAllowanceM = 0,
  } = {},
) {
  if (prev === null || typeof prev !== 'object') {
    throw new TypeError('checkBaroGeomDrift requires a previous fix object');
  }
  if (curr === null || typeof curr !== 'object') {
    throw new TypeError('checkBaroGeomDrift requires a current fix object');
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    dtS: null,
    prevDifferenceM: null,
    differenceM: null,
    jumpM: null,
    boundM: null,
    excessM: null,
    ratio: null,
    gvaPrev: null,
    gvaCurr: null,
    gvaBoundM: null,
    baroDriftAllowanceM,
  };
  if (
    prev.baroAltM !== undefined &&
    prev.baroAltM !== null &&
    !isAltitude(prev.baroAltM)
  ) {
    return { ...base, reason: 'invalid-altitude' };
  }
  if (
    curr.baroAltM !== undefined &&
    curr.baroAltM !== null &&
    !isAltitude(curr.baroAltM)
  ) {
    return { ...base, reason: 'invalid-altitude' };
  }
  if (
    prev.geomAltM !== undefined &&
    prev.geomAltM !== null &&
    !isAltitude(prev.geomAltM)
  ) {
    return { ...base, reason: 'invalid-altitude' };
  }
  if (
    curr.geomAltM !== undefined &&
    curr.geomAltM !== null &&
    !isAltitude(curr.geomAltM)
  ) {
    return { ...base, reason: 'invalid-altitude' };
  }
  if (
    !isAltitude(prev.baroAltM) ||
    !isAltitude(prev.geomAltM) ||
    !isAltitude(curr.baroAltM) ||
    !isAltitude(curr.geomAltM)
  ) {
    return { ...base, reason: 'missing-altitude' };
  }
  const prevDifferenceM = prev.baroAltM - prev.geomAltM;
  const differenceM = curr.baroAltM - curr.geomAltM;
  if (!isGva(prev.gva) || !isGva(curr.gva)) {
    if (
      (prev.gva !== undefined && prev.gva !== null && !isGva(prev.gva)) ||
      (curr.gva !== undefined && curr.gva !== null && !isGva(curr.gva))
    ) {
      return {
        ...base,
        prevDifferenceM,
        differenceM,
        reason: 'invalid-quality',
      };
    }
    return {
      ...base,
      prevDifferenceM,
      differenceM,
      reason: 'missing-quality',
    };
  }
  if (prev.gva === 0 || curr.gva === 0) {
    return {
      ...base,
      prevDifferenceM,
      differenceM,
      gvaPrev: prev.gva,
      gvaCurr: curr.gva,
      reason: 'unknown-accuracy',
    };
  }
  if (prev.gva === 3 || curr.gva === 3) {
    return {
      ...base,
      prevDifferenceM,
      differenceM,
      gvaPrev: prev.gva,
      gvaCurr: curr.gva,
      reason: 'gva-reserved',
    };
  }
  if (!finite(baroDriftAllowanceM) || baroDriftAllowanceM < 0) {
    return {
      ...base,
      prevDifferenceM,
      differenceM,
      gvaPrev: prev.gva,
      gvaCurr: curr.gva,
      reason: 'invalid-allowance',
    };
  }
  if (!finite(prev.atMs) || !finite(curr.atMs)) {
    return {
      ...base,
      prevDifferenceM,
      differenceM,
      gvaPrev: prev.gva,
      gvaCurr: curr.gva,
      reason: 'invalid-time',
    };
  }
  const dtS = (curr.atMs - prev.atMs) / 1000;
  if (dtS < 0) {
    return {
      ...base,
      dtS,
      prevDifferenceM,
      differenceM,
      gvaPrev: prev.gva,
      gvaCurr: curr.gva,
      reason: 'negative-dt',
    };
  }
  if (dtS * 1000 > maxIntervalMs) {
    return {
      ...base,
      dtS,
      prevDifferenceM,
      differenceM,
      gvaPrev: prev.gva,
      gvaCurr: curr.gva,
      reason: 'interval-too-long',
    };
  }
  const boundM =
    GVA_BOUND_M[prev.gva] + GVA_BOUND_M[curr.gva] + baroDriftAllowanceM;
  const jumpM = Math.abs(differenceM - prevDifferenceM);
  const anomalous = jumpM > boundM;
  const excessM = anomalous ? jumpM - boundM : 0;
  const ratio = anomalous ? jumpM / boundM : null;
  return {
    ...base,
    judged: true,
    anomalous,
    signals: anomalous ? [BARO_GEOM_DRIFT_SIGNAL] : [],
    dtS,
    prevDifferenceM,
    differenceM,
    jumpM,
    boundM,
    excessM,
    ratio,
    gvaPrev: prev.gva,
    gvaCurr: curr.gva,
    gvaBoundM: boundM - baroDriftAllowanceM,
  };
}

/**
 * Detect baro-geometric difference-jump events across fixes from one
 * aircraft. Fixes are judged in timestamp order (a sorted copy;
 * input order is never assumed). One event per violating
 * consecutive pair. Fixes that cannot be judged yield no event for
 * their adjacent pairs; the chain is judged pair-by-pair. Events
 * carry NO interpretation: that judgment lives only on the
 * corroborated summary.
 *
 * @param {{baroAltM?: number, geomAltM?: number, gva?: number,
 *   atMs?: number, hex?: string}[]} fixes - Fixes from one aircraft
 *   (any order).
 * @param {{maxIntervalMs?: number, baroDriftAllowanceM?: number,
 *   hex?: string}} [options] - Interval gate, barometric-drift
 *   allowance, and hex to stamp on events when the fixes do not
 *   carry one.
 * @returns {{hex: string|null, prevAtMs: number, atMs: number,
 *   prevDifferenceM: number, differenceM: number, jumpM: number,
 *   boundM: number, excessM: number, ratio: number|null,
 *   signal: string}[]} Violation events, in timestamp order.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectBaroGeomDriftEvents(
  fixes,
  {
    maxIntervalMs = BARO_GEOM_DRIFT_MAX_INTERVAL_MS,
    baroDriftAllowanceM = 0,
    hex = null,
  } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectBaroGeomDriftEvents requires an array');
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
      verdict = checkBaroGeomDrift(prev, curr, {
        maxIntervalMs,
        baroDriftAllowanceM,
      });
    } catch {
      continue;
    }
    if (!verdict.anomalous) continue;
    events.push({
      hex: eventHex(curr, eventHex(prev, hex)),
      prevAtMs: prev.atMs,
      atMs: curr.atMs,
      prevDifferenceM: verdict.prevDifferenceM,
      differenceM: verdict.differenceM,
      jumpM: verdict.jumpM,
      boundM: verdict.boundM,
      excessM: verdict.excessM,
      ratio: verdict.ratio,
      signal: BARO_GEOM_DRIFT_SIGNAL,
    });
  }
  return events;
}

/**
 * Summarize baro-geometric difference-jump events across aircraft.
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
export function summarizeBaroGeomDriftEvents(
  events,
  {
    windowMs = BARO_GEOM_DRIFT_CORROBORATION_WINDOW_MS,
    minAircraft = BARO_GEOM_DRIFT_CORROBORATION_MIN_AIRCRAFT,
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
    interpretation: corroborated ? BARO_GEOM_DRIFT_INTERPRETATION : null,
  };
}
