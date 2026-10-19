/**
 * Canadian Forest Fire Weather Index (FWI) System adjective danger
 * classes: any of the six system outputs (FFMC, DMC, DC, ISI, BUI,
 * FWI) -> Low / Moderate / High / Very High / Extreme.
 *
 * Why a new module: GEV already has fire data (the FIRMS hot-spot
 * layer) and a shelf of environmental classifiers (Beaufort,
 * Saffir-Simpson, UV Index, EPA AQI, WMO sea state, flood
 * categories, EAWS avalanche scale, SPI drought, ...), but nothing
 * that answers "how dangerous are fire conditions right now?" in
 * the vocabulary fire agencies actually publish. The Canadian FWI
 * System is that vocabulary — the operational fire-danger system
 * used across Canada and adopted internationally (EFFIS, GWIS,
 * CEMS) — and its published adjective-rating classes turn each
 * numeric output into one of five danger levels. This module is
 * that answer: one pure classifier plus the frozen component table
 * (verbatim published bands, physical basis) that a badge, legend,
 * or readout needs. No call-site migration — no layer reads this
 * yet.
 *
 * Standard: Canadian Forest Service Fire Danger Group (2025),
 * "The 2025 Update to the FWI System: Structure, Changes and
 * Interpretation" (Information Report GLC-X-42), Natural Resources
 * Canada, Canadian Forest Service, Great Lakes Forestry Centre.
 * Section 5.3 proposes a physically based national classification
 * framework; Table 1 ("Physically based national classifications
 * of the FWI System and the primary physical process the
 * classification has been based on. (Integer values are rounded.)")
 * reads, verbatim:
 *
 *   Code / Index   Low    Moderate  High    Very High  Extreme   Primary basis
 *   FFMC           0–75   76–84     85–89   90–92      93+       Sustainable flaming ignition
 *   DMC            0–10   11–25     26–45   46–60      61+       Lightning ignition probability
 *   DC             0–70   71–190    191–300 301–500    501+      Deep organic consumption
 *   ISI            0–2    3–5       6–10    11–15      16+       Spread (transition to crowning)
 *   BUI            0–20   21–40     41–60   61–90      90+       Surface fuel consumption
 *   FWI            0–5    6–15      16–22   23–29      30+       Intensity and suppression difficulty
 *
 *   The report notes each threshold is tied to one specific
 *   physical process in a general conifer fuel type (C-3 / pine
 *   needle litter) via FBP models — the "physical basis" column
 *   quoted above. The 30+ Extreme break for FWI matches the
 *   independently published EFFIS/GWIS "High" class floor (FWI
 *   21.3–38.0) and the CEMS interpretation "FWI values above 30
 *   indicate high fire danger conditions" (Copernicus Emergency
 *   Management Service, ECMWF Confluence user guide).
 *
 * Sources (primary sources only; no blog summaries):
 * - CFS Fire Danger Group (2025), Information Report GLC-X-42,
 *   Table 1 (§5.3): the six adjective-rating class tables and the
 *   physical-process basis quoted above, plus the framework caveats
 *   quoted in the scope notes below.
 *   https://www.eoas.ubc.ca/courses/atsc413/fire_basics/images/NG-FWI-2025.pdf
 * - Copernicus Emergency Management Service user guide (ECMWF
 *   Confluence), CFS FWI System interpretation bullets:
 *   FFMC/DMC/DC above 90 = high danger; ISI above 10 = high spread
 *   potential; BUI above 40 = increasing large-fire potential; FWI
 *   above 30 = high fire danger conditions.
 *   https://confluence.ecmwf.int/pages/viewpage.action?pageId=340773358
 *
 * Band tiling: the printed table gives rounded integers, so the
 * bands are stored as verbatim [min, max] display edges (max null =
 * open above) while classification tiles [0, +inf) on the class
 * LOWER bounds: [min_i, min_{i+1}). Where the printed integers show
 * a shared edge (BUI: Very High "61–90" / Extreme "90+"), the
 * higher class's lower bound wins, so BUI 90 lands in Extreme —
 * the report's "integer values are rounded" note makes these
 * printed edges display conveniences, not exact cutoffs. A
 * fractional value between two printed edges (e.g. FWI 5.5) lands
 * in the lower-adjacent class. Negative, non-finite, or
 * non-numeric input is unknown -> null, never throws.
 *
 * The five `label` values ('Low' .. 'Extreme') quote the published
 * adjective levels; the `description` sentences are this module's
 * editorial summaries of what each level means operationally.
 * `code` values ('LOW' .. 'EXTREME', 'FFMC' .. 'FWI') are this
 * module's invention for compact reference.
 *
 * Accuracy / scope limits — read before using the numbers:
 * - PROPOSED NATIONAL FRAMEWORK, NOT OPERATIONAL LAW. The report
 *   is explicit: "No such classification will be perfect ...
 *   They are not meant to be definitive but used as initial
 *   guidance and to provide a nationally consistent set of
 *   classifications." Each Canadian agency historically set its
 *   own adjective breaks (unchanged 40+ years in most
 *   jurisdictions) and may modify these for its jurisdiction.
 *   Treat the classes as the CFS-proposed national interpretation,
 *   not as any agency's trigger thresholds.
 * - GRASSLAND COMPONENTS EXCLUDED. The report adds GFMC / GSI /
 *   GFWI class suggestions but warns "the grassland
 *   classifications have not been previously tested and the
 *   validation is underway, therefore these threshold suggestions
 *   may change in forthcoming publications" — so they are not in
 *   this module. Peatland components are not yet published.
 * - FWI2025 INPUTS. FWI2025 computes the codes hourly from
 *   weather; the published classes apply to the component values
 *   themselves regardless of cadence. Computing the codes (from
 *   temperature, humidity, wind, precipitation) is caller-side;
 *   this module classifies the value only.
 * - NOT A FIRE-OCCURRENCE PREDICTION. The FWI System does not
 *   account for ignition sources (lightning, human activity) or
 *   topography (CEMS user guide, limitations). Extreme fire danger
 *   means extreme fire behaviour IF a fire starts, not that one
 *   will.
 */

/**
 * The five published adjective danger levels, calm first. `label`
 * quotes the published adjective; `description` is an editorial
 * operational summary.
 */
export const FWI_DANGER_LEVELS = Object.freeze([
  Object.freeze({
    code: 'LOW',
    severity: 1,
    label: 'Low',
    description:
      'Relatively little fire danger: fires are unlikely to start or to spread quickly.',
  }),
  Object.freeze({
    code: 'MODERATE',
    severity: 2,
    label: 'Moderate',
    description:
      'Moderate fire danger: fires can start and may spread at moderate intensity.',
  }),
  Object.freeze({
    code: 'HIGH',
    severity: 3,
    label: 'High',
    description:
      'High fire danger: fires start easily and may spread rapidly, challenging suppression efforts.',
  }),
  Object.freeze({
    code: 'VERY_HIGH',
    severity: 4,
    label: 'Very High',
    description:
      'Very high fire danger: fires spread very rapidly and control efforts are seriously challenged.',
  }),
  Object.freeze({
    code: 'EXTREME',
    severity: 5,
    label: 'Extreme',
    description:
      'Extreme fire danger: extreme fire behaviour is expected; fires are likely uncontrollable at the fire front.',
  }),
]);

/**
 * Level code -> FWI_DANGER_LEVELS entry.
 */
export const FWI_LEVEL_BY_CODE = Object.freeze(
  Object.fromEntries(FWI_DANGER_LEVELS.map((entry) => [entry.code, entry])),
);

/**
 * The six FWI System outputs with their published adjective-rating
 * classes (Table 1, GLC-X-42). `band` holds the verbatim published
 * [min, max] display edges; a null max marks the open-ended
 * Extreme class. `physicalBasis` quotes the table's "Primary basis
 * of the classification" column verbatim; `whatItMeasures` is an
 * editorial one-line summary.
 */
export const FWI_SYSTEM_COMPONENTS = Object.freeze([
  Object.freeze({
    code: 'FFMC',
    name: 'Fine Fuel Moisture Code',
    kind: 'fuel-moisture code',
    whatItMeasures:
      'Moisture content of the fine surface litter that carries ignition; reacts to weather within hours.',
    physicalBasis: 'Sustainable flaming ignition',
    classes: Object.freeze([
      Object.freeze({ level: 'LOW', band: Object.freeze([0, 75]) }),
      Object.freeze({ level: 'MODERATE', band: Object.freeze([76, 84]) }),
      Object.freeze({ level: 'HIGH', band: Object.freeze([85, 89]) }),
      Object.freeze({ level: 'VERY_HIGH', band: Object.freeze([90, 92]) }),
      Object.freeze({ level: 'EXTREME', band: Object.freeze([93, null]) }),
    ]),
  }),
  Object.freeze({
    code: 'DMC',
    name: 'Duff Moisture Code',
    kind: 'fuel-moisture code',
    whatItMeasures:
      'Moisture content of loosely compacted decomposing organic layers beneath the litter.',
    physicalBasis: 'Lightning ignition probability',
    classes: Object.freeze([
      Object.freeze({ level: 'LOW', band: Object.freeze([0, 10]) }),
      Object.freeze({ level: 'MODERATE', band: Object.freeze([11, 25]) }),
      Object.freeze({ level: 'HIGH', band: Object.freeze([26, 45]) }),
      Object.freeze({ level: 'VERY_HIGH', band: Object.freeze([46, 60]) }),
      Object.freeze({ level: 'EXTREME', band: Object.freeze([61, null]) }),
    ]),
  }),
  Object.freeze({
    code: 'DC',
    name: 'Drought Code',
    kind: 'fuel-moisture code',
    whatItMeasures:
      'Moisture content of deep compact organic layers; the seasonal drought indicator of the system.',
    physicalBasis: 'Deep organic consumption',
    classes: Object.freeze([
      Object.freeze({ level: 'LOW', band: Object.freeze([0, 70]) }),
      Object.freeze({ level: 'MODERATE', band: Object.freeze([71, 190]) }),
      Object.freeze({ level: 'HIGH', band: Object.freeze([191, 300]) }),
      Object.freeze({ level: 'VERY_HIGH', band: Object.freeze([301, 500]) }),
      Object.freeze({ level: 'EXTREME', band: Object.freeze([501, null]) }),
    ]),
  }),
  Object.freeze({
    code: 'ISI',
    name: 'Initial Spread Index',
    kind: 'fire-behaviour index',
    whatItMeasures:
      'Expected rate of fire spread from the combination of wind speed and fine-fuel moisture.',
    physicalBasis: 'Spread (transition to crowning)',
    classes: Object.freeze([
      Object.freeze({ level: 'LOW', band: Object.freeze([0, 2]) }),
      Object.freeze({ level: 'MODERATE', band: Object.freeze([3, 5]) }),
      Object.freeze({ level: 'HIGH', band: Object.freeze([6, 10]) }),
      Object.freeze({ level: 'VERY_HIGH', band: Object.freeze([11, 15]) }),
      Object.freeze({ level: 'EXTREME', band: Object.freeze([16, null]) }),
    ]),
  }),
  Object.freeze({
    code: 'BUI',
    name: 'Buildup Index',
    kind: 'fire-behaviour index',
    whatItMeasures:
      'Total fuel available for combustion, combining the two deeper moisture codes.',
    physicalBasis: 'Surface fuel consumption',
    classes: Object.freeze([
      Object.freeze({ level: 'LOW', band: Object.freeze([0, 20]) }),
      Object.freeze({ level: 'MODERATE', band: Object.freeze([21, 40]) }),
      Object.freeze({ level: 'HIGH', band: Object.freeze([41, 60]) }),
      Object.freeze({ level: 'VERY_HIGH', band: Object.freeze([61, 90]) }),
      Object.freeze({ level: 'EXTREME', band: Object.freeze([90, null]) }),
    ]),
  }),
  Object.freeze({
    code: 'FWI',
    name: 'Fire Weather Index',
    kind: 'fire-weather index',
    whatItMeasures:
      'Overall fire intensity from spread potential and fuel availability; the scale the public roadside danger signs use.',
    physicalBasis: 'Intensity and suppression difficulty',
    classes: Object.freeze([
      Object.freeze({ level: 'LOW', band: Object.freeze([0, 5]) }),
      Object.freeze({ level: 'MODERATE', band: Object.freeze([6, 15]) }),
      Object.freeze({ level: 'HIGH', band: Object.freeze([16, 22]) }),
      Object.freeze({ level: 'VERY_HIGH', band: Object.freeze([23, 29]) }),
      Object.freeze({ level: 'EXTREME', band: Object.freeze([30, null]) }),
    ]),
  }),
]);

/**
 * Component code ('FFMC' .. 'FWI') -> FWI_SYSTEM_COMPONENTS entry.
 */
export const FWI_COMPONENT_BY_CODE = Object.freeze(
  Object.fromEntries(FWI_SYSTEM_COMPONENTS.map((entry) => [entry.code, entry])),
);

/**
 * Normalise a component code to canonical uppercase form.
 * @param {*} component - e.g. 'FFMC', 'ffmc', ' fwi '.
 * @returns {string|null} the canonical code, or null when unknown.
 */
function normaliseComponentCode(component) {
  if (typeof component !== 'string') {
    return null;
  }
  const code = component.trim().toUpperCase();
  return FWI_COMPONENT_BY_CODE[code] ? code : null;
}

/**
 * Whether a value is classifiable: a finite number >= 0.
 * @param {*} value - the candidate component value.
 * @returns {boolean} true for finite non-negative numbers.
 */
function isKnownValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Classifies an FWI System component value on the CFS
 * GLC-X-42 Table 1 adjective-rating classes.
 *
 * @param {string} component - one of 'FFMC', 'DMC', 'DC', 'ISI',
 *   'BUI', 'FWI' (case-insensitive).
 * @param {number} value - the component value (non-negative).
 *   The bands tile [0, +inf) on lower bounds: a value lands in the
 *   highest class whose band minimum it reaches (BUI 90 -> Extreme;
 *   see the header on rounded printed integers).
 * @returns {object | null} the frozen classification entry
 *   ({ component, componentName, kind, value, level, severity,
 *   label, band, physicalBasis, description, group }), or null
 *   when the component or value is unknown — never throws.
 */
export function classifyFireWeatherIndex(component, value) {
  const code = normaliseComponentCode(component);
  if (code === null || !isKnownValue(value)) {
    return null;
  }
  const componentEntry = FWI_COMPONENT_BY_CODE[code];
  const classes = componentEntry.classes;
  let match = classes[0];
  for (let i = 1; i < classes.length; i++) {
    if (value >= classes[i].band[0]) {
      match = classes[i];
    }
  }
  const levelEntry = FWI_LEVEL_BY_CODE[match.level];
  return Object.freeze({
    component: componentEntry.code,
    componentName: componentEntry.name,
    kind: componentEntry.kind,
    value,
    level: levelEntry.code,
    severity: levelEntry.severity,
    label: levelEntry.label,
    band: match.band,
    physicalBasis: componentEntry.physicalBasis,
    description: levelEntry.description,
    group: 'fire-danger',
  });
}

/**
 * Danger-level code for an FWI System component value.
 * @param {string} component - 'FFMC', 'DMC', 'DC', 'ISI', 'BUI',
 *   'FWI' (case-insensitive).
 * @param {number} value - the component value (non-negative).
 * @returns {string | null} 'LOW' .. 'EXTREME', or null when unknown.
 */
export function fireWeatherDangerLevel(component, value) {
  const entry = classifyFireWeatherIndex(component, value);
  return entry === null ? null : entry.level;
}

/**
 * Whether the classified danger is significant: High or above, the
 * point at which fires start easily and suppression is challenged.
 * This threshold is this module's editorial choice (operational
 * triggers vary by agency), not a published trigger.
 * @param {object | string} entryOrCode - a classification entry (as
 *   returned by {@link classifyFireWeatherIndex}) or a level code
 *   ('LOW' .. 'EXTREME').
 * @returns {boolean | null} true at HIGH/VERY_HIGH/EXTREME, false
 *   at LOW/MODERATE, null when unknown — never throws.
 */
export function isSignificantFireDanger(entryOrCode) {
  const level =
    typeof entryOrCode === 'string'
      ? entryOrCode.trim().toUpperCase()
      : entryOrCode && typeof entryOrCode.level === 'string'
        ? entryOrCode.level.trim().toUpperCase()
        : null;
  const levelEntry = level === null ? undefined : FWI_LEVEL_BY_CODE[level];
  if (!levelEntry) {
    return null;
  }
  return levelEntry.severity >= 3;
}
