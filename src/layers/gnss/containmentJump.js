/**
 * NIC containment-violation jump check: a displacement cross-check
 * between TWO consecutive fixes and the containment claims on BOTH.
 *
 * Each ADS-B fix claims its true position lies within its NIC
 * containment radius Rc of the reported position, with near-certainty.
 * Take two consecutive fixes from one aircraft, dt apart. The aircraft
 * can have travelled at most vmax * dt between them, and each reported
 * position can be off by at most its own Rc. So the two reported
 * positions can be at most Rc1 + Rc2 + vmax * dt apart — any larger
 * displacement means at least one of the two containment claims is
 * violated: the true positions cannot both lie inside their claimed
 * radii while the aircraft flew at or below vmax.
 *
 * What no prior check sees:
 * - The teleport check (spoofSignals) judges displacement against a
 *   FIXED speed threshold and never reads the quality fields. A 2 km
 *   jump in 1 s flags regardless of integrity — and a 400 m jump in
 *   1 s passes regardless. This check judges the SAME displacement
 *   against the claims on the two fixes: with NIC 11 on both ends
 *   (Rc 7.5 m each) a 400 m jump in 1 s is a containment violation,
 *   while with NIC 1 on both ends (Rc 20 NM each) a 2 km jump is
 *   exactly what the claimed radii allow. Poor-integrity fixes are
 *   never convicted by this check; tight-integrity fixes convict
 *   smaller jumps.
 * - The claim-consistency check (qualityConsistency) judges NIC
 *   against NACp on ONE fix and never reads positions. A spoofer
 *   that sets a coherent NIC/NACp pair while jumping positions
 *   passes it; a transponder whose NIC is honest but whose positions
 *   jump passes it too. Only this check tests the positions
 *   against the containment claims.
 * - The velocity / acceleration checks judge kinematics against
 *   fixed plausibility bands, never against the transmitter's own
 *   claimed error bounds. This check is the only one that turns
 *   the transmitter's containment claim into a bound on how far
 *   consecutive reports may disagree.
 * - The quality-drop check compares an aircraft's quality fields
 *   against its OWN earlier fields. This check compares positions
 *   against quality fields, so a transponder that has reported a
 *   tight NIC since power-on — no drop, no change — still fails
 *   here when its positions jump past what that NIC allows.
 *
 * Threshold derivation: vmax defaults to 340 m/s (~660 kt), above
 * any subsonic airliner's ground speed including a strong tailwind,
 * below supersonic flight. The bound is strict (>): a displacement
 * exactly equal to Rc1 + Rc2 + vmax * dt is consistent. Callers
 * tracking faster aircraft (military, supersonic) must pass a higher
 * `maxSpeedMps`; a fixed-wing jet at 500 m/s with tight NIC would
 * otherwise false-flag.
 *
 * Tables are DO-260B (Version 2) NIC containment-radius bounds,
 * 1 NM = 1852 m: 1 <20 NM, 2 <8 NM, 3 <4 NM, 4 <2 NM, 5 <1 NM,
 * 6 <0.6 NM, 7 <0.2 NM, 8 <0.1 NM, 9 <75 m, 10 <25 m, 11 <7.5 m.
 * NIC 0 claims no containment (unknown) and cannot be judged.
 *
 * What this is NOT:
 * - Not a verdict on either position. A violation says at least
 *   one of the two containment claims (or the speed assumption)
 *   is wrong, not which fix is wrong or where the aircraft was.
 * - Not a spoof detector by itself. Benign causes also produce
 *   violations: a transponder that overstates NIC (tight claim,
 *   loose reality) trips the edge by mis-reporting, not by attack;
 *   surface multipath on the ground can jump a reported position
 *   past a tight Rc; a decoder mis-mapping NIC manufactures a
 *   violation the transmitter never sent.
 * - Not a ground exclusion. Ground state is irrelevant to whether
 *   two positions cohere with their containment claims, so
 *   on-ground fixes are judged like any other — unlike the
 *   kinematic checks, where ground handling bends tracks for
 *   benign reasons.
 *
 * The event is a secondary, unvalidated signal — never a verdict.
 * One aircraft violating is a receiver/transponder event until
 * corroborated: violations from several distinct aircraft inside
 * one window are the sky-event test. Unlike earlier summarize
 * helpers, `summarizeContainmentJumpEvents` sets `interpretation`
 * ONLY when corroborated, so a lone event never reads as a sky
 * event on its own.
 *
 * Pure module, no imports. Standalone: no feed wiring.
 */

/** 1 NM in metres (exact). */
const NM_M = 1852;
/**
 * DO-260B NIC containment-radius bounds in metres, indexed by NIC.
 * Index 0 is null: NIC 0 claims no containment (unknown).
 */
const NIC_CONTAINMENT_RADIUS_M = Object.freeze([
  null,
  20 * NM_M,
  8 * NM_M,
  4 * NM_M,
  2 * NM_M,
  1 * NM_M,
  0.6 * NM_M,
  0.2 * NM_M,
  0.1 * NM_M,
  75,
  25,
  7.5,
]);
/** Mean Earth radius in metres, for the haversine distance. */
const EARTH_RADIUS_M = 6_371_000;
/**
 * Default cap on plausible true ground speed: 340 m/s (~660 kt).
 * Above any subsonic airliner's ground speed with tailwind; callers
 * tracking faster aircraft must override it.
 */
export const CONTAINMENT_JUMP_MAX_SPEED_MPS = 340;
/** Corroboration window: violations this close count as one sky event. */
export const CONTAINMENT_JUMP_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must violate inside one window to corroborate. */
export const CONTAINMENT_JUMP_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: two consecutive fixes violate their containment claims. */
export const CONTAINMENT_JUMP_SIGNAL = 'containment-violation';
/** Secondary, unvalidated reading of a corroborated violation set. */
export const CONTAINMENT_JUMP_INTERPRETATION = 'suspected-gnss-interference';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a quality field is a usable DO-260B category (integer 0-11). */
function isCategory(value) {
  return finite(value) && Number.isInteger(value) && value >= 0 && value <= 11;
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

/**
 * Containment radius in metres for a NIC value, or null when the NIC
 * claims no containment (0) or is not a usable category.
 *
 * @param {number} nic - DO-260B Navigation Integrity Category (0-11).
 * @returns {number|null} Containment radius in metres, or null.
 */
export function containmentRadiusM(nic) {
  if (!isCategory(nic)) return null;
  return NIC_CONTAINMENT_RADIUS_M[nic];
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
 * Containment-violation verdict over two consecutive fixes from one
 * aircraft. Judged when both positions, both NICs, and both timestamps
 * are usable and the timestamps are non-decreasing.
 *
 * @param {{lat?: number, lon?: number, nic?: number, atMs?: number}} prev
 *   The earlier fix.
 * @param {{lat?: number, lon?: number, nic?: number, atMs?: number}} curr
 *   The later fix.
 * @param {{maxSpeedMps?: number}} [options] - Plausible-speed cap.
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: string|null, reason: string|null, distanceM: number|null,
 *   allowedM: number|null, excessM: number|null, ratio: number|null,
 *   dtS: number|null, rcPrevM: number|null, rcCurrM: number|null,
 *   maxSpeedMps: number}} The verdict.
 * @throws {TypeError} When either fix is null or not an object.
 */
export function checkContainmentJump(
  prev,
  curr,
  { maxSpeedMps = CONTAINMENT_JUMP_MAX_SPEED_MPS } = {},
) {
  if (prev === null || typeof prev !== 'object') {
    throw new TypeError('checkContainmentJump requires a previous fix object');
  }
  if (curr === null || typeof curr !== 'object') {
    throw new TypeError('checkContainmentJump requires a current fix object');
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    distanceM: null,
    allowedM: null,
    excessM: null,
    ratio: null,
    dtS: null,
    rcPrevM: null,
    rcCurrM: null,
    maxSpeedMps,
  };
  if (!isPosition(prev) || !isPosition(curr)) {
    return { ...base, reason: 'invalid-position' };
  }
  if (!isCategory(prev.nic) || !isCategory(curr.nic)) {
    if (
      (prev.nic !== undefined && prev.nic !== null && !isCategory(prev.nic)) ||
      (curr.nic !== undefined && curr.nic !== null && !isCategory(curr.nic))
    ) {
      return { ...base, reason: 'invalid-quality' };
    }
    return { ...base, reason: 'missing-quality' };
  }
  if (prev.nic === 0 || curr.nic === 0) {
    return {
      ...base,
      rcPrevM: NIC_CONTAINMENT_RADIUS_M[prev.nic],
      rcCurrM: NIC_CONTAINMENT_RADIUS_M[curr.nic],
      reason: 'unknown-containment',
    };
  }
  if (!finite(prev.atMs) || !finite(curr.atMs)) {
    return { ...base, reason: 'invalid-time' };
  }
  const dtS = (curr.atMs - prev.atMs) / 1000;
  if (dtS < 0) {
    return { ...base, reason: 'negative-dt' };
  }
  const rcPrevM = NIC_CONTAINMENT_RADIUS_M[prev.nic];
  const rcCurrM = NIC_CONTAINMENT_RADIUS_M[curr.nic];
  const distanceM = haversineM(prev, curr);
  const allowedM = rcPrevM + rcCurrM + maxSpeedMps * dtS;
  const anomalous = distanceM > allowedM;
  return {
    ...base,
    judged: true,
    anomalous,
    signals: anomalous ? [CONTAINMENT_JUMP_SIGNAL] : [],
    interpretation: anomalous ? CONTAINMENT_JUMP_INTERPRETATION : null,
    distanceM,
    allowedM,
    excessM: distanceM - allowedM,
    ratio: allowedM > 0 ? distanceM / allowedM : null,
    dtS,
    rcPrevM,
    rcCurrM,
  };
}

/**
 * Detect containment-violation events across fixes from one aircraft.
 * Fixes are judged in timestamp order (a sorted copy; input order is
 * never assumed). One event per violating consecutive pair. Fixes
 * that cannot be judged (bad position/quality/time) yield no event
 * for their adjacent pairs; the chain is judged pair-by-pair.
 *
 * @param {{lat?: number, lon?: number, nic?: number, atMs?: number,
 *   hex?: string}[]} fixes - Fixes from one aircraft (any order).
 * @param {{maxSpeedMps?: number, hex?: string}} [options] -
 *   Plausible-speed cap, and hex to stamp on events when the fixes
 *   do not carry one.
 * @returns {{hex: string|null, prevAtMs: number, atMs: number,
 *   distanceM: number, allowedM: number, excessM: number,
 *   ratio: number|null, signal: string, interpretation: string}[]}
 *   Violation events, in timestamp order.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectContainmentJumpEvents(
  fixes,
  { maxSpeedMps = CONTAINMENT_JUMP_MAX_SPEED_MPS, hex = null } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectContainmentJumpEvents requires an array');
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
      verdict = checkContainmentJump(prev, curr, { maxSpeedMps });
    } catch {
      continue;
    }
    if (!verdict.anomalous) continue;
    events.push({
      hex: eventHex(curr, eventHex(prev, hex)),
      prevAtMs: prev.atMs,
      atMs: curr.atMs,
      distanceM: verdict.distanceM,
      allowedM: verdict.allowedM,
      excessM: verdict.excessM,
      ratio: verdict.ratio,
      signal: CONTAINMENT_JUMP_SIGNAL,
      interpretation: CONTAINMENT_JUMP_INTERPRETATION,
    });
  }
  return events;
}

/**
 * Summarize containment-violation events across aircraft.
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
export function summarizeContainmentJumpEvents(
  events,
  {
    windowMs = CONTAINMENT_JUMP_CORROBORATION_WINDOW_MS,
    minAircraft = CONTAINMENT_JUMP_CORROBORATION_MIN_AIRCRAFT,
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
    interpretation: corroborated ? CONTAINMENT_JUMP_INTERPRETATION : null,
  };
}
