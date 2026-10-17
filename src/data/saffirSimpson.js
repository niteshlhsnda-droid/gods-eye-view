/**
 * Saffir-Simpson Hurricane Wind Scale (SSHWS): maximum sustained wind
 * speed -> tropical-cyclone class (tropical depression, tropical storm,
 * hurricane Categories 1-5).
 *
 * Why a new module: GEV already has weather-adjacent pure helpers
 * (Cycles 1-8 added sunTimes, moonPhase, Beaufort, feelsLike, ICAO
 * Standard Atmosphere, FAA flight categories, sunPosition, and EPA AQI),
 * but nothing that answers "how strong is this cyclone?" for the
 * cyclones layer. The SSHWS is the natural companion readout there:
 * a cyclone's maximum sustained wind maps to exactly one class, and
 * the class carries the NHC's damage expectation. This module is that
 * answer: one pure classifier plus the category table (bands in four
 * units, major-hurricane flag, damage gloss) that a badge or readout
 * needs. No call-site migration — no layer reads this yet.
 *
 * Standard: the NOAA / National Hurricane Center Saffir-Simpson
 * Hurricane Wind Scale. The scale is defined on the highest wind speed
 * averaged over a one-minute interval, 10 m above the surface.
 * Categories 1-5 use the NHC's published bands; the tropical-depression
 * / tropical-storm bands use the NHC's tropical-cyclone definitions
 * (depression <= 33 kt, storm 34-63 kt, hurricane >= 64 kt).
 *
 * Sources (primary sources only; no blog summaries):
 * - NOAA Atlantic Oceanographic and Meteorological Laboratory,
 *   Tropical Cyclone FAQ D1, "How are Atlantic hurricanes ranked?"
 *   (contributed by Chris Landsea, NHC): the Saffir-Simpson table in
 *   mph / m/s / kt, the note that classification by central pressure
 *   ended in the 1990s and wind speed alone is now used, and the note
 *   that the Category 3/4/5 limits were modified on 2012-05-15 to
 *   resolve rounding errors.
 *   http://www.aoml.noaa.gov/hrd/tcfaq/D1.html
 * - NOAA / NHC, "Saffir-Simpson Hurricane Wind Scale" (category
 *   damage statements quoted in CATEGORY entries below, and the
 *   statement that the scale does not include storm surge, rainfall
 *   flooding, or tornadoes).
 *   https://www.nhc.noaa.gov/aboutsshws.php
 * - NOAA / NHC tropical-cyclone definitions: tropical depression
 *   <= 33 kt, tropical storm 34-63 kt, hurricane >= 64 kt
 *   (1-minute maximum sustained winds).
 *
 * Per-unit bands — read before comparing units: each unit classifies
 * against ITS OWN published band edges, not against a conversion of
 * the knot bands. The published mph / km/h / m/s bands are the knot
 * bands converted and rounded (NHC rounds converted values to the
 * nearest 5 mph / 5 km/h), so converting an input and then classifying
 * in knots can land one category off at a rounded edge (e.g. 95 mph
 * converts to ~82.6 kt, just above the 82 kt Category 1 ceiling, while
 * the published mph table puts 95 mph in Category 1). Knots are the
 * canonical unit: NHC assigns tropical-cyclone intensities in 5-kt
 * increments. Callers holding a measurement in another unit should
 * pass that unit through, not convert to knots first.
 *
 * Fractional inputs: the published edges are integers, and NHC
 * intensities are assigned in 5-kt increments, so fractional speeds
 * never occur in NHC data. Classification still accepts them and
 * treats each band as the half-open interval [min, next band's min),
 * so a fractional speed lands in the band containing it (82.6 kt ->
 * Category 1, consistent with 95 mph -> Category 1). The stored `max`
 * values remain the published integer edges for display.
 *
 * Accuracy / scope limits — read before using the numbers:
 * - WIND ONLY. The scale estimates potential WIND damage. It does
 *   not include storm surge, rainfall flooding, or tornadoes, all of
 *   which can be deadly in any category. A large lower-category
 *   hurricane can produce a severe surge. Never present the category
 *   as an all-hazards severity score.
 * - ATLANTIC / NORTHEAST PACIFIC SCALE ONLY. Other basins use
 *   different intensity scales (e.g. IMD, Bureau of Meteorology,
 *   JMA). Do not present these categories for a cyclone classified
 *   under another basin's scale.
 * - CALLER SUPPLIES 1-MINUTE MAXIMUM SUSTAINED WIND. Feeding a gust,
 *   a 10-minute mean, or an instantaneous sensor reading misclassifies
 *   by construction. The 2012 rounding-error fix is baked into the
 *   published bands below; do not "correct" them back.
 * - No Category 6. Category 5 is open-ended (>= 137 kt); stronger
 *   storms stay Category 5.
 */

/** Units accepted by {@link classifySaffirSimpson}. */
export const SAFFIR_SIMPSON_UNITS = Object.freeze(['kt', 'mph', 'kmh', 'ms']);

/** Lowest category number that counts as a major hurricane. */
export const MAJOR_HURRICANE_MIN_CATEGORY = 3;

/**
 * The scale, weakest first. `bands` holds [min, max] inclusive edges in
 * each unit; `max: null` means open-ended (Category 5). `damage` quotes
 * the NHC category statement's first sentence (tropical depression /
 * tropical storm entries use a plain gloss, since NHC's scale page
 * covers hurricanes only).
 * @type {ReadonlyArray<Readonly<{
 *   key: string,
 *   name: string,
 *   category: number | null,
 *   isHurricane: boolean,
 *   isMajor: boolean,
 *   bands: Readonly<Record<string, Readonly<[number, number | null]>>>,
 *   damage: string,
 * }>>}
 */
export const SAFFIR_SIMPSON_SCALE = Object.freeze([
  Object.freeze({
    key: 'TD',
    name: 'Tropical Depression',
    category: null,
    isHurricane: false,
    isMajor: false,
    bands: Object.freeze({
      kt: Object.freeze([0, 33]),
      mph: Object.freeze([0, 38]),
      kmh: Object.freeze([0, 62]),
      ms: Object.freeze([0, 17]),
    }),
    damage:
      'Tropical depression: sustained winds below tropical-storm strength.',
  }),
  Object.freeze({
    key: 'TS',
    name: 'Tropical Storm',
    category: null,
    isHurricane: false,
    isMajor: false,
    bands: Object.freeze({
      kt: Object.freeze([34, 63]),
      mph: Object.freeze([39, 73]),
      kmh: Object.freeze([63, 118]),
      ms: Object.freeze([18, 32]),
    }),
    damage: 'Tropical storm: sustained winds below hurricane strength.',
  }),
  Object.freeze({
    key: 'C1',
    name: 'Category 1',
    category: 1,
    isHurricane: true,
    isMajor: false,
    bands: Object.freeze({
      kt: Object.freeze([64, 82]),
      mph: Object.freeze([74, 95]),
      kmh: Object.freeze([119, 153]),
      ms: Object.freeze([33, 42]),
    }),
    damage: 'Very dangerous winds will produce some damage.',
  }),
  Object.freeze({
    key: 'C2',
    name: 'Category 2',
    category: 2,
    isHurricane: true,
    isMajor: false,
    bands: Object.freeze({
      kt: Object.freeze([83, 95]),
      mph: Object.freeze([96, 110]),
      kmh: Object.freeze([154, 177]),
      ms: Object.freeze([43, 49]),
    }),
    damage: 'Extremely dangerous winds will cause extensive damage.',
  }),
  Object.freeze({
    key: 'C3',
    name: 'Category 3',
    category: 3,
    isHurricane: true,
    isMajor: true,
    bands: Object.freeze({
      kt: Object.freeze([96, 112]),
      mph: Object.freeze([111, 129]),
      kmh: Object.freeze([178, 208]),
      ms: Object.freeze([50, 58]),
    }),
    damage: 'Devastating damage will occur.',
  }),
  Object.freeze({
    key: 'C4',
    name: 'Category 4',
    category: 4,
    isHurricane: true,
    isMajor: true,
    bands: Object.freeze({
      kt: Object.freeze([113, 136]),
      mph: Object.freeze([130, 156]),
      kmh: Object.freeze([209, 251]),
      ms: Object.freeze([59, 69]),
    }),
    damage: 'Catastrophic damage will occur.',
  }),
  Object.freeze({
    key: 'C5',
    name: 'Category 5',
    category: 5,
    isHurricane: true,
    isMajor: true,
    bands: Object.freeze({
      kt: Object.freeze([137, null]),
      mph: Object.freeze([157, null]),
      kmh: Object.freeze([252, null]),
      ms: Object.freeze([70, null]),
    }),
    damage: 'Catastrophic damage will occur.',
  }),
]);

/** Scale key ('TD', 'TS', 'C1'..'C5') -> scale entry. */
export const SAFFIR_SIMPSON_BY_KEY = Object.freeze(
  Object.fromEntries(SAFFIR_SIMPSON_SCALE.map((entry) => [entry.key, entry])),
);

/**
 * Classifies a 1-minute maximum sustained wind speed on the
 * Saffir-Simpson Hurricane Wind Scale.
 *
 * @param {number} windSpeed - maximum sustained wind speed in `unit`.
 * @param {string} [unit='kt'] - one of 'kt' (knots, canonical), 'mph',
 *   'kmh' (km/h), 'ms' (m/s). Each unit classifies against its own
 *   published band edges; see the header note on per-unit bands.
 * @returns {object} the frozen scale entry for the wind speed.
 * @throws {TypeError} on a non-finite, negative, or non-numeric speed,
 *   or an unknown unit.
 */
export function classifySaffirSimpson(windSpeed, unit = 'kt') {
  if (typeof windSpeed !== 'number' || !Number.isFinite(windSpeed)) {
    throw new TypeError(
      `classifySaffirSimpson: windSpeed must be a finite number, got ${windSpeed}`,
    );
  }
  if (windSpeed < 0) {
    throw new TypeError(
      `classifySaffirSimpson: windSpeed must be >= 0, got ${windSpeed}`,
    );
  }
  if (!SAFFIR_SIMPSON_UNITS.includes(unit)) {
    throw new TypeError(
      `classifySaffirSimpson: unit must be one of ${SAFFIR_SIMPSON_UNITS.join(', ')}, got ${String(unit)}`,
    );
  }
  for (let i = 0; i < SAFFIR_SIMPSON_SCALE.length; i++) {
    const entry = SAFFIR_SIMPSON_SCALE[i];
    const [min] = entry.bands[unit];
    const next = SAFFIR_SIMPSON_SCALE[i + 1];
    const upperExclusive = next === undefined ? Infinity : next.bands[unit][0];
    if (windSpeed >= min && windSpeed < upperExclusive) {
      return entry;
    }
  }
  // Unreachable: the bands tile [0, +inf) in every unit, with C5
  // open-ended. Kept as a guard so a future table edit fails loudly
  // instead of returning undefined.
  throw new Error(
    `classifySaffirSimpson: no band covers ${windSpeed} ${unit} — scale table has a gap`,
  );
}

/**
 * True when the classified entry is a major hurricane (Category 3+).
 * Accepts either a scale entry (as returned by
 * {@link classifySaffirSimpson}) or a scale key ('TD', 'TS', 'C1'..'C5').
 * @param {object | string} entryOrKey
 * @returns {boolean}
 */
export function isMajorHurricane(entryOrKey) {
  const entry =
    typeof entryOrKey === 'string'
      ? SAFFIR_SIMPSON_BY_KEY[entryOrKey]
      : entryOrKey;
  if (!entry || typeof entry.isMajor !== 'boolean') {
    throw new TypeError(
      `isMajorHurricane: expected a scale entry or key, got ${String(entryOrKey)}`,
    );
  }
  return entry.isMajor;
}
