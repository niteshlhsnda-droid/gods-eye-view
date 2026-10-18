/**
 * Modified Mercalli Intensity (MMI) Scale: an observed intensity
 * (integer 1-12, designated by Roman numerals I-XII) -> the USGS
 * abridged description of the effects at that site, plus the
 * perceived-shaking label used on USGS ShakeMap legends.
 *
 * Why a new module: GEV already has pure classifiers for other
 * published hazard scales (Cycles 8-14 added EPA AQI,
 * Saffir-Simpson, WHO UV Index, Enhanced Fujita, NOAA Space
 * Weather Scales, WMO Sea State, and WMO present-weather Code
 * Table 4677), but nothing that decodes earthquake intensity —
 * the number an earthquake report, ShakeMap, or "Did You Feel
 * It?" readout actually shows for a place. Magnitude says how
 * big the earthquake was at its source; intensity says what
 * happened HERE. This module is that answer: one intensity ->
 * one published description, with a short perceived-shaking
 * label for badges. No layer reads it yet.
 *
 * Standard: the Modified Mercalli Intensity Scale of 1931
 * (Wood and Neumann), as used in the United States. It has no
 * mathematical basis — it is an arbitrary ranking based on
 * observed effects. The lower numbers deal with how the
 * earthquake is felt by people; the higher numbers are based
 * on observed structural damage, and structural engineers
 * usually contribute information for assigning values of
 * VIII or above.
 *
 * `description` is the USGS abridged wording from "The
 * Severity of an Earthquake" (USGS General Interest
 * Publication 1989-288-913), reproduced verbatim except for
 * two mechanical normalisations: the GIP's sentence-case
 * "some dishes" at level V is capitalised to "Some dishes",
 * and "Rail bent" at level X is kept as published ("Rails
 * bent" appears in some reproductions; the GIP reads
 * "Rail bent"). No meaning is changed and no description is
 * invented: every one of the 12 levels has a published
 * wording.
 *
 * `perceivedShaking` is the short label from the USGS
 * ShakeMap legend (I Not felt; II-III Weak; IV Light;
 * V Moderate; VI Strong; VII Very strong; VIII Severe;
 * IX Violent; X Extreme). ShakeMap's legend tops out at X,
 * so XI and XII share the label Extreme — they are still
 * distinct levels with distinct descriptions, and the label
 * is a display shorthand, not a merge of the levels.
 *
 * Unknown / out-of-range input -> null, never an invented
 * description. `classifyModifiedMercalli` never throws: any
 * input that is not an integer 1-12 or a canonical Roman
 * numeral I-XII (including numeric strings like '4', floats,
 * NaN, null, undefined, booleans, 'IV-V' ranges, decimal
 * instrumental values like 5.4) returns null. Callers that
 * need to distinguish "not an intensity" from "a valid
 * intensity" get exactly that: null means no such level.
 * Roman input is accepted because Roman numerals are the
 * scale's own designation (USGS: "designated by Roman
 * numerals"); it is matched case-insensitively after
 * trimming, but only in canonical form — 'IIII' and
 * 'VIIII' are not valid Roman numerals and return null.
 *
 * Sources (primary sources only):
 * - USGS, "The Severity of an Earthquake" (General Interest
 *   Publication 1989-288-913): the abbreviated description
 *   of all 12 levels, the 1931 Wood/Neumann origin, the
 *   no-mathematical-basis statement, and the VIII+
 *   structural-engineer note.
 *   https://pubs.usgs.gov/gip/earthq4/severitygip.html
 * - USGS, "The Modified Mercalli Intensity Scale": the scale
 *   in current US use, the note that X-and-above criteria
 *   are downweighted in USGS assignments because they track
 *   ground-failure susceptibility more than shaking level
 *   (Stover and Coffman, 1993).
 *   https://www.usgs.gov/natural-hazards/earthquake-hazards/science/modified-mercalli-intensity-scale
 * - USGS ShakeMap legend (PAGER exposure legend): the
 *   perceived-shaking labels I Not felt, II-III Weak,
 *   IV Light, V Moderate, VI Strong, VII Very Strong,
 *   VIII Severe, IX Violent, X Extreme.
 *   https://earthquake.usgs.gov/product/losspager/nn00510518/us/1442597448496/expolegend.pdf
 *
 * No colours: USGS publishes no colour code for MMI, so none
 * is stored. Display colours are a presentation choice;
 * callers pick their own.
 *
 * Scope limits — read before using the levels:
 * - ONE VALUE PER SITE, NOT PER EARTHQUAKE. An earthquake
 *   has one magnitude but produces many intensities — one
 *   per site, varying with distance, depth, geology, and
 *   construction. Never label a whole earthquake with a
 *   single MMI unless it is explicitly the maximum observed
 *   intensity, and say so.
 * - NO MAGNITUDE -> INTENSITY CONVERSION. There is no
 *   formula that turns a magnitude into an MMI: the same
 *   magnitude yields different intensities at different
 *   sites, and the published magnitude/intensity correlation
 *   tables are rough averages, not assignments. This module
 *   provides no magnitude-to-intensity function, and
 *   callers must not invent one from the descriptions.
 * - DECIMAL / INSTRUMENTAL INTENSITY IS NOT THIS SCALE.
 *   ShakeMap and similar products also publish decimal
 *   instrumental intensity (e.g. 5.4) derived from ground
 *   motion, not from observed effects. A decimal is not an
 *   MMI level and returns null here; rounding it to the
 *   nearest integer silently misstates an observation as
 *   a measurement. An instrumental-intensity classifier,
 *   if ever needed, is a separate module.
 * - RANGES ARE NOT LEVELS. Reports sometimes give a range
 *   ('IV-V'). A range is not one level; it returns null.
 *   The caller must pick the assigned level, not average
 *   the range.
 * - INTENSITY I IS "NOT FELT", NOT "NO EARTHQUAKE".
 *   Seismographs record it; people (almost) do not feel it.
 *   Never render I as "no earthquake".
 * - X AND ABOVE ARE DOWNWEIGHTED BY USGS. The phenomena
 *   Wood and Neumann used to define the highest levels
 *   track ground conditions susceptible to spectacular
 *   failure (and fault rupture reaching the surface) more
 *   than shaking level, so USGS downweights them when
 *   assigning intensities. Treat X-XII as damage
 *   descriptions, not shaking measurements.
 * - OTHER SCALES ARE NOT MMI. Historical intensities from
 *   other scales (Rossi-Forel, MSK, EMS-98, JMA) must never
 *   be decoded with this table, even where the numbers
 *   look similar. EMS-98 is compatible with MMI in broad
 *   terms but is a different scale with its own criteria.
 */

/** Lowest Modified Mercalli intensity. */
export const MODIFIED_MERCALLI_MIN = 1;

/** Highest Modified Mercalli intensity. */
export const MODIFIED_MERCALLI_MAX = 12;

/**
 * The scale, weakest first. `description` is the verbatim
 * USGS abridged wording (see header); `perceivedShaking`
 * is the USGS ShakeMap legend label.
 * @type {ReadonlyArray<Readonly<{
 *   intensity: number,
 *   roman: string,
 *   perceivedShaking: string,
 *   description: string,
 * }>>}
 */
export const MODIFIED_MERCALLI_SCALE = Object.freeze([
  Object.freeze({
    intensity: 1,
    roman: 'I',
    perceivedShaking: 'Not felt',
    description:
      'Not felt except by a very few under especially favorable conditions.',
  }),
  Object.freeze({
    intensity: 2,
    roman: 'II',
    perceivedShaking: 'Weak',
    description:
      'Felt only by a few persons at rest, especially on upper floors of buildings. Delicately suspended objects may swing.',
  }),
  Object.freeze({
    intensity: 3,
    roman: 'III',
    perceivedShaking: 'Weak',
    description:
      'Felt quite noticeably by persons indoors, especially on upper floors of buildings. Many people do not recognize it as an earthquake. Standing motor cars may rock slightly. Vibration similar to the passing of a truck. Duration estimated.',
  }),
  Object.freeze({
    intensity: 4,
    roman: 'IV',
    perceivedShaking: 'Light',
    description:
      'Felt indoors by many, outdoors by few during the day. At night, some awakened. Dishes, windows, doors disturbed; walls make cracking sound. Sensation like heavy truck striking building. Standing motor cars rocked noticeably.',
  }),
  Object.freeze({
    intensity: 5,
    roman: 'V',
    perceivedShaking: 'Moderate',
    description:
      'Felt by nearly everyone; many awakened. Some dishes, windows broken. Unstable objects overturned. Pendulum clocks may stop.',
  }),
  Object.freeze({
    intensity: 6,
    roman: 'VI',
    perceivedShaking: 'Strong',
    description:
      'Felt by all, many frightened. Some heavy furniture moved; a few instances of fallen plaster. Damage slight.',
  }),
  Object.freeze({
    intensity: 7,
    roman: 'VII',
    perceivedShaking: 'Very strong',
    description:
      'Damage negligible in buildings of good design and construction; slight to moderate in well-built ordinary structures; considerable damage in poorly built or badly designed structures; some chimneys broken.',
  }),
  Object.freeze({
    intensity: 8,
    roman: 'VIII',
    perceivedShaking: 'Severe',
    description:
      'Damage slight in specially designed structures; considerable damage in ordinary substantial buildings with partial collapse. Damage great in poorly built structures. Fall of chimneys, factory stacks, columns, monuments, walls. Heavy furniture overturned.',
  }),
  Object.freeze({
    intensity: 9,
    roman: 'IX',
    perceivedShaking: 'Violent',
    description:
      'Damage considerable in specially designed structures; well-designed frame structures thrown out of plumb. Damage great in substantial buildings, with partial collapse. Buildings shifted off foundations.',
  }),
  Object.freeze({
    intensity: 10,
    roman: 'X',
    perceivedShaking: 'Extreme',
    description:
      'Some well-built wooden structures destroyed; most masonry and frame structures destroyed with foundations. Rail bent.',
  }),
  Object.freeze({
    intensity: 11,
    roman: 'XI',
    perceivedShaking: 'Extreme',
    description:
      'Few, if any (masonry) structures remain standing. Bridges destroyed. Rails bent greatly.',
  }),
  Object.freeze({
    intensity: 12,
    roman: 'XII',
    perceivedShaking: 'Extreme',
    description:
      'Damage total. Lines of sight and level are distorted. Objects thrown into the air.',
  }),
]);

/** Intensity number (1-12) -> scale entry. */
export const MODIFIED_MERCALLI_BY_INTENSITY = Object.freeze(
  Object.fromEntries(
    MODIFIED_MERCALLI_SCALE.map((entry) => [entry.intensity, entry]),
  ),
);

/** Roman numeral ('I'-'XII') -> scale entry. */
export const MODIFIED_MERCALLI_BY_ROMAN = Object.freeze(
  Object.fromEntries(
    MODIFIED_MERCALLI_SCALE.map((entry) => [entry.roman, entry]),
  ),
);

/**
 * Classifies a Modified Mercalli Intensity on the USGS scale.
 *
 * Accepts an integer 1-12 or a canonical Roman numeral
 * 'I'-'XII' (case-insensitive, surrounding whitespace
 * ignored). Every other input — including numeric strings,
 * floats, decimals, ranges, and out-of-range values —
 * returns null. Never throws.
 *
 * @param {unknown} input - intensity number or Roman numeral.
 * @returns {object | null} the frozen scale entry, or null.
 */
export function classifyModifiedMercalli(input) {
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) {
      return null;
    }
    return MODIFIED_MERCALLI_BY_INTENSITY[input] ?? null;
  }
  if (typeof input === 'string') {
    const roman = input.trim().toUpperCase();
    return MODIFIED_MERCALLI_BY_ROMAN[roman] ?? null;
  }
  return null;
}

/**
 * Returns the perceived-shaking label ('Not felt', 'Weak',
 * 'Light', 'Moderate', 'Strong', 'Very strong', 'Severe',
 * 'Violent', 'Extreme') for an intensity, or null when the
 * input is not a valid MMI level. Never throws.
 *
 * @param {unknown} input - intensity number or Roman numeral.
 * @returns {string | null}
 */
export function modifiedMercalliShaking(input) {
  const entry = classifyModifiedMercalli(input);
  return entry === null ? null : entry.perceivedShaking;
}

/**
 * Returns the USGS abridged description for an intensity,
 * or null when the input is not a valid MMI level. Never
 * throws.
 *
 * @param {unknown} input - intensity number or Roman numeral.
 * @returns {string | null}
 */
export function modifiedMercalliDescription(input) {
  const entry = classifyModifiedMercalli(input);
  return entry === null ? null : entry.description;
}
