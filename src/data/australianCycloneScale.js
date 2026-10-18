/**
 * Australian Tropical Cyclone Intensity Scale (Bureau of Meteorology):
 * maximum 10-minute sustained wind speed -> cyclone Category 1-5.
 *
 * Why a new module: GEV already classifies cyclones on the US
 * Saffir-Simpson scale (src/data/saffirSimpson.js) and has weather-
 * adjacent pure helpers (Beaufort, EPA AQI, floodCategories), but
 * nothing for the OTHER basins' intensity scales. A first-pass
 * refusal check ruled out three of this slot's four candidate ideas
 * before writing a line:
 *   - EPA/US AQI -> src/data/airQualityIndex.js already implements it
 *     (6 categories, breakpoints, dominant-pollutant helper).
 *   - NWS river-flood categories -> src/data/floodCategories.js
 *     already implements them.
 *   - Saffir-Simpson hurricane scale -> src/data/saffirSimpson.js
 *     already implements it (US Atlantic / Northeast Pacific only).
 * The remaining genuine gap is the Australian-region (Bureau of
 * Meteorology) tropical-cyclone intensity scale, which uses 10-minute
 * sustained winds and different category boundaries from the SSHWS.
 * This module is that answer: one pure classifier plus the category
 * table (bands in two units, gust reference, severe flag, impact
 * gloss) that a badge or readout for the cyclones layer needs.
 * No call-site migration — no layer reads this yet.
 *
 * Standard: the Bureau of Meteorology's 5-category tropical cyclone
 * intensity scale, defined on the maximum 10-minute sustained wind
 * speed near the cyclone's centre. The km/h category bands below are
 * the BoM's published bands (BoM cyclone FAQ); the knot bands are the
 * scale's published knot equivalents (34-47 / 48-63 / 64-85 /
 * 86-107 / >107 kt). Categories 3, 4 and 5 are "severe tropical
 * cyclones" (BoM: severe = sustained >= 118 km/h and gusts >= 165
 * km/h).
 *
 * Sources (primary sources only; no blog summaries):
 * - Australian Government, Bureau of Meteorology, "Tropical
 *   Cyclone FAQs", category table: Category 1 sustained 63-88 km/h,
 *   gusts below 125 km/h; Category 2 89-117 / 125-164; Category 3
 *   118-159 / 165-224 (severe); Category 4 160-199 / 225-279 (severe);
 *   Category 5 over 200 / over 280 (severe); and "Tropical cyclones
 *   are classified as severe when they are producing 'very
 *   destructive winds' having sustained surface winds of at least
 *   118 km/h near the centre and gusts of at least 165 km/h. This
 *   corresponds to cyclone categories 3, 4 and 5."
 *   https://reg.bom.gov.au/cyclone/faq/index.shtml
 * - Bureau of Meteorology, "Tropical cyclones: what you need to
 *   know" (updated 2026-09-17): "A Category 1 cyclone has a mean
 *   wind speed of 63-88 km/h and typical strongest gusts of up to
 *   124 km/h. A Category 5 cyclone has a mean wind speed greater
 *   than 200 km/h and gusts greater than 279 km/h."
 *   https://www.bom.gov.au/news-and-media/tropical-cyclones-what-you-need-to-know
 * - NOAA Atlantic Oceanographic and Meteorological Laboratory,
 *   Tropical Cyclone FAQ D2 (contributed by Neal Dorst), "How are
 *   Australian tropical cyclones ranked?": the BoM scale in gusts /
 *   averaged wind speeds with typical effects per category (quoted
 *   in CATEGORY entries below) and the note that average wind speed
 *   is a 10-minute average.
 *   http://www.aoml.noaa.gov/hrd/tcfaq/D2.html
 *
 * Per-unit bands — read before comparing units: each unit classifies
 * against ITS OWN published band edges, not against a conversion of
 * the km/h bands. The published knot bands are the km/h bands
 * converted and rounded (1 km/h ~= 0.54 kt), so converting an input
 * and then classifying in km/h can land one category off at a
 * rounded edge (e.g. 47.5 kt converts to ~88.0 km/h, just above the
 * 88 km/h Category 1 ceiling, while the published knot table puts
 * 47.5 kt in Category 1). Kilometres per hour are the canonical
 * unit: the BoM publishes and assigns cyclone categories in km/h.
 * Callers holding a measurement in knots should pass 'kt', not
 * convert to km/h first.
 *
 * Accuracy / scope limits — read before using the numbers:
 * - WIND ONLY. The scale estimates potential WIND damage. It does
 *   not include storm surge, rainfall flooding, or tornadoes, all of
 *   which can be deadly in any category. BoM warns that the category
 *   does not reflect the full range of hazards — a Category 1
 *   cyclone can bring prolonged heavy rain or storm surge that leads
 *   to devastating flooding. Never present the category as an
 *   all-hazards severity score.
 * - AUSTRALIAN REGION SCALE ONLY. Other basins use different
 *   intensity scales (Saffir-Simpson in the US Atlantic / Northeast
 *   Pacific, JMA in the Northwest Pacific, IMD in the North Indian
 *   Ocean). Do not present these categories for a cyclone classified
 *   under another basin's scale.
 * - CALLER SUPPLIES 10-MINUTE MAXIMUM SUSTAINED WIND. Feeding a
 *   gust, a 1-minute mean (US convention), or an instantaneous
 *   sensor reading misclassifies by construction.
 * - BELOW CYCLONE STRENGTH. Systems below 63 km/h (34 kt) are not
 *   tropical cyclones on this scale (BoM names them at gale force
 *   and calls weaker systems tropical lows). classifyAustralianCyclone
 *   returns null for those, never a fabricated category.
 * - No Category 6. Category 5 is open-ended (> 200 km/h); stronger
 *   storms stay Category 5.
 */

/** Units accepted by {@link classifyAustralianCyclone}. */
export const AUSTRALIAN_CYCLONE_UNITS = Object.freeze(['kmh', 'kt']);

/** Lowest category number that counts as a severe tropical cyclone. */
export const SEVERE_TROPICAL_CYCLONE_MIN_CATEGORY = 3;

/**
 * The scale, weakest first. `bands` holds [min, max] inclusive edges in
 * each unit; `max: null` means open-ended (Category 5). `gusts` holds
 * the typical strongest-gust range in km/h for reference (min null =
 * "below", max null = "over"); classification always uses the
 * 10-minute sustained `bands`, never the gust range. `impacts` quotes
 * the AOML FAQ D2 indicative effects; `windLabel` quotes the BoM FAQ
 * wind-damage wording.
 * @type {ReadonlyArray<Readonly<{
 *   key: string,
 *   name: string,
 *   category: number,
 *   isSevere: boolean,
 *   bands: Readonly<Record<string, Readonly<[number, number | null]>>>,
 *   gusts: Readonly<{min: number | null, max: number | null}>,
 *   windLabel: string,
 *   impacts: string,
 * }>>}
 */
export const AUSTRALIAN_CYCLONE_SCALE = Object.freeze([
  Object.freeze({
    key: 'C1',
    name: 'Category 1',
    category: 1,
    isSevere: false,
    bands: Object.freeze({
      kmh: Object.freeze([63, 88]),
      kt: Object.freeze([34, 47]),
    }),
    gusts: Object.freeze({ min: null, max: 124 }),
    windLabel: 'Damaging winds',
    impacts:
      'Negligible house damage. Damage to some crops, trees and caravans. Craft may drag moorings.',
  }),
  Object.freeze({
    key: 'C2',
    name: 'Category 2',
    category: 2,
    isSevere: false,
    bands: Object.freeze({
      kmh: Object.freeze([89, 117]),
      kt: Object.freeze([48, 63]),
    }),
    gusts: Object.freeze({ min: 125, max: 164 }),
    windLabel: 'Destructive winds',
    impacts:
      'Minor house damage. Significant damage to signs, trees and caravans. Heavy damage to some crops. Risk of power failure. Small craft may break moorings.',
  }),
  Object.freeze({
    key: 'C3',
    name: 'Category 3',
    category: 3,
    isSevere: true,
    bands: Object.freeze({
      kmh: Object.freeze([118, 159]),
      kt: Object.freeze([64, 85]),
    }),
    gusts: Object.freeze({ min: 165, max: 224 }),
    windLabel: 'Very destructive winds',
    impacts:
      'Some roof and structural damage. Some caravans destroyed. Power failure likely.',
  }),
  Object.freeze({
    key: 'C4',
    name: 'Category 4',
    category: 4,
    isSevere: true,
    bands: Object.freeze({
      kmh: Object.freeze([160, 199]),
      kt: Object.freeze([86, 107]),
    }),
    gusts: Object.freeze({ min: 225, max: 279 }),
    windLabel: 'Very destructive winds',
    impacts:
      'Significant roofing loss and structural damage. Many caravans destroyed and blown away. Dangerous airborne debris. Widespread power failure.',
  }),
  Object.freeze({
    key: 'C5',
    name: 'Category 5',
    category: 5,
    isSevere: true,
    bands: Object.freeze({
      kmh: Object.freeze([200, null]),
      kt: Object.freeze([108, null]),
    }),
    gusts: Object.freeze({ min: 280, max: null }),
    windLabel: 'Very destructive winds',
    impacts: 'Extremely dangerous with widespread destruction.',
  }),
]);

/** Scale key ('C1'..'C5') -> scale entry. */
export const AUSTRALIAN_CYCLONE_BY_KEY = Object.freeze(
  Object.fromEntries(
    AUSTRALIAN_CYCLONE_SCALE.map((entry) => [entry.key, entry]),
  ),
);

/**
 * Classifies a 10-minute maximum sustained wind speed on the
 * Australian (BoM) tropical cyclone intensity scale.
 *
 * Returns null (never throws, never NaN) when the input is not a
 * finite non-negative number, the unit is unknown, or the speed is
 * below cyclone strength (< 63 km/h / < 34 kt), which the scale does
 * not cover.
 *
 * @param {number} windSpeed - 10-minute maximum sustained wind speed in
 *   `unit`, near the cyclone's centre.
 * @param {string} [unit='kmh'] - one of 'kmh' (km/h, canonical) or
 *   'kt' (knots). Each unit classifies against its own published band
 *   edges; see the header note on per-unit bands.
 * @returns {object | null} the frozen scale entry for the wind speed,
 *   or null for unknown / out-of-range input.
 */
export function classifyAustralianCyclone(windSpeed, unit = 'kmh') {
  if (typeof windSpeed !== 'number' || !Number.isFinite(windSpeed)) {
    return null;
  }
  if (windSpeed < 0) {
    return null;
  }
  if (!AUSTRALIAN_CYCLONE_UNITS.includes(unit)) {
    return null;
  }
  for (let i = 0; i < AUSTRALIAN_CYCLONE_SCALE.length; i++) {
    const entry = AUSTRALIAN_CYCLONE_SCALE[i];
    const [min] = entry.bands[unit];
    const next = AUSTRALIAN_CYCLONE_SCALE[i + 1];
    const upperExclusive = next === undefined ? Infinity : next.bands[unit][0];
    if (windSpeed >= min && windSpeed < upperExclusive) {
      return entry;
    }
  }
  // Only reachable for speeds below the Category 1 floor (63 km/h /
  // 34 kt): below cyclone strength, which this scale does not cover.
  return null;
}

/**
 * True when the classified entry is a severe tropical cyclone
 * (Category 3+). Accepts either a scale entry (as returned by
 * {@link classifyAustralianCyclone}) or a scale key ('C1'..'C5').
 * Returns null for an unknown key or entry.
 * @param {object | string} entryOrKey
 * @returns {boolean | null}
 */
export function isSevereTropicalCyclone(entryOrKey) {
  const entry =
    typeof entryOrKey === 'string'
      ? AUSTRALIAN_CYCLONE_BY_KEY[entryOrKey]
      : entryOrKey;
  if (!entry || typeof entry.isSevere !== 'boolean') {
    return null;
  }
  return entry.isSevere;
}
