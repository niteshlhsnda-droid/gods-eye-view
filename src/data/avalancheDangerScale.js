/**
 * European Avalanche Danger Scale (EADS) + EAWS danger patterns:
 * avalanche danger level 1-5 -> snowpack stability, likelihood of
 * triggering, and backcountry travel advice, plus the ten EAWS
 * typical-situation danger patterns (dp1-dp10).
 *
 * Why a new module: every other environmental classifier in this
 * project (Beaufort, Saffir-Simpson, UV Index, EPA AQI, ...) turns a
 * raw number into human-readable vocabulary for cards, legends, and
 * voice readouts. Mountain snow safety has no such table yet, and the
 * EAWS scale is the one vocabulary every European avalanche bulletin
 * speaks, so a shared frozen table keeps cards and legends honest.
 *
 * The scale text below is quoted VERBATIM from the published EAWS
 * European Avalanche Danger Scale (stability and likelihood-of-
 * triggering columns), as reproduced by the EAWS-matrix derivation
 * paper and by EAWS member services:
 *
 *   1-Low:        "The snowpack is well bonded and stable in general."
 *                 "Triggering is generally possible only from high
 *                  additional loads** in isolated areas of very steep,
 *                  extreme terrain. Only small and medium-sized natural
 *                  avalanches are possible."
 *   2-Moderate:   "The snowpack is only moderately well bonded on some
 *                  steep slopes*; otherwise well bonded in general."
 *                 "Triggering is possible primarily from high additional
 *                  loads**, particularly on the indicated steep slopes*.
 *                  Very large natural avalanches are unlikely."
 *   3-Considerable:"The snowpack is moderately to poorly bonded on many
 *                  steep slopes*."
 *                 "Triggering is possible even from low additional
 *                  loads** particularly on the indicated steep slopes*.
 *                  In certain situations some large, in isolated cases
 *                  very large natural avalanches are possible."
 *   4-High:       "The snowpack is poorly bonded on most steep slopes*."
 *                 "Triggering is likely even by low additional loads**
 *                  on many steep slopes*. In some cases, numerous large
 *                  and often very large natural avalanches can be
 *                  expected."
 *   5-Very High:  "The snowpack is poorly bonded and largely unstable
 *                  in general."
 *                 "Numerous very large and often extremely large natural
 *                  avalanches can be expected, even in moderately steep
 *                  terrain*."
 *
 *   Footnotes: "* Steep slopes are slopes with an incline of more than
 *   about 30 degrees." / "** Additional load: - heavy: e.g. a group of
 *   skiers without spacing. - low: e.g. a single skier / snowboarder
 *   riding smoothly and without falling, a group of skiers with spacing
 *   of at least 10 m, a single person walking."
 *
 * The `travelAdvice` strings are the official third column of the EAWS
 * scale (backcountry travel recommendations): level 1 "Travel is
 * generally safe."; level 2 "Careful route selection, particularly on
 * the indicated steep slopes and at the indicated altitudes and
 * aspects."; level 3 "Partially unfavourable conditions. Experience in
 * the assessment of avalanche hazard is required. Avoid the indicated
 * steep slopes* if possible."; level 4 "Unfavourable conditions. Stay
 * on moderately steep terrain. Heed the run-out zones of avalanches.";
 * level 5 "Extraordinarily unfavourable conditions. Avoid avalanche
 * terrain if possible."
 *
 * The ten danger patterns (dp1-dp10) are the EAWS "typical avalanche
 * situations", used on avalanche.report bulletins and in EAWS member
 * snowpack descriptions; the pattern `code`s match the bulletin
 * abbreviations (e.g. "dp.1: deep persistent weak layer").
 *
 * Sources (all fetched and verified 2026-10-18):
 * - EAWS matrix derivation paper (Part A), Table 1 "European avalanche
 *   danger scale (EAWS, 2023c)", quoting the scale verbatim,
 *   https://nhess.copernicus.org/preprints/nhess-2024-48/nhess-2024-48-manuscript-version3.pdf
 * - Icelandic Met Office (EAWS member), avalanche forecast help page,
 *   https://en.vedur.is/avalanches/forecast/help/
 * - EAWS bulletins using dp codes, e.g.
 *   https://static.avalanche.report/simple/2023-01-04/en.html
 *   ("dp.1: deep persistent weak layer", "dp.10: springtime scenario")
 *
 * Scope notes: the danger level is a regional-bulletin product, not a
 * slope-scale measurement — level 3 is famously the level at which
 * most fatal accidents occur (MOST_ACCIDENTS_LEVEL), because danger is
 * high enough to release but low enough that people travel. Level 5
 * colour is rendered dark red with a black chequer in EAWS bulletins;
 * `colorHex` values below are the conventional EAWS bulletin palette.
 * Out-of-range or unknown inputs return null; nothing here throws.
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/avalancheDangerScale
 */

/** Incline (degrees) above which EAWS calls a slope "steep" (~30). */
export const STEEP_SLOPE_DEGREES = 30;

/**
 * Danger level at which most avalanche fatalities occur: 3
 * (Considerable) — dangerous enough to release, benign-looking enough
 * that people keep travelling. Documented by EAWS member services
 * (e.g. SLF) from accident statistics.
 */
export const MOST_ACCIDENTS_LEVEL = 3;

/**
 * The five EAWS danger levels, in order. `stability` and `triggering`
 * are quoted verbatim from the published EAWS scale; `travelAdvice` is
 * the scale's official backcountry-travel column.
 */
export const AVALANCHE_DANGER_LEVELS = Object.freeze([
  Object.freeze({
    level: 1,
    name: 'Low',
    stability: 'The snowpack is well bonded and stable in general.',
    triggering:
      'Triggering is generally possible only from high additional loads** in isolated areas of very steep, extreme terrain. Only small and medium-sized natural avalanches are possible.',
    travelAdvice: 'Travel is generally safe.',
    colorName: 'green',
    colorHex: '#00A651',
  }),
  Object.freeze({
    level: 2,
    name: 'Moderate',
    stability:
      'The snowpack is only moderately well bonded on some steep slopes*; otherwise well bonded in general.',
    triggering:
      'Triggering is possible primarily from high additional loads**, particularly on the indicated steep slopes*. Very large natural avalanches are unlikely.',
    travelAdvice:
      'Careful route selection, particularly on the indicated steep slopes and at the indicated altitudes and aspects.',
    colorName: 'yellow',
    colorHex: '#FFED00',
  }),
  Object.freeze({
    level: 3,
    name: 'Considerable',
    stability:
      'The snowpack is moderately to poorly bonded on many steep slopes*.',
    triggering:
      'Triggering is possible even from low additional loads** particularly on the indicated steep slopes*. In certain situations some large, in isolated cases very large natural avalanches are possible.',
    travelAdvice:
      'Partially unfavourable conditions. Experience in the assessment of avalanche hazard is required. Avoid the indicated steep slopes* if possible.',
    colorName: 'orange',
    colorHex: '#FF950E',
  }),
  Object.freeze({
    level: 4,
    name: 'High',
    stability: 'The snowpack is poorly bonded on most steep slopes*.',
    triggering:
      'Triggering is likely even by low additional loads** on many steep slopes*. In some cases, numerous large and often very large natural avalanches can be expected.',
    travelAdvice:
      'Unfavourable conditions. Stay on moderately steep terrain. Heed the run-out zones of avalanches.',
    colorName: 'red',
    colorHex: '#E30613',
  }),
  Object.freeze({
    level: 5,
    name: 'Very High',
    stability: 'The snowpack is poorly bonded and largely unstable in general.',
    triggering:
      'Numerous very large and often extremely large natural avalanches can be expected, even in moderately steep terrain*.',
    travelAdvice:
      'Extraordinarily unfavourable conditions. Avoid avalanche terrain if possible.',
    colorName: 'dark red with black chequer',
    colorHex: '#8B0000',
  }),
]);

/**
 * The ten EAWS typical-situation danger patterns, dp1-dp10. The
 * `code`s match the abbreviations used on avalanche.report bulletins;
 * `description` is a one-line field summary of the EAWS pattern text.
 */
export const EAWS_DANGER_PATTERNS = Object.freeze([
  Object.freeze({
    code: 'dp1',
    name: 'Deep persistent weak layer',
    description:
      'A deeply buried persistent weak layer (faceted crystals, depth hoar) that can be triggered by low additional loads weeks after the last storm; avalanches can be very large.',
  }),
  Object.freeze({
    code: 'dp2',
    name: 'Gliding snow',
    description:
      'The entire snowpack is gliding on the ground, typically on smooth ground such as grassy slopes; release can occur at any time of day and is difficult to predict.',
  }),
  Object.freeze({
    code: 'dp3',
    name: 'Rain',
    description:
      'Rain on snow weakens the snowpack and increases the likelihood of wet-snow avalanches and full-depth slides.',
  }),
  Object.freeze({
    code: 'dp4',
    name: 'Cold following warm / warm following cold',
    description:
      'A sharp temperature swing after a warm or cold period changes bonding in the snowpack, e.g. a cold snap crusting over wet snow or warming destabilising cold snow.',
  }),
  Object.freeze({
    code: 'dp5',
    name: 'Snowfall after a long period of cold',
    description:
      'New snow falls onto a cold, faceted old-snow surface and bonds poorly with it.',
  }),
  Object.freeze({
    code: 'dp6',
    name: 'Cold, loose snow and wind',
    description:
      'Cold loose snow transported by wind forms wind slabs on leeward slopes and near ridgelines.',
  }),
  Object.freeze({
    code: 'dp7',
    name: 'Snow-poor areas in snow-rich surroundings',
    description:
      'Thin snowpack spots (wind-scoured ridges, rocky areas) next to deep snow, where near-ground weak layers are easier to trigger.',
  }),
  Object.freeze({
    code: 'dp8',
    name: 'Buried surface hoar',
    description:
      'A buried surface-hoar layer forms a persistent weak layer, most often on shady slopes.',
  }),
  Object.freeze({
    code: 'dp9',
    name: 'Graupel',
    description:
      'A graupel layer in the snowpack acts as a weak layer for the overlying snow.',
  }),
  Object.freeze({
    code: 'dp10',
    name: 'Springtime scenario',
    description:
      'The first full melt-freeze cycles of the season; diurnal warming drives wet-snow avalanche activity, typically in the afternoon.',
  }),
]);

/**
 * Whether a danger level value is usable: an integer in [1, 5].
 * @param {*} level - the candidate level.
 * @returns {boolean} true for integer levels 1-5.
 */
function isKnownLevel(level) {
  return (
    typeof level === 'number' &&
    Number.isInteger(level) &&
    level >= 1 &&
    level <= 5
  );
}

/**
 * EAWS danger-level entry for a bulletin danger level.
 * Unknown or out-of-range inputs return null (never throw): bulletins
 * legitimately publish "no rating" for sub-regions.
 * @param {number} level - EAWS danger level (1-5).
 * @returns {object|null} the frozen `AVALANCHE_DANGER_LEVELS` entry, or null.
 */
export function avalancheDangerLevel(level) {
  if (!isKnownLevel(level)) {
    return null;
  }
  return AVALANCHE_DANGER_LEVELS[level - 1];
}

/**
 * Normalise a danger-pattern code to 'dpN' form.
 * @param {*} code - e.g. 'dp1', 'DP.3', or the number 7.
 * @returns {string|null} 'dpN' for N in [1, 10], else null.
 */
function normalisePatternCode(code) {
  if (typeof code === 'number' && Number.isInteger(code)) {
    return code >= 1 && code <= 10 ? `dp${code}` : null;
  }
  if (typeof code !== 'string') {
    return null;
  }
  const match = /^dp\.?(\d{1,2})$/i.exec(code.trim());
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return n >= 1 && n <= 10 ? `dp${n}` : null;
}

/**
 * EAWS danger-pattern entry for a bulletin pattern code.
 * Accepts 'dp1'..'dp10' (also 'DP.3' bulletin style, or the plain
 * number 1-10); anything else returns null, never throws.
 * @param {string|number} code - danger-pattern code.
 * @returns {object|null} the frozen `EAWS_DANGER_PATTERNS` entry, or null.
 */
export function avalancheDangerPattern(code) {
  const normalised = normalisePatternCode(code);
  if (normalised === null) {
    return null;
  }
  return (
    EAWS_DANGER_PATTERNS.find((entry) => entry.code === normalised) ?? null
  );
}

/**
 * Whether a danger level is significant enough that EAWS travel
 * advice turns restrictive (Considerable and above: avoid indicated
 * steep slopes, heed run-out zones, or stay out of avalanche terrain).
 * Unknown levels return null, never throw.
 * @param {number} level - EAWS danger level (1-5).
 * @returns {boolean|null} true at level 3+, false below, null when unknown.
 */
export function isSignificantDanger(level) {
  if (!isKnownLevel(level)) {
    return null;
  }
  return level >= 3;
}
