/**
 * Feels-like temperatures: heat index, wind chill, and dew point from
 * air temperature, relative humidity, and wind speed.
 *
 * Why a new module: the globe shows raw temperature, but what a person
 * actually feels outdoors is the apparent temperature. A 100 °F day at
 * 55% humidity feels like 124 °F, and a 20 °F day in a 20 mph wind
 * feels like 4 °F. Cards, legends, and voice readouts can share these
 * three calculators instead of each re-deriving them.
 *
 * All three formulas are defined in Fahrenheit by their sources, so
 * the primary entry points take °F (and mph for wind). Celsius /
 * km/h wrappers convert, compute in the source units, and convert
 * back, so a value is identical whichever unit it arrived in.
 *
 * Sources (all fetched and verified 2026-10-17):
 * - NOAA Weather Prediction Center, "Heat Index Equation",
 *   http://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
 *   (Rothfusz regression, low/high-humidity adjustments, and the
 *   simple-formula-first procedure).
 * - National Weather Service, "What is the heat index?",
 *   https://www.weather.gov/ama/heatindex
 *   (heat-index danger categories and body effects; the 100 °F /
 *   55% -> 124 °F and 100 °F / 15% -> 96 °F chart anchors).
 * - National Weather Service, "Wind Chill Questions",
 *   https://www.weather.gov/safety/cold-faqs
 *   (2001 NWS wind-chill formula; defined only at or below 50 °F
 *   and wind speeds above 3 mph).
 * - National Weather Service, "Wind Chill" chart,
 *   https://www.weather.gov/arx/wind_chill
 *   (chart anchors: 20 °F at 20 mph feels like 4 °F, 0 °F at
 *   10 mph feels like -16 °F).
 * - Alduchov, O. A. & Eskridge, R. E. (1996), "Improved Magnus form
 *   approximation of saturation vapor pressure", Journal of Applied
 *   Meteorology 35, 601-609 (dew-point constants a = 17.625,
 *   b = 243.04 °C; agrees with the 17.27 / 237.7 and 17.67 / 243.5
 *   Magnus variants to within 0.02 °C on the tested anchors).
 *
 * Scope notes:
 * - Heat index assumes shade and light wind; full sun can add up to
 *   15 °F (NWS). Wind chill assumes nighttime / no solar heating;
 *   bright sunshine can raise it by 10-18 °F (NWS).
 * - The Rothfusz regression is not valid far outside the temperature
 *   / humidity range Steadman fitted it on (NWS); this module still
 *   returns the computed value there rather than refusing, and
 *   callers should not present extreme extrapolations as measured.
 * - Dew point uses the over-water Magnus form. Below 0 °C the
 *   physical quantity is the frost point (over ice, different
 *   constants); the returned value is still the over-water dew
 *   point, which is the number weather reports quote.
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/feelsLike
 */

/** Air temperature at or below which wind chill is defined (°F). */
export const WIND_CHILL_MAX_TEMP_F = 50;

/** Wind speed above which wind chill is defined (mph). */
export const WIND_CHILL_MIN_WIND_MPH = 3;

/** Magnus coefficient a (dimensionless) for saturation vapour pressure. */
export const DEW_POINT_MAGNUS_A = 17.625;

/** Magnus coefficient b (°C) for saturation vapour pressure. */
export const DEW_POINT_MAGNUS_B_C = 243.04;

/**
 * The four NWS heat-index danger bands. `maxF` is null for Extreme
 * Danger: the scale is open-ended above 125 °F. Bands are half-open
 * [minF, maxF). `effect` is the NWS body-effect text.
 */
export const HEAT_INDEX_CATEGORIES = Object.freeze([
  Object.freeze({
    name: 'Caution',
    minF: 80,
    maxF: 90,
    effect: 'Fatigue possible with prolonged exposure and/or physical activity',
  }),
  Object.freeze({
    name: 'Extreme Caution',
    minF: 90,
    maxF: 103,
    effect:
      'Heat stroke, heat cramps, or heat exhaustion possible with prolonged exposure and/or physical activity',
  }),
  Object.freeze({
    name: 'Danger',
    minF: 103,
    maxF: 125,
    effect:
      'Heat cramps or heat exhaustion likely, and heat stroke possible with prolonged exposure and/or physical activity',
  }),
  Object.freeze({
    name: 'Extreme Danger',
    minF: 125,
    maxF: null,
    effect: 'Heat stroke highly likely',
  }),
]);

/** Category returned for heat-index values below 80 °F. */
export const BELOW_CAUTION = Object.freeze({
  name: 'Below Caution',
  minF: null,
  maxF: 80,
  effect: 'No NWS heat-caution level is assigned below 80 °F',
});

/**
 * Validate a finite number input.
 * @param {number} value - the value to validate.
 * @param {string} label - input label for the error message.
 */
function checkFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

/**
 * Validate relative humidity in percent.
 * @param {number} humidityPct - relative humidity (0-100).
 */
function checkHumidity(humidityPct) {
  checkFinite(humidityPct, 'relative humidity');
  if (humidityPct < 0 || humidityPct > 100) {
    throw new RangeError('relative humidity must be in [0, 100]');
  }
}

/**
 * Heat index (apparent temperature) in °F from air temperature and
 * relative humidity, following the NWS / WPC procedure: compute the
 * simple formula first and average it with the temperature; if that
 * average is 80 °F or higher, use the full Rothfusz regression plus
 * the low- / high-humidity adjustments. At low humidity the apparent
 * temperature can come out below the air temperature.
 * @param {number} tempF - air temperature in °F.
 * @param {number} humidityPct - relative humidity in percent (0-100).
 * @returns {number} heat index in °F.
 */
export function heatIndexF(tempF, humidityPct) {
  checkFinite(tempF, 'temperature');
  checkHumidity(humidityPct);
  const simple =
    0.5 * (tempF + 61.0 + (tempF - 68.0) * 1.2 + humidityPct * 0.094);
  if ((simple + tempF) / 2 < 80) {
    return simple;
  }
  let heatIndex =
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * humidityPct -
    0.22475541 * tempF * humidityPct -
    0.00683783 * tempF * tempF -
    0.05481717 * humidityPct * humidityPct +
    0.00122874 * tempF * tempF * humidityPct +
    0.00085282 * tempF * humidityPct * humidityPct -
    0.00000199 * tempF * tempF * humidityPct * humidityPct;
  if (humidityPct < 13 && tempF >= 80 && tempF <= 112) {
    heatIndex -=
      ((13 - humidityPct) / 4) * Math.sqrt((17 - Math.abs(tempF - 95.0)) / 17);
  } else if (humidityPct > 85 && tempF >= 80 && tempF <= 87) {
    heatIndex += ((humidityPct - 85) / 10) * ((87 - tempF) / 5);
  }
  return heatIndex;
}

/**
 * Heat index in °C from air temperature in °C and relative humidity.
 * @param {number} tempC - air temperature in °C.
 * @param {number} humidityPct - relative humidity in percent (0-100).
 * @returns {number} heat index in °C.
 */
export function heatIndexC(tempC, humidityPct) {
  checkFinite(tempC, 'temperature');
  const tempF = (tempC * 9) / 5 + 32;
  return ((heatIndexF(tempF, humidityPct) - 32) * 5) / 9;
}

/**
 * Wind chill in °F from air temperature and wind speed, using the
 * 2001 NWS / Environment Canada formula. Defined only at or below
 * 50 °F and wind speeds above 3 mph; anything else throws.
 * @param {number} tempF - air temperature in °F (<= 50).
 * @param {number} windMph - wind speed in mph (> 3).
 * @returns {number} wind chill in °F.
 */
export function windChillF(tempF, windMph) {
  checkFinite(tempF, 'temperature');
  checkFinite(windMph, 'wind speed');
  if (windMph < 0) {
    throw new RangeError('wind speed cannot be negative');
  }
  if (tempF > WIND_CHILL_MAX_TEMP_F || windMph <= WIND_CHILL_MIN_WIND_MPH) {
    throw new RangeError(
      `wind chill is only defined at or below ${WIND_CHILL_MAX_TEMP_F} °F ` +
        `and wind speeds above ${WIND_CHILL_MIN_WIND_MPH} mph`,
    );
  }
  const windFactor = Math.pow(windMph, 0.16);
  return (
    35.74 + 0.6215 * tempF - 35.75 * windFactor + 0.4275 * tempF * windFactor
  );
}

/**
 * Wind chill in °C from air temperature in °C and wind speed in km/h.
 * @param {number} tempC - air temperature in °C (<= 10).
 * @param {number} windKmh - wind speed in km/h (> 4.83).
 * @returns {number} wind chill in °C.
 */
export function windChillC(tempC, windKmh) {
  checkFinite(tempC, 'temperature');
  checkFinite(windKmh, 'wind speed');
  const tempF = (tempC * 9) / 5 + 32;
  const windMph = windKmh / 1.609344;
  return ((windChillF(tempF, windMph) - 32) * 5) / 9;
}

/**
 * Dew point in °C from air temperature and relative humidity, using
 * the improved Magnus form (Alduchov & Eskridge 1996). At 100%
 * humidity the dew point equals the air temperature.
 * @param {number} tempC - air temperature in °C.
 * @param {number} humidityPct - relative humidity in percent (0-100].
 * @returns {number} dew point in °C.
 */
export function dewPointC(tempC, humidityPct) {
  checkFinite(tempC, 'temperature');
  checkFinite(humidityPct, 'relative humidity');
  if (humidityPct <= 0 || humidityPct > 100) {
    throw new RangeError('relative humidity must be in (0, 100]');
  }
  if (tempC <= -DEW_POINT_MAGNUS_B_C) {
    throw new RangeError('temperature is at or below the Magnus singularity');
  }
  const gamma =
    Math.log(humidityPct / 100) +
    (DEW_POINT_MAGNUS_A * tempC) / (DEW_POINT_MAGNUS_B_C + tempC);
  return (DEW_POINT_MAGNUS_B_C * gamma) / (DEW_POINT_MAGNUS_A - gamma);
}

/**
 * Dew point in °F from air temperature in °F and relative humidity.
 * @param {number} tempF - air temperature in °F.
 * @param {number} humidityPct - relative humidity in percent (0-100].
 * @returns {number} dew point in °F.
 */
export function dewPointF(tempF, humidityPct) {
  checkFinite(tempF, 'temperature');
  const tempC = ((tempF - 32) * 5) / 9;
  return (dewPointC(tempC, humidityPct) * 9) / 5 + 32;
}

/**
 * NWS danger category for a heat-index value. Below 80 °F returns
 * the frozen `BELOW_CAUTION` entry; at or above 80 °F returns the
 * frozen `HEAT_INDEX_CATEGORIES` entry. Bands are half-open
 * [minF, maxF): a value exactly on a boundary takes the higher band.
 * @param {number} heatIndex - heat index in °F.
 * @returns {object} the frozen category entry.
 */
export function heatIndexCategory(heatIndex) {
  checkFinite(heatIndex, 'heat index');
  if (heatIndex < 80) {
    return BELOW_CAUTION;
  }
  for (const entry of HEAT_INDEX_CATEGORIES) {
    if (entry.maxF === null || heatIndex < entry.maxF) {
      return entry;
    }
  }
  // Unreachable: Extreme Danger has no upper bound, but keep the
  // exhaustiveness explicit rather than returning undefined.
  return HEAT_INDEX_CATEGORIES[HEAT_INDEX_CATEGORIES.length - 1];
}

/**
 * Feels-like temperature in °F for one set of conditions. Picks the
 * index the NWS would publish: heat index at or above 80 °F (when
 * humidity is known), wind chill at or below 50 °F with wind above
 * 3 mph, otherwise the air temperature itself.
 * @param {object} conditions - `{ tempF, humidityPct?, windMph? }`.
 * @param {number} conditions.tempF - air temperature in °F.
 * @param {number} [conditions.humidityPct] - relative humidity (0-100).
 * @param {number} [conditions.windMph] - wind speed in mph (>= 0).
 * @returns {{ valueF: number, method: string }} frozen result, where
 * `method` is 'heat-index', 'wind-chill', or 'air-temperature'.
 */
export function feelsLikeF({ tempF, humidityPct, windMph } = {}) {
  checkFinite(tempF, 'temperature');
  if (humidityPct !== undefined) {
    checkHumidity(humidityPct);
  }
  if (windMph !== undefined) {
    checkFinite(windMph, 'wind speed');
    if (windMph < 0) {
      throw new RangeError('wind speed cannot be negative');
    }
  }
  if (tempF >= 80 && humidityPct !== undefined) {
    return Object.freeze({
      valueF: heatIndexF(tempF, humidityPct),
      method: 'heat-index',
    });
  }
  if (
    tempF <= WIND_CHILL_MAX_TEMP_F &&
    windMph !== undefined &&
    windMph > WIND_CHILL_MIN_WIND_MPH
  ) {
    return Object.freeze({
      valueF: windChillF(tempF, windMph),
      method: 'wind-chill',
    });
  }
  return Object.freeze({ valueF: tempF, method: 'air-temperature' });
}
