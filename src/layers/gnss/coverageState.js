/**
 * GNSS cell coverage state: whether a cell has enough ADS-B reports to judge,
 * and — when it does — its navigation-integrity level.
 *
 * The gap this closes: the GNSS cell classifier on `feature/gnss`
 * (`src/layers/gnss/records.js`, `gnssIntegrityLevel`) answers "nominal" for
 * a cell with zero aircraft, and `binGnssCells` silently drops cells with
 * fewer than `GNSS_MIN_AIRCRAFT` reports. Both read as "nothing wrong here"
 * when the truth is "not enough ADS-B traffic to judge". A sparse cell must
 * say so, per the same honesty rule as ruling #7 (live means live; anything
 * else is labelled for what it is).
 *
 * Standalone and pure (no imports): it mirrors the gpsjam.org cell formula
 * (`100 * max(0, degraded - 1) / total`) and the 2% / 10% bands from
 * `feature/gnss`, which does not exist on `main` yet. When the GNSS feature
 * wires this in, its `GNSS_MIN_AIRCRAFT` / `GNSS_MEDIUM_PERCENT` /
 * `GNSS_HIGH_PERCENT` constants must be unified with the defaults here —
 * not duplicated — so the two can never drift apart.
 */

/** Default minimum aircraft for a cell to be judged (same as the GNSS layer's `GNSS_MIN_AIRCRAFT`). */
export const GNSS_COVERAGE_MIN_AIRCRAFT = 3;
/** Medium band edge, percent (same as the GNSS layer's `GNSS_MEDIUM_PERCENT`). */
export const GNSS_COVERAGE_MEDIUM_PERCENT = 2;
/** High band edge, percent (same as the GNSS layer's `GNSS_HIGH_PERCENT`). */
export const GNSS_COVERAGE_HIGH_PERCENT = 10;

/** A cell with too few reports to judge. */
export const GNSS_COVERAGE_INSUFFICIENT = 'insufficient-data';
/** A cell with enough reports to judge. */
export const GNSS_COVERAGE_COVERED = 'covered';
/** Primary state of a covered, healthy cell. */
export const GNSS_COVERAGE_NOMINAL = 'nominal';
/** Primary state of a covered cell over the medium band: low navigation accuracy. */
export const GNSS_COVERAGE_ANOMALY = 'navigation-integrity-anomaly';
/** Secondary, unvalidated reading of an anomaly cell. */
export const GNSS_COVERAGE_INTERPRETATION = 'suspected-gnss-interference';

/**
 * Coverage + integrity state of one GNSS cell.
 *
 * @param {{aircraft?: number, degraded?: number, minAircraft?: number}} [counts]
 *   `aircraft` is the reports in the cell, `degraded` how many reported low
 *   navigation accuracy. `degraded` above `aircraft` is clamped, never an error.
 * @returns {Readonly<{coverage: string, percentDegraded: number|null, level: string|null, state: string, interpretation: string|null, reason: string}>}
 *   `percentDegraded` is null while coverage is insufficient: a percentage
 *   over too few reports is not evidence. `level` is likewise null there.
 */
export function gnssCoverageState({
  aircraft = 0,
  degraded = 0,
  minAircraft = GNSS_COVERAGE_MIN_AIRCRAFT,
} = {}) {
  for (const [name, value] of [
    ['aircraft', aircraft],
    ['degraded', degraded],
    ['minAircraft', minAircraft],
  ])
    if (!Number.isFinite(value) || value < 0)
      throw new TypeError(`GNSS coverage ${name} must be a finite number >= 0`);
  if (aircraft < minAircraft)
    return Object.freeze({
      coverage: GNSS_COVERAGE_INSUFFICIENT,
      percentDegraded: null,
      level: null,
      state: GNSS_COVERAGE_INSUFFICIENT,
      interpretation: null,
      reason: `fewer than ${minAircraft} aircraft — not enough ADS-B reports to judge this cell`,
    });
  const bounded = Math.min(degraded, aircraft);
  // gpsjam.org's cell formula: the first degraded report is discounted.
  const percent = (100 * Math.max(0, bounded - 1)) / aircraft;
  const level =
    percent > GNSS_COVERAGE_HIGH_PERCENT
      ? 'high'
      : percent >= GNSS_COVERAGE_MEDIUM_PERCENT
        ? 'medium'
        : 'low';
  const anomaly = level !== 'low';
  return Object.freeze({
    coverage: GNSS_COVERAGE_COVERED,
    percentDegraded: Math.round(percent * 10) / 10,
    level,
    state: anomaly ? GNSS_COVERAGE_ANOMALY : GNSS_COVERAGE_NOMINAL,
    interpretation: anomaly ? GNSS_COVERAGE_INTERPRETATION : null,
    reason: anomaly
      ? `${bounded} of ${aircraft} aircraft reported low navigation accuracy`
      : `${bounded} of ${aircraft} aircraft reported low navigation accuracy — within the low band`,
  });
}
