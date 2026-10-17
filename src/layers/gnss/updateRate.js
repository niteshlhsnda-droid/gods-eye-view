/**
 * ADS-B position-update-rate anomaly: a cadence check on one aircraft's
 * own fix timestamps.
 *
 * ADS-B position reports arrive at a nominal ~1 Hz cadence. When the
 * updates from an aircraft keep arriving but at a sustained slower
 * cadence — a median interval several times the nominal second — the
 * feed carrying those updates is degraded: a receiver losing packets,
 * an upstream aggregator throttling, a congested link, or a transponder
 * falling behind. The positions themselves may be perfectly good, which
 * is why no position-based check sees this: the Cycle 2 teleport check
 * watches positions jump, the stale check watches updates stop, the
 * quality-drop check watches NIC/NACp fields fall, the altitude and
 * velocity checks compare fields on one fix or one pair, and the Cycle 1
 * coverage bands count reports per cell. None of them measures how
 * OFTEN updates arrive, so a feed that dribbles one update every five
 * seconds reads exactly like a healthy 1 Hz feed. This check closes
 * that gap by judging the median interval over a trailing window
 * against the aircraft's own nominal cadence.
 *
 * The median — not the mean, not the longest gap — is the statistic
 * because it answers "sustained" and ignores one-off events: a single
 * 30-second missed poll among one-second updates leaves the median at
 * ~1 s, and a burst of duplicate timestamps (zero-length intervals)
 * is dropped before the median is taken. Only a cadence that stays
 * slow across the window moves the median.
 *
 * What this is NOT:
 * - Not a stale check. A feed that goes silent yields no intervals at
 *   all, so it is `insufficient-data` here, never a degraded event.
 *   Silence belongs to the Cycle 2 stale signal.
 * - Not a position check. Latitudes, longitudes, and speeds are never
 *   read; a teleporting aircraft with a healthy cadence passes here.
 * - Not a parked-aircraft detector. Parked / on-ground aircraft are
 *   EXCLUDED, not flagged: an aircraft on the apron reports slowly or
 *   not at all for entirely benign reasons, and a slow cadence from a
 *   parked aircraft says nothing about the feed. Exclusion is keyed
 *   only on the per-fix `onGround` flag, never on speed: a slow-moving
 *   airborne aircraft (holding, gliding, hovering) is still expected
 *   to report at ~1 Hz, so a rate drop there IS a feed event. A fix
 *   with `onGround` missing or false counts as airborne; only an
 *   explicit `onGround === true` fix is dropped, so ground fixes
 *   inside a takeoff roll never contribute the long parked gap to
 *   interval math, and a flapping ground flag only drops occasional
 *   fixes instead of voiding the window.
 *
 * The event is a secondary, unvalidated signal — never a verdict, and
 * never interference. Benign causes also slow a cadence:
 * - Receiver coverage: one receiver at the edge of its range drops
 *   packets while the sky is fine, which is why a lone degraded
 *   aircraft is a receiver event, not a sky event.
 * - Shared feed path: several aircraft degrading together points at
 *   the receiver, aggregator, or link they share — still a feed
 *   problem, not GNSS interference. Even corroborated, this signal
 *   carries no interference claim; interference is judged by the
 *   position/quality signals, not by cadence.
 * - Transponder load: a busy or aging transponder can fall behind on
 *   its own, with every other aircraft on the same receiver healthy.
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring (carrying
 * per-aircraft fix histories through normalization, which currently
 * keeps only the latest snapshot) is a separate step.
 */

/** Nominal ADS-B position cadence: one update per second. */
export const UPDATE_RATE_NOMINAL_INTERVAL_MS = 1_000;
/**
 * Degraded median: 3x the nominal cadence. Well above scheduling
 * jitter and network delay, well below the 5 s median of a 0.2 Hz
 * degraded feed.
 */
export const UPDATE_RATE_DEGRADED_MEDIAN_MS = 3_000;
/** Trailing window over which the median interval is measured. */
export const UPDATE_RATE_WINDOW_MS = 60_000;
/**
 * Minimum intervals inside the window to judge: six airborne fixes.
 * Fewer than this and one gap dominates the median, so the window is
 * `insufficient-data` instead of degraded.
 */
export const UPDATE_RATE_MIN_INTERVALS = 5;
/** Corroboration window: degraded events this close together count as one feed event. */
export const UPDATE_RATE_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must degrade inside one window to corroborate. */
export const UPDATE_RATE_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: one aircraft's update cadence stayed slow. */
export const UPDATE_RATE_SIGNAL = 'update-rate-drop';
/**
 * Secondary, unvalidated reading of a rate drop: a degraded feed or
 * receiver event. Deliberately NOT an interference claim.
 */
export const UPDATE_RATE_INTERPRETATION = 'degraded-feed-or-receiver-event';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a fix is parked: only an explicit on-ground flag excludes. */
function isParked(fix) {
  return fix?.onGround === true;
}

/** Airborne fixes with usable timestamps, earliest first. */
function airborneOrdered(fixes) {
  return fixes
    .filter((fix) => !isParked(fix) && finite(fix?.atMs))
    .sort((a, b) => a.atMs - b.atMs);
}

/**
 * Median of a non-empty array of numbers. Averages the two middle
 * values for an even count so the median is stable under jitter.
 */
function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[mid];
  return (ordered[mid - 1] + ordered[mid]) / 2;
}

/**
 * Intervals between consecutive fixes, in milliseconds. Zero or
 * negative intervals are duplicate reports of one timestamp, not
 * updates, so they are dropped before the median is taken.
 */
function intervalsOf(ordered) {
  const intervals = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const interval = ordered[i].atMs - ordered[i - 1].atMs;
    if (interval > 0) intervals.push(interval);
  }
  return intervals;
}

/**
 * Update-rate check over one aircraft's fixes.
 *
 * The trailing window is anchored at the latest airborne fix: only
 * airborne fixes inside the window contribute intervals. A window is
 * judged when it can be evaluated — enough airborne intervals inside
 * it — whether or not the cadence degraded. A window that cannot be
 * evaluated yields no verdict (`judged: false`) with the reason
 * recorded, so callers can tell "healthy cadence" apart from "could
 * not judge".
 *
 * @param {{atMs?: number, hex?: string, onGround?: boolean}[]} fixes -
 *   Fixes for one aircraft (any order; positions and speeds ignored).
 * @param {{windowMs?: number, minIntervals?: number,
 *   degradedMedianMs?: number}} [options] - Window, minimum
 *   intervals, and degraded-median edge.
 * @returns {{judged: boolean, degraded: boolean, signals: string[],
 *   interpretation: string|null, reason: string|null,
 *   medianIntervalMs: number|null, intervalCount: number,
 *   updateRateHz: number|null, windowStartMs: number|null,
 *   windowEndMs: number|null, fixCount: number}} The window verdict.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function updateRateCheck(
  fixes,
  {
    windowMs = UPDATE_RATE_WINDOW_MS,
    minIntervals = UPDATE_RATE_MIN_INTERVALS,
    degradedMedianMs = UPDATE_RATE_DEGRADED_MEDIAN_MS,
  } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('updateRateCheck requires an array of fixes');
  }
  const base = {
    judged: false,
    degraded: false,
    signals: [],
    interpretation: null,
    reason: null,
    medianIntervalMs: null,
    intervalCount: 0,
    updateRateHz: null,
    windowStartMs: null,
    windowEndMs: null,
    fixCount: fixes.length,
  };
  const airborne = airborneOrdered(fixes);
  if (airborne.length === 0) {
    if (fixes.length === 0) {
      return { ...base, reason: 'insufficient-data' };
    }
    if (fixes.some((fix) => isParked(fix))) {
      return { ...base, reason: 'on-ground' };
    }
    return { ...base, reason: 'missing-timestamp' };
  }
  const windowEndMs = airborne[airborne.length - 1].atMs;
  const windowStartMs = windowEndMs - windowMs;
  const windowFixes = airborne.filter((fix) => fix.atMs >= windowStartMs);
  const intervals = intervalsOf(windowFixes);
  if (intervals.length < minIntervals) {
    return {
      ...base,
      reason: 'insufficient-data',
      intervalCount: intervals.length,
      windowStartMs,
      windowEndMs,
    };
  }
  const medianIntervalMs = median(intervals);
  const degraded = medianIntervalMs > degradedMedianMs;
  return {
    ...base,
    judged: true,
    degraded,
    signals: degraded ? [UPDATE_RATE_SIGNAL] : [],
    interpretation: degraded ? UPDATE_RATE_INTERPRETATION : null,
    medianIntervalMs,
    intervalCount: intervals.length,
    updateRateHz: UPDATE_RATE_NOMINAL_INTERVAL_MS / medianIntervalMs,
    windowStartMs,
    windowEndMs,
  };
}

/**
 * Detect update-rate-drop events across one aircraft's fix history.
 * Edge-triggered: an event fires on the healthy-to-degraded transition
 * of the trailing window, not on every degraded window, so a sustained
 * drop yields one event. A return to a healthy window resets the edge,
 * so a re-degradation after recovery is a fresh event. Windows that
 * cannot be judged leave the edge unchanged — unknown is not healthy.
 *
 * @param {{atMs?: number, hex?: string, onGround?: boolean}[]} fixes -
 *   Fixes for one aircraft (any order; positions and speeds ignored).
 * @param {{windowMs?: number, minIntervals?: number,
 *   degradedMedianMs?: number, hex?: string}} [options] - Window,
 *   minimum intervals, degraded-median edge, and hex to stamp on
 *   events when the fixes do not carry one.
 * @returns {{hex: string|null, atMs: number, windowStartMs: number,
 *   windowEndMs: number, medianIntervalMs: number, updateRateHz: number,
 *   intervalCount: number, signal: string, interpretation: string}[]}
 *   Rate-drop events, earliest first.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectUpdateRateEvents(
  fixes,
  {
    windowMs = UPDATE_RATE_WINDOW_MS,
    minIntervals = UPDATE_RATE_MIN_INTERVALS,
    degradedMedianMs = UPDATE_RATE_DEGRADED_MEDIAN_MS,
    hex = null,
  } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectUpdateRateEvents requires an array of fixes');
  }
  const airborne = airborneOrdered(fixes);
  const events = [];
  let degraded = false;
  for (let end = 0; end < airborne.length; end += 1) {
    const anchor = airborne[end];
    const windowFixes = airborne.filter(
      (fix) => fix.atMs >= anchor.atMs - windowMs && fix.atMs <= anchor.atMs,
    );
    const intervals = intervalsOf(windowFixes);
    if (intervals.length < minIntervals) continue;
    const medianIntervalMs = median(intervals);
    const nowDegraded = medianIntervalMs > degradedMedianMs;
    if (nowDegraded && !degraded) {
      events.push({
        hex:
          typeof anchor?.hex === 'string'
            ? anchor.hex
            : typeof hex === 'string'
              ? hex
              : null,
        atMs: anchor.atMs,
        windowStartMs: anchor.atMs - windowMs,
        windowEndMs: anchor.atMs,
        medianIntervalMs,
        updateRateHz: UPDATE_RATE_NOMINAL_INTERVAL_MS / medianIntervalMs,
        intervalCount: intervals.length,
        signal: UPDATE_RATE_SIGNAL,
        interpretation: UPDATE_RATE_INTERPRETATION,
      });
    }
    degraded = nowDegraded;
  }
  return events;
}

/**
 * Summarize rate-drop events across aircraft. Corroboration is the
 * shared-feed test: at least `minAircraft` DISTINCT aircraft degrading
 * inside one sliding `windowMs` window. Two events from one aircraft
 * never corroborate each other — that is one receiver, not one feed.
 * Events without a finite timestamp are malformed and ignored.
 *
 * @param {{hex?: string|null, atMs?: number}[]} events - Rate-drop events.
 * @param {{windowMs?: number, minAircraft?: number}} [options] -
 *   Corroboration window and distinct-aircraft bar.
 * @returns {{count: number, aircraftCount: number, corroborated: boolean,
 *   windowMs: number, firstAtMs: number|null, lastAtMs: number|null,
 *   interpretation: string|null}} The summary.
 */
export function summarizeUpdateRateEvents(
  events,
  {
    windowMs = UPDATE_RATE_CORROBORATION_WINDOW_MS,
    minAircraft = UPDATE_RATE_CORROBORATION_MIN_AIRCRAFT,
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
    interpretation: ordered.length ? UPDATE_RATE_INTERPRETATION : null,
  };
}
