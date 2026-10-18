/**
 * EAWS Matrix: (snowpack stability x frequency x avalanche size) ->
 * regional avalanche danger level 1-5.
 *
 * Why a new module: Cycle 18 added the EAWS danger-scale vocabulary
 * (levels 1-5 with stability/triggering/advice text and the dp1-dp10
 * danger patterns), but not the published look-up that PRODUCES the
 * level from forecaster-assessed conditions. The EAWS Matrix is that
 * look-up: three panels (one per stability class), frequency on the
 * y axis, avalanche size on the x axis, 45 cells total. This module
 * encodes the primary Matrix-suggested level (D1) of every cell, so
 * any UI can turn "very poor stability, many locations, size 3"
 * into a defensible danger level without duplicating the table.
 *
 * What it is NOT: the Matrix is a decision-support tool, not a
 * measurement. The published paper stresses that danger "cannot be
 * measured or calculated (by algorithms) in a strict sense" — the
 * final level remains a forecaster's expert judgment, especially
 * around the transition zones (e.g. poor-some-size 2, which spans
 * levels 2-3). Also, the level is a REGIONAL bulletin product, not
 * a slope-scale measurement.
 *
 * Scope: this is the Matrix lookup only. The surrounding published
 * workflow (start with the lowest assessed stability class; skip a
 * class whose frequency is "none or nearly none"; danger defaults
 * to 1 (low) when the lowest class is good; the highest level across
 * avalanche problems wins) is described in the paper's section 6.1
 * and is deliberately NOT implemented here — a single-cell lookup
 * cannot perform multi-step workflow logic.
 *
 * Sources (primary sources only; no blog summaries):
 * - Muller, Techel & Mitterer, "The EAWS matrix, a decision support
 *   tool to determine the regional avalanche danger level (Part A):
 *   conceptual development", Nat. Hazards Earth Syst. Sci., 25,
 *   4503-4521, 2025. Defines the three factors and their classes
 *   (Tables 2-4), derives the 45-cell matrix from 76 European
 *   forecasters (D1 = median response, D2 = second level in brackets
 *   when in the interquartile range), presents the revised matrix
 *   after operational testing (Fig. 3b), documents the good->1
 *   default and the none-or-nearly-none skip rule (sect. 6.1), and
 *   gives worked examples (sect. 6.2).
 *   https://nhess.copernicus.org/articles/25/4503/2025/
 * - EAWS: the matrix "was formally adopted by the EAWS General
 *   Assembly in 2022" (initial revision) and "the proposed changes
 *   were formally adopted by the EAWS General Assembly in 2025"
 *   (consolidated matrix); "now adopted as an EAWS standard"
 *   (Part A, sects. 1 and 4).
 *
 * Cell values below are the published D1 (primary, Matrix-suggested)
 * level of each cell. Cross-checked against the paper's own worked
 * examples and stated high-agreement cells: very poor-many-size 1
 * -> 2 (D2=3); poor-many-size 2 -> 3; very poor-some-size 2/3 ->
 * 3 / 3 (D2=4); very poor-many-size 3 -> 4 (85% agreement);
 * poor-some-size 3 -> 3 (84%); fair-a few-size 1 -> 1 (97%);
 * very poor-many-size 5 -> 5 (99%). Cells that carry a bracketed
 * secondary level (D2) in the publication resolve to their D1 here;
 * the D2 alternatives (shown when >=30% of experts chose a different
 * level, resp. within the interquartile range) are forecaster
 * judgment territory, not encoded.
 *
 * Pure: no DOM, no Cesium, no imports, no network. Never throws:
 * anything outside the published classes returns null.
 *
 * @module data/avalancheDangerMatrix
 */

/**
 * The three stability classes the Matrix panels cover (Table 2 of
 * the paper). The fourth published class, "good", is a workflow
 * rule, not a matrix panel: when the lowest assessed stability
 * class is good, the danger level defaults to 1 (low).
 */
export const STABILITY_CLASSES = Object.freeze(['very poor', 'poor', 'fair']);

/**
 * The three frequency classes the Matrix rows cover (Table 3 of
 * the paper). The fourth published class, "none or nearly none",
 * is a workflow rule, not a matrix row: skip to the next stability
 * class (more stable) and assess that panel instead.
 */
export const FREQUENCY_CLASSES = Object.freeze(['many', 'some', 'a few']);

/**
 * The five avalanche size classes (Table 4 of the paper), keyed by
 * the numeric class with its published label and destructive
 * potential wording.
 */
export const SIZE_CLASSES = Object.freeze([
  Object.freeze({
    size: 1,
    label: 'Small',
    destructivePotential:
      'Unlikely to bury a person, except in run out zones with unfavorable terrain features (e.g. terrain traps).',
  }),
  Object.freeze({
    size: 2,
    label: 'Medium',
    destructivePotential: 'May bury, injure, or kill a person.',
  }),
  Object.freeze({
    size: 3,
    label: 'Large',
    destructivePotential:
      'May bury and destroy cars, damage trucks, destroy small buildings and break a few trees.',
  }),
  Object.freeze({
    size: 4,
    label: 'Very large',
    destructivePotential:
      'May bury and destroy trucks and trains. May destroy fairly large buildings and small areas of forest.',
  }),
  Object.freeze({
    size: 5,
    label: 'Extremely large',
    destructivePotential:
      'May devastate the landscape and has catastrophic destructive potential.',
  }),
]);

/**
 * The 45-cell EAWS Matrix: stability -> frequency -> size -> D1
 * (primary, Matrix-suggested danger level 1-5). Decoded from the
 * published matrix (Part A, Fig. 3b) and cross-checked against the
 * paper's worked examples (sect. 6.2) and stated high-agreement
 * cells.
 *
 * Layout per panel (rows = frequency top to bottom many/some/a few,
 * columns = size 1-5):
 *
 *   very poor:  many  [2,3,4,5,5]
 *               some  [2,3,3,4,5]
 *               a few [1,2,3,3,4]
 *   poor:       many  [2,3,4,4,5]
 *               some  [2,2,3,4,4]
 *               a few [1,2,2,3,3]
 *   fair:       many  [1,2,3,3,4]
 *               some  [1,2,2,3,3]
 *               a few [1,1,2,2,3]
 */
const MATRIX = Object.freeze({
  'very poor': Object.freeze({
    many: Object.freeze([2, 3, 4, 5, 5]),
    some: Object.freeze([2, 3, 3, 4, 5]),
    'a few': Object.freeze([1, 2, 3, 3, 4]),
  }),
  poor: Object.freeze({
    many: Object.freeze([2, 3, 4, 4, 5]),
    some: Object.freeze([2, 2, 3, 4, 4]),
    'a few': Object.freeze([1, 2, 2, 3, 3]),
  }),
  fair: Object.freeze({
    many: Object.freeze([1, 2, 3, 3, 4]),
    some: Object.freeze([1, 2, 2, 3, 3]),
    'a few': Object.freeze([1, 1, 2, 2, 3]),
  }),
});

function normalizeAxis(value, classes) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return classes.includes(normalized) ? normalized : null;
}

function normalizeSize(size) {
  if (typeof size === 'number') {
    return Number.isInteger(size) && size >= 1 && size <= 5 ? size : null;
  }
  if (typeof size === 'string') {
    const trimmed = size.trim();
    if (!/^[1-5]$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  return null;
}

/**
 * EAWS Matrix lookup: the primary Matrix-suggested danger level
 * (D1, integer 1-5) for one combination of snowpack stability,
 * its frequency, and the largest expected avalanche size.
 *
 * @param {object} args - `{ stability, frequency, size }`.
 *   `stability` is one of "very poor" | "poor" | "fair"
 *   (case-insensitive, surrounding whitespace ignored);
 *   `frequency` is one of "many" | "some" | "a few";
 *   `size` is the avalanche size class 1-5 (number, or a numeric
 *   string like "3").
 * @returns {number|null} the D1 danger level (1-5), or null when
 *   any axis is missing or outside the published Matrix classes.
 *   Never throws. Note: "good" stability and "none or nearly none"
 *   frequency are published workflow concepts, not Matrix cells —
 *   they return null here (the workflow, not the Matrix, resolves
 *   them: good defaults to level 1; none-or-nearly-none moves to
 *   the next stability panel).
 */
export function avalancheDangerMatrix(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return null;
  }
  const stability = normalizeAxis(args.stability, STABILITY_CLASSES);
  const frequency = normalizeAxis(args.frequency, FREQUENCY_CLASSES);
  const size = normalizeSize(args.size);
  if (stability === null || frequency === null || size === null) {
    return null;
  }
  return MATRIX[stability][frequency][size - 1];
}
