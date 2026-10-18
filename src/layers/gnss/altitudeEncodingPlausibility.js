/**
 * Mode-S altitude-encoding plausibility: a check that a reported barometric
 * altitude could have come out of a real Mode-S transponder at all.
 *
 * A Mode-S extended squitter carries barometric altitude in the 13-bit AC
 * field in one of two encodings (ICAO Doc 9871, DO-260B §2.2.3.2.7.2.2):
 * - Q-bit = 1: an 11-bit binary count N in 25-ft steps,
 *   altitude = N × 25 − 1000 ft, so −1000 to +50,175 ft.
 * - Q-bit = 0: the Gillham code, a modified Gray code in 100-ft steps,
 *   spanning −1000 to +126,700 ft.
 * Both encodings therefore produce altitudes that are exact multiples of
 * 25 ft, and their ranges bound what any transponder can emit: nothing
 * below −1000 ft, nothing above +126,700 ft, and nothing above 50,175 ft
 * that is not a 100-ft multiple (the binary encoding cannot reach that
 * high; only the 100-ft Gillham encoding can).
 *
 * What no prior check sees: the altitude-divergence check compares baro
 * against geometric altitude on one fix — it never asks whether the baro
 * value itself is encodable. The movement checks (teleport, velocity
 * consistency, acceleration) judge horizontal path shape; a spoof that
 * keeps positions plausible while fabricating altitudes — e.g. a phantom
 * aircraft climbing through 60,000 ft in 37-ft steps, or a decoder bug
 * that blends metre-converted or interpolated altitudes into the baro
 * field — passes all of them. This check trusts no reported field except
 * the altitude itself, and judges it against the union of the two
 * encodings, not against flight performance.
 *
 * Why the union, not the encoding: decoded feeds (readsb `alt_baro`) do
 * not carry the Q-bit, so the encoding in use is unobservable. Judging
 * against the union means a fix is flagged only when NO Mode-S encoding
 * could have produced it — a stricter, decoder-agnostic bar.
 *
 * The Gillham bit-level property — adjacent 100-ft steps differ in exactly
 * one code bit, so a multi-bit change between successive Gillham words is
 * an impossible transition — is NOT judged here: it is observable only in
 * raw message bits, which decoded feeds do not carry. The decoded-level
 * consequences of encoding violations (impossible quantization, altitudes
 * outside both encodings' ranges, granularity no encoding reaches) are
 * what this module judges; a raw-bit Gillham transition check belongs at
 * the decoder, not at the feed.
 *
 * The events are secondary, unvalidated signals — never a verdict. Benign
 * causes also produce non-encodable altitudes:
 * - Aggregator smoothing or interpolation between 25-ft steps.
 * - Feet↔metre conversion rounding blended into the baro field.
 * - Geometric (GNSS) or MLAT-estimated altitudes mixed into the baro
 *   field by the aggregator.
 * - A faulty altitude encoder or decoder bug on a real aircraft.
 * - A transponder test pattern (ground maintenance squitters) leaking
 *   into the feed.
 * Fixes with an explicit `onGround === true` flag are EXCLUDED, not
 * flagged: ground proximity multipath and maintenance squitters bend
 * surface altitudes for entirely benign reasons.
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring (carrying
 * per-aircraft fix histories through normalization, which currently keeps
 * only the latest snapshot) is a separate step.
 */

/** Both Mode-S altitude encodings quantize to multiples of this, feet. */
export const ALTITUDE_ENCODING_QUANTUM_FT = 25;
/** Q=1 binary encoding: 11-bit N, altitude = N × 25 − 1000 ft. */
export const ALTITUDE_ENCODING_BINARY_MIN_FT = -1_000;
export const ALTITUDE_ENCODING_BINARY_MAX_FT = 50_175;
/** Q=0 Gillham encoding: 100-ft Gray code, ICAO range. */
export const ALTITUDE_ENCODING_GILLHAM_MIN_FT = -1_000;
export const ALTITUDE_ENCODING_GILLHAM_MAX_FT = 126_700;
/** Corroboration window: violations this close together count as one sky event. */
export const ALTITUDE_ENCODING_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must violate inside one window to corroborate. */
export const ALTITUDE_ENCODING_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: a fix's altitude is not a multiple of 25 ft. */
export const ALTITUDE_ENCODING_SIGNAL_QUANTIZATION =
  'altitude-quantization-violation';
/** Observed fact: a fix's altitude is outside every Mode-S encoding. */
export const ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE =
  'altitude-encoding-impossible';
/**
 * Secondary, unvalidated reading of a CORROBORATED violation summary.
 * Stamped only by the corroborated summary — per-aircraft verdicts and
 * per-fix events carry facts alone, never this reading.
 */
export const ALTITUDE_ENCODING_INTERPRETATION = 'suspected-adsb-spoofing';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a fix is parked: only an explicit on-ground flag excludes. */
function isParked(fix) {
  return fix?.onGround === true;
}

/** Whether a fix carries a usable barometric altitude. */
function hasAltitude(fix) {
  return !isParked(fix) && finite(fix?.alt);
}

/**
 * The encodings' quantization rule: every Mode-S altitude is an exact
 * multiple of 25 ft. A decoded float that is not an exact multiple cannot
 * be a raw transponder report — something transformed it.
 */
function quantizationViolation(alt) {
  return alt % ALTITUDE_ENCODING_QUANTUM_FT !== 0;
}

/**
 * Whether NO Mode-S encoding could have produced this altitude:
 * below both encodings' floor, above both encodings' ceiling, or above
 * the binary encoding's ceiling with a granularity the Gillham encoding
 * cannot produce (it quantizes to 100 ft).
 */
function encodingImpossible(alt) {
  if (alt < ALTITUDE_ENCODING_BINARY_MIN_FT) return true;
  if (alt > ALTITUDE_ENCODING_GILLHAM_MAX_FT) return true;
  if (
    alt > ALTITUDE_ENCODING_BINARY_MAX_FT &&
    alt % (ALTITUDE_ENCODING_QUANTUM_FT * 4) !== 0
  )
    return true;
  return false;
}

/** The violation signals for one altitude, or none. */
function violationSignals(alt) {
  const signals = [];
  if (quantizationViolation(alt))
    signals.push(ALTITUDE_ENCODING_SIGNAL_QUANTIZATION);
  if (encodingImpossible(alt))
    signals.push(ALTITUDE_ENCODING_SIGNAL_IMPOSSIBLE);
  return signals;
}

/**
 * Altitude-encoding plausibility verdict over one aircraft's fix history.
 *
 * Judged when at least one airborne fix carries a finite barometric
 * altitude; a history with no usable altitude yields no verdict
 * (`judged: false`) with the reason recorded, so callers can tell
 * "encodable altitudes" apart from "could not judge". The verdict carries
 * observed facts only — no interpretation; that reading belongs to the
 * corroborated cross-aircraft summary.
 *
 * @param {{atMs?: number, alt?: number, hex?: string,
 *   onGround?: boolean}[]} fixes - Fixes for one aircraft (any order;
 *   only `alt` — barometric altitude in feet, as readsb reports
 *   `alt_baro` — is judged).
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: null, reason: string|null, evaluatedFixes: number,
 *   violatingFixes: number, fixCount: number}} The verdict.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function altitudeEncodingPlausibilityCheck(fixes) {
  if (!Array.isArray(fixes)) {
    throw new TypeError(
      'altitudeEncodingPlausibilityCheck requires an array of fixes',
    );
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    evaluatedFixes: 0,
    violatingFixes: 0,
    fixCount: fixes.length,
  };
  const usable = fixes.filter(hasAltitude);
  if (usable.length === 0) {
    if (fixes.length === 0) {
      return { ...base, reason: 'insufficient-data' };
    }
    if (fixes.some((fix) => isParked(fix))) {
      return { ...base, reason: 'on-ground' };
    }
    return { ...base, reason: 'insufficient-data' };
  }
  const signals = new Set();
  let violatingFixes = 0;
  for (const fix of usable) {
    const fixSignals = violationSignals(fix.alt);
    if (fixSignals.length > 0) {
      violatingFixes += 1;
      for (const signal of fixSignals) signals.add(signal);
    }
  }
  return {
    ...base,
    judged: true,
    anomalous: violatingFixes > 0,
    signals: [...signals],
    evaluatedFixes: usable.length,
    violatingFixes,
  };
}

/**
 * Detect altitude-encoding violation events across one aircraft's fix
 * history. One event per violating fix, earliest first. A fix can carry
 * both signals at once (e.g. 60,013 ft is neither a 25-ft multiple nor
 * encodable above the binary ceiling).
 *
 * @param {{atMs?: number, alt?: number, hex?: string,
 *   onGround?: boolean}[]} fixes - Fixes for one aircraft (any order).
 * @param {{hex?: string}} [options] - Hex to stamp on events when the
 *   fixes do not carry one.
 * @returns {{hex: string|null, atMs: number|null, alt: number,
 *   signals: string[]}[]} Violation events, earliest first. Events carry
 *   facts alone — no interpretation.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectAltitudeEncodingEvents(fixes, { hex = null } = {}) {
  if (!Array.isArray(fixes)) {
    throw new TypeError(
      'detectAltitudeEncodingEvents requires an array of fixes',
    );
  }
  const usable = fixes
    .filter(hasAltitude)
    .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  const events = [];
  for (const fix of usable) {
    const signals = violationSignals(fix.alt);
    if (signals.length === 0) continue;
    const fixHex =
      typeof fix?.hex === 'string'
        ? fix.hex
        : typeof hex === 'string'
          ? hex
          : null;
    events.push({
      hex: fixHex,
      atMs: finite(fix?.atMs) ? fix.atMs : null,
      alt: fix.alt,
      signals,
    });
  }
  return events;
}

/**
 * Summarize altitude-encoding violation events across aircraft.
 * Corroboration is the sky-event test: at least `minAircraft` DISTINCT
 * aircraft violating inside one sliding `windowMs` window. Two events
 * from one aircraft never corroborate each other — one faulty encoder
 * already explains every violation from that airframe, so counting events
 * instead of aircraft would corroborate a single bad encoder with
 * itself. Events without a finite timestamp are malformed and ignored.
 *
 * The `suspected-adsb-spoofing` reading appears ONLY on a corroborated
 * summary: one aircraft's non-encodable altitudes are a receiver or
 * encoder event until a second aircraft violates in the same window.
 *
 * @param {{hex?: string|null, atMs?: number}[]} events - Violation events.
 * @param {{windowMs?: number, minAircraft?: number}} [options] -
 *   Corroboration window and distinct-aircraft bar.
 * @returns {{count: number, aircraftCount: number, corroborated: boolean,
 *   windowMs: number, firstAtMs: number|null, lastAtMs: number|null,
 *   interpretation: string|null}} The summary.
 */
export function summarizeAltitudeEncodingEvents(
  events,
  {
    windowMs = ALTITUDE_ENCODING_CORROBORATION_WINDOW_MS,
    minAircraft = ALTITUDE_ENCODING_CORROBORATION_MIN_AIRCRAFT,
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
    interpretation: corroborated ? ALTITUDE_ENCODING_INTERPRETATION : null,
  };
}
