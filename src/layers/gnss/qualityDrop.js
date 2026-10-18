/**
 * Sudden per-aircraft NIC/NACp quality drop: a temporal cross-check on the
 * aircraft-reported navigation quality the cell layer already classifies.
 *
 * The cell layer (`records.js`) classifies each fix in isolation: an
 * aircraft reporting NIC < 7 or NACp < 8 counts as degraded whether it has
 * reported degraded values all flight (old transponder, persistent
 * avionics fault) or degraded only in the last minute. Those two cases
 * mean very different things. A transponder that always reports low
 * quality is a property of the aircraft; an aircraft whose reported
 * quality was good and then suddenly degrades mid-flight is a property
 * of the sky it just flew into — a receiver losing satellites to
 * jamming, terrain masking, or a spoofed signal it can no longer trust
 * is exactly what a fresh drop looks like.
 *
 * What no prior check sees: the Cycle 1 coverage bands count degraded
 * reports per cell, the Cycle 2 spoof signals watch positions move, the
 * Cycle 4 altitude check compares two altitudes on one fix, and the
 * Cycle 5 velocity check compares reported against derived motion.
 * None of them compares an aircraft's quality fields against its OWN
 * earlier quality fields, so a sky-wide interference event that drags
 * ten healthy aircraft from good to degraded reads exactly like ten
 * chronically bad transponders. This check closes that gap by judging
 * each fix pair against the aircraft's own earlier quality baseline,
 * and by corroborating across aircraft: one aircraft dropping is a
 * receiver event, two or more dropping within minutes is a sky event.
 *
 * The drop is a secondary, unvalidated signal — never a verdict —
 * because benign effects also degrade reported quality:
 * - Satellite geometry: a setting constellation or a banked turn can
 *   worsen DOP and drag NACp down without any interference.
 * - Terrain / antenna masking: valleys and airframe shadowing cost
 *   satellites on an otherwise clear day.
 * - Receiver faults: a failing antenna or firmware glitch degrades one
 *   aircraft's reports while the sky is fine, which is why a lone drop
 *   is not corroborated and a lone drop never implies interference.
 * - Recovery is out of scope: a degraded-to-good pair is not a drop,
 *   so it yields no verdict here. A recovery detector would be a
 *   separate check, not a negation of this one.
 *
 * Quality semantics mirror the cell-layer classifier exactly (same NIC
 * 7 / NACp 8 edges, same NIC-0-with-NACp->=10 unknown exception), minus
 * the `gpsOkBefore` loss flag, which is a loss event rather than a
 * quality value and is already classified where it is reported.
 *
 * Pure module, no imports. Wiring to the feed (carrying per-aircraft
 * fix histories through normalization, which currently keeps only the
 * latest snapshot) is a separate step.
 */

/** NIC below 7: containment radius of 0.2 NM or more (mirrors records.js). */
export const QUALITY_DROP_NIC_THRESHOLD = 7;
/** NACp below 8: position uncertainty of 93 m or more (mirrors records.js). */
export const QUALITY_DROP_NACP_THRESHOLD = 8;
/** NACp at or above this means NIC 0 is unknown, not bad (mirrors records.js). */
export const QUALITY_DROP_UNKNOWN_NIC_NACP_FLOOR = 10;
/**
 * Maximum fix spacing: beyond this, the two fixes are different epochs
 * (the aircraft may have landed, parked, and taken off again), so a
 * good-to-degraded pair is not a sudden drop.
 */
export const QUALITY_DROP_MAX_INTERVAL_MS = 600_000;
/** Corroboration window: drops this close together count as one sky event. */
export const QUALITY_DROP_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must drop inside one window to corroborate. */
export const QUALITY_DROP_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: one aircraft's reported quality suddenly degraded. */
export const QUALITY_DROP_SIGNAL = 'quality-drop';
/** Secondary, unvalidated reading of a drop (single or corroborated). */
export const QUALITY_DROP_INTERPRETATION = 'suspected-gnss-interference';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Quality fields of one fix, read tolerantly: missing stays null. */
function qualityFields(fix) {
  const nic = finite(fix?.nic) ? fix.nic : null;
  const nacp = finite(fix?.nacp) ? fix.nacp : null;
  return { nic, nacp };
}

/** Whether one quality field reports degraded, given both fields. */
function fieldDegraded(field, { nic, nacp }) {
  if (field === 'nacp')
    return nacp !== null && nacp < QUALITY_DROP_NACP_THRESHOLD;
  if (field === 'nic') {
    if (nic === null || nic >= QUALITY_DROP_NIC_THRESHOLD) return false;
    // NIC 0 with strong NACp is unknown, not bad (records.js exception).
    if (
      nic === 0 &&
      nacp !== null &&
      nacp >= QUALITY_DROP_UNKNOWN_NIC_NACP_FLOOR
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Whether a fix reports degraded quality on any field.
 *
 * @param {{nic?: number|null, nacp?: number|null}} fix - One position fix.
 * @returns {boolean} True when NIC or NACp reports degraded.
 */
export function isQualityDegraded(fix) {
  const fields = qualityFields(fix);
  return fieldDegraded('nic', fields) || fieldDegraded('nacp', fields);
}

/**
 * Whether a fix reports good quality: at least one quality field present
 * and none degraded. Missing fields are not bad, matching the classifier:
 * a fix with no quality data at all is not good, it is unknown.
 *
 * @param {{nic?: number|null, nacp?: number|null}} fix - One position fix.
 * @returns {boolean} True when the fix is a usable good-quality baseline.
 */
export function isQualityGood(fix) {
  const { nic, nacp } = qualityFields(fix);
  if (nic === null && nacp === null) return false;
  return !isQualityDegraded(fix);
}

/**
 * Quality-drop check between two successive fixes of ONE aircraft.
 *
 * A drop is a good baseline fix followed, within the interval window,
 * by a degraded fix. A pair is judged when it can be evaluated —
 * increasing in-window timestamps, a good baseline, and quality data
 * on the later fix — whether or not a drop occurred. A pair that
 * cannot be evaluated yields no verdict (`judged: false`) with the
 * reason recorded, so callers can tell "no drop" apart from
 * "could not judge".
 *
 * @param {{atMs?: number, nic?: number|null, nacp?: number|null}} prev -
 *   Earlier fix.
 * @param {{atMs?: number, nic?: number|null, nacp?: number|null}} next -
 *   Later fix.
 * @returns {{judged: boolean, dropped: boolean, signals: string[],
 *   interpretation: string|null, reason: string|null, intervalMs: number|null,
 *   nicBefore: number|null, nicAfter: number|null, nacpBefore: number|null,
 *   nacpAfter: number|null, droppedFields: string[]}} The pair verdict.
 */
export function qualityDropCheck(prev, next) {
  const before = qualityFields(prev);
  const after = qualityFields(next);
  const base = {
    judged: false,
    dropped: false,
    signals: [],
    interpretation: null,
    reason: null,
    intervalMs: null,
    nicBefore: before.nic,
    nicAfter: after.nic,
    nacpBefore: before.nacp,
    nacpAfter: after.nacp,
    droppedFields: [],
  };
  if (!finite(prev?.atMs) || !finite(next?.atMs)) {
    return { ...base, reason: 'missing-timestamp' };
  }
  const intervalMs = next.atMs - prev.atMs;
  if (intervalMs <= 0) {
    return { ...base, reason: 'non-increasing-timestamp' };
  }
  if (intervalMs > QUALITY_DROP_MAX_INTERVAL_MS) {
    return { ...base, intervalMs, reason: 'interval-exceeds-window' };
  }
  if (!isQualityGood(prev)) {
    return {
      ...base,
      intervalMs,
      reason: isQualityDegraded(prev)
        ? 'already-degraded'
        : 'insufficient-quality-data',
    };
  }
  if (!finite(next?.nic) && !finite(next?.nacp)) {
    return { ...base, intervalMs, reason: 'insufficient-quality-data' };
  }
  if (!isQualityDegraded(next)) {
    return { ...base, judged: true, intervalMs };
  }
  const droppedFields = ['nic', 'nacp'].filter(
    (field) => !fieldDegraded(field, before) && fieldDegraded(field, after),
  );
  return {
    ...base,
    judged: true,
    dropped: true,
    signals: [QUALITY_DROP_SIGNAL],
    interpretation: QUALITY_DROP_INTERPRETATION,
    intervalMs,
    droppedFields,
  };
}

/**
 * Detect quality drops across one aircraft's ordered fix history.
 * Consecutive pairs are judged; a degraded-to-good recovery yields no
 * event, and a re-degradation after recovery is a fresh drop.
 *
 * @param {{atMs?: number, nic?: number|null, nacp?: number|null,
 *   hex?: string}[]} fixes - Fixes for one aircraft (any order).
 * @param {{hex?: string}} [options] - Hex to stamp on events when the
 *   fixes do not carry one.
 * @returns {{hex: string|null, atMs: number, intervalMs: number,
 *   nicBefore: number|null, nicAfter: number|null, nacpBefore: number|null,
 *   nacpAfter: number|null, droppedFields: string[], signal: string,
 *   interpretation: string}[]} Drop events, earliest first.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectQualityDrops(fixes, { hex = null } = {}) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectQualityDrops requires an array of fixes');
  }
  const ordered = [...fixes].sort((a, b) => {
    const aMs = finite(a?.atMs) ? a.atMs : Number.POSITIVE_INFINITY;
    const bMs = finite(b?.atMs) ? b.atMs : Number.POSITIVE_INFINITY;
    return aMs - bMs;
  });
  const events = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const verdict = qualityDropCheck(ordered[i - 1], ordered[i]);
    if (!verdict.judged || !verdict.dropped) continue;
    const later = ordered[i];
    events.push({
      hex:
        typeof later?.hex === 'string'
          ? later.hex
          : typeof ordered[i - 1]?.hex === 'string'
            ? ordered[i - 1].hex
            : typeof hex === 'string'
              ? hex
              : null,
      atMs: later.atMs,
      intervalMs: verdict.intervalMs,
      nicBefore: verdict.nicBefore,
      nicAfter: verdict.nicAfter,
      nacpBefore: verdict.nacpBefore,
      nacpAfter: verdict.nacpAfter,
      droppedFields: verdict.droppedFields,
      signal: QUALITY_DROP_SIGNAL,
      interpretation: QUALITY_DROP_INTERPRETATION,
    });
  }
  return events;
}

/**
 * Summarize drop events across aircraft. Corroboration is the sky-event
 * test: at least `minAircraft` DISTINCT aircraft dropping inside one
 * sliding `windowMs` window. Two drops from one aircraft never
 * corroborate each other — that is one receiver, not one sky.
 * Events without a finite timestamp are malformed and ignored.
 *
 * @param {{hex?: string|null, atMs?: number}[]} events - Drop events.
 * @param {{windowMs?: number, minAircraft?: number}} [options] -
 *   Corroboration window and distinct-aircraft bar.
 * @returns {{count: number, aircraftCount: number, corroborated: boolean,
 *   windowMs: number, firstAtMs: number|null, lastAtMs: number|null,
 *   interpretation: string|null}} The summary.
 */
export function summarizeQualityDrops(
  events,
  {
    windowMs = QUALITY_DROP_CORROBORATION_WINDOW_MS,
    minAircraft = QUALITY_DROP_CORROBORATION_MIN_AIRCRAFT,
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
    interpretation: ordered.length ? QUALITY_DROP_INTERPRETATION : null,
  };
}
