/**
 * Aviation flight categories (VFR / MVFR / IFR / LIFR): the ceiling +
 * visibility classification of observed or forecast airport weather.
 *
 * Why a new module: GEV renders aircraft, cockpit readouts, and
 * METAR-style station data, but nothing in the repo turns a ceiling +
 * visibility pair into the one vocabulary every aviation-weather map
 * uses — VFR green, MVFR blue, IFR red, LIFR magenta. Cards, legends,
 * and voice readouts can share this one classifier instead of each
 * hard-coding thresholds (and disagreeing at the boundaries).
 *
 * Model: the FAA / NWS four-category table. Ceiling is the lowest
 * broken or overcast layer, in feet AGL; visibility is prevailing
 * visibility in statute miles (not nautical miles). The final category
 * is the WORSE of the ceiling category and the visibility category
 * (an OR rule): a 5,000 ft ceiling with 0.5 sm visibility in fog is
 * LIFR. Boundaries follow the FAA AIM wording exactly:
 * - VFR: ceiling > 3,000 ft AND visibility > 5 sm.
 * - MVFR: ceiling 1,000–3,000 ft (inclusive) OR visibility 3–5 sm
 *   (inclusive). Exactly 3,000 ft or exactly 5 sm is MVFR, not VFR.
 * - IFR: ceiling 500 to < 1,000 ft OR visibility 1 to < 3 sm.
 *   Exactly 1,000 ft is MVFR; exactly 3 sm is MVFR; exactly 500 ft
 *   is IFR; exactly 1 sm is IFR.
 * - LIFR: ceiling < 500 ft OR visibility < 1 sm.
 * No ceiling (clear / few / scattered only) counts as VFR on the
 * ceiling dimension — VFR needs no ceiling or one above 3,000 ft.
 *
 * VLIFR (Very Low IFR) is an NWS refinement, not one of the FAA AIM
 * four: ceiling < 200 ft and/or visibility < 1/2 sm. It is exposed
 * only through `flightCategoryDetailed`, which splits the worst end
 * of LIFR; the plain `flightCategory` returns the four FAA categories.
 *
 * Sources (fetched and verified 2026-10-17):
 * - FAA Aeronautical Information Manual, Chapter 7, Flight Categories
 *   (four-category thresholds; ceiling = lowest broken/overcast
 *   layer), summarized at
 *   https://legalclarity.org/how-to-read-a-terminal-aerodrome-forecast-taf/
 * - National Weather Service, "Ceiling and Visibility"
 *   https://www.weather.gov/zme/safety_cigvis
 *   (ceiling / visibility threshold tables; visibility in SM).
 * - ForeFlight, "Flight Rules Thrown Out of the ForeFlight Mobile App"
 *   https://blog.foreflight.com/staging/9401/2015/02/19/flight-rules-thrown-out/
 *   ("Flight Category" describes observed/forecast weather, not the
 *   flight rules in force; NWS VLIFR = ceiling < 200 ft and/or
 *   visibility < 1/2 sm).
 * - WeatherAPI, "Ceiling and Visibility: How to Build Reliable IFR
 *   Condition Detection"
 *   https://blog.weatherapi.com/ifr-condition-detection-ceiling-visibility-weatherapi/
 *   (worst-of / OR rule; ceiling = lowest broken or overcast layer).
 *
 * Scope notes: this classifies WEATHER, not legality. It is not the
 * 14 CFR 91.155 VFR weather minimums (which vary by airspace, day /
 * night, and altitude), not Special VFR, and not a go / no-go
 * decision — a VFR category says nothing about wind, storms, or
 * terrain. No live data, no DOM, no imports, no network.
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/flightCategories
 */

/** Ceiling above this (ft AGL) is VFR; at or below it is MVFR or worse. */
export const VFR_CEILING_FT = 3000;

/** Visibility above this (statute miles) is VFR; at or below it is MVFR or worse. */
export const VFR_VISIBILITY_SM = 5;

/** Ceiling at or above this (ft AGL) is MVFR or better; below it is IFR or worse. */
export const MVFR_CEILING_FT = 1000;

/** Visibility at or above this (statute miles) is MVFR or better; below it is IFR or worse. */
export const MVFR_VISIBILITY_SM = 3;

/** Ceiling at or above this (ft AGL) is IFR or better; below it is LIFR. */
export const IFR_CEILING_FT = 500;

/** Visibility at or above this (statute mile) is IFR or better; below it is LIFR. */
export const IFR_VISIBILITY_SM = 1;

/** Ceiling below this (ft AGL) is VLIFR (NWS refinement). */
export const VLIFR_CEILING_FT = 200;

/** Visibility below this (statute mile) is VLIFR (NWS refinement). */
export const VLIFR_VISIBILITY_SM = 0.5;

/** Flight categories from best to worst weather (FAA AIM four). */
export const FLIGHT_CATEGORIES = Object.freeze(['VFR', 'MVFR', 'IFR', 'LIFR']);

/** Human-readable names, conventional map colors, and plain-language guidance per category. */
export const FLIGHT_CATEGORY_INFO = Object.freeze({
  VFR: Object.freeze({
    code: 'VFR',
    name: 'Visual Flight Rules',
    color: 'green',
    guidance: 'Visual flying conditions. Still check wind, storms, and terrain.',
  }),
  MVFR: Object.freeze({
    code: 'MVFR',
    name: 'Marginal Visual Flight Rules',
    color: 'blue',
    guidance: 'Marginal visual conditions. Legal for VFR but with slim margins; many accidents happen in MVFR.',
  }),
  IFR: Object.freeze({
    code: 'IFR',
    name: 'Instrument Flight Rules',
    color: 'red',
    guidance: 'Instrument conditions. Visual flight is not safe or legal for VFR-only pilots.',
  }),
  LIFR: Object.freeze({
    code: 'LIFR',
    name: 'Low Instrument Flight Rules',
    color: 'magenta',
    guidance: 'Very low instrument conditions, near the limits of standard instrument approaches.',
  }),
  VLIFR: Object.freeze({
    code: 'VLIFR',
    name: 'Very Low Instrument Flight Rules',
    color: 'magenta',
    guidance:
      'NWS refinement splitting the worst end of LIFR (ceiling below 200 ft and/or visibility below 1/2 sm). Shares the LIFR map color where renderers do not split it out.',
  }),
});

/** Cloud-cover codes that define a ceiling (broken, overcast, vertical visibility). */
export const FLIGHT_CATEGORY_CEILING_COVERAGES = Object.freeze(['BKN', 'OVC', 'VV']);

/** Cloud-cover codes that never define a ceiling (few, scattered, clear, no significant cloud, no cloud detected). */
export const FLIGHT_CATEGORY_NON_CEILING_COVERAGES = Object.freeze([
  'FEW',
  'SCT',
  'CLR',
  'SKC',
  'NSC',
  'NCD',
]);

function assertNonNegativeFinite(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${String(value)}`);
  }
  if (value < 0) {
    throw new RangeError(`${name} must be >= 0, got ${value}`);
  }
}

function assertFlightCategory(code) {
  if (code !== 'VFR' && code !== 'MVFR' && code !== 'IFR' && code !== 'LIFR' && code !== 'VLIFR') {
    throw new TypeError(`unknown flight category: ${String(code)}`);
  }
}

/**
 * Classify a ceiling alone. `null` / `undefined` means no ceiling
 * (clear, few, or scattered only) and counts as VFR on this dimension.
 *
 * @param {number|null|undefined} ceilingFt ceiling in feet AGL.
 * @returns {'VFR'|'MVFR'|'IFR'|'LIFR'} the ceiling-only category.
 */
export function ceilingCategory(ceilingFt) {
  if (ceilingFt === null || ceilingFt === undefined) {
    return 'VFR';
  }
  assertNonNegativeFinite('ceilingFt', ceilingFt);
  if (ceilingFt < IFR_CEILING_FT) {
    return 'LIFR';
  }
  if (ceilingFt < MVFR_CEILING_FT) {
    return 'IFR';
  }
  if (ceilingFt <= VFR_CEILING_FT) {
    return 'MVFR';
  }
  return 'VFR';
}

/**
 * Classify prevailing visibility alone, in statute miles.
 *
 * @param {number} visibilitySm prevailing visibility in statute miles.
 * @returns {'VFR'|'MVFR'|'IFR'|'LIFR'} the visibility-only category.
 */
export function visibilityCategory(visibilitySm) {
  assertNonNegativeFinite('visibilitySm', visibilitySm);
  if (visibilitySm < IFR_VISIBILITY_SM) {
    return 'LIFR';
  }
  if (visibilitySm < MVFR_VISIBILITY_SM) {
    return 'IFR';
  }
  if (visibilitySm <= VFR_VISIBILITY_SM) {
    return 'MVFR';
  }
  return 'VFR';
}

/**
 * The worse of two flight categories (best-to-worst order
 * VFR < MVFR < IFR < LIFR < VLIFR).
 *
 * @param {string} a first category code.
 * @param {string} b second category code.
 * @returns {string} the worse category.
 */
export function worseFlightCategory(a, b) {
  assertFlightCategory(a);
  assertFlightCategory(b);
  const order = ['VFR', 'MVFR', 'IFR', 'LIFR', 'VLIFR'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/**
 * Classify airport weather from ceiling + visibility. The result is
 * the worse of the two dimensions (OR rule).
 *
 * @param {{ceilingFt?: number|null, visibilitySm: number}} input
 *   ceiling in feet AGL (null/omitted = no ceiling) and prevailing
 *   visibility in statute miles.
 * @returns {'VFR'|'MVFR'|'IFR'|'LIFR'} the flight category.
 */
export function flightCategory(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('flightCategory input must be an object');
  }
  const { ceilingFt = null, visibilitySm } = input;
  return worseFlightCategory(ceilingCategory(ceilingFt), visibilityCategory(visibilitySm));
}

/**
 * Like `flightCategory`, but splits the worst end of LIFR into the
 * NWS VLIFR refinement (ceiling below 200 ft and/or visibility
 * below 1/2 sm).
 *
 * @param {{ceilingFt?: number|null, visibilitySm: number}} input
 *   ceiling in feet AGL (null/omitted = no ceiling) and prevailing
 *   visibility in statute miles.
 * @returns {'VFR'|'MVFR'|'IFR'|'LIFR'|'VLIFR'} the detailed category.
 */
export function flightCategoryDetailed(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('flightCategoryDetailed input must be an object');
  }
  const { ceilingFt = null, visibilitySm } = input;
  if (ceilingFt !== null && ceilingFt !== undefined) {
    assertNonNegativeFinite('ceilingFt', ceilingFt);
  }
  assertNonNegativeFinite('visibilitySm', visibilitySm);
  const ceilingIsVlifr = ceilingFt !== null && ceilingFt !== undefined && ceilingFt < VLIFR_CEILING_FT;
  const visibilityIsVlifr = visibilitySm < VLIFR_VISIBILITY_SM;
  if (ceilingIsVlifr || visibilityIsVlifr) {
    return 'VLIFR';
  }
  return flightCategory(input);
}

/**
 * Derive a METAR ceiling from cloud layers: the base of the lowest
 * broken, overcast, or vertical-visibility (VV) layer. FEW / SCT /
 * clear layers never define a ceiling. Returns null when no layer
 * defines one.
 *
 * @param {Array<{coverage: string, baseFt?: number}>} layers cloud layers
 *   with a METAR coverage code and (for ceiling layers) a base in feet AGL.
 * @returns {number|null} the ceiling in feet AGL, or null when there is none.
 */
export function ceilingFromCloudLayers(layers) {
  if (!Array.isArray(layers)) {
    throw new TypeError('layers must be an array');
  }
  let ceiling = null;
  for (const layer of layers) {
    if (layer === null || typeof layer !== 'object') {
      throw new TypeError('each cloud layer must be an object');
    }
    const { coverage, baseFt } = layer;
    if (typeof coverage !== 'string') {
      throw new TypeError('each cloud layer needs a string coverage code');
    }
    if (FLIGHT_CATEGORY_CEILING_COVERAGES.includes(coverage)) {
      assertNonNegativeFinite('baseFt', baseFt);
      ceiling = ceiling === null ? baseFt : Math.min(ceiling, baseFt);
    } else if (FLIGHT_CATEGORY_NON_CEILING_COVERAGES.includes(coverage)) {
      continue;
    } else {
      throw new TypeError(`unknown cloud coverage code: ${coverage}`);
    }
  }
  return ceiling;
}
