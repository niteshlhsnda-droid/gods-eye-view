/**
 * Shared humidity math: saturation vapour pressure (Magnus formula),
 * dew point / frost point, relative humidity, absolute humidity,
 * vapour-pressure deficit, Stull wet-bulb temperature, and humidex.
 *
 * Non-overlap with the prior shared-math modules:
 * - `unitMath.js` owns bare unit conversions (degC <-> degF, hPa <->
 *   inHg). This module owns HUMIDITY PHYSICS: no unit conversion
 *   functions live here — temperatures are always degrees Celsius and
 *   pressures always hectopascals.
 * - `windMath.js` owns wind direction/components/Beaufort; it has no
 *   moisture quantities.
 * - `statsMath.js` / `interpMath.js` / `vectorMath.js` /
 *   `signalMath.js` / `colorMath.js` / `dateMath.js` / `timeMath.js` /
 *   `geoMath.js` / `angleMath.js` own no humidity quantities.
 * - Pressure-dependent moisture quantities (specific humidity, mixing
 *   ratio) are intentionally OUT of scope: they need an ambient
 *   pressure input and belong with a future pressure/atmosphere module.
 *
 * Canonical semantics (standalone — no call sites re-pointed):
 * - Pure: no DOM, no Cesium, no imports. All inputs/outputs are plain
 *   numbers.
 * - Error values: `null` on invalid input — never a throw, never `NaN`.
 * - Relative humidity (RH) is a percentage in `[0, 100]` and is defined
 *   relative to saturation over LIQUID WATER — the common SYNOP/METAR
 *   reporting convention, which keeps `dewPointFromTempRh` consistent
 *   with the dew points weather feeds report even below freezing.
 *   `saturationVapourPressureHpa(tempC, 'ice')` is provided separately
 *   for saturation over an ice surface, and `frostPointFromTempRh`
 *   inverts the ice formula.
 * - Magnus coefficients are the Alduchov–Eskridge (Buck) values:
 *   over water `es = 6.112 * exp(17.67*T / (T + 243.5))`, valid
 *   `-45..60` °C; over ice `es = 6.112 * exp(22.46*T / (T + 272.62))`,
 *   valid `-80..0` °C. Inputs outside the applicable range return
 *   `null` rather than an extrapolated value.
 * - Dew point inverts the water Magnus formula; frost point inverts the
 *   ice formula. Below freezing the frost point sits ABOVE the dew
 *   point (e.g. at -10 °C / 50% RH, dew point ≈ -18.5 °C but frost
 *   point ≈ -16.5 °C) — that ordering is correct physics, not a bug.
 * - Absolute humidity uses `AH = 216.7 * e / (T + 273.15)` g/m³ with
 *   `e` in hPa (ideal-gas form, standard meteorological formula).
 * - Wet bulb uses the Stull (2011) approximation, valid for
 *   `-20..50` °C and `5..99`% RH; inputs outside that box return
 *   `null`. It is an approximation (±~1 °C worst case at the box
 *   edges), not a psychrometric-chart solution.
 * - Humidex is the Canadian `H = T + 0.5555 * (e - 10)` index with `e`
 *   in hPa. It is meaningful for warm conditions; the formula itself is
 *   applied for any in-range input and callers decide when to display it.
 * - Converters return FULL double precision, never rounded: display
 *   rounding is the caller's job.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in this
 * commit — migration is a separate, per-group change, like the prior
 * idea-cycle modules.
 *
 * @module data/humidityMath
 */

/** Saturation vapour pressure at 0 °C, hPa (Magnus constant). */
const MAGNUS_A_HPA = 6.112;
/** Magnus numerator coefficient over liquid water. */
const MAGNUS_B_WATER = 17.67;
/** Magnus denominator offset over liquid water, °C. */
const MAGNUS_C_WATER = 243.5;
/** Magnus numerator coefficient over ice. */
const MAGNUS_B_ICE = 22.46;
/** Magnus denominator offset over ice, °C. */
const MAGNUS_C_ICE = 272.62;
/** Valid temperature range for the water Magnus formula, °C. */
const WATER_MIN_C = -45;
const WATER_MAX_C = 60;
/** Valid temperature range for the ice Magnus formula, °C. */
const ICE_MIN_C = -80;
const ICE_MAX_C = 0;
/** Valid temperature range for the Stull wet-bulb formula, °C. */
const STULL_MIN_C = -20;
const STULL_MAX_C = 50;
/** Valid RH range for the Stull wet-bulb formula, percent. */
const STULL_MIN_RH = 5;
const STULL_MAX_RH = 99;
/** Absolute-humidity constant: 216.7 g·K / (m³·hPa). */
const ABSOLUTE_HUMIDITY_CONSTANT = 216.7;
/** Kelvin offset for 0 °C. */
const KELVIN_OFFSET = 273.15;
/** Humidex vapour-pressure coefficient and reference pressure, hPa. */
const HUMIDEX_COEFFICIENT = 0.5555;
const HUMIDEX_REFERENCE_HPA = 10;

/**
 * True when `value` is a finite number.
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * True when `tempC` is a finite number inside the water Magnus range.
 * @param {number} tempC
 * @returns {boolean}
 */
function isWaterRange(tempC) {
  return tempC >= WATER_MIN_C && tempC <= WATER_MAX_C;
}

/**
 * True when `rhPercent` is a finite number in `[0, 100]`.
 * @param {number} rhPercent
 * @returns {boolean}
 */
function isRhRange(rhPercent) {
  return rhPercent >= 0 && rhPercent <= 100;
}

/**
 * Saturation vapour pressure at `tempC`.
 * @param {number} tempC Air temperature in degrees Celsius.
 * @param {'water'|'ice'} [surface] Saturation surface; default `'water'`.
 * @returns {number|null} Saturation vapour pressure in hPa, or `null`
 *   for invalid input, an unknown surface, or a temperature outside the
 *   applicable Magnus range.
 */
export function saturationVapourPressureHpa(tempC, surface = 'water') {
  if (!isFiniteNumber(tempC)) return null;
  if (surface === 'water') {
    if (!isWaterRange(tempC)) return null;
    return (
      MAGNUS_A_HPA *
      Math.exp((MAGNUS_B_WATER * tempC) / (tempC + MAGNUS_C_WATER))
    );
  }
  if (surface === 'ice') {
    if (tempC < ICE_MIN_C || tempC > ICE_MAX_C) return null;
    return (
      MAGNUS_A_HPA * Math.exp((MAGNUS_B_ICE * tempC) / (tempC + MAGNUS_C_ICE))
    );
  }
  return null;
}

/**
 * Actual vapour pressure from temperature and relative humidity.
 * @param {number} tempC Air temperature in degrees Celsius.
 * @param {number} rhPercent Relative humidity in percent, `[0, 100]`.
 * @returns {number|null} Vapour pressure in hPa, or `null` for invalid
 *   input. `0`% RH gives exactly `0` hPa.
 */
export function vapourPressureHpa(tempC, rhPercent) {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPercent)) return null;
  if (!isWaterRange(tempC) || !isRhRange(rhPercent)) return null;
  const saturation = saturationVapourPressureHpa(tempC, 'water');
  return (saturation * rhPercent) / 100;
}

/**
 * Dew point from temperature and relative humidity (water Magnus).
 * @param {number} tempC Air temperature in degrees Celsius.
 * @param {number} rhPercent Relative humidity in percent, `(0, 100]`.
 * @returns {number|null} Dew point in degrees Celsius, or `null` for
 *   invalid input, `0`% RH (no finite dew point), or out-of-range
 *   temperature. `100`% RH returns exactly `tempC`.
 */
export function dewPointFromTempRh(tempC, rhPercent) {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPercent)) return null;
  if (!isWaterRange(tempC) || rhPercent <= 0 || rhPercent > 100) {
    return null;
  }
  if (rhPercent === 100) return tempC;
  const vapour = vapourPressureHpa(tempC, rhPercent);
  const logRatio = Math.log(vapour / MAGNUS_A_HPA);
  return (MAGNUS_C_WATER * logRatio) / (MAGNUS_B_WATER - logRatio);
}

/**
 * Relative humidity from temperature and dew point (water Magnus).
 * @param {number} tempC Air temperature in degrees Celsius.
 * @param {number} dewPointC Dew point in degrees Celsius.
 * @returns {number|null} Relative humidity in percent, or `null` for
 *   invalid input, a dew point above the air temperature
 *   (supersaturation — unphysical), or out-of-range temperatures.
 */
export function relativeHumidityFromDewPoint(tempC, dewPointC) {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(dewPointC)) return null;
  if (!isWaterRange(tempC) || !isWaterRange(dewPointC)) return null;
  if (dewPointC > tempC) return null;
  const saturation = saturationVapourPressureHpa(tempC, 'water');
  const vapour = saturationVapourPressureHpa(dewPointC, 'water');
  return (vapour / saturation) * 100;
}

/**
 * Frost point from temperature and relative humidity (ice Magnus).
 * The temperature at which frost forms on an ice surface at the current
 * vapour pressure. Below freezing this sits above the dew point.
 * @param {number} tempC Air temperature in degrees Celsius.
 * @param {number} rhPercent Relative humidity in percent, `(0, 100]`.
 * @returns {number|null} Frost point in degrees Celsius, or `null` for
 *   invalid input, `0`% RH, out-of-range temperature, or a vapour
 *   pressure whose ice-formula frost point would be above freezing
 *   (frost point is only defined below 0 °C).
 */
export function frostPointFromTempRh(tempC, rhPercent) {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPercent)) return null;
  if (!isWaterRange(tempC) || rhPercent <= 0 || rhPercent > 100) {
    return null;
  }
  const vapour = vapourPressureHpa(tempC, rhPercent);
  if (vapour >= MAGNUS_A_HPA) return null;
  const logRatio = Math.log(vapour / MAGNUS_A_HPA);
  return (MAGNUS_C_ICE * logRatio) / (MAGNUS_B_ICE - logRatio);
}

/**
 * Absolute humidity (mass of water vapour per cubic metre of air).
 * @param {number} tempC Air temperature in degrees Celsius.
 * @param {number} rhPercent Relative humidity in percent, `[0, 100]`.
 * @returns {number|null} Absolute humidity in g/m³, or `null` for
 *   invalid input. `0`% RH gives exactly `0` g/m³.
 */
export function absoluteHumidityGm3(tempC, rhPercent) {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPercent)) return null;
  if (!isWaterRange(tempC) || !isRhRange(rhPercent)) return null;
  const vapour = vapourPressureHpa(tempC, rhPercent);
  return (ABSOLUTE_HUMIDITY_CONSTANT * vapour) / (tempC + KELVIN_OFFSET);
}

/**
 * Vapour-pressure deficit: saturation minus actual vapour pressure.
 * @param {number} tempC Air temperature in degrees Celsius.
 * @param {number} rhPercent Relative humidity in percent, `[0, 100]`.
 * @returns {number|null} VPD in hPa, or `null` for invalid input.
 *   `100`% RH gives `0` hPa (saturated air).
 */
export function vapourPressureDeficitHpa(tempC, rhPercent) {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPercent)) return null;
  if (!isWaterRange(tempC) || !isRhRange(rhPercent)) return null;
  const saturation = saturationVapourPressureHpa(tempC, 'water');
  const vapour = vapourPressureHpa(tempC, rhPercent);
  return saturation - vapour;
}

/**
 * Wet-bulb temperature via the Stull (2011) approximation.
 * @param {number} tempC Air temperature in degrees Celsius, `-20..50`.
 * @param {number} rhPercent Relative humidity in percent, `5..99`.
 * @returns {number|null} Wet-bulb temperature in degrees Celsius, or
 *   `null` for invalid input or input outside the Stull validity box.
 */
export function wetBulbCelsiusStull(tempC, rhPercent) {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPercent)) return null;
  if (tempC < STULL_MIN_C || tempC > STULL_MAX_C) return null;
  if (rhPercent < STULL_MIN_RH || rhPercent > STULL_MAX_RH) return null;
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rhPercent + 8.313659)) +
    Math.atan(tempC + rhPercent) -
    Math.atan(rhPercent - 1.676331) +
    0.00391838 * rhPercent ** 1.5 * Math.atan(0.023101 * rhPercent) -
    4.686035
  );
}

/**
 * Humidex (Canadian perceived-temperature index).
 * @param {number} tempC Air temperature in degrees Celsius.
 * @param {number} rhPercent Relative humidity in percent, `[0, 100]`.
 * @returns {number|null} Humidex value (same numeric scale as °C), or
 *   `null` for invalid input.
 */
export function humidex(tempC, rhPercent) {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPercent)) return null;
  if (!isWaterRange(tempC) || !isRhRange(rhPercent)) return null;
  const vapour = vapourPressureHpa(tempC, rhPercent);
  return tempC + HUMIDEX_COEFFICIENT * (vapour - HUMIDEX_REFERENCE_HPA);
}
