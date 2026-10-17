/**
 * Acceleration plausibility: a pure position-track kinematics check over
 * fix triples.
 *
 * Each ADS-B fix carries a position and a time. Three successive fixes
 * define two velocity vectors: the average velocity over the first
 * interval and over the second. Their difference, divided by the time
 * between the two interval midpoints, is the average acceleration the
 * aircraft would have needed to fly that path. When that acceleration
 * exceeds what a transport-category aircraft can sustain, the reported
 * path bends too fast to be real flight.
 *
 * What no prior check sees: every prior check either trusts a reported
 * field or judges an absolute quantity.
 * - The Cycle 2 teleport check uses ABSOLUTE thresholds (>500 m/s
 *   implied speed or >150 km step), so a path that bends hard at
 *   ordinary speeds passes it.
 * - The Cycle 5 velocity-consistency check compares derived motion
 *   against the REPORTED ground speed and track. A spoofer that fakes
 *   the velocity fields to match the spoofed positions passes it.
 * - The NIC/NACp cell classifier and the quality-drop check read
 *   REPORTED quality fields, which a spoofer can also fake.
 * - The altitude check compares two altitudes on ONE fix; the
 *   update-rate check measures cadence, not path shape; the cluster
 *   check needs several aircraft at one position; the coverage bands
 *   count reports per cell.
 * This check trusts NO reported field — not speed, not track, not
 * quality, not altitude. Only positions and times. A spoof that fakes
 * every reported field consistently still has to move the positions
 * along a flyable path, and a path that bends faster than ~2 g is not
 * one. A slow-drift spoof that bends the path gently, below the edge,
 * passes here: this check bounds the bend rate, it does not prove the
 * path true.
 *
 * Why a vector difference, not speed or heading alone: one number
 * catches both failure modes at once. A sudden speed change with no
 * heading change (longitudinal) and a sudden heading change at
 * constant speed (lateral, a turn) both move the velocity vector, so
 * both raise the same acceleration figure. Splitting them would need
 * two thresholds and two tests for the same bend.
 *
 * Threshold derivation: `seen_pos` ages are whole seconds, so each
 * interval's elapsed time is uncertain by up to ~1 s. At a 250 m/s
 * cruise over a 10 s interval, each velocity estimate errs by up to
 * ~25 m/s, so the acceleration errs by up to ~5 m/s^2 worst case.
 * The 20 m/s^2 edge (~2 g) is four times that worst case, and well
 * above the ~1 g a transport aircraft sustains in normal flight, with
 * margin for turbulence gusts. Position quantization (ADS-B CPR
 * ~5 m) adds only ~0.5 m/s of velocity error over 10 s — negligible
 * next to the timing term. Intervals shorter than 10 s are not
 * judged at all: below that, the whole-second timing error dominates
 * the acceleration. Intervals longer than 120 s are not judged
 * either: over that long, velocity may legitimately change (climb,
 * descent, a planned turn), so a bend is no longer evidence.
 *
 * What this is NOT:
 * - Not a teleport check. A straight-line jump at constant velocity
 *   is also caught here (the jump interval's velocity differs from
 *   its neighbour), but the two checks answer different questions:
 *   teleport asks "is this speed possible", this asks "is this
 *   CHANGE in velocity possible".
 * - Not a velocity check. Reported speed and track are never read;
 *   a mismatch between reported and derived velocity is the Cycle 5
 *   signal, not this one.
 * - Not a parked-aircraft detector. Fixes with an explicit
 *   `onGround === true` flag are EXCLUDED, not flagged: ground
 *   handling, towing, and apron multipath bend ground tracks for
 *   entirely benign reasons. A fix with `onGround` missing or false
 *   counts as airborne.
 *
 * The event is a secondary, unvalidated signal — never a verdict, and
 * never interference. Benign causes also bend a reported path:
 * - Turbulence: a hard gust displaces one fix and the path kinks;
 *   the kink is real air motion, not a false position.
 * - Military / high-performance flight: fighters and aerobatic
 *   aircraft sustain well over 2 g in a turn, so a hard maneuver
 *   from such an aircraft trips this edge legitimately. The edge is
 *   set for transport-category flight; high-g traffic is a known
 *   false-positive source, not a reason to raise the edge and blind
 *   the check for everyone else.
 * - Decoder / timing artifacts: a mis-paired timestamp bends the
 *   path exactly like a spoof does, which is why one aircraft's
 *   trajectory break is a receiver event until corroborated.
 * - One offset fix yields up to THREE anomalous triples (the bend into
 *   it, the bend through it, and the bend back out), so a lone event
 *   cluster from one aircraft is one bad fix, not several. Corroboration
 *   across aircraft is the sky-event test.
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring
 * (carrying per-aircraft fix histories through normalization, which
 * currently keeps only the latest snapshot) is a separate step.
 */

/** Minimum fix spacing: below this, whole-second timing error dominates. */
export const ACCELERATION_MIN_INTERVAL_MS = 10_000;
/** Maximum fix spacing: beyond this, velocity may legitimately change. */
export const ACCELERATION_MAX_INTERVAL_MS = 120_000;
/**
 * Plausibility edge: metres per second squared (~2 g). A larger
 * average acceleration over a fix triple is not flyable transport
 * flight. Well above the ~5 m/s^2 worst-case timing-noise figure at
 * cruise over a 10 s interval.
 */
export const ACCELERATION_MAX_PLAUSIBLE_MPS2 = 20;
/** Corroboration window: breaks this close together count as one sky event. */
export const ACCELERATION_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must break inside one window to corroborate. */
export const ACCELERATION_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: a fix triple bends faster than flyable flight. */
export const ACCELERATION_SIGNAL_TRAJECTORY_BREAK = 'trajectory-break';
/** Secondary, unvalidated reading of a trajectory break. */
export const ACCELERATION_INTERPRETATION = 'suspected-gnss-spoofing';

/** IUGG mean Earth radius, metres (same as the Cycle 2 spoof module). */
const EARTH_MEAN_RADIUS_M = 6_371_008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a fix is parked: only an explicit on-ground flag excludes. */
function isParked(fix) {
  return fix?.onGround === true;
}

/** Whether a fix carries a usable position and timestamp. */
function isUsable(fix) {
  return (
    finite(fix?.atMs) &&
    finite(fix?.lat) &&
    finite(fix?.lon) &&
    Math.abs(fix.lat) <= 90 &&
    Math.abs(fix.lon) <= 180
  );
}

/**
 * Airborne fixes with usable positions and timestamps, earliest first.
 * Parked fixes are dropped; fixes with missing or out-of-range
 * coordinates are skipped, never judged.
 */
function airborneOrdered(fixes) {
  return fixes
    .filter((fix) => !isParked(fix) && isUsable(fix))
    .sort((a, b) => a.atMs - b.atMs);
}

/** Normalize a longitude delta in degrees to [-180, 180]. */
function wrapLonDeltaDeg(delta) {
  let wrapped = delta % 360;
  if (wrapped > 180) wrapped -= 360;
  if (wrapped < -180) wrapped += 360;
  return wrapped;
}

/**
 * Local east/north displacement between two fixes, metres. A flat
 * tangent-plane projection at the pair's mean latitude: exact enough
 * for the short steps this check judges, and the longitude delta is
 * wrapped so a pair straddling the date line measures the short way
 * across it, not around the world.
 */
function displacementM(from, to) {
  const meanLat = toRad((from.lat + to.lat) / 2);
  const east =
    EARTH_MEAN_RADIUS_M *
    Math.cos(meanLat) *
    toRad(wrapLonDeltaDeg(to.lon - from.lon));
  const north = EARTH_MEAN_RADIUS_M * toRad(to.lat - from.lat);
  return [east, north];
}

/**
 * Average acceleration over one fix triple, metres per second squared.
 * The velocity change happens between the midpoints of the two
 * intervals, so the divisor is the mean of the two intervals.
 * Returns null when either interval falls outside the judged band.
 */
function tripleAcceleration(first, middle, last, minIntervalMs, maxIntervalMs) {
  const dt12 = middle.atMs - first.atMs;
  const dt23 = last.atMs - middle.atMs;
  if (
    dt12 < minIntervalMs ||
    dt12 > maxIntervalMs ||
    dt23 < minIntervalMs ||
    dt23 > maxIntervalMs
  ) {
    return null;
  }
  const [east12, north12] = displacementM(first, middle);
  const [east23, north23] = displacementM(middle, last);
  const vEast12 = east12 / (dt12 / 1000);
  const vNorth12 = north12 / (dt12 / 1000);
  const vEast23 = east23 / (dt23 / 1000);
  const vNorth23 = north23 / (dt23 / 1000);
  const dv = Math.hypot(vEast23 - vEast12, vNorth23 - vNorth12);
  return dv / ((dt12 + dt23) / 2 / 1000);
}

/**
 * Acceleration of every evaluable triple in an ordered fix history,
 * earliest first. Triples whose intervals fall outside the judged band
 * are skipped, not judged.
 */
function tripleAccelerations(
  ordered,
  minIntervalMs = ACCELERATION_MIN_INTERVAL_MS,
  maxIntervalMs = ACCELERATION_MAX_INTERVAL_MS,
) {
  const triples = [];
  for (let i = 1; i + 1 < ordered.length; i += 1) {
    const acceleration = tripleAcceleration(
      ordered[i - 1],
      ordered[i],
      ordered[i + 1],
      minIntervalMs,
      maxIntervalMs,
    );
    if (acceleration === null) continue;
    triples.push({
      first: ordered[i - 1],
      middle: ordered[i],
      last: ordered[i + 1],
      acceleration,
    });
  }
  return triples;
}

/** Hex to stamp on events: the fix's own hex, else the caller's. */
function eventHex(fix, fallbackHex) {
  if (typeof fix?.hex === 'string') return fix.hex;
  if (typeof fallbackHex === 'string') return fallbackHex;
  return null;
}

/**
 * Acceleration-plausibility verdict over one aircraft's fix history.
 *
 * Judged when at least one triple can be evaluated; a history that
 * cannot be evaluated yields no verdict (`judged: false`) with the
 * reason recorded, so callers can tell "flyable path" apart from
 * "could not judge".
 *
 * @param {{atMs?: number, lat?: number, lon?: number, hex?: string,
 *   onGround?: boolean}[]} fixes - Fixes for one aircraft (any order;
 *   reported speed, track, quality, and altitude ignored).
 * @param {{minIntervalMs?: number, maxIntervalMs?: number,
 *   maxPlausibleMps2?: number}} [options] - Interval band and
 *   plausibility edge.
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: string|null, reason: string|null,
 *   maxAccelerationMps2: number|null, evaluatedTriples: number,
 *   anomalousTriples: number, fixCount: number}} The verdict.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function accelerationPlausibilityCheck(
  fixes,
  {
    minIntervalMs = ACCELERATION_MIN_INTERVAL_MS,
    maxIntervalMs = ACCELERATION_MAX_INTERVAL_MS,
    maxPlausibleMps2 = ACCELERATION_MAX_PLAUSIBLE_MPS2,
  } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError(
      'accelerationPlausibilityCheck requires an array of fixes',
    );
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    maxAccelerationMps2: null,
    evaluatedTriples: 0,
    anomalousTriples: 0,
    fixCount: fixes.length,
  };
  const usable = airborneOrdered(fixes);
  if (usable.length === 0) {
    if (fixes.length === 0) {
      return { ...base, reason: 'insufficient-data' };
    }
    if (fixes.some((fix) => isParked(fix))) {
      return { ...base, reason: 'on-ground' };
    }
    if (fixes.some((fix) => !finite(fix?.atMs))) {
      return { ...base, reason: 'missing-timestamp' };
    }
    return { ...base, reason: 'insufficient-data' };
  }
  if (usable.length < 3) {
    return { ...base, reason: 'insufficient-data' };
  }
  const triples = tripleAccelerations(usable, minIntervalMs, maxIntervalMs).map(
    (triple) => triple.acceleration,
  );
  if (triples.length === 0) {
    return { ...base, reason: 'insufficient-data' };
  }
  const maxAccelerationMps2 = Math.max(...triples);
  const anomalousTriples = triples.filter((a) => a > maxPlausibleMps2).length;
  const anomalous = anomalousTriples > 0;
  return {
    ...base,
    judged: true,
    anomalous,
    signals: anomalous ? [ACCELERATION_SIGNAL_TRAJECTORY_BREAK] : [],
    interpretation: anomalous ? ACCELERATION_INTERPRETATION : null,
    maxAccelerationMps2,
    evaluatedTriples: triples.length,
    anomalousTriples,
  };
}

/**
 * Detect trajectory-break events across one aircraft's fix history.
 * One event per anomalous triple, earliest first: a single offset fix
 * therefore yields up to three events (the bend into it, the bend
 * through it, and the bend back out), which is one bad fix, not three
 * independent breaks.
 *
 * @param {{atMs?: number, lat?: number, lon?: number, hex?: string,
 *   onGround?: boolean}[]} fixes - Fixes for one aircraft (any order;
 *   reported speed, track, quality, and altitude ignored).
 * @param {{minIntervalMs?: number, maxIntervalMs?: number,
 *   maxPlausibleMps2?: number, hex?: string}} [options] - Interval
 *   band, plausibility edge, and hex to stamp on events when the
 *   fixes do not carry one.
 * @returns {{hex: string|null, atMs: number, firstAtMs: number,
 *   middleAtMs: number, accelerationMps2: number, signal: string,
 *   interpretation: string}[]} Trajectory-break events, earliest first.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectAccelerationEvents(
  fixes,
  {
    minIntervalMs = ACCELERATION_MIN_INTERVAL_MS,
    maxIntervalMs = ACCELERATION_MAX_INTERVAL_MS,
    maxPlausibleMps2 = ACCELERATION_MAX_PLAUSIBLE_MPS2,
    hex = null,
  } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectAccelerationEvents requires an array of fixes');
  }
  const ordered = airborneOrdered(fixes);
  const events = [];
  for (const { first, middle, last, acceleration } of tripleAccelerations(
    ordered,
    minIntervalMs,
    maxIntervalMs,
  )) {
    if (acceleration > maxPlausibleMps2) {
      events.push({
        hex: eventHex(last, hex),
        atMs: last.atMs,
        firstAtMs: first.atMs,
        middleAtMs: middle.atMs,
        accelerationMps2: acceleration,
        signal: ACCELERATION_SIGNAL_TRAJECTORY_BREAK,
        interpretation: ACCELERATION_INTERPRETATION,
      });
    }
  }
  return events;
}

/**
 * Summarize trajectory-break events across aircraft. Corroboration is
 * the sky-event test: at least `minAircraft` DISTINCT aircraft breaking
 * inside one sliding `windowMs` window. Two events from one aircraft
 * never corroborate each other — one offset fix already yields up to
 * three events, so counting events instead of aircraft would corroborate a
 * single bad fix with itself. Events without a finite timestamp are
 * malformed and ignored.
 *
 * @param {{hex?: string|null, atMs?: number}[]} events - Break events.
 * @param {{windowMs?: number, minAircraft?: number}} [options] -
 *   Corroboration window and distinct-aircraft bar.
 * @returns {{count: number, aircraftCount: number, corroborated: boolean,
 *   windowMs: number, firstAtMs: number|null, lastAtMs: number|null,
 *   interpretation: string|null}} The summary.
 */
export function summarizeAccelerationEvents(
  events,
  {
    windowMs = ACCELERATION_CORROBORATION_WINDOW_MS,
    minAircraft = ACCELERATION_CORROBORATION_MIN_AIRCRAFT,
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
    interpretation: ordered.length ? ACCELERATION_INTERPRETATION : null,
  };
}
