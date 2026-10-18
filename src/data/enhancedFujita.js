/**
 * Enhanced Fujita Scale (EF Scale): estimated 3-second gust -> tornado
 * rating (EF0-EF5) with the NWS damage descriptor for the rating.
 *
 * Why a new module: GEV already has weather-adjacent pure helpers
 * (Cycles 1-10 added sunTimes, moonPhase, Beaufort, feelsLike, ICAO
 * Standard Atmosphere, FAA flight categories, sunPosition, EPA AQI,
 * Saffir-Simpson, and the WHO UV Index), but nothing that answers
 * "how strong was this tornado?" for a severe-weather / tornado
 * readout. The EF Scale is the natural companion to the Saffir-Simpson
 * module: one maps a cyclone's sustained wind to a category, this one
 * maps a tornado's estimated gust to a rating. This module is that
 * answer: one pure classifier plus the rating table (mph bands,
 * intensity word, damage gloss) that a badge or readout needs.
 * No call-site migration — no layer reads this yet.
 *
 * Standard: the NOAA / National Weather Service Enhanced Fujita
 * Scale, operational in the United States since 2007-02-01. A
 * tornado is assigned one rating, EF0-EF5, from the most intense
 * damage it caused. The wind speeds are 3-second gusts ESTIMATED
 * from surveyed damage (see the scope limits below), not anemometer
 * measurements.
 *
 * Sources (primary sources only; no blog summaries):
 * - NOAA / NWS, \"The Enhanced Fujita Scale (EF Scale)\" (Norman,
 *   OK Weather Forecast Office): the scale became operational
 *   2007-02-01; a tornado's rating comes from comparing surveyed
 *   damage against Damage Indicators (DIs) and Degrees of Damage
 *   (DoD); the EF band table in mph 3-second gust (EF0 65-85,
 *   EF1 86-110, EF2 111-135, EF3 136-165, EF4 166-200, EF5
 *   over 200); and the IMPORTANT NOTE that EF winds are estimates
 *   based on damage, not measurements, and that a 3-second gust is
 *   not the same wind as a standard surface observation.
 *   https://www.weather.gov/oun/efscale
 * - NOAA / NWS, \"Fujita Scale Page\" (Tampa Bay): the same EF band
 *   table, the 28 Damage Indicators / 8 levels of damage framing,
 *   and the note that the 3-second gust is estimated at the point
 *   of damage and varies with height and exposure.
 *   https://www.weather.gov/tbw/fujita
 * - NOAA / NWS Storm Prediction Center, \"Fujita Tornado Damage
 *   Scale\": the original F Scale (no longer used in the U.S.),
 *   its typical-damage descriptors per level, and the note that
 *   F-scale wind numbers were guesses never verified in science
 *   or engineering — the reason the EF Scale re-anchored the bands
 *   to surveyed damage. http://www.spc.noaa.gov/faq/tornado/f-scale.html
 * - NOAA NCEI, \"The Enhanced Fujita Tornado Scale\": the
 *   original-vs-enhanced comparison (F0 40-72 mph fastest
 *   1/4-mile / 45-78 mph 3-second gust vs EF0 65-85 mph 3-second
 *   gust, and so on), confirming the EF bands are NOT the F bands
 *   relabelled — an F-number and its EF-number share the digit,
 *   not the wind range.
 *   https://www.ncei.noaa.gov/monitoring-content/societal-impacts/tornadoes/reports/enhanced-fujita-tornado-scale.pdf
 *
 * Units — read before comparing units: NWS publishes the EF bands
 * in mph ONLY. There is no published per-unit EF table (unlike
 * Saffir-Simpson, where NHC publishes bands in knots, mph, km/h,
 * and m/s). So this module classifies against the published mph
 * bands, and kmh / ms inputs are converted EXACTLY to mph first
 * (1 mph = 1.609344 km/h; 1 mph = 0.44704 m/s) — no rounded
 * per-unit tables are invented. Callers holding a measurement in
 * another unit pass that unit through; the conversion is exact,
 * so no edge-rounding dispute can arise.
 *
 * Fractional inputs: the published edges are integers, and official
 * ratings never come from a fractional measured gust (they come from
 * surveyed damage). Classification still accepts fractional gusts:
 * each band is upper-inclusive — a gust lands in the first band
 * whose published ceiling covers it — so 85.5 mph -> EF1 (above
 * EF0's 85 ceiling) and 200.5 mph -> EF5 (EF5 is \"over 200\").
 * The stored `min` values remain the published integer starts for
 * display; the stored `max` values are the published integer
 * ceilings that drive classification.
 *
 * Accuracy / scope limits — read before using the numbers:
 * - DAMAGE-BASED ESTIMATES, NOT MEASUREMENTS. An official EF
 *   rating is assigned by an NWS damage survey: surveyed damage is
 *   matched to Damage Indicators and Degrees of Damage, and the
 *   wind range is estimated from that match. A gust measured by
 *   an anemometer or radar does NOT by itself assign an EF rating.
 *   Never present this classifier's output as an official rating;
 *   it answers \"which EF band does this estimated gust fall in?\"
 *   - 3-SECOND GUST AT THE POINT OF DAMAGE. The EF gust is
 *     estimated at the point of damage and varies with height and
 *   exposure. Feeding a 1-minute sustained wind, a 10-minute mean,
 *   or a gust measured elsewhere misclassifies by construction.
 * - BELOW 65 MPH IS NOT ON THE SCALE. Gusts below 65 mph map to
 *   no EF rating (`classifyEnhancedFujita` returns null); they are
 *   not \"EF0\". A tornado with no surveyable damage is EFU
 *   (EF-Unknown, exported as `EF_UNKNOWN`), not EF0.
 * - NO UPPER BOUND. EF5 is open-ended (> 200 mph). Stronger
 *   tornadoes stay EF5; there is no EF6. EF5 also has no stated
 *   upper wind bound in the operational scale.
 * - U.S. SCALE. The EF Scale is the U.S. operational scale (also
 *   used in e.g. France). Other countries use other scales (e.g.
 *   the TORRO scale in the UK); do not present these ratings for
 *   a tornado classified under another scale.
 */

/** Units accepted by {@link classifyEnhancedFujita}. */
export const ENHANCED_FUJITA_UNITS = Object.freeze(['mph', 'kmh', 'ms']);

/** Lowest EF number that counts as a violent tornado (EF4+). */
export const VIOLENT_TORNADO_MIN_EF = 4;

/** Exact conversion constants (definitions, not measurements). */
export const KMH_PER_MPH = 1.609344;
export const MS_PER_MPH = 0.44704;

/**
 * The scale, weakest first. `bands.mph` holds [min, max] inclusive
 * edges in mph 3-second gust; `max: null` means open-ended (EF5).
 * EF5's stored min is 201 — the first integer over 200 — matching
 * the published \"Over 200\" wording.
 * `intensity` is the NWS character word for the level (Weak /
 * Strong / Violent). `damage` paraphrases the NWS/SPC typical-damage
 * descriptor for the level.
 * @type {ReadonlyArray<Readonly<{
 *   key: string,
 *   name: string,
 *   efNumber: number,
 *   intensity: string,
 *   bands: Readonly<{ mph: Readonly<[number, number | null]> }>,
 *   damage: string,
 * }>>}
 */
export const ENHANCED_FUJITA_SCALE = Object.freeze([
  Object.freeze({
    key: 'EF0',
    name: 'EF0',
    efNumber: 0,
    intensity: 'Weak',
    bands: Object.freeze({ mph: Object.freeze([65, 85]) }),
    damage:
      'Light damage: some damage to chimneys, branches broken off trees, shallow-rooted trees pushed over, sign boards damaged.',
  }),
  Object.freeze({
    key: 'EF1',
    name: 'EF1',
    efNumber: 1,
    intensity: 'Weak',
    bands: Object.freeze({ mph: Object.freeze([86, 110]) }),
    damage:
      'Moderate damage: roof surfaces peeled off, mobile homes pushed off foundations or overturned, moving autos pushed off roads.',
  }),
  Object.freeze({
    key: 'EF2',
    name: 'EF2',
    efNumber: 2,
    intensity: 'Strong',
    bands: Object.freeze({ mph: Object.freeze([111, 135]) }),
    damage:
      'Considerable damage: roofs torn off frame houses, mobile homes demolished, boxcars overturned, large trees snapped or uprooted, light-object missiles generated.',
  }),
  Object.freeze({
    key: 'EF3',
    name: 'EF3',
    efNumber: 3,
    intensity: 'Strong',
    bands: Object.freeze({ mph: Object.freeze([136, 165]) }),
    damage:
      'Severe damage: roofs and some walls torn off well-constructed houses, trains overturned, most trees in a forest uprooted, heavy cars lifted off the ground and thrown.',
  }),
  Object.freeze({
    key: 'EF4',
    name: 'EF4',
    efNumber: 4,
    intensity: 'Violent',
    bands: Object.freeze({ mph: Object.freeze([166, 200]) }),
    damage:
      'Devastating damage: well-constructed houses leveled, structures with weak foundations blown away some distance, cars thrown, large missiles generated.',
  }),
  Object.freeze({
    key: 'EF5',
    name: 'EF5',
    efNumber: 5,
    intensity: 'Violent',
    bands: Object.freeze({ mph: Object.freeze([201, null]) }),
    damage:
      'Incredible damage: strong frame houses leveled off foundations and swept away, automobile-sized missiles fly through the air, trees debarked.',
  }),
]);

/**
 * EF-Unknown: a tornado that cannot be rated because there is no
 * surveyable damage. NOT a scale entry — it carries no wind band
 * and never comes back from {@link classifyEnhancedFujita}. Callers
 * representing an unrated tornado use this object directly.
 */
export const EF_UNKNOWN = Object.freeze({
  key: 'EFU',
  name: 'EF-Unknown',
  efNumber: null,
  intensity: 'Unknown',
  bands: Object.freeze({ mph: Object.freeze([null, null]) }),
  damage: 'Unknown: no surveyable damage, so no rating can be assigned.',
});

/** Scale key ('EF0'..'EF5') -> scale entry. */
export const ENHANCED_FUJITA_BY_KEY = Object.freeze(
  Object.fromEntries(ENHANCED_FUJITA_SCALE.map((entry) => [entry.key, entry])),
);

/**
 * Classifies an estimated 3-second gust on the Enhanced Fujita
 * Scale.
 *
 * @param {number} gust - estimated 3-second gust in `unit`.
 * @param {string} [unit='mph'] - one of 'mph' (canonical, published
 *   bands), 'kmh' (km/h), 'ms' (m/s). Non-mph inputs are converted
 *   exactly to mph before classification; see the header note.
 * @returns {object | null} the frozen scale entry for the gust, or
 *   null when the gust is below 65 mph (not on the scale).
 * @throws {TypeError} on a non-finite, negative, or non-numeric
 *   gust, or an unknown unit.
 */
export function classifyEnhancedFujita(gust, unit = 'mph') {
  if (typeof gust !== 'number' || !Number.isFinite(gust)) {
    throw new TypeError(
      `classifyEnhancedFujita: gust must be a finite number, got ${gust}`,
    );
  }
  if (gust < 0) {
    throw new TypeError(
      `classifyEnhancedFujita: gust must be >= 0, got ${gust}`,
    );
  }
  if (!ENHANCED_FUJITA_UNITS.includes(unit)) {
    throw new TypeError(
      `classifyEnhancedFujita: unit must be one of ${ENHANCED_FUJITA_UNITS.join(', ')}, got ${String(unit)}`,
    );
  }
  const gustMph =
    unit === 'mph'
      ? gust
      : unit === 'kmh'
        ? gust / KMH_PER_MPH
        : gust / MS_PER_MPH;
  if (gustMph < ENHANCED_FUJITA_SCALE[0].bands.mph[0]) {
    return null;
  }
  for (const entry of ENHANCED_FUJITA_SCALE) {
    const [, max] = entry.bands.mph;
    // Upper-inclusive bands: the first band whose published ceiling
    // covers the gust wins. EF5's ceiling is null (open-ended), so
    // it catches everything above EF4's 200 ceiling — including
    // fractional gusts like 200.5, matching the published
    // \"Over 200\" wording.
    if (max === null || gustMph <= max) {
      return entry;
    }
  }
  // Unreachable: the bands tile [65, +inf) in mph, with EF5
  // open-ended. Kept as a guard so a future table edit fails loudly
  // instead of returning undefined.
  throw new Error(
    `classifyEnhancedFujita: no band covers ${gust} ${unit} — scale table has a gap`,
  );
}

/**
 * True when the classified entry is a violent tornado (EF4+).
 * Accepts either a scale entry (as returned by
 * {@link classifyEnhancedFujita}), the `EF_UNKNOWN` object (false),
 * or a scale key ('EF0'..'EF5', 'EFU'). Null (below-scale gust)
 * returns false — a sub-EF0 gust is not a violent tornado.
 * @param {object | string | null} entryOrKey
 * @returns {boolean}
 */
export function isViolentTornado(entryOrKey) {
  if (entryOrKey === null) {
    return false;
  }
  const entry =
    typeof entryOrKey === 'string'
      ? entryOrKey === EF_UNKNOWN.key
        ? EF_UNKNOWN
        : ENHANCED_FUJITA_BY_KEY[entryOrKey]
      : entryOrKey;
  if (!entry || (typeof entry.efNumber !== 'number' && entry !== EF_UNKNOWN)) {
    throw new TypeError(
      `isViolentTornado: expected a scale entry, 'EFU', or key, got ${String(entryOrKey)}`,
    );
  }
  return (
    typeof entry.efNumber === 'number' &&
    entry.efNumber >= VIOLENT_TORNADO_MIN_EF
  );
}
