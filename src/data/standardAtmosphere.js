/**
 * ICAO Standard Atmosphere (ISA): temperature, pressure, density, and
 * speed of sound versus altitude, plus the pressure-altitude and
 * density-altitude corrections pilots and performance tables use.
 *
 * Why a new module: GEV renders aircraft, drone, and camera altitudes
 * and reads METAR-style station data, but nothing in the repo converts
 * between the altitude systems that data actually arrives in. An
 * altimeter set to QNH reads indicated altitude; performance charts
 * want pressure altitude; a hot day at a high airfield wants density
 * altitude. This module is the one shared, sourced conversion between
 * those systems, so HUD readouts, analyst text, and voice answers all
 * agree instead of each embedding its own approximation.
 *
 * Model: the ISA troposphere + lower stratosphere, in geopotential
 * altitude, exactly as tabulated in ISO 2533 / ICAO Doc 7488:
 * - 0–11,000 m: temperature falls 0.0065 K/m from 288.15 K.
 * - 11,000–20,000 m: isothermal at 216.65 K (tropopause).
 * - 20,000–32,000 m: temperature rises 0.001 K/m to 228.65 K.
 * Pressure follows the hydrostatic equation with the ideal-gas law
 * (power law in lapse layers, exponential in the isothermal layer);
 * density is pressure / (R * T); speed of sound is sqrt(gamma * R * T).
 * Below sea level the troposphere formulas extend to -1000 m, so
 * cold dense air at sea level (whose density altitude is below
 * -500 m) stays in range; the Dead Sea shore at -430 m is the
 * lowest dry land on Earth.
 *
 * Pressure altitude is the altitude in this standard atmosphere at
 * which the pressure equals the station pressure (FAA definition).
 * Density altitude is the altitude in this standard atmosphere at
 * which the density equals the actual air density — i.e. pressure
 * altitude corrected for nonstandard temperature (FAA definition).
 * Both are computed exactly by inverting the ISA relations, not by
 * the cockpit rules of thumb (1000 ft per inHg, 120 ft per degC),
 * which are included only as `densityAltitudeRuleOfThumbM` for
 * cross-checking against the values pilots expect.
 *
 * Scope notes: dry air only. Humidity makes real air less dense, so
 * on a humid day the true density altitude is slightly higher than
 * this module reports — the FAA notes the same caveat in P-8740-2.
 * Inputs are geopotential altitude, the ISA's own coordinate; use
 * `geopotentialAltitudeM` / `geometricAltitudeM` to convert from the
 * geometric heights Cesium and GPS report (the two differ by at most
 * ~162 m at 32 km). No wind, no weather, no live data.
 *
 * Sources (fetched and verified 2026-10-17):
 * - ISO 2533:1975 / ICAO Doc 7488 Standard Atmosphere, via the
 *   ISA layer table (sea-level 101325 Pa / 288.15 K / 1.225 kg/m3,
 *   tropopause 11000 m / 216.65 K / 22632 Pa, 20000 m / 5474.9 Pa,
 *   32000 m / 228.65 K / 868.02 Pa, R = 287.05287 J/(kg K),
 *   g0 = 9.80665 m/s2, speed of sound at sea level 340.294 m/s).
 * - FAA Density Altitude, FAA-P-8740-2 (2008):
 *   https://www.slideshare.net/slideshow/faa-p-874002-densityaltitudehires-branded/23473397
 *   (pressure altitude = indicated altitude on an altimeter set to
 *   29.92 inHg / 1013 hPa; density altitude = "pressure altitude
 *   corrected for nonstandard temperature variations").
 * - FAA Pilot's Handbook of Aeronautical Knowledge, altitude
 *   definitions (density altitude as the altitude in the standard
 *   atmosphere with the same density as the air in question).
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/standardAtmosphere
 */

/** Standard sea-level pressure, Pa (29.92126 inHg). */
export const SEA_LEVEL_PRESSURE_PA = 101325;

/** Standard sea-level pressure, hPa (1013.25 hPa = 29.92 inHg). */
export const STANDARD_PRESSURE_HPA = 1013.25;

/** Standard sea-level temperature, K (15 degC). */
export const SEA_LEVEL_TEMPERATURE_K = 288.15;

/** Specific gas constant for dry air, J/(kg K). */
export const SPECIFIC_GAS_CONSTANT_DRY_AIR = 287.05287;

/** Standard gravity, m/s^2. */
export const STANDARD_GRAVITY = 9.80665;

/** Ratio of specific heats for air (cp/cv), dimensionless. */
export const RATIO_OF_SPECIFIC_HEATS_AIR = 1.4;

/**
 * Standard sea-level density, kg/m^3, from the ideal-gas law
 * (101325 / (287.05287 * 288.15) = 1.2250), matching the ISA table.
 */
export const SEA_LEVEL_DENSITY_KG_PER_M3 =
  SEA_LEVEL_PRESSURE_PA /
  (SPECIFIC_GAS_CONSTANT_DRY_AIR * SEA_LEVEL_TEMPERATURE_K);

/** Tropopause base: geopotential altitude, m. */
export const TROPOPAUSE_ALTITUDE_M = 11000;

/** Tropopause / lower-stratosphere temperature, K (-56.5 degC). */
export const TROPOPAUSE_TEMPERATURE_K = 216.65;

/** Top of the isothermal lower stratosphere, m. */
export const LOWER_STRATOSPHERE_TOP_M = 20000;

/** Troposphere lapse rate dT/dh, K/m (temperature falls with height). */
export const TROPOSPHERE_LAPSE_RATE_K_PER_M = -0.0065;

/** Upper-stratosphere lapse rate dT/dh, K/m (temperature rises). */
export const UPPER_STRATOSPHERE_LAPSE_RATE_K_PER_M = 0.001;

/** Lowest altitude the model covers, m (below the Dead Sea shore). */
export const MIN_ALTITUDE_M = -1000;

/** Highest altitude the model covers, m (top of the ISA layer table). */
export const MAX_ALTITUDE_M = 32000;

/** Earth radius used by the ISA for geopotential conversion, m. */
export const ISA_EARTH_RADIUS_M = 6356766;

/** Lowest plausible QNH for the pressure-altitude conversion, hPa. */
export const MIN_QNH_HPA = 800;

/** Highest plausible QNH for the pressure-altitude conversion, hPa. */
export const MAX_QNH_HPA = 1100;

/**
 * Pressure at the tropopause, Pa, from the troposphere power law.
 * Matches the ISA table value 22632 Pa.
 */
export const TROPOPAUSE_PRESSURE_PA =
  SEA_LEVEL_PRESSURE_PA *
  (TROPOPAUSE_TEMPERATURE_K / SEA_LEVEL_TEMPERATURE_K) **
    (-STANDARD_GRAVITY /
      (TROPOSPHERE_LAPSE_RATE_K_PER_M * SPECIFIC_GAS_CONSTANT_DRY_AIR));

/** Pressure at 20,000 m, Pa, from the isothermal exponential law. */
export const STRATOSPHERE_20KM_PRESSURE_PA =
  TROPOPAUSE_PRESSURE_PA *
  Math.exp(
    (-STANDARD_GRAVITY * (LOWER_STRATOSPHERE_TOP_M - TROPOPAUSE_ALTITUDE_M)) /
      (SPECIFIC_GAS_CONSTANT_DRY_AIR * TROPOPAUSE_TEMPERATURE_K),
  );

function checkFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function checkAltitude(altitudeM, label = 'altitude') {
  checkFinite(altitudeM, label);
  if (altitudeM < MIN_ALTITUDE_M || altitudeM > MAX_ALTITUDE_M) {
    throw new RangeError(
      `${label} must be in [${MIN_ALTITUDE_M}, ${MAX_ALTITUDE_M}] m`,
    );
  }
  return altitudeM;
}

/**
 * ISA temperature at a geopotential altitude.
 *
 * @param {number} altitudeM geopotential altitude, metres.
 * @returns {number} temperature, kelvin.
 */
export function isaTemperatureK(altitudeM) {
  checkAltitude(altitudeM);
  // Layer boundaries return the defined constants: the lapse
  // arithmetic (288.15 - 0.0065 * 11000) is 216.64999... in binary
  // floating point, not the tabulated 216.65 K.
  if (altitudeM === TROPOPAUSE_ALTITUDE_M) {
    return TROPOPAUSE_TEMPERATURE_K;
  }
  if (altitudeM <= TROPOPAUSE_ALTITUDE_M) {
    return SEA_LEVEL_TEMPERATURE_K + TROPOSPHERE_LAPSE_RATE_K_PER_M * altitudeM;
  }
  if (altitudeM <= LOWER_STRATOSPHERE_TOP_M) {
    return TROPOPAUSE_TEMPERATURE_K;
  }
  return (
    TROPOPAUSE_TEMPERATURE_K +
    UPPER_STRATOSPHERE_LAPSE_RATE_K_PER_M *
      (altitudeM - LOWER_STRATOSPHERE_TOP_M)
  );
}

/**
 * ISA temperature at a geopotential altitude, in degrees Celsius.
 *
 * @param {number} altitudeM geopotential altitude, metres.
 * @returns {number} temperature, degC.
 */
export function isaTemperatureC(altitudeM) {
  return isaTemperatureK(altitudeM) - 273.15;
}

/**
 * ISA pressure at a geopotential altitude, via the hydrostatic
 * equation: power law in the lapse layers, exponential in the
 * isothermal layer.
 *
 * @param {number} altitudeM geopotential altitude, metres.
 * @returns {number} pressure, pascals.
 */
export function isaPressurePa(altitudeM) {
  checkAltitude(altitudeM);
  if (altitudeM <= TROPOPAUSE_ALTITUDE_M) {
    const temperatureK = isaTemperatureK(altitudeM);
    return (
      SEA_LEVEL_PRESSURE_PA *
      (temperatureK / SEA_LEVEL_TEMPERATURE_K) **
        (-STANDARD_GRAVITY /
          (TROPOSPHERE_LAPSE_RATE_K_PER_M * SPECIFIC_GAS_CONSTANT_DRY_AIR))
    );
  }
  if (altitudeM <= LOWER_STRATOSPHERE_TOP_M) {
    return (
      TROPOPAUSE_PRESSURE_PA *
      Math.exp(
        (-STANDARD_GRAVITY * (altitudeM - TROPOPAUSE_ALTITUDE_M)) /
          (SPECIFIC_GAS_CONSTANT_DRY_AIR * TROPOPAUSE_TEMPERATURE_K),
      )
    );
  }
  const temperatureK = isaTemperatureK(altitudeM);
  return (
    STRATOSPHERE_20KM_PRESSURE_PA *
    (temperatureK / TROPOPAUSE_TEMPERATURE_K) **
      (-STANDARD_GRAVITY /
        (UPPER_STRATOSPHERE_LAPSE_RATE_K_PER_M * SPECIFIC_GAS_CONSTANT_DRY_AIR))
  );
}

/**
 * ISA pressure at a geopotential altitude, in hectopascals.
 *
 * @param {number} altitudeM geopotential altitude, metres.
 * @returns {number} pressure, hPa.
 */
export function isaPressureHpa(altitudeM) {
  return isaPressurePa(altitudeM) / 100;
}

/**
 * ISA air density at a geopotential altitude, from the ideal-gas law
 * (density = pressure / (R * T)).
 *
 * @param {number} altitudeM geopotential altitude, metres.
 * @returns {number} density, kg/m^3.
 */
export function isaDensityKgPerM3(altitudeM) {
  checkAltitude(altitudeM);
  return (
    isaPressurePa(altitudeM) /
    (SPECIFIC_GAS_CONSTANT_DRY_AIR * isaTemperatureK(altitudeM))
  );
}

/**
 * Speed of sound at a geopotential altitude, sqrt(gamma * R * T).
 *
 * @param {number} altitudeM geopotential altitude, metres.
 * @returns {number} speed of sound, m/s.
 */
export function speedOfSoundMPerS(altitudeM) {
  checkAltitude(altitudeM);
  return Math.sqrt(
    RATIO_OF_SPECIFIC_HEATS_AIR *
      SPECIFIC_GAS_CONSTANT_DRY_AIR *
      isaTemperatureK(altitudeM),
  );
}

/**
 * All ISA properties at a geopotential altitude, in one frozen object.
 *
 * @param {number} altitudeM geopotential altitude, metres.
 * @returns {object} temperature, pressure, density, speed of sound.
 */
export function isaProperties(altitudeM) {
  checkAltitude(altitudeM);
  const temperatureK = isaTemperatureK(altitudeM);
  const pressurePa = isaPressurePa(altitudeM);
  return Object.freeze({
    altitudeM,
    temperatureK,
    temperatureC: temperatureK - 273.15,
    pressurePa,
    pressureHpa: pressurePa / 100,
    densityKgPerM3: pressurePa / (SPECIFIC_GAS_CONSTANT_DRY_AIR * temperatureK),
    speedOfSoundMPerS: Math.sqrt(
      RATIO_OF_SPECIFIC_HEATS_AIR *
        SPECIFIC_GAS_CONSTANT_DRY_AIR *
        temperatureK,
    ),
  });
}

/**
 * Geopotential altitude whose ISA pressure equals the given pressure:
 * the exact inverse of `isaPressurePa`.
 *
 * @param {number} pressurePa station pressure, pascals.
 * @returns {number} geopotential altitude, metres.
 */
export function altitudeFromPressureM(pressurePa) {
  checkFinite(pressurePa, 'pressure');
  const minPressurePa = isaPressurePa(MAX_ALTITUDE_M);
  const maxPressurePa = isaPressurePa(MIN_ALTITUDE_M);
  if (pressurePa < minPressurePa || pressurePa > maxPressurePa) {
    throw new RangeError(
      `pressure must be in [${minPressurePa.toFixed(1)}, ${maxPressurePa.toFixed(1)}] Pa`,
    );
  }
  if (pressurePa >= TROPOPAUSE_PRESSURE_PA) {
    // Troposphere: T = T0 * (p/p0)^(1/5.25588), h = (T0 - T) / 0.0065.
    const temperatureK =
      SEA_LEVEL_TEMPERATURE_K *
      (pressurePa / SEA_LEVEL_PRESSURE_PA) **
        ((-TROPOSPHERE_LAPSE_RATE_K_PER_M * SPECIFIC_GAS_CONSTANT_DRY_AIR) /
          STANDARD_GRAVITY);
    return (
      (SEA_LEVEL_TEMPERATURE_K - temperatureK) / -TROPOSPHERE_LAPSE_RATE_K_PER_M
    );
  }
  if (pressurePa >= STRATOSPHERE_20KM_PRESSURE_PA) {
    // Isothermal layer: h = h_b - (R*T_b/g) * ln(p/p_b).
    return (
      TROPOPAUSE_ALTITUDE_M -
      ((SPECIFIC_GAS_CONSTANT_DRY_AIR * TROPOPAUSE_TEMPERATURE_K) /
        STANDARD_GRAVITY) *
        Math.log(pressurePa / TROPOPAUSE_PRESSURE_PA)
    );
  }
  // Upper stratosphere: T = T_b * (p/p_b)^(1/-34.16), h from the lapse.
  const temperatureK =
    TROPOPAUSE_TEMPERATURE_K *
    (pressurePa / STRATOSPHERE_20KM_PRESSURE_PA) **
      ((-UPPER_STRATOSPHERE_LAPSE_RATE_K_PER_M *
        SPECIFIC_GAS_CONSTANT_DRY_AIR) /
        STANDARD_GRAVITY);
  return (
    LOWER_STRATOSPHERE_TOP_M +
    (temperatureK - TROPOPAUSE_TEMPERATURE_K) /
      UPPER_STRATOSPHERE_LAPSE_RATE_K_PER_M
  );
}

/**
 * Geopotential altitude whose ISA density equals the given density:
 * the exact inverse of `isaDensityKgPerM3`, found by bisection
 * (density falls monotonically with altitude, so the root is unique).
 *
 * @param {number} densityKgPerM3 air density, kg/m^3.
 * @returns {number} geopotential altitude, metres.
 */
export function altitudeFromDensityM(densityKgPerM3) {
  checkFinite(densityKgPerM3, 'density');
  const minDensity = isaDensityKgPerM3(MAX_ALTITUDE_M);
  const maxDensity = isaDensityKgPerM3(MIN_ALTITUDE_M);
  if (densityKgPerM3 < minDensity || densityKgPerM3 > maxDensity) {
    throw new RangeError(
      `density must be in [${minDensity.toFixed(5)}, ${maxDensity.toFixed(5)}] kg/m^3`,
    );
  }
  let low = MIN_ALTITUDE_M;
  let high = MAX_ALTITUDE_M;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    if (isaDensityKgPerM3(mid) > densityKgPerM3) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

/**
 * Pressure altitude from a QNH altimeter setting and an indicated
 * (QNH-set) altitude: the altitude in the standard atmosphere at
 * which the pressure equals the station pressure implied by QNH.
 * Exact ISA version of the altimeter-setting correction — no
 * 1000 ft-per-inHg linearisation.
 *
 * @param {object} input
 * @param {number} input.qnhHpa QNH (mean-sea-level pressure), hPa.
 * @param {number} input.indicatedAltitudeM altitude read on an
 *   altimeter set to QNH, metres above mean sea level.
 * @returns {number} pressure altitude, metres.
 */
export function pressureAltitudeM({ qnhHpa, indicatedAltitudeM }) {
  checkFinite(qnhHpa, 'qnhHpa');
  if (qnhHpa < MIN_QNH_HPA || qnhHpa > MAX_QNH_HPA) {
    throw new RangeError(
      `qnhHpa must be in [${MIN_QNH_HPA}, ${MAX_QNH_HPA}] hPa`,
    );
  }
  checkAltitude(indicatedAltitudeM, 'indicatedAltitudeM');
  // Station pressure = QNH scaled by the ISA pressure ratio at the
  // indicated altitude (QNH is the MSL pressure of the same column).
  const stationPressurePa =
    qnhHpa * 100 * (isaPressurePa(indicatedAltitudeM) / SEA_LEVEL_PRESSURE_PA);
  return altitudeFromPressureM(stationPressurePa);
}

/**
 * Density altitude from pressure altitude and outside air
 * temperature: the altitude in the standard atmosphere whose density
 * equals the actual air density (pressure altitude corrected for
 * nonstandard temperature). Exact ISA inversion; dry air only.
 *
 * @param {object} input
 * @param {number} input.pressureAltitudeM pressure altitude, metres.
 * @param {number} input.oatC outside air temperature, degC.
 * @returns {number} density altitude, metres.
 */
export function densityAltitudeM({
  pressureAltitudeM: pressureAltitude,
  oatC,
}) {
  checkAltitude(pressureAltitude, 'pressureAltitudeM');
  checkFinite(oatC, 'oatC');
  if (oatC < -100 || oatC > 100) {
    throw new RangeError('oatC must be in [-100, 100] degC');
  }
  const stationPressurePa = isaPressurePa(pressureAltitude);
  const actualDensityKgPerM3 =
    stationPressurePa / (SPECIFIC_GAS_CONSTANT_DRY_AIR * (oatC + 273.15));
  return altitudeFromDensityM(actualDensityKgPerM3);
}

/**
 * The FAA cockpit rule of thumb: density altitude ≈ pressure
 * altitude + 120 ft per degC that OAT exceeds the ISA temperature
 * at pressure altitude (120 ft = 36.576 m). Approximate — the
 * exact value is `densityAltitudeM`. Useful only for cross-checking
 * against the numbers pilots compute by hand.
 *
 * @param {object} input
 * @param {number} input.pressureAltitudeM pressure altitude, metres.
 * @param {number} input.oatC outside air temperature, degC.
 * @returns {number} approximate density altitude, metres.
 */
export function densityAltitudeRuleOfThumbM({
  pressureAltitudeM: pressureAltitude,
  oatC,
}) {
  checkAltitude(pressureAltitude, 'pressureAltitudeM');
  checkFinite(oatC, 'oatC');
  if (oatC < -100 || oatC > 100) {
    throw new RangeError('oatC must be in [-100, 100] degC');
  }
  return (
    pressureAltitude + 120 * 0.3048 * (oatC - isaTemperatureC(pressureAltitude))
  );
}

/**
 * Convert geometric altitude (what Cesium / GPS report: distance
 * above the ellipsoid) to geopotential altitude (the ISA's
 * coordinate): h = R*z / (R + z).
 *
 * @param {number} geometricAltitudeM geometric altitude, metres.
 * @returns {number} geopotential altitude, metres.
 */
export function geopotentialAltitudeM(geometricAltitudeM) {
  checkFinite(geometricAltitudeM, 'geometricAltitudeM');
  const geopotential =
    (ISA_EARTH_RADIUS_M * geometricAltitudeM) /
    (ISA_EARTH_RADIUS_M + geometricAltitudeM);
  // Snap float round-trip noise at the boundary (a geometric altitude
  // converted from exactly MAX_ALTITUDE_M can come back 4e-9 m high).
  if (geopotential > MAX_ALTITUDE_M && geopotential <= MAX_ALTITUDE_M + 1e-6) {
    return MAX_ALTITUDE_M;
  }
  if (geopotential < MIN_ALTITUDE_M && geopotential >= MIN_ALTITUDE_M - 1e-6) {
    return MIN_ALTITUDE_M;
  }
  return checkAltitude(geopotential, 'geometricAltitudeM');
}

/**
 * Convert geopotential altitude (the ISA's coordinate) to geometric
 * altitude (what Cesium / GPS report): z = R*h / (R - h).
 *
 * @param {number} geopotentialAltitudeM geopotential altitude, metres.
 * @returns {number} geometric altitude, metres.
 */
export function geometricAltitudeM(geopotentialAltitudeM) {
  checkAltitude(geopotentialAltitudeM, 'geopotentialAltitudeM');
  return (
    (ISA_EARTH_RADIUS_M * geopotentialAltitudeM) /
    (ISA_EARTH_RADIUS_M - geopotentialAltitudeM)
  );
}
