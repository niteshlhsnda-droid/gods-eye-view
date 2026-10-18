/**
 * Shared unit conversions: length (m <-> ft, km <-> mi), speed
 * (knots <-> km/h <-> m/s), temperature (degC <-> degF), and pressure
 * (hPa <-> inHg).
 *
 * Display code across layers currently re-derives these factors inline
 * (e.g. `* 3.28084`, `/ 1.609`, `* 1.852`, `* 33.86`) with inconsistent
 * precision — a 5-decimal foot factor is off by ~1.5 mm per 100 m, and a
 * 2-decimal inHg factor is off by ~0.04 inHg at standard pressure. This
 * module is the one canonical, dependency-free implementation.
 *
 * Canonical factors (exact unless noted):
 * - 1 ft = 0.3048 m EXACTLY (international foot, 1959 agreement).
 * - 1 mi = 1609.344 m EXACTLY (5280 ft x 0.3048 m).
 * - 1 nmi = 1852 m EXACTLY, so 1 kt = 1.852 km/h EXACTLY and
 *   1 kt = 1852 / 3600 m/s. The m/s factor is a REPEATING decimal
 *   (0.514444...), so it is stored as the ratio `1852 / 3600`, never as
 *   a truncated literal such as 0.5144.
 * - degC <-> degF is the exact affine map F = C x 9/5 + 32.
 * - 1 inHg = 33.8638866667 hPa (derived: mercury density
 *   13595.1 kg/m^3 x standard gravity 9.80665 m/s^2 x 0.0254 m =
 *   3386.38866667 Pa). Stored as `3386.38866667 / 100` so the
 *   derivation stays visible; it is not an exact definition the way the
 *   foot/mile/knot factors are.
 *
 * Precision / rounding contract:
 * - Converters return FULL double precision. They NEVER round, truncate,
 *   or format: `metersToFeet(1)` returns 3.280839895013123, not 3.28.
 *   Display rounding (decimals, significant figures, locale) is the
 *   CALLER's job, because the right rounding depends on the display
 *   context (a readout vs. a label vs. a stored value) and rounding
 *   inside a converter would silently corrupt chained conversions.
 * - Each inverse pair is defined through the SAME constant (one direction
 *   multiplies, the other divides), so round-trips are as close as
 *   floating-point allows instead of drifting by two independent
 *   approximations.
 *
 * Input contract (same convention as `geoProjection`):
 * - Every function returns `null` for non-finite or non-number input
 *   instead of throwing or returning NaN.
 * - Negative length/speed values are ACCEPTED and sign-preserved: the
 *   converters are pure linear/affine maps, and deltas (e.g. an altitude
 *   change of -50 m) are legitimate inputs. Only non-finite input is
 *   rejected.
 *
 * Pure: no DOM, no imports. All inputs/outputs are plain numbers.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in this
 * commit — migration is a separate, per-group change (adding this file to
 * every boundary group that owns an importing module), like the prior
 * idea-cycle modules.
 *
 * @module data/unitMath
 */

/** Metres in one international foot (exact). */
export const METERS_PER_FOOT = 0.3048;
/** Metres in one international (statute) mile (exact). */
export const METERS_PER_MILE = 1609.344;
/** Kilometres in one international (statute) mile (exact). */
export const KILOMETERS_PER_MILE = 1.609344;
/** Kilometres per hour in one knot (exact). */
export const KNOT_TO_KMH = 1.852;
/** Metres per second in one knot (exact ratio 1852 / 3600). */
export const KNOT_TO_MS = 1852 / 3600;
/** Hectopascals in one inch of mercury (derived, see header). */
export const INHG_TO_HPA = 3386.38866667 / 100;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function convert(value, fn) {
  if (!isFiniteNumber(value)) return null;
  return fn(value);
}

/**
 * Metres to feet.
 * @param {number} meters Length in metres.
 * @returns {number|null} Length in feet, or null for invalid input.
 */
export function metersToFeet(meters) {
  return convert(meters, (value) => value / METERS_PER_FOOT);
}

/**
 * Feet to metres.
 * @param {number} feet Length in feet.
 * @returns {number|null} Length in metres, or null for invalid input.
 */
export function feetToMeters(feet) {
  return convert(feet, (value) => value * METERS_PER_FOOT);
}

/**
 * Kilometres to statute miles.
 * @param {number} kilometers Length in kilometres.
 * @returns {number|null} Length in miles, or null for invalid input.
 */
export function kilometersToMiles(kilometers) {
  return convert(kilometers, (value) => value / KILOMETERS_PER_MILE);
}

/**
 * Statute miles to kilometres.
 * @param {number} miles Length in miles.
 * @returns {number|null} Length in kilometres, or null for invalid input.
 */
export function milesToKilometers(miles) {
  return convert(miles, (value) => value * KILOMETERS_PER_MILE);
}

/**
 * Knots to kilometres per hour.
 * @param {number} knots Speed in knots.
 * @returns {number|null} Speed in km/h, or null for invalid input.
 */
export function knotsToKmh(knots) {
  return convert(knots, (value) => value * KNOT_TO_KMH);
}

/**
 * Kilometres per hour to knots.
 * @param {number} kmh Speed in km/h.
 * @returns {number|null} Speed in knots, or null for invalid input.
 */
export function kmhToKnots(kmh) {
  return convert(kmh, (value) => value / KNOT_TO_KMH);
}

/**
 * Knots to metres per second.
 * @param {number} knots Speed in knots.
 * @returns {number|null} Speed in m/s, or null for invalid input.
 */
export function knotsToMs(knots) {
  return convert(knots, (value) => value * KNOT_TO_MS);
}

/**
 * Metres per second to knots.
 * @param {number} ms Speed in m/s.
 * @returns {number|null} Speed in knots, or null for invalid input.
 */
export function msToKnots(ms) {
  return convert(ms, (value) => value / KNOT_TO_MS);
}

/**
 * Kilometres per hour to metres per second.
 * @param {number} kmh Speed in km/h.
 * @returns {number|null} Speed in m/s, or null for invalid input.
 */
export function kmhToMs(kmh) {
  return convert(kmh, (value) => value / 3.6);
}

/**
 * Metres per second to kilometres per hour.
 * @param {number} ms Speed in m/s.
 * @returns {number|null} Speed in km/h, or null for invalid input.
 */
export function msToKmh(ms) {
  return convert(ms, (value) => value * 3.6);
}

/**
 * Degrees Celsius to degrees Fahrenheit.
 * @param {number} celsius Temperature in degrees Celsius.
 * @returns {number|null} Temperature in degrees Fahrenheit, or null for
 *   invalid input.
 */
export function celsiusToFahrenheit(celsius) {
  return convert(celsius, (value) => (value * 9) / 5 + 32);
}

/**
 * Degrees Fahrenheit to degrees Celsius.
 * @param {number} fahrenheit Temperature in degrees Fahrenheit.
 * @returns {number|null} Temperature in degrees Celsius, or null for
 *   invalid input.
 */
export function fahrenheitToCelsius(fahrenheit) {
  return convert(fahrenheit, (value) => ((value - 32) * 5) / 9);
}

/**
 * Hectopascals to inches of mercury.
 * @param {number} hpa Pressure in hectopascals.
 * @returns {number|null} Pressure in inHg, or null for invalid input.
 */
export function hpaToInHg(hpa) {
  return convert(hpa, (value) => value / INHG_TO_HPA);
}

/**
 * Inches of mercury to hectopascals.
 * @param {number} inHg Pressure in inches of mercury.
 * @returns {number|null} Pressure in hectopascals, or null for invalid
 *   input.
 */
export function inHgToHpa(inHg) {
  return convert(inHg, (value) => value * INHG_TO_HPA);
}
