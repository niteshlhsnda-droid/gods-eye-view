/**
 * Barometric-versus-geometric altitude divergence: a vertical GNSS-integrity
 * cross-check for ADS-B aircraft.
 *
 * An ADS-B aircraft reports two independent altitudes: barometric altitude
 * (pressure altimeter, referenced to 1013.25 hPa) and geometric altitude
 * (GNSS height above the WGS84 ellipsoid). A GNSS altitude error — from
 * spoofing, a jamming-degraded fix, or a receiver fault — moves the geometric
 * figure while the barometric figure stays tied to the pressure altimeter,
 * so a large split between the two is evidence about the GNSS fix that no
 * horizontal check can see. The Cycle 1 coverage bands, the NIC/NACp
 * classifier, and the Cycle 2 teleport / stale / cluster signals all look at
 * horizontal position, reported quality, or coverage; a spoofer that shifts
 * only altitude, or shifts position while keeping altitude plausible, passes
 * all of them.
 *
 * The split is a secondary, unvalidated signal — never a verdict — because
 * three benign effects also separate the two figures:
 * - Geoid separation: geometric altitude is height above the ellipsoid,
 *   barometric altitude approximates height above mean sea level, and the
 *   geoid sits roughly +/-110 m (+/-360 ft) from the ellipsoid worldwide.
 * - Non-standard atmosphere: barometric altitude assumes the ISA pressure
 *   profile, so in cold or dense air the true altitude is lower than
 *   indicated, and the error grows with height above the altimeter-setting
 *   reference; at cruise it can reach many hundreds of feet in extreme cold.
 * - Transponder quantization: 25 ft (or 100 ft) steps on each figure.
 * The bands below are GEV-defined heuristics sized to absorb those effects,
 * not a published classifier, and they are not validated against known
 * spoofing events. A faulty static port or barometric encoder moves the
 * barometric figure alone, so a divergent split can also be an air-data
 * fault, not a GNSS fault.
 *
 * Pure module, no imports. Wiring to the feed (carrying `alt_geom` through
 * normalization, which currently drops it) is a separate step.
 */

/** Within this split, geoid + normal atmosphere + quantization explain the gap. */
export const ALTITUDE_DIVERGENCE_CONSISTENT_FT = 500;
/** Beyond this split, geoid + atmosphere no longer plausibly explain the gap. */
export const ALTITUDE_DIVERGENCE_DIVERGENT_FT = 1500;
/** Altitudes outside this envelope are bad decodes, not evidence. */
export const ALTITUDE_DIVERGENCE_MIN_FT = -2000;
export const ALTITUDE_DIVERGENCE_MAX_FT = 70000;
/** Secondary, unvalidated reading of a divergent split. */
export const ALTITUDE_DIVERGENCE_INTERPRETATION =
  'suspected-gnss-altitude-error';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Judge one aircraft's barometric/geometric altitude split.
 *
 * @param {{altBaro?: number, altGeom?: number, onGround?: boolean}} [aircraft]
 *   Altitudes in feet, as readsb reports `alt_baro` / `alt_geom`.
 * @returns {{divergenceFt: number|null, absDivergenceFt: number|null, band: 'insufficient'|'consistent'|'watch'|'divergent', reason: string|null, interpretation: string|null}}
 *   `divergenceFt` is geometric minus barometric, so a positive split means
 *   the GNSS fix sits above the pressure altitude. `reason` is set only for
 *   the insufficient band: `missing-altitude`, `on-ground`, or
 *   `out-of-envelope`.
 */
export function altitudeDivergenceCheck(input = {}) {
  const { altBaro, altGeom, onGround } = input ?? {};
  if (onGround === true)
    return {
      divergenceFt: null,
      absDivergenceFt: null,
      band: 'insufficient',
      reason: 'on-ground',
      interpretation: null,
    };
  if (!finite(altBaro) || !finite(altGeom))
    return {
      divergenceFt: null,
      absDivergenceFt: null,
      band: 'insufficient',
      reason: 'missing-altitude',
      interpretation: null,
    };
  if (
    altBaro < ALTITUDE_DIVERGENCE_MIN_FT ||
    altBaro > ALTITUDE_DIVERGENCE_MAX_FT ||
    altGeom < ALTITUDE_DIVERGENCE_MIN_FT ||
    altGeom > ALTITUDE_DIVERGENCE_MAX_FT
  )
    return {
      divergenceFt: null,
      absDivergenceFt: null,
      band: 'insufficient',
      reason: 'out-of-envelope',
      interpretation: null,
    };
  const divergenceFt = altGeom - altBaro;
  const absDivergenceFt = Math.abs(divergenceFt);
  if (absDivergenceFt <= ALTITUDE_DIVERGENCE_CONSISTENT_FT)
    return {
      divergenceFt,
      absDivergenceFt,
      band: 'consistent',
      reason: null,
      interpretation: null,
    };
  if (absDivergenceFt <= ALTITUDE_DIVERGENCE_DIVERGENT_FT)
    return {
      divergenceFt,
      absDivergenceFt,
      band: 'watch',
      reason: null,
      interpretation: null,
    };
  return {
    divergenceFt,
    absDivergenceFt,
    band: 'divergent',
    reason: null,
    interpretation: ALTITUDE_DIVERGENCE_INTERPRETATION,
  };
}

/**
 * Summarize one snapshot's splits. Entries without a usable split count as
 * insufficient; entries without a hex are counted but never listed.
 *
 * @param {{hex?: string, altBaro?: number, altGeom?: number, onGround?: boolean}[]} [aircraft]
 * @param {{maxDivergentHexes?: number}} [options]
 * @returns {{total: number, assessed: number, consistent: number, watch: number, divergent: number, insufficient: number, divergentHexes: string[]}}
 */
export function summarizeAltitudeDivergence(
  aircraft = [],
  { maxDivergentHexes = 50 } = {},
) {
  const summary = {
    total: 0,
    assessed: 0,
    consistent: 0,
    watch: 0,
    divergent: 0,
    insufficient: 0,
    divergentHexes: [],
  };
  const listed = new Set();
  for (const entry of aircraft ?? []) {
    summary.total += 1;
    const { band } = altitudeDivergenceCheck(entry ?? {});
    summary[band] += 1;
    if (band !== 'insufficient') summary.assessed += 1;
    if (
      band === 'divergent' &&
      typeof entry?.hex === 'string' &&
      entry.hex !== '' &&
      !listed.has(entry.hex) &&
      summary.divergentHexes.length < maxDivergentHexes
    ) {
      listed.add(entry.hex);
      summary.divergentHexes.push(entry.hex);
    }
  }
  return summary;
}
