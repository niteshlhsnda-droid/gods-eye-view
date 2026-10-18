/**
 * Duplicate ICAO 24-bit address detection: two distinct tracks claiming the
 * SAME 24-bit aircraft address within a coincidence window whose positions
 * are physically incompatible.
 *
 * Primary sources:
 * - EASA Safety Information Bulletin SIB 2011-14, "ICAO 24-Bit Aircraft
 *   Address Settings": "Any incorrect aircraft address is, potentially, a
 *   duplicate address, because it has not been legitimately assigned to that
 *   airframe. The potential for duplication rises dramatically in cases of
 *   incorrect addresses where values such as all 0's or all 1's have been
 *   set." A duplicate address can swap controller display labels and
 *   seriously degrade or disable ACAS II.
 * - FlightAware, "Demystifying ADS-B Receiver Data": "Even the 'unique'
 *   ICAO code can be wrong... This can result in multiple aircraft flying
 *   with the same ICAO code" (mis-programmed at install, or stale after a
 *   re-registration where the transponder address was never updated).
 * - ICAO APAC Radio Navigation Symposium (2025), ADS-B spoofing briefing:
 *   spoofing symptoms include "'Additional' or 'duplicate' aircraft will
 *   appear to the controller"; detection means include an "Anti-spoofing
 *   algorithm at receiver/ATM system" and a "Check against flight plans".
 * - RTCA DO-260B (1090ES MOPS) and ICAO Annex 10 Vol III: the 24-bit
 *   aircraft address is assigned once per airframe by the State of Registry
 *   and must be transmitted as assigned — it is the address, not a callsign,
 *   and is meant to be globally unique per airframe.
 *
 * What no prior check sees: every earlier GNSS/ADS-B check judges ONE
 * track in isolation (motion, containment, quality, trajectory). A ghost
 * injection or a mis-programmed transponder that copies a legitimate
 * aircraft's address flies perfectly clean single-track checks — positions,
 * velocity, NIC and NACp can all be plausible. The tell is
 * cross-track: one address, two places. This check compares pairs of
 * fixes that claim the same address and flags pairs whose separation
 * cannot be covered by one airframe in the elapsed time.
 *
 * A judged pair with no conflict is consistent even for the reserved
 * all-zero/all-one addresses; those get their own observed-fact signal
 * (EASA SIB's mis-programming marker) without a conflict verdict.
 * `interpretation` follows the Cycle-12 precedent and is only attached
 * when the conflict is corroborated by two or more distinct aircraft in
 * the window: at least two conflicted pairs, or one conflicted pair whose
 * two tracks report divergent callsigns (two positively identified
 * airframes). A lone conflicted pair without callsign corroboration is
 * the observed fact only — it can also be a decoder pairing two receivers'
 * feeds on one address with stale timestamps.
 *
 * Pure module, no imports. Standalone: NO feed wiring — normalization
 * drops the fields this check needs (hex, callsign), so wiring hex /
 * callsign through normalization is a separate step. Never throws on bad
 * input: invalid fixes and addresses return not-judged results.
 */

/** Fixes farther apart in time than this never form a pair (ms). */
export const DUPLICATE_ICAO24_WINDOW_MS = 60_000;
/**
 * Generous civil-aircraft ceiling for the "one airframe could have moved
 * this far" test (~583 kt); deliberately above any plausible cruise so a
 * conflict verdict means the pair cannot be one aircraft.
 */
export const DUPLICATE_ICAO24_MAX_SPEED_MPS = 300;
/** Feed/decoder merge tolerance for two reports of the same airframe (m). */
export const DUPLICATE_ICAO24_POSITION_TOLERANCE_M = 2_000;
/** Observed fact: the two fixes cannot be the same airframe. */
export const DUPLICATE_ICAO24_SIGNAL_CONFLICT = 'duplicate-icao24-conflict';
/** Observed fact: the address is an EASA SIB mis-programming marker. */
export const DUPLICATE_ICAO24_SIGNAL_RESERVED_ADDRESS =
  'duplicate-icao24-reserved-address';
/** Observed fact: the two tracks identify as different flights. */
export const DUPLICATE_ICAO24_SIGNAL_CALLSIGN_DIVERGENT =
  'duplicate-icao24-callsign-divergent';
/** Secondary, unvalidated reading of a corroborated conflict. */
export const DUPLICATE_ICAO24_INTERPRETATION = 'suspected-adsb-spoofing';
/**
 * All-zeros and all-ones 24-bit addresses: the EASA SIB 2011-14 markers
 * of a never-programmed or defaulted Mode S transponder.
 */
export const DUPLICATE_ICAO24_RESERVED_HEXES = Object.freeze([
  '000000',
  'FFFFFF',
]);

/** IUGG mean Earth radius, metres (same as the Cycle 5 velocity module). */
const EARTH_MEAN_RADIUS_M = 6_371_008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

function validLatLon(fix) {
  return (
    fix &&
    typeof fix === 'object' &&
    finiteNumber(fix.lat) &&
    finiteNumber(fix.lon) &&
    fix.lat >= -90 &&
    fix.lat <= 90 &&
    fix.lon >= -180 &&
    fix.lon <= 180 &&
    finiteNumber(fix.atMs)
  );
}

/** Normalize a longitude delta in degrees to [-180, 180]. */
function wrapLonDeltaDeg(delta) {
  let wrapped = delta % 360;
  if (wrapped > 180) wrapped -= 360;
  if (wrapped < -180) wrapped += 360;
  return wrapped;
}

/** Great-circle distance between two fixes (haversine, spherical earth). */
function haversineDistanceM(a, b) {
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dp = toRad(b.lat - a.lat);
  const dl = toRad(wrapLonDeltaDeg(b.lon - a.lon));
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_MEAN_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Normalize a claimed ICAO 24-bit address to its canonical six-uppercase-
 * hex-char form, tolerating readsb-style variants ("a835af", "0xA835AF").
 * @returns {string|null} The canonical address, or null when not a 24-bit hex.
 */
export function normalizeIcao24(hex) {
  if (typeof hex !== 'string') return null;
  const cleaned = hex.trim().replace(/^0x/i, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(cleaned) ? cleaned : null;
}

/**
 * Normalize a reported callsign/flight-id for comparison: trimmed and
 * uppercased, null when absent or blank. (readsb reports it space-padded.)
 */
export function normalizeCallsign(callsign) {
  if (typeof callsign !== 'string') return null;
  const cleaned = callsign.trim().toUpperCase();
  return cleaned === '' ? null : cleaned;
}

/**
 * Judge one pair of fixes claiming the same ICAO 24-bit address.
 *
 * The conflict test asks whether ONE airframe could have produced both
 * fixes: separation must stay within the position tolerance plus the
 * elapsed time times the civil ceiling. Simultaneous fixes (dt = 0) at
 * different positions conflict whenever they are farther apart than the
 * tolerance. Fixes inside the window and within the movement bound are
 * the normal "one airframe, two reports" case and are consistent.
 *
 * @param {{lat: number, lon: number, atMs: number, hex?: string, callsign?: string}} fixA First fix.
 * @param {{lat: number, lon: number, atMs: number, hex?: string, callsign?: string}} fixB Second fix.
 * @returns {Readonly<{judged: boolean, conflict: boolean|null, consistent: boolean|null, signals: string[], dtMs: number|null, separationM: number|null, hex: string|null, reservedAddress: boolean, callsignDivergent: boolean|null, interpretation: null, reason: string|null}>}
 *   `reason` names why a pair was not judged: `invalid-address`
 *   (either side missing or not 24-bit hex), `address-mismatch`, or
 *   `invalid-fix` (bad coordinates or timestamp), or `outside-window`.
 *   `interpretation` is always null at pair level; see
 *   `summarizeDuplicateIcao24` for the corroborated reading.
 */
export function duplicateIcao24Pair(fixA, fixB) {
  const notJudged = (reason) =>
    Object.freeze({
      judged: false,
      conflict: null,
      consistent: null,
      signals: Object.freeze([]),
      dtMs: null,
      separationM: null,
      hex: null,
      reservedAddress: false,
      callsignDivergent: null,
      interpretation: null,
      reason,
    });

  const hexA = normalizeIcao24(fixA?.hex);
  const hexB = normalizeIcao24(fixB?.hex);
  if (!hexA || !hexB) return notJudged('invalid-address');
  if (hexA !== hexB) return notJudged('address-mismatch');
  if (!validLatLon(fixA) || !validLatLon(fixB)) return notJudged('invalid-fix');

  const dtMs = Math.abs(fixB.atMs - fixA.atMs);
  if (dtMs > DUPLICATE_ICAO24_WINDOW_MS) return notJudged('outside-window');

  const separationM = haversineDistanceM(fixA, fixB);
  const limitM =
    DUPLICATE_ICAO24_POSITION_TOLERANCE_M +
    (dtMs / 1000) * DUPLICATE_ICAO24_MAX_SPEED_MPS;
  const conflict = separationM > limitM;

  const signals = [];
  if (conflict) signals.push(DUPLICATE_ICAO24_SIGNAL_CONFLICT);
  const reservedAddress = DUPLICATE_ICAO24_RESERVED_HEXES.includes(hexA);
  if (reservedAddress) signals.push(DUPLICATE_ICAO24_SIGNAL_RESERVED_ADDRESS);

  let callsignDivergent = null;
  const csA = normalizeCallsign(fixA.callsign);
  const csB = normalizeCallsign(fixB.callsign);
  if (csA !== null && csB !== null) {
    callsignDivergent = csA !== csB;
    if (callsignDivergent)
      signals.push(DUPLICATE_ICAO24_SIGNAL_CALLSIGN_DIVERGENT);
  }

  return Object.freeze({
    judged: true,
    conflict,
    consistent: signals.length === 0,
    signals: Object.freeze(signals),
    dtMs,
    separationM,
    hex: hexA,
    reservedAddress,
    callsignDivergent,
    // Corroboration by >=2 distinct aircraft is a batch property, not a
    // pair property: see summarizeDuplicateIcao24.
    interpretation: null,
    reason: null,
  });
}

/**
 * Summarize a batch of claimed-same-address fix pairs drawn from one time
 * window. Entries whose fixes or addresses are invalid count as
 * insufficient, never as evidence — a bad decode is not a conflict.
 *
 * @param {{hex?: string, a?: object, b?: object}[]} [pairs]
 * @param {{maxConflictHexes?: number}} [options]
 * @returns {{total: number, judged: number, conflict: number, conflictPairs: number, insufficient: number, conflictHexes: string[], interpretation: string|null}}
 *   `interpretation` is `suspected-adsb-spoofing` only when the conflict is
 *   corroborated by two or more distinct aircraft in the window: at least
 *   two conflicted pairs (each conflicted pair is two distinct tracks —
 *   positions incompatible, so not one airframe), or one conflicted pair
 *   whose tracks report divergent callsigns (two positively identified
 *   airframes). A lone conflicted pair without callsign corroboration is
 *   reported as the observed fact only.
 */
export function summarizeDuplicateIcao24(
  pairs = [],
  { maxConflictHexes = 50 } = {},
) {
  const summary = {
    total: 0,
    judged: 0,
    conflict: 0,
    conflictPairs: 0,
    insufficient: 0,
    conflictHexes: [],
    interpretation: null,
  };
  const listed = new Set();
  let divergentPairSeen = false;
  for (const entry of pairs ?? []) {
    summary.total += 1;
    let result;
    try {
      result = duplicateIcao24Pair(entry?.a, entry?.b);
    } catch {
      summary.insufficient += 1;
      continue;
    }
    if (!result.judged) {
      summary.insufficient += 1;
      continue;
    }
    summary.judged += 1;
    if (!result.conflict) continue;
    summary.conflict += 1;
    summary.conflictPairs += 1;
    if (result.callsignDivergent) divergentPairSeen = true;
    if (
      !listed.has(result.hex) &&
      summary.conflictHexes.length < maxConflictHexes
    ) {
      listed.add(result.hex);
      summary.conflictHexes.push(result.hex);
    }
  }
  if (summary.conflictPairs >= 2 || divergentPairSeen)
    summary.interpretation = DUPLICATE_ICAO24_INTERPRETATION;
  return summary;
}
