/**
 * ADS-B track plausibility: judge a short sequence of position-only
 * reports ({lat, lon, atMs}) and flag the individual reports that are
 * physically implausible.
 *
 * What no prior check sees: the Cycle 2 `teleportCheck` judges a PAIR of
 * fixes and flags the jump, but never attributes which fix is bad — a
 * 200 km jump between fixes A and B leaves the caller guessing whether A
 * or B is the corrupt one. The Cycle 4 `velocityConsistencyCheck` judges
 * reported-versus-derived velocity on a pair, and refuses to judge at all
 * when the reported `gsKt`/`trackDeg` fields are absent. This module
 * needs position reports only, works on a SEQUENCE (not one pair), and
 * attributes the offending report by neighbor consistency:
 *
 * - A report whose BOTH adjacent segments are implausibly fast is the
 *   vertex of a jump-and-back: it gets the `track-spike` fact. When the
 *   flanking reports are also mutually close, the jump is inconsistent
 *   with its neighbors' positions too (`track-spike-neighbor-consistent`).
 * - A report that is the far endpoint of an implausibly fast segment
 *   whose other side is a judged-plausible segment is the jump's origin
 *   (or landing): its neighbors agree with each other, so the report on
 *   the far side is the corrupt one (`track-jump-endpoint`).
 * - A fast segment flanked by plausible segments on BOTH sides sits
 *   between two mutually consistent clusters; positions alone cannot say
 *   which side is corrupt, so it stays unattributed (segment facts only).
 * - A lone fast segment at a track end cannot be attributed: both
 *   endpoint reports carry the `track-segment-too-fast` observed fact,
 *   but neither is judged implausible — the segment fact, not a verdict,
 *   is what a caller can act on.
 *
 * Honesty rules, same as the spoof-movement line: each implausible
 * report is an observed movement fact. Spoofing is a SECOND, unvalidated
 * interpretation (`suspected-adsb-spoofing`), attached only when at
 * least one report is judged implausible — a decoder error, a wrong
 * message pairing, or a merged track can all look identical.
 *
 * Pure module, no imports. No feed wiring: callers pass already-ordered
 * report sequences (a track for one aircraft, typically one polling
 * window).
 */

/** Segment implied speed above this (m/s) is physically implausible (strict `>`). */
export const TRACK_MAX_PLAUSIBLE_SPEED_MPS = 700;
/**
 * Below this interval (ms) a segment is not judged: whole-second
 * timestamp quantization dominates the implied speed, so a fast-looking
 * short segment is timing noise, not evidence.
 */
export const TRACK_MIN_SEGMENT_INTERVAL_MS = 1_000;
/**
 * Spike corroboration edge: the jump is "inconsistent with neighbors"
 * when the flanking reports are this close to each other, as a fraction
 * of the shorter jump leg.
 */
export const TRACK_SPIKE_NEIGHBOR_RATIO = 0.5;
/** Observed fact: this report borders an implausibly fast segment. */
export const TRACK_SIGNAL_SEGMENT_FAST = 'track-segment-too-fast';
/** Observed fact: both adjacent segments are implausibly fast. */
export const TRACK_SIGNAL_SPIKE = 'track-spike';
/** Observed fact: spike, and the flanking reports are mutually close. */
export const TRACK_SIGNAL_SPIKE_NEIGHBOR_CONSISTENT =
  'track-spike-neighbor-consistent';
/** Observed fact: far endpoint of a fast segment beside a plausible one. */
export const TRACK_SIGNAL_JUMP_ENDPOINT = 'track-jump-endpoint';
/** Secondary, unvalidated reading of any implausible report. */
export const TRACK_PLAUSIBILITY_INTERPRETATION = 'suspected-adsb-spoofing';

/** IUGG mean Earth radius, metres (same as the Cycle 2 spoof module). */
const EARTH_MEAN_RADIUS_M = 6_371_008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Validate a latitude/longitude pair.
 * @throws {RangeError} On non-finite or out-of-range coordinates.
 */
export function assertTrackLatLon(lat, lon) {
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

/** Normalize a longitude delta in degrees to [-180, 180]. */
function wrapLonDeltaDeg(delta) {
  let wrapped = delta % 360;
  if (wrapped > 180) wrapped -= 360;
  if (wrapped < -180) wrapped += 360;
  return wrapped;
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

function assertReport(report, index) {
  if (!report || typeof report !== 'object')
    throw new TypeError(
      `reports[${index}] must be an object with lat, lon, atMs`,
    );
  assertTrackLatLon(report.lat, report.lon);
  if (!Number.isFinite(report.atMs))
    throw new TypeError(
      `reports[${index}].atMs must be a finite epoch-ms number`,
    );
}

function judgeSegment(from, to, fromIndex) {
  const dtMs = to.atMs - from.atMs;
  if (dtMs <= 0)
    return Object.freeze({
      fromIndex,
      toIndex: fromIndex + 1,
      judged: false,
      dtMs,
      distanceM: null,
      speedMps: null,
      implausible: false,
      unjudgedReason:
        dtMs === 0 ? 'duplicate-timestamp' : 'reordered-timestamps',
    });
  if (dtMs < TRACK_MIN_SEGMENT_INTERVAL_MS)
    return Object.freeze({
      fromIndex,
      toIndex: fromIndex + 1,
      judged: false,
      dtMs,
      distanceM: null,
      speedMps: null,
      implausible: false,
      unjudgedReason: 'interval-too-short',
    });
  const distanceM = haversineDistanceM(from.lat, from.lon, to.lat, to.lon);
  const speedMps = distanceM / (dtMs / 1000);
  return Object.freeze({
    fromIndex,
    toIndex: fromIndex + 1,
    judged: true,
    dtMs,
    distanceM,
    speedMps,
    implausible: speedMps > TRACK_MAX_PLAUSIBLE_SPEED_MPS,
    unjudgedReason: null,
  });
}

/**
 * Judge one ordered track of ADS-B position reports.
 *
 * @param {{lat: number, lon: number, atMs: number}[]} reports Ordered
 *   position reports for one aircraft (oldest first). Extra fields are
 *   ignored.
 * @returns {Readonly<{judged: boolean, reason: string|null, reportCount: number, segments: ReadonlyArray, reportSignals: ReadonlyArray<ReadonlyArray<string>>, implausible: ReadonlyArray<boolean>, implausibleIndexes: ReadonlyArray<number>, interpretation: string|null}>}
 *   `reason` is `empty-track` or `single-report` when there is nothing
 *   to judge. `implausible[i]` is true for reports judged corrupt;
 *   `reportSignals[i]` carries the observed facts on each report.
 */
export function judgeTrackPlausibility(reports) {
  if (!Array.isArray(reports))
    throw new TypeError('reports must be an array of {lat, lon, atMs}');
  reports.forEach(assertReport);

  const reportCount = reports.length;
  const reportSignals = reports.map(() => []);
  const implausible = reports.map(() => false);
  if (reportCount < 2) {
    return Object.freeze({
      judged: false,
      reason: reportCount === 0 ? 'empty-track' : 'single-report',
      reportCount,
      segments: Object.freeze([]),
      reportSignals: Object.freeze(reportSignals.map(Object.freeze)),
      implausible: Object.freeze(implausible),
      implausibleIndexes: Object.freeze([]),
      interpretation: null,
    });
  }

  const segments = [];
  for (let i = 0; i < reportCount - 1; i += 1)
    segments.push(judgeSegment(reports[i], reports[i + 1], i));

  const addSignal = (index, signal) => {
    if (!reportSignals[index].includes(signal))
      reportSignals[index].push(signal);
  };
  const markImplausible = (index, signal) => {
    implausible[index] = true;
    addSignal(index, signal);
  };

  for (let i = 0; i < reportCount; i += 1) {
    const left = i > 0 ? segments[i - 1] : null;
    const right = i < reportCount - 1 ? segments[i] : null;
    if (left?.judged && left.implausible)
      addSignal(i, TRACK_SIGNAL_SEGMENT_FAST);
    if (right?.judged && right.implausible)
      addSignal(i, TRACK_SIGNAL_SEGMENT_FAST);
  }

  // Attribute each implausible segment to its corrupt endpoint. Processed
  // per segment so a fast segment between two judged-plausible flanks
  // cannot mark BOTH endpoints (one visit would blame the left report,
  // the other the right): that geometry is ambiguous and stays
  // unattributed, segment facts only.
  for (let s = 0; s < segments.length; s += 1) {
    const seg = segments[s];
    if (!seg.judged || !seg.implausible) continue;
    const left = s > 0 ? segments[s - 1] : null;
    const right = s < segments.length - 1 ? segments[s + 1] : null;
    const leftFast = left?.judged === true && left.implausible;
    const rightFast = right?.judged === true && right.implausible;
    const leftSlow = left?.judged === true && !left.implausible;
    const rightSlow = right?.judged === true && !right.implausible;

    // Spike vertex: the fast segment's endpoint shared with another fast
    // segment is the vertex of a jump-and-back, so it is the corrupt one.
    // Corroborated when the flanking reports are mutually close: the jump
    // is then inconsistent with its neighbors' positions, not just speed.
    if (leftFast) {
      markImplausible(s, TRACK_SIGNAL_SPIKE);
      const neighborGap = haversineDistanceM(
        reports[s - 1].lat,
        reports[s - 1].lon,
        reports[s + 1].lat,
        reports[s + 1].lon,
      );
      const shorterLeg = Math.min(left.distanceM, seg.distanceM);
      if (neighborGap <= TRACK_SPIKE_NEIGHBOR_RATIO * shorterLeg)
        markImplausible(s, TRACK_SIGNAL_SPIKE_NEIGHBOR_CONSISTENT);
    }
    if (rightFast) {
      markImplausible(s + 1, TRACK_SIGNAL_SPIKE);
      const neighborGap = haversineDistanceM(
        reports[s].lat,
        reports[s].lon,
        reports[s + 2].lat,
        reports[s + 2].lon,
      );
      const shorterLeg = Math.min(seg.distanceM, right.distanceM);
      if (neighborGap <= TRACK_SPIKE_NEIGHBOR_RATIO * shorterLeg)
        markImplausible(s + 1, TRACK_SIGNAL_SPIKE_NEIGHBOR_CONSISTENT);
    }
    if (leftFast || rightFast) continue;

    // Jump endpoint: exactly one judged-plausible flank. Reports on the
    // plausible side agree with each other, so the report on the far side
    // of the fast segment is the corrupt one.
    if (leftSlow && !rightSlow)
      markImplausible(s + 1, TRACK_SIGNAL_JUMP_ENDPOINT);
    else if (rightSlow && !leftSlow)
      markImplausible(s, TRACK_SIGNAL_JUMP_ENDPOINT);
  }

  const implausibleIndexes = [];
  for (let i = 0; i < reportCount; i += 1)
    if (implausible[i]) implausibleIndexes.push(i);

  return Object.freeze({
    judged: true,
    reason: null,
    reportCount,
    segments: Object.freeze(segments),
    reportSignals: Object.freeze(reportSignals.map(Object.freeze)),
    implausible: Object.freeze(implausible),
    implausibleIndexes: Object.freeze(implausibleIndexes),
    interpretation:
      implausibleIndexes.length > 0 ? TRACK_PLAUSIBILITY_INTERPRETATION : null,
  });
}

/**
 * Summarize a batch of tracks. Tracks whose reports are malformed count
 * as unjudged, never as evidence — a bad decode is not a jump.
 *
 * @param {{hex?: string, reports?: object[]}[]} [tracks]
 * @param {{maxImplausibleHexes?: number}} [options]
 * @returns {{total: number, judged: number, unjudged: number, tracksWithImplausible: number, implausibleReports: number, implausibleHexes: string[]}}
 */
export function summarizeTrackPlausibility(
  tracks = [],
  { maxImplausibleHexes = 50 } = {},
) {
  const summary = {
    total: 0,
    judged: 0,
    unjudged: 0,
    tracksWithImplausible: 0,
    implausibleReports: 0,
    implausibleHexes: [],
  };
  const listed = new Set();
  for (const track of tracks ?? []) {
    summary.total += 1;
    let result;
    try {
      result = judgeTrackPlausibility(track?.reports);
    } catch {
      summary.unjudged += 1;
      continue;
    }
    if (!result.judged) {
      summary.unjudged += 1;
      continue;
    }
    summary.judged += 1;
    if (result.implausibleIndexes.length === 0) continue;
    summary.tracksWithImplausible += 1;
    summary.implausibleReports += result.implausibleIndexes.length;
    if (
      typeof track?.hex === 'string' &&
      track.hex !== '' &&
      !listed.has(track.hex) &&
      summary.implausibleHexes.length < maxImplausibleHexes
    ) {
      listed.add(track.hex);
      summary.implausibleHexes.push(track.hex);
    }
  }
  return summary;
}
