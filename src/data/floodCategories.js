/**
 * NWS Advanced Hydrologic Prediction Services (AHPS) flood-stage
 * categories for river gauges.
 *
 * Why a new module: the globe can show a river gauge's current stage,
 * but the raw number in feet only becomes actionable when mapped to
 * the National Weather Service severity scale that AHPS hydrographs
 * use: Below Action / Action Stage / Minor Flood / Moderate Flood /
 * Major Flood. Cards, legends, and voice readouts can share this one
 * classifier instead of each re-deriving the comparison logic, and the
 * official category definitions live next to the code that uses them.
 *
 * The scale is gauge-relative: every threshold is a stage in feet above
 * that gauge's datum, set individually by the NWS for the reach it
 * serves. The three flood categories do not all have to exist at a
 * given gauge (NWS glossary: "all three of the lower flood categories
 * (minor, moderate, major) do not necessarily exist for a given forecast
 * point... However, at least one of these three flood categories must
 * start at flood stage") -- so flood thresholds may be missing, but at
 * least one of minor / moderate / major must be present, and defined
 * thresholds must be strictly increasing: action < minor < moderate <
 * major.
 *
 * Sources (all fetched and verified 2026-10-18):
 * - National Weather Service, "About Hydrograph" (NOAA / water.noaa.gov),
 *   https://water.noaa.gov/about/hydrograph
 *   (official Action / Minor / Moderate / Major flood definitions; stage
 *   and flow definitions).
 * - NOAA National Weather Service Glossary, "Flood Categories"
 *   (definitions of Minor / Moderate / Major / Record flooding, and the
 *   note that not all three flood categories necessarily exist at a
 *   forecast point).
 * - NOAA NWS Advanced Hydrologic Prediction Services, "How to implement
 *   the regional map inline frame" (AHPS observation-map marker colors:
 *   Minor (orange), Moderate (red), Major (violet); Action (yellow);
 *   no flooding (green)).
 *
 * Scope notes:
 * - Stage boundaries are closed at the lower end: a reading exactly at
 *   the minor threshold is Minor Flood, matching "at or above flood
 *   stage" language. The epsilon tests pin this.
 * - "Record Flooding" is an NWS forecast-point attribute (a crest at or
 *   above the period of record), not an AHPS classifier band, so it is
 *   not a category here.
 * - Flood severity at a stage is not necessarily uniform along a reach
 *   (channel, banks, levees vary); NWS ties each category's bounds to
 *   the most significant flood impacts somewhere in the reach.
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/floodCategories
 */

/** Stage in feet at or above which each AHPS category begins, keyed by category. */
export const BELOW_ACTION = Object.freeze({
  key: 'below_action',
  name: 'Below Action',
  definition:
    'River stage below the gauge action stage: no NWS action or flood level is in effect.',
  markerColor: 'green',
});

export const ACTION_STAGE = Object.freeze({
  key: 'action_stage',
  name: 'Action Stage',
  definition:
    'The stage which, when reached by a rising stream, represents the level where the National Weather Service or a partner/user needs to take some type of mitigation action in preparation for possible significant hydrologic activity.',
  markerColor: 'yellow',
});

export const MINOR_FLOOD = Object.freeze({
  key: 'minor_flood',
  name: 'Minor Flood',
  definition: 'Minimal or no property damage, but possibly some public threat.',
  markerColor: 'orange',
});

export const MODERATE_FLOOD = Object.freeze({
  key: 'moderate_flood',
  name: 'Moderate Flood',
  definition:
    'Some inundation of structures and roads near stream. Some evacuations of people and/or transfer of property to higher elevations.',
  markerColor: 'red',
});

export const MAJOR_FLOOD = Object.freeze({
  key: 'major_flood',
  name: 'Major Flood',
  definition:
    'Extensive inundation of structures and roads. Significant evacuations of people and/or transfer of property to higher elevations.',
  markerColor: 'violet',
});

/**
 * The five AHPS categories in ascending severity, for legend rendering.
 */
export const FLOOD_CATEGORIES = Object.freeze([
  BELOW_ACTION,
  ACTION_STAGE,
  MINOR_FLOOD,
  MODERATE_FLOOD,
  MAJOR_FLOOD,
]);

/**
 * Gauge flood thresholds in feet of stage. `action` is optional; at
 * least one of `minor` / `moderate` / `major` must be a finite number
 * (NWS: at least one flood category must start at flood stage).
 * @typedef {{action?: number|null, minor?: number|null, moderate?: number|null, major?: number|null}} FloodThresholds
 */

/**
 * Validate a finite number input.
 * @param {number} value - the value to validate.
 * @param {string} label - input label for the error message.
 */
function checkFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

/**
 * Normalize a thresholds object: missing entries become null, present
 * ones are validated, and the whole set must be strictly increasing
 * action < minor < moderate < major across the entries that exist.
 * @param {FloodThresholds} thresholds - gauge flood thresholds in feet.
 * @returns {{action: number|null, minor: number|null, moderate: number|null, major: number|null}}
 */
function normalizeThresholds(thresholds) {
  if (
    thresholds === null ||
    typeof thresholds !== 'object' ||
    Array.isArray(thresholds)
  ) {
    throw new TypeError(
      'thresholds must be an object with action/minor/moderate/major entries',
    );
  }
  const normalized = { action: null, minor: null, moderate: null, major: null };
  for (const key of ['action', 'minor', 'moderate', 'major']) {
    const value = thresholds[key];
    if (value === undefined || value === null) continue;
    checkFinite(value, `${key} threshold`);
    normalized[key] = value;
  }
  if (
    normalized.minor === null &&
    normalized.moderate === null &&
    normalized.major === null
  ) {
    throw new RangeError(
      'thresholds must define at least one of the minor, moderate, or major flood levels',
    );
  }
  const ordered = ['action', 'minor', 'moderate', 'major'].filter(
    (key) => normalized[key] !== null,
  );
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const next = ordered[i];
    if (!(normalized[next] > normalized[prev])) {
      throw new RangeError(
        `thresholds must be strictly increasing: ${next} (${normalized[next]}) must exceed ${prev} (${normalized[prev]})`,
      );
    }
  }
  return normalized;
}

/**
 * Classify a river gauge reading into the NWS AHPS flood categories.
 * A reading exactly at a threshold belongs to that category (bands are
 * closed at the lower bound: "at or above flood stage").
 * @param {number} stage - observed water-surface stage in feet above the gauge datum.
 * @param {FloodThresholds} thresholds - the gauge's action/minor/moderate/major thresholds in feet.
 * @returns {object} one of BELOW_ACTION, ACTION_STAGE, MINOR_FLOOD, MODERATE_FLOOD, MAJOR_FLOOD.
 */
export function classifyFloodStage(stage, thresholds) {
  checkFinite(stage, 'stage');
  const t = normalizeThresholds(thresholds);
  if (t.major !== null && stage >= t.major) return MAJOR_FLOOD;
  if (t.moderate !== null && stage >= t.moderate) return MODERATE_FLOOD;
  if (t.minor !== null && stage >= t.minor) return MINOR_FLOOD;
  if (t.action !== null && stage >= t.action) return ACTION_STAGE;
  return BELOW_ACTION;
}

/**
 * The flood-stage level for a gauge: the lowest defined flood threshold
 * (minor, moderate, or major). NWS requires at least one of them to
 * exist, and the lowest is where flooding begins at that reach.
 * @param {FloodThresholds} thresholds - the gauge's action/minor/moderate/major thresholds in feet.
 * @returns {number} the flood-stage level in feet.
 */
export function floodStage(thresholds) {
  const t = normalizeThresholds(thresholds);
  if (t.minor !== null) return t.minor;
  if (t.moderate !== null) return t.moderate;
  return t.major;
}

/**
 * Whether a category means the river is flooding (Minor, Moderate, or
 * Major) as opposed to Below Action / Action Stage.
 * @param {object} category - one of the FLOOD_CATEGORIES entries.
 * @returns {boolean} true for the three NWS flood categories.
 */
export function isFloodingCategory(category) {
  if (
    category === null ||
    typeof category !== 'object' ||
    typeof category.key !== 'string'
  ) {
    throw new TypeError('category must be one of the flood category objects');
  }
  return (
    category.key === MINOR_FLOOD.key ||
    category.key === MODERATE_FLOOD.key ||
    category.key === MAJOR_FLOOD.key
  );
}
