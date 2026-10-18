/**
 * Emitter-category vs callsign consistency: a pure ADS-B identity check.
 *
 * Research basis: ADS-B's EMITTER CATEGORY field is encoded per DO-260B
 * Table 2-16 (ICAO UAT tech manual Table 2-32 carries the same set) as a
 * numeric code — 0 no information, 1 light (<15,500 lb), 2 small, 3 large,
 * 4 high-vortex large (e.g. B757), 5 heavy (>300,000 lb), 6 highly
 * maneuverable (>5 g), 7 rotorcraft, 9 glider/sailplane, 10 lighter-than-air,
 * 11 parachutist, 12 ultralight/hang-glider/paraglider, 14 unmanned aerial
 * vehicle, 15 space/transatmospheric, 17/18 surface vehicles, 19-21 obstacles,
 * 22-39 reserved, 8/13/16 unassigned. The same spec constrains the 8-char
 * CALL SIGN field (digits 0-9, capitals A-Z, trailing spaces) to "an
 * identifier appropriate for the Emitter Category, operating rules, and
 * procedures under which the A/V is operating". A callsign that contradicts
 * the declared category is therefore a direct spec violation, not a judgment
 * call.
 *
 * Why this check, not one of the earlier ones: every prior GNSS/ADS-B check
 * judges motion or quality fields. Cycles 7-18 covered update rate, spoof
 * signals, NIC/NACp/NACv/SIL/SDA consistency, NIC containment, baro-geo
 * jumps, duplicate ICAO24s, dead reckoning, vertical rate, acceleration
 * plausibility, and altitude-encoding plausibility. None of them look at the
 * IDENTITY pair: the same airframe broadcasting one emitter category and an
 * incompatible callsign. This closes that gap on a single report, with no
 * fix history and no second aircraft.
 *
 * The judged case is narrow and honest: a callsign shaped like a scheduled
 * airline flight ID — a known ICAO airline designator prefix followed by a
 * flight number — paired with an emitter category that no scheduled airline
 * flight uses. `UAL123` claiming emitter category 5 (heavy) is consistent;
 * `UAL123` claiming 9 (glider/sailplane), 7 (rotorcraft), 1 (light), 14
 * (UAV), or a surface-vehicle category is a mismatch. Scheduled airline
 * traffic flies transport-category fixed-wing aircraft (categories 2, 3, 4,
 * 5); rotorcraft, gliders, light piston aircraft, and UAVs do not operate
 * scheduled airline flight numbers.
 *
 * Real-world grounding: the FAA's own ADS-B installation guidance lists
 * wrong emitter-category configuration as a top equipage error ("Light"
 * aircraft incorrectly configured as "small", category 6 claimed by
 * non-aerobatic types) and tracks call-sign mismatch (CSMM) as an automated
 * ATC alert — so misconfiguration is the most common benign cause of a
 * mismatch here, and spoofing of the identity fields is the hostile one.
 * The observed fact is the mismatch; the interpretation is unvalidated.
 *
 * What this is NOT:
 * - Not a full identity-verification engine. Callsigns NOT shaped like a
 *   recognized airline flight ID are unjudgeable: general aviation
 *   registrations ("N123AB"), military callsigns, ferry/test callsigns
 *   (even Airbus's own "AIB" test flights) are deliberately out of scope.
 * - Not exhaustive on airline prefixes. The designator list is a curated
 *   set of major scheduled carriers (exported, extendable by callers). An
 *   unknown 3-letter-plus-digits callsign is unjudgeable, never a mismatch:
 *   missing knowledge must not become evidence.
 * - Not a registration lookup. Nothing here verifies the callsign against
 *   an operator database; that is a separate (online) step.
 * - Not corroboration-gated. This is a per-report signal; cross-report or
 *   cross-aircraft corroboration is a wiring concern, out of scope for a
 *   standalone module.
 *
 * Pure: no DOM, no Cesium, no imports, no node:fs/node:path. Standalone:
 * no feed wiring — no call-site changes ship with this module.
 */

/** Numeric emitter category: heavy (>300,000 lb ICAO). */
export const EMITTER_CATEGORY_HEAVY = 5;
/** Numeric emitter category: rotorcraft. */
export const EMITTER_CATEGORY_ROTORCRAFT = 7;
/** Numeric emitter category: glider/sailplane. */
export const EMITTER_CATEGORY_GLIDER = 9;
/** Numeric emitter category: unmanned aerial vehicle. */
export const EMITTER_CATEGORY_UAV = 14;

/**
 * Fixed-wing transport categories flown by scheduled airlines:
 * 2 small (15,500-75,000 lb), 3 large (75,000-300,000 lb),
 * 4 high-vortex large (e.g. B757), 5 heavy (>300,000 lb).
 */
export const EMITTER_CATEGORIES_AIRLINE_COMPATIBLE = Object.freeze([
  2, 3, 4, 5,
]);

/**
 * Categories that no scheduled airline flight operates with an airline
 * flight-ID callsign: light piston GA (1), aerobatic/high-g types (6),
 * rotorcraft (7), gliders (9), balloons/airships (10), parachutists (11),
 * ultralights (12), UAVs (14), space/transatmospheric (15), surface
 * vehicles (17, 18), and fixed obstacles (19, 20, 21).
 */
export const EMITTER_CATEGORIES_AIRLINE_INCOMPATIBLE = Object.freeze([
  1, 6, 7, 9, 10, 11, 12, 14, 15, 17, 18, 19, 20, 21,
]);

/**
 * Curated set of ICAO airline (telephony) designators used to recognise a
 * scheduled-airline flight-ID callsign. Intentionally major carriers only;
 * an unknown prefix is unjudgeable, never evidence of a mismatch. Exported
 * so callers can extend it for their airspace without editing this module.
 */
export const KNOWN_AIRLINE_DESIGNATORS = Object.freeze(
  new Set([
    // North America
    'UAL',
    'AAL',
    'DAL',
    'SWA',
    'JBU',
    'ASA',
    'FDX',
    'UPS',
    'GTI',
    'CLX',
    'BOX',
    'ACA',
    'WJA',
    // Europe
    'BAW',
    'DLH',
    'AFR',
    'KLM',
    'VIR',
    'EZY',
    'RYR',
    'SWR',
    'AUA',
    'SAS',
    'FIN',
    'VLG',
    'THY',
    'TAP',
    'IBE',
    'AZA',
    'BEL',
    'EIN',
    'LOT',
    'AEE',
    // Middle East / Africa
    'UAE',
    'ETD',
    'QTR',
    'SVA',
    'GFA',
    'MSR',
    'OMA',
    'KAC',
    'ELY',
    'ETH',
    'KQA',
    'SAA',
    'RAM',
    // Asia-Pacific
    'SIA',
    'CPA',
    'THA',
    'ANA',
    'JAL',
    'KAL',
    'CCA',
    'CES',
    'CSN',
    'AIC',
    'IGO',
    'EVA',
    'MAS',
    'GIA',
    'PAL',
    'AXM',
    'TGW',
    // Latin America
    'LAN',
    'ARG',
    'CMP',
    'AMX',
    'GLO',
  ]),
);

/** Observed fact: emitter category contradicts the callsign. */
export const EMITTER_CONSISTENCY_SIGNAL = 'emitter-category-callsign-mismatch';
/** Secondary, unvalidated reading of the mismatch. */
export const EMITTER_CONSISTENCY_INTERPRETATION = 'suspected-identity-spoofing';

/** DO-260B emitter category set, 0-39 (ICAO UAT Table 2-32 wording). */
export const EMITTER_CATEGORY_LABELS = Object.freeze({
  0: 'no aircraft type information',
  1: 'light (<15,500 lb)',
  2: 'small (15,500-75,000 lb)',
  3: 'large (75,000-300,000 lb)',
  4: 'high-vortex large (e.g. B757)',
  5: 'heavy (>300,000 lb)',
  6: 'highly maneuverable (>5 g)',
  7: 'rotorcraft',
  8: 'unassigned',
  9: 'glider/sailplane',
  10: 'lighter than air',
  11: 'parachutist/skydiver',
  12: 'ultralight/hang glider/paraglider',
  13: 'unassigned',
  14: 'unmanned aerial vehicle',
  15: 'space/transatmospheric vehicle',
  16: 'unassigned',
  17: 'surface vehicle - emergency vehicle',
  18: 'surface vehicle - service vehicle',
  19: 'point obstacle',
  20: 'cluster obstacle',
  21: 'line obstacle',
});

/**
 * Designator prefix + flight number, e.g. "UAL123", "BAW 9", "DLH400H".
 * Three letters, an optional space, 1-4 digits, one optional trailing
 * letter (heavy/special suffix used on some flight IDs).
 */
const AIRLINE_FLIGHT_ID_RE = /^([A-Z]{3}) ?([0-9]{1,4})([A-Z]?)$/;
/** ADS-B callsign alphabet: 8 characters of A-Z, 0-9, trailing spaces. */
const CALLSIGN_ALPHABET_RE = /^[A-Z0-9 ]{1,8}$/;

/**
 * Judge whether one ADS-B report's emitter category is consistent with its
 * callsign. Normalises inputs (uppercase/trim callsign, numeric category);
 * returns null on invalid input; never throws.
 *
 * @param {object} input
 * @param {number|string} input.emitterCategory Numeric DO-260B category 0-39.
 * @param {string} input.callsign Flight ID from the report.
 * @returns {null|{
 *   judged: boolean,
 *   consistent: boolean,
 *   signals: string[],
 *   interpretation: (string|null),
 *   reason: (string|null),
 *   emitterCategory: number,
 *   callsign: string,
 * }} Null on invalid input; an unjudgeable result (judged:false) when the
 *   category is unknown/unassigned/reserved or the callsign is not a
 *   recognised scheduled-airline flight ID.
 */
export function emitterCategoryConsistency(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const category = toCategoryNumber(input.emitterCategory);
  const callsign = toCallsign(input.callsign);
  if (category === null || callsign === null) return null;

  const base = {
    judged: false,
    consistent: true,
    signals: [],
    interpretation: null,
    reason: null,
    emitterCategory: category,
    callsign,
  };

  if (category === 0 || isUnassignedOrReserved(category)) {
    return {
      ...base,
      reason: `emitter category ${category} carries no aircraft type information`,
    };
  }

  const airlineId = parseAirlineFlightId(callsign);
  if (airlineId === null) {
    return {
      ...base,
      reason: 'callsign is not a recognised scheduled-airline flight ID',
    };
  }

  if (EMITTER_CATEGORIES_AIRLINE_COMPATIBLE.includes(category)) {
    return {
      ...base,
      judged: true,
      reason: `airline flight ID with ${EMITTER_CATEGORY_LABELS[category]} category`,
    };
  }

  if (EMITTER_CATEGORIES_AIRLINE_INCOMPATIBLE.includes(category)) {
    return {
      ...base,
      judged: true,
      consistent: false,
      signals: [EMITTER_CONSISTENCY_SIGNAL],
      interpretation: EMITTER_CONSISTENCY_INTERPRETATION,
      reason:
        `airline flight ID "${airlineId}" claims emitter category ${category} ` +
        `(${EMITTER_CATEGORY_LABELS[category]}) — no scheduled airline ` +
        `operates this category; misconfiguration is the common benign ` +
        `cause, spoofed identity fields the hostile one`,
    };
  }

  // Unreachable with the current tables, kept as a guard.
  return { ...base, reason: `emitter category ${category} not classified` };
}

/** Coerce a numeric category: integer 0-39, or null when invalid. */
function toCategoryNumber(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    const coerced = Number(value);
    if (Number.isInteger(coerced)) return coerceRange(coerced);
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return coerceRange(value);
  }
  return null;
}

function coerceRange(value) {
  return value >= 0 && value <= 39 ? value : null;
}

/** Categories 8/13/16 are unassigned, 22-39 are reserved per the set. */
function isUnassignedOrReserved(category) {
  return (
    category === 8 ||
    category === 13 ||
    category === 16 ||
    (category >= 22 && category <= 39)
  );
}

/** Uppercase/trim the callsign, validate the ADS-B alphabet, else null. */
function toCallsign(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized.length === 0 || !CALLSIGN_ALPHABET_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Recognised scheduled-airline flight ID, or null. A 3-letter prefix must
 * be a known ICAO airline designator; unknown prefixes stay unjudgeable.
 */
function parseAirlineFlightId(callsign) {
  const match = AIRLINE_FLIGHT_ID_RE.exec(callsign);
  if (match === null) return null;
  if (!KNOWN_AIRLINE_DESIGNATORS.has(match[1])) return null;
  return callsign.replace(/ +/g, '');
}
