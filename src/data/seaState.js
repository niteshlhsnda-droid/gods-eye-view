/**
 * WMO Sea State Code (Code Table 3700): significant wave height ->
 * code 0 (Calm, glassy) to code 9 (Phenomenal), with the Met Office
 * forecast term each code falls under (Smooth / Slight / Moderate /
 * Rough / Very rough / High / Very high / Phenomenal).
 *
 * Why a new module: GEV already has weather-adjacent pure helpers
 * (Cycles 1-12 added sunTimes, moonPhase, Beaufort, feelsLike, ICAO
 * Standard Atmosphere, FAA flight categories, sunPosition, EPA AQI,
 * Saffir-Simpson, WHO UV Index, Enhanced Fujita, and the NOAA Space
 * Weather Scales), but nothing that answers "how rough is the sea?"
 * for an ocean / coastal readout. GEV is a globe: coastlines and
 * shipping lanes are core scenery, and a marine layer or vessel
 * readout needs exactly this one-number-to-one-code mapping. This
 * module is that answer: one pure classifier (plus a feet variant
 * and a forecast-term lookup) and the scale table a badge or readout
 * needs. No call-site migration — no layer reads this yet.
 *
 * Standard: the WMO sea state code, which adopts the Douglas Sea
 * Scale's wind-sea definition. Each code is a band of significant
 * wave height Hsig (the average height of the highest one-third of
 * the waves), in metres:
 *
 *   Code  Descriptor       Hsig band (m)
 *   0     Calm (glassy)    exactly 0
 *   1     Calm (rippled)   above 0 to 0.1
 *   2     Smooth (wavelets) 0.1 to 0.5
 *   3     Slight           0.5 to 1.25
 *   4     Moderate         1.25 to 2.5
 *   5     Rough            2.5 to 4
 *   6     Very rough       4 to 6
 *   7     High             6 to 9
 *   8     Very high        9 to 14
 *   9     Phenomenal       above 14
 *
 * Each entry's `threshold` is the band's LOWER bound: classification
 * is "highest threshold reached", i.e. the entry whose threshold is
 * the largest one less than or equal to the measured height — the
 * same rule the sibling classifier modules use. Two consequences:
 *
 * - Shared endpoints belong to the HIGHER code. Exactly 0.5 m is
 *   code 3 (Slight), not code 2: the Met Office's own wording is
 *   "Smooth: wave height less than 0.5 m" / "Slight: wave height
 *   of 0.5 to 1.25 m", so 0.5 m is not Smooth. Likewise exactly
 *   14 m is code 9 (Phenomenal), not code 8.
 * - Code 0 is the ONE exception: it is the exact-zero point, not a
 *   band. Codes 0 and 1 therefore share threshold 0, and
 *   classifySeaState special-cases an input of exactly 0 m to code
 *   0; any positive height below 0.1 m is code 1.
 *
 * Sources (national meteorological services — the operational
 * publishers of these tables — plus the WMO code attribution):
 * - Met Eireann, "Sea Area Forecast Terminology" (Marine
 *   Terminology): the full descriptive table — Calm 0-0.1,
 *   Smooth (Wavelets) 0.1-0.5, Slight 0.5-1.25, Moderate
 *   1.25-2.5, Rough 2.5-4.0, Very rough 4.0-6.0, High 6.0-9.0,
 *   Very High 9.0-14.0, Phenomenal over 14.0 m — and the
 *   definition "Significant wave height is the average height of
 *   the highest one-third of the waves", plus "individual waves
 *   will have heights in excess of the significant height" and
 *   "the highest wave of all will have a height about twice the
 *   significant height".
 *   https://www.met.ie/forecasts/marine-inland-lakes/sea-area-forecast-terminology
 * - UK Met Office, "Guide to marine forecasts" (Coast and sea):
 *   the forecast-term definitions — Smooth: wave height less than
 *   0.5 m; Slight: 0.5 to 1.25 m; Moderate: 1.25 to 2.5 m; Rough:
 *   2.5 to 4.0 m; Very rough: 4.0 to 6.0 m; High: 6.0 to 9.0 m;
 *   Very high: 9.0 to 14.0 m; Phenomenal: more than 14.0 m —
 *   which fixes the shared-endpoint tie-break (see above) and
 *   the forecastTerm mapping (codes 0-2 all read "Smooth").
 *   https://weather.metoffice.gov.uk/guides/coast-and-sea
 * - WMO Code Table 3700 (State of the sea) is the code framework
 *   these tables implement; the WMO code largely adopts the
 *   wind-sea definition of the Douglas Sea Scale.
 *
 * No colours: WMO publishes no colour code for sea state (unlike
 * the WHO UV Index), so none is stored. Display colours are a
 * presentation choice; callers pick their own.
 *
 * Accuracy / scope limits — read before using the numbers:
 * - FEED SIGNIFICANT WAVE HEIGHT, NOT MAXIMUM WAVE HEIGHT. The
 *   bands are Hsig bands. Individual waves exceed Hsig (the
 *   highest wave is about twice Hsig), so feeding a maximum or
 *   single-wave height overstates the code by construction —
 *   potentially by two codes.
 * - THE CODE DOES NOT KNOW WHAT THE HEIGHT IS MADE OF. The
 *   classifier maps one number to one code; it cannot tell wind
 *   sea from swell, and the published tables attach no
 *   composition rule to the code. Label what was fed (e.g.
 *   "total-sea Hsig 3.2 m -> code 5"). Do not feed a swell-only
 *   height and present the result as the sea state, and do not
 *   use this module to classify swell: Douglas's swell code is
 *   a separate code with different bands and is out of scope.
 * - FORECAST TERMS ARE COARSER THAN CODES. The Met Office
 *   forecast wording merges codes 0-2 into "Smooth" and has no
 *   separate words for "Calm (glassy)" / "Calm (rippled)" /
 *   "Smooth (wavelets)". A forecast that says "Smooth" therefore
 *   does NOT mean code 2 — it means code 0, 1, or 2. The
 *   `forecastTerm` field on each entry carries this mapping so
 *   callers never have to guess it.
 * - NOT A SAFETY THRESHOLD. The code describes the sea; it is
 *   not a go / no-go for any vessel. What is safe depends on
 *   vessel size and type, crew, fetch, period, breaking seas,
 *   and local hazards — none of which this module sees. Never
 *   present a code as permission to sail.
 * - DESCRIPTIVE WORDING VARIES BY TABULATION. Some secondary
 *   tables reword the Douglas degrees (e.g. "Wrinkled",
 *   "Beautiful") or shift the degree numbering. This module uses
 *   the WMO / Met Eireann wording above (Calm (glassy) through
 *   Phenomenal) and the 0-9 numbering both services use.
 */

/** Lowest code in the scale (Calm, glassy). */
export const SEA_STATE_MIN_CODE = 0;

/** Highest code in the scale (Phenomenal, open-ended above 14 m). */
export const SEA_STATE_MAX_CODE = 9;

/** Exact metres per foot (international foot, 1959). */
export const METRE_PER_FOOT = 0.3048;

/**
 * WMO Sea State Code scale, calmest first. `threshold` is the
 * lower bound of the code's significant-wave-height band in
 * metres; classification takes the highest threshold <= the
 * measured height, except that an input of exactly 0 m is code 0
 * (see the header: codes 0 and 1 share threshold 0). `bandLabel`
 * is the published band. `forecastTerm` is the Met Office
 * forecast word for the code — codes 0-2 all read "Smooth".
 * @type {ReadonlyArray<Readonly<{
 *   code: number,
 *   descriptor: string,
 *   forecastTerm: string,
 *   threshold: number,
 *   thresholdUnit: string,
 *   bandLabel: string,
 * }>>}
 */
export const SEA_STATE_SCALE = Object.freeze([
  Object.freeze({
    code: 0,
    descriptor: 'Calm (glassy)',
    forecastTerm: 'Smooth',
    threshold: 0,
    thresholdUnit: 'm',
    bandLabel: '0 m',
  }),
  Object.freeze({
    code: 1,
    descriptor: 'Calm (rippled)',
    forecastTerm: 'Smooth',
    threshold: 0,
    thresholdUnit: 'm',
    bandLabel: '0–0.1 m',
  }),
  Object.freeze({
    code: 2,
    descriptor: 'Smooth (wavelets)',
    forecastTerm: 'Smooth',
    threshold: 0.1,
    thresholdUnit: 'm',
    bandLabel: '0.1–0.5 m',
  }),
  Object.freeze({
    code: 3,
    descriptor: 'Slight',
    forecastTerm: 'Slight',
    threshold: 0.5,
    thresholdUnit: 'm',
    bandLabel: '0.5–1.25 m',
  }),
  Object.freeze({
    code: 4,
    descriptor: 'Moderate',
    forecastTerm: 'Moderate',
    threshold: 1.25,
    thresholdUnit: 'm',
    bandLabel: '1.25–2.5 m',
  }),
  Object.freeze({
    code: 5,
    descriptor: 'Rough',
    forecastTerm: 'Rough',
    threshold: 2.5,
    thresholdUnit: 'm',
    bandLabel: '2.5–4 m',
  }),
  Object.freeze({
    code: 6,
    descriptor: 'Very rough',
    forecastTerm: 'Very rough',
    threshold: 4,
    thresholdUnit: 'm',
    bandLabel: '4–6 m',
  }),
  Object.freeze({
    code: 7,
    descriptor: 'High',
    forecastTerm: 'High',
    threshold: 6,
    thresholdUnit: 'm',
    bandLabel: '6–9 m',
  }),
  Object.freeze({
    code: 8,
    descriptor: 'Very high',
    forecastTerm: 'Very high',
    threshold: 9,
    thresholdUnit: 'm',
    bandLabel: '9–14 m',
  }),
  Object.freeze({
    code: 9,
    descriptor: 'Phenomenal',
    forecastTerm: 'Phenomenal',
    threshold: 14,
    thresholdUnit: 'm',
    bandLabel: '> 14 m',
  }),
]);

/** Sea state code (0..9) -> scale entry. */
export const SEA_STATE_BY_CODE = Object.freeze(
  Object.fromEntries(SEA_STATE_SCALE.map((entry) => [entry.code, entry])),
);

/**
 * Requires `value` to be a finite number >= 0.
 * @param {number} value
 * @param {string} name
 */
function requireNonNegativeFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${value}`);
  }
  if (value < 0) {
    throw new TypeError(`${name} must be >= 0, got ${value}`);
  }
}

/**
 * Classifies a significant wave height on the WMO Sea State Code.
 *
 * @param {number} significantWaveHeightMetres - significant wave
 *   height Hsig (average height of the highest one-third of the
 *   waves) in metres. NOT a maximum or single-wave height.
 * @returns {object} the frozen scale entry for the height. Never
 *   null: every non-negative height has a code, and code 9 is
 *   open-ended above 14 m.
 * @throws {TypeError} on a non-finite, negative, or non-numeric
 *   height.
 */
export function classifySeaState(significantWaveHeightMetres) {
  requireNonNegativeFinite(
    significantWaveHeightMetres,
    'classifySeaState: significantWaveHeightMetres',
  );
  if (significantWaveHeightMetres === 0) {
    return SEA_STATE_SCALE[SEA_STATE_MIN_CODE];
  }
  let matched = SEA_STATE_SCALE[1];
  for (const entry of SEA_STATE_SCALE.slice(1)) {
    if (significantWaveHeightMetres >= entry.threshold) {
      matched = entry;
    } else {
      break;
    }
  }
  return matched;
}

/**
 * Classifies a significant wave height given in feet on the WMO
 * Sea State Code. The feet value is converted exactly
 * (1 ft = 0.3048 m) and classified in metres — no rounding.
 *
 * @param {number} significantWaveHeightFeet - significant wave
 *   height Hsig in feet.
 * @returns {object} the frozen scale entry for the height.
 * @throws {TypeError} on a non-finite, negative, or non-numeric
 *   height.
 */
export function classifySeaStateFromFeet(significantWaveHeightFeet) {
  requireNonNegativeFinite(
    significantWaveHeightFeet,
    'classifySeaStateFromFeet: significantWaveHeightFeet',
  );
  return classifySeaState(significantWaveHeightFeet * METRE_PER_FOOT);
}

/**
 * Looks up one code's scale entry.
 *
 * @param {number} code - integer sea state code, 0-9.
 * @returns {object} the frozen scale entry for the code.
 * @throws {TypeError} on a non-integer or out-of-range code.
 */
export function seaStateByCode(code) {
  if (
    typeof code !== 'number' ||
    !Number.isInteger(code) ||
    code < SEA_STATE_MIN_CODE ||
    code > SEA_STATE_MAX_CODE
  ) {
    throw new TypeError(
      `seaStateByCode: code must be an integer ${SEA_STATE_MIN_CODE}-${SEA_STATE_MAX_CODE}, got ${code}`,
    );
  }
  return SEA_STATE_BY_CODE[code];
}

/**
 * Returns the Met Office forecast term for a significant wave
 * height ("Smooth" for codes 0-2, then the code's own
 * descriptor from Slight upward).
 *
 * @param {number} significantWaveHeightMetres - significant wave
 *   height Hsig in metres.
 * @returns {string} the forecast term.
 * @throws {TypeError} on a non-finite, negative, or non-numeric
 *   height.
 */
export function seaStateForecastTerm(significantWaveHeightMetres) {
  return classifySeaState(significantWaveHeightMetres).forecastTerm;
}
