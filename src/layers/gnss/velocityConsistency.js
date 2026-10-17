/**
 * Reported-versus-derived velocity consistency: a cross-check between an
 * ADS-B aircraft's reported velocity and the motion its own successive
 * position fixes imply.
 *
 * Each ADS-B fix carries two independent statements about motion: the
 * position itself, and the reported ground speed (`gs`, knots) and track
 * (`track`, degrees) from the velocity message. Between two fixes, the
 * positions imply an average speed (great-circle distance over elapsed
 * time) and a course (initial bearing). When the aircraft flies steadily,
 * the derived speed sits inside the band spanned by the two reported
 * speeds (plus tolerance) and the derived course matches the reported
 * track. A large disagreement means one of the two statements is wrong:
 * the positions were shifted, the velocity fields went stale, or a
 * decoder paired messages from different times.
 *
 * What no prior check sees: the Cycle 2 teleport check uses ABSOLUTE
 * thresholds (>500 m/s implied speed or >150 km step), so a slow-drift
 * spoof — each step small, each implied speed far below 500 m/s — passes
 * it while the fixes creep away from where the reported velocity says the
 * aircraft should be. The NIC/NACp classifier reads reported quality on
 * one fix, the Cycle 1 coverage bands count reports per cell, and the
 * Cycle 4 altitude check compares two altitudes on one fix; none of them
 * compares velocity against position. This check closes that gap by
 * judging each fix pair against the aircraft's OWN reported velocity,
 * not against an absolute limit.
 *
 * The mismatch is a secondary, unvalidated signal — never a verdict —
 * because benign effects also separate the two statements:
 * - Acceleration: the derived figure is an AVERAGE over the interval
 *   while each reported speed is INSTANTANEOUS. Comparing the derived
 *   speed against the whole [min, max] band spanned by the two reported
 *   speeds absorbs steady acceleration or deceleration; only a derived
 *   speed outside that band, beyond tolerance, mismatches.
 * - Turns: the derived course is a chord bearing while the reported
 *   track is instantaneous, so the course is judged only while the
 *   aircraft claims near-straight flight (both reported tracks within
 *   15 degrees). A turning aircraft's course is not judged at all.
 * - Timing granularity: `seen_pos` ages are whole seconds, so over a
 *   short interval the elapsed time is uncertain by ~1 s. The speed
 *   tolerance therefore grows with reported speed (10% of the faster
 *   reported speed on top of a 15 m/s floor).
 * - Message pairing: a velocity message paired with the wrong position
 *   message by a decoder mismatches both sub-checks at once, which is
 *   why a mismatch carries the suspected-spoofing interpretation only as
 *   a possibility, alongside decoder and timing artifacts.
 *
 * Pure module, no imports. Wiring to the feed (carrying `gs` / `track`
 * through normalization, which currently drops them) is a separate step.
 */

/** Minimum fix spacing: below this, whole-second timing error dominates. */
export const VELOCITY_MIN_INTERVAL_MS = 5_000;
/** Maximum fix spacing: beyond this, velocity may legitimately change. */
export const VELOCITY_MAX_INTERVAL_MS = 120_000;
/** Floor of the speed tolerance, metres per second (~29 kt). */
export const VELOCITY_SPEED_BASE_TOLERANCE_MPS = 15;
/** Timing-granularity allowance, as a fraction of the faster reported speed. */
export const VELOCITY_SPEED_TIMING_FRACTION = 0.1;
/** Reported tracks must agree within this (degrees) for a course verdict. */
export const VELOCITY_MAX_TRACK_CHANGE_DEG = 15;
/** Course mismatch edge, degrees between derived bearing and mean track. */
export const VELOCITY_COURSE_TOLERANCE_DEG = 30;
/** Below this displacement (metres), a bearing is too noisy to judge. */
export const VELOCITY_MIN_COURSE_DISTANCE_M = 500;
/** Observed fact: derived speed contradicts the reported speeds. */
export const VELOCITY_SIGNAL_SPEED_MISMATCH = 'velocity-speed-mismatch';
/** Observed fact: derived course contradicts the reported track. */
export const VELOCITY_SIGNAL_COURSE_MISMATCH = 'velocity-course-mismatch';
/** Secondary, unvalidated reading of either mismatch. */
export const VELOCITY_CONSISTENCY_INTERPRETATION = 'suspected-gnss-spoofing';
/** Knots to metres per second, exact by definition (1 kt = 1852/3600 m/s). */
export const KNOT_TO_MPS = 1852 / 3600;

/** IUGG mean Earth radius, metres (same as the Cycle 2 spoof module). */
const EARTH_MEAN_RADIUS_M = 6_371_008.8;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Wrap an angle in degrees to [-180, 180). */
function wrapDeg(angle) {
  let wrapped = (angle + 180) % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped - 180;
}

/** Normalize a longitude delta in degrees to [-180, 180]. */
function wrapLonDeltaDeg(delta) {
  let wrapped = delta % 360;
  if (wrapped > 180) wrapped -= 360;
  if (wrapped < -180) wrapped += 360;
  return wrapped;
}

/**
 * Validate a latitude/longitude pair.
 * @throws {RangeError} On non-finite or out-of-range coordinates.
 */
export function assertVelocityLatLon(lat, lon) {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new RangeError(`Invalid lat/lon: ${lat}, ${lon}`);
  }
}

/** Great-circle distance between two points (haversine, spherical earth). */
function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(wrapLonDeltaDeg(lon2 - lon1));
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_MEAN_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north. */
function initialBearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(wrapLonDeltaDeg(lon2 - lon1));
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function assertFix(fix, name) {
  if (!fix || typeof fix !== 'object')
    throw new TypeError(`${name} must be an object with lat, lon, atMs`);
  assertVelocityLatLon(fix.lat, fix.lon);
  if (!Number.isFinite(fix.atMs))
    throw new TypeError(`${name}.atMs must be a finite epoch-ms number`);
}

/**
 * Judge one pair of successive fixes of ONE aircraft.
 *
 * The speed check compares the derived average speed against the band
 * spanned by the two reported ground speeds, widened by a tolerance of
 * 15 m/s plus 10% of the faster reported speed. The course check runs
 * only when both reported tracks are present, agree within 15 degrees
 * (near-straight flight), and the displacement is at least 500 m; it
 * compares the derived initial bearing against the circular mean of the
 * two reported tracks with a 30-degree tolerance.
 *
 * @param {{lat: number, lon: number, atMs: number, gsKt?: number, trackDeg?: number}} prev Earlier fix.
 * @param {{lat: number, lon: number, atMs: number, gsKt?: number, trackDeg?: number}} next Later fix.
 *   `gsKt` is ADS-B ground speed in knots, `trackDeg` is ground track in
 *   degrees clockwise from north, as readsb reports `gs` / `track`.
 * @returns {Readonly<{judged: boolean, consistent: boolean|null, speedMismatch: boolean|null, courseMismatch: boolean|null, derivedSpeedMps: number|null, derivedCourseDeg: number|null, dtMs: number, signals: string[], interpretation: string|null, reason: string|null}>}
 *   `reason` names why a pair was not judged: `duplicate-or-reordered`,
 *   `interval-too-short`, `interval-too-long`, or `insufficient`
 *   (neither sub-check had the fields it needs). A judged pair with no
 *   mismatch is consistent even when one sub-check was not judgeable.
 */
export function velocityConsistencyCheck(prev, next) {
  assertFix(prev, 'prev');
  assertFix(next, 'next');
  const dtMs = next.atMs - prev.atMs;
  const notJudged = (reason) =>
    Object.freeze({
      judged: false,
      consistent: null,
      speedMismatch: null,
      courseMismatch: null,
      derivedSpeedMps: null,
      derivedCourseDeg: null,
      dtMs,
      signals: [],
      interpretation: null,
      reason,
    });
  if (dtMs <= 0) return notJudged('duplicate-or-reordered');
  if (dtMs < VELOCITY_MIN_INTERVAL_MS) return notJudged('interval-too-short');
  if (dtMs > VELOCITY_MAX_INTERVAL_MS) return notJudged('interval-too-long');

  const distanceM = haversineDistanceM(prev.lat, prev.lon, next.lat, next.lon);
  const derivedSpeedMps = distanceM / (dtMs / 1000);

  let speedMismatch = null;
  if (finite(prev.gsKt) && finite(next.gsKt)) {
    const reportedMin = Math.min(prev.gsKt, next.gsKt) * KNOT_TO_MPS;
    const reportedMax = Math.max(prev.gsKt, next.gsKt) * KNOT_TO_MPS;
    const tolerance =
      VELOCITY_SPEED_BASE_TOLERANCE_MPS +
      VELOCITY_SPEED_TIMING_FRACTION * reportedMax;
    speedMismatch =
      derivedSpeedMps < reportedMin - tolerance ||
      derivedSpeedMps > reportedMax + tolerance;
  }

  let courseMismatch = null;
  let derivedCourseDeg = null;
  if (
    finite(prev.trackDeg) &&
    finite(next.trackDeg) &&
    distanceM >= VELOCITY_MIN_COURSE_DISTANCE_M
  ) {
    const trackChange = Math.abs(wrapDeg(next.trackDeg - prev.trackDeg));
    if (trackChange <= VELOCITY_MAX_TRACK_CHANGE_DEG) {
      derivedCourseDeg = initialBearingDeg(
        prev.lat,
        prev.lon,
        next.lat,
        next.lon,
      );
      const meanTrack =
        (((prev.trackDeg + wrapDeg(next.trackDeg - prev.trackDeg) / 2) % 360) +
          360) %
        360;
      const courseDiff = Math.abs(wrapDeg(derivedCourseDeg - meanTrack));
      courseMismatch = courseDiff > VELOCITY_COURSE_TOLERANCE_DEG;
    }
  }

  if (speedMismatch === null && courseMismatch === null)
    return notJudged('insufficient');
  const signals = [];
  if (speedMismatch === true) signals.push(VELOCITY_SIGNAL_SPEED_MISMATCH);
  if (courseMismatch === true) signals.push(VELOCITY_SIGNAL_COURSE_MISMATCH);
  return Object.freeze({
    judged: true,
    consistent: signals.length === 0,
    speedMismatch,
    courseMismatch,
    derivedSpeedMps,
    derivedCourseDeg,
    dtMs,
    signals: Object.freeze(signals),
    interpretation:
      signals.length > 0 ? VELOCITY_CONSISTENCY_INTERPRETATION : null,
    reason: null,
  });
}

/**
 * Summarize a batch of fix pairs. Entries whose fixes are invalid (bad
 * coordinates, non-finite timestamps) count as insufficient, never as
 * evidence — a bad decode is not a mismatch. Entries without a hex are
 * counted but never listed.
 *
 * @param {{hex?: string, prev?: object, next?: object}[]} [pairs]
 * @param {{maxMismatchHexes?: number}} [options]
 * @returns {{total: number, judged: number, consistent: number, speedMismatch: number, courseMismatch: number, mismatch: number, insufficient: number, mismatchHexes: string[]}}
 */
export function summarizeVelocityConsistency(
  pairs = [],
  { maxMismatchHexes = 50 } = {},
) {
  const summary = {
    total: 0,
    judged: 0,
    consistent: 0,
    speedMismatch: 0,
    courseMismatch: 0,
    mismatch: 0,
    insufficient: 0,
    mismatchHexes: [],
  };
  const listed = new Set();
  for (const entry of pairs ?? []) {
    summary.total += 1;
    let result;
    try {
      result = velocityConsistencyCheck(entry?.prev, entry?.next);
    } catch {
      summary.insufficient += 1;
      continue;
    }
    if (!result.judged) {
      summary.insufficient += 1;
      continue;
    }
    summary.judged += 1;
    if (result.consistent) summary.consistent += 1;
    else {
      summary.mismatch += 1;
      if (result.speedMismatch) summary.speedMismatch += 1;
      if (result.courseMismatch) summary.courseMismatch += 1;
      if (
        typeof entry?.hex === 'string' &&
        entry.hex !== '' &&
        !listed.has(entry.hex) &&
        summary.mismatchHexes.length < maxMismatchHexes
      ) {
        listed.add(entry.hex);
        summary.mismatchHexes.push(entry.hex);
      }
    }
  }
  return summary;
}
