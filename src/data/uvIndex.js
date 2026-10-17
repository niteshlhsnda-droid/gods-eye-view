/**
 * WHO Global Solar UV Index (UVI): UV Index value -> exposure category
 * (Low, Moderate, High, Very High, Extreme) with the WHO colour code and
 * sun-protection guidance.
 *
 * Why a new module: GEV already has sun-adjacent pure helpers (Cycles
 * 1-9 added sunTimes, moonPhase, Beaufort, feelsLike, ICAO Standard
 * Atmosphere, FAA flight categories, sunPosition, EPA AQI, and the
 * Saffir-Simpson scale), but nothing that answers "how strong is the
 * sun right now, and what protection does that call for?" for a
 * sun/UV readout. The UVI is the natural companion to sunPosition and
 * sunTimes: solar position says where the sun is, the UVI says how
 * much skin-damaging UV is reaching the ground. This module is that
 * answer: one pure classifier plus the category table (bands, WHO
 * colour, protection flag, protection gloss) that a badge or readout
 * needs. No call-site migration — no layer reads this yet.
 *
 * Standard: the Global Solar UV Index as published by WHO with WMO,
 * UNEP, and ICNIRP in "Global Solar UV Index: A Practical Guide"
 * (2002). Categories and colours:
 *   0-2 Low, green; 3-5 Moderate, yellow; 6-7 High, orange;
 *   8-10 Very High, red; 11+ Extreme, violet.
 *
 * Sources (primary sources only; no blog summaries):
 * - WHO, "Radiation: The ultraviolet (UV) index" (Q&A): the UVI
 *   action bands 0-2 / 3-7 / 8+, the statement that below a UVI of
 *   2 the risk for even very sensitive fair-skinned people is
 *   limited and under normal circumstances no protective measures
 *   are needed, and that when protection is required it should
 *   include all protective means (clothing, hat, sunglasses, shade,
 *   sunscreen).
 *   https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index
 * - WHO INTERSUN, "The UV index sun protection table": the
 *   international colour code for UVI values (the graphic
 *   presentation for consistent UVI reporting).
 *   https://www.who.int/publications/m/item/the-uv-index-sun-protection-table/
 * - WHO / WMO / UNEP / ICNIRP, "Global Solar UV Index: A Practical
 *   Guide" (2002): the five-category table and the escalating
 *   protection messages paraphrased in each entry's `protection`
 *   field below (no protection at Low; protection required from
 *   Moderate up; shade all day and avoid midday sun at Very High;
 *   take all precautions and avoid the sun around solar noon at
 *   Extreme).
 *
 * Colour: only the WHO colour NAME is stored (`color`). Display hex
 * codes are a presentation choice and vary by publisher, so callers
 * pick their own hex for the name; the module does not invent one.
 *
 * Fractional inputs: forecasts are often reported with decimals
 * (e.g. 5.4), so classification accepts them and treats each band as
 * the half-open interval [min, next band's min). The stored `max`
 * values remain the published integer edges for display.
 *
 * Accuracy / scope limits — read before using the numbers:
 * - DAILY-MAXIMUM, CLEAR-SKY-ORIENTED FORECAST VALUE. The UVI is
 *   defined for the daily maximum erythemally weighted UV irradiance
 *   under the forecast conditions. It is not an instantaneous meter
 *   reading, and cloud, ozone, altitude, and surface reflection
 *   shift the real exposure. Never present a single UVI as a
 *   minute-by-minute exposure meter.
 * - AVERAGE PERSON. The categories describe risk for the average
 *   person. Very fair skin, photosensitising medication, and other
 *   individual factors raise the risk at the same UVI. The
 *   `protection` strings are general public-health guidance, not
 *   medical advice.
 * - NO UPPER BOUND. The scale is open-ended: values above 11 occur
 *   (e.g. high-altitude tropical sites), and they stay Extreme.
 *   Never clamp a UVI to 11.
 * - UVI 0 IS VALID. Night-time / zero-sun values are Low, not an
 *   error. Only negative, non-finite, or non-numeric inputs throw.
 */

/** UVI at or above which WHO says sun protection is required. */
export const UV_INDEX_PROTECTION_THRESHOLD = 3;

/**
 * The scale, weakest first. `range` holds [min, max] inclusive edges;
 * `max: null` means open-ended (Extreme). `protection` paraphrases the
 * WHO guide's message for the category; `protectionRequired` is false
 * only for Low.
 * @type {ReadonlyArray<Readonly<{
 *   key: string,
 *   name: string,
 *   range: Readonly<[number, number | null]>,
 *   color: string,
 *   protectionRequired: boolean,
 *   protection: string,
 * }>>}
 */
export const UV_INDEX_SCALE = Object.freeze([
  Object.freeze({
    key: 'LOW',
    name: 'Low',
    range: Object.freeze([0, 2]),
    color: 'green',
    protectionRequired: false,
    protection:
      'No protection required. Wear sunglasses on bright days; use sunscreen if there is snow on the ground (it reflects UV) or if you have particularly fair skin.',
  }),
  Object.freeze({
    key: 'MODERATE',
    name: 'Moderate',
    range: Object.freeze([3, 5]),
    color: 'yellow',
    protectionRequired: true,
    protection:
      'Protection required. Seek shade around midday, wear protective clothing, a wide-brimmed hat, and sunglasses, and use sunscreen.',
  }),
  Object.freeze({
    key: 'HIGH',
    name: 'High',
    range: Object.freeze([6, 7]),
    color: 'orange',
    protectionRequired: true,
    protection:
      'Protection required. Seek shade around midday, wear protective clothing, a wide-brimmed hat, and sunglasses, use sunscreen, and reduce time in the sun around solar noon.',
  }),
  Object.freeze({
    key: 'VERY_HIGH',
    name: 'Very High',
    range: Object.freeze([8, 10]),
    color: 'red',
    protectionRequired: true,
    protection:
      'Protection required. Avoid being outside during midday hours; seek shade all day, wear protective clothing, a wide-brimmed hat, and sunglasses, and use sunscreen.',
  }),
  Object.freeze({
    key: 'EXTREME',
    name: 'Extreme',
    range: Object.freeze([11, null]),
    color: 'violet',
    protectionRequired: true,
    protection:
      'Take all precautions: avoid the sun around solar noon, seek shade all day, wear protective clothing, a wide-brimmed hat, and sunglasses, and use sunscreen.',
  }),
]);

/** Scale key ('LOW', 'MODERATE', 'HIGH', 'VERY_HIGH', 'EXTREME') -> scale entry. */
export const UV_INDEX_BY_KEY = Object.freeze(
  Object.fromEntries(UV_INDEX_SCALE.map((entry) => [entry.key, entry])),
);

/**
 * Classifies a UV Index value on the WHO Global Solar UV Index.
 *
 * @param {number} uvi - UV Index value (>= 0; fractional forecasts accepted).
 * @returns {object} the frozen scale entry for the UVI.
 * @throws {TypeError} on a non-finite, negative, or non-numeric UVI.
 */
export function classifyUvIndex(uvi) {
  if (typeof uvi !== 'number' || !Number.isFinite(uvi)) {
    throw new TypeError(
      `classifyUvIndex: uvi must be a finite number, got ${uvi}`,
    );
  }
  if (uvi < 0) {
    throw new TypeError(`classifyUvIndex: uvi must be >= 0, got ${uvi}`);
  }
  for (let i = 0; i < UV_INDEX_SCALE.length; i++) {
    const entry = UV_INDEX_SCALE[i];
    const [min] = entry.range;
    const next = UV_INDEX_SCALE[i + 1];
    const upperExclusive = next === undefined ? Infinity : next.range[0];
    if (uvi >= min && uvi < upperExclusive) {
      return entry;
    }
  }
  // Unreachable: the bands tile [0, +inf), with Extreme open-ended.
  // Kept as a guard so a future table edit fails loudly instead of
  // returning undefined.
  throw new Error(
    `classifyUvIndex: no band covers ${uvi} — scale table has a gap`,
  );
}

/**
 * True when the classified entry requires sun protection (UVI >= 3,
 * i.e. every category except Low). Accepts either a scale entry (as
 * returned by {@link classifyUvIndex}) or a scale key ('LOW',
 * 'MODERATE', 'HIGH', 'VERY_HIGH', 'EXTREME').
 * @param {object | string} entryOrKey
 * @returns {boolean}
 */
export function requiresProtection(entryOrKey) {
  const entry =
    typeof entryOrKey === 'string' ? UV_INDEX_BY_KEY[entryOrKey] : entryOrKey;
  if (!entry || typeof entry.protectionRequired !== 'boolean') {
    throw new TypeError(
      `requiresProtection: expected a scale entry or key, got ${String(entryOrKey)}`,
    );
  }
  return entry.protectionRequired;
}
