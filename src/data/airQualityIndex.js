/**
 * US EPA Air Quality Index (AQI): concentration -> sub-index, categories,
 * and the overall (highest-sub-index) AQI.
 *
 * Why a new module: GEV already has weather-adjacent pure helpers
 * (Cycles 1-7 added sunTimes, moonPhase, Beaufort, feelsLike, ICAO
 * Standard Atmosphere, FAA flight categories, and sunPosition), but
 * nothing that answers "how healthy is the air here?" for a place the
 * user is looking at. Air quality is the natural companion readout to
 * the weather and fire layers: a wildfire-smoke day is exactly when a
 * PM2.5 sub-index belongs next to the fire perimeter. This module is
 * that answer: one pure function per pollutant, one for the overall
 * AQI, and the category table (names, colors, health effects,
 * sensitive groups) that a badge or readout needs.
 *
 * Standard: the US EPA AQI as codified in 40 CFR Part 58, Appendix G,
 * Table 2 breakpoints, with the Appendix G section 3.4 procedure:
 * truncate the concentration, find the two breakpoints that contain
 * it, apply Equation 1 (piecewise-linear interpolation), round the
 * index to the nearest integer. The reported AQI is the highest
 * sub-index; the pollutant that produces it is the "main" pollutant.
 *
 * Sources (primary sources only; no blog summaries):
 * - 40 CFR Part 58, Appendix G, "Uniform Air Quality Index (AQI) and
 *   Daily Reporting", sections 2.2.1, 3.1, and 3.4 (Table 2
 *   breakpoints, truncation rules, Equation 1, footnotes 2-4).
 *   https://www.law.cornell.edu/cfr/text/40/appendix-G_to_part_58
 * - US EPA, "Technical Assistance Document for the Reporting of
 *   Daily Air Quality - the Air Quality Index (AQI)",
 *   EPA-454/B-16-002, May 2016 (Table 1 category names/colors,
 *   Table 2 RGB color formulas, Table 3 pollutant-specific
 *   sensitive groups, and the "Beyond the AQI" note for values
 *   above 500). https://www.airnow.gov/publications/air-quality-index/technical-assistance-document-for-reporting-the-daily-aqi/
 * - US EPA AirNow, "AQI Basics" (the six category health-effects
 *   statements quoted in AQI_CATEGORIES).
 *   https://www.airnow.gov/aqi/aqi-basics/
 *
 * Breakpoint vintage — read before comparing against other tables:
 * the CURRENT Appendix G Table 2 carries the 2024 PM2.5 revision:
 * Good 0.0-9.0, Moderate 9.1-35.4, Unhealthy for Sensitive Groups
 * 35.5-55.4, Unhealthy 55.5-125.4, Very Unhealthy 125.5-225.4,
 * Hazardous 225.5+. Older tables (including the 2016 TAD's Table 6
 * and many online calculators) show the pre-2024 PM2.5 bands
 * (0.0-12.0 / 12.1-35.4 / 35.5-55.4 / 55.5-150.4 / 150.5-250.4 /
 * 250.5-500.4). This module follows the current CFR Table 2.
 *
 * A known inconsistency inside Appendix G itself: the worked example
 * in section 3.4(d) computes 206 for an 8-hour ozone value of
 * 0.130 ppm, which matches the PRE-2015 8-hour ozone breakpoints
 * (0.116-0.374 ppm -> AQI 201-300), not the current Table 2
 * (0.106-0.200 ppm -> AQI 201-300, which gives 226). The example's
 * PM10 (210 -> 128) and 1-hour ozone (0.156 ppm -> 140) parts still
 * match Table 2. This module follows Table 2, not the stale example.
 *
 * Averaging-time footnotes (Appendix G Table 2, footnotes 2-3):
 * - 8-hour ozone does NOT define AQI values above 300. Above
 *   0.200 ppm, `subIndex('o3_8h', ...)` returns a capped result
 *   (aqi null) and the caller must use 1-hour ozone instead.
 * - 1-hour ozone defines AQI values only from 101 up. Below
 *   0.125 ppm, `subIndex('o3_1h', ...)` returns a capped result.
 * - 1-hour SO2 does NOT define AQI values of 200 or greater; those
 *   are calculated from 24-hour SO2 concentrations, whose
 *   breakpoints are not in Table 2. Above 304 ppb,
 *   `subIndex('so2', ...)` returns a capped result. This module
 *   deliberately does NOT invent 24-hour SO2 breakpoints.
 *
 * Above the top breakpoint (Appendix G section 3.4(c) + footnote 4):
 * the Hazardous band's upper concentration is the concentration
 * EPA specifies for AQI 500 (see AQI_500_CONCENTRATIONS). Beyond
 * that, the index extrapolates along the last segment and the result
 * carries `beyondScale: true`. Values above 500 are "Beyond the
 * AQI" (TAD Table 1 note): follow the Hazardous-category guidance.
 *
 * Accuracy / scope limits — read before using the numbers:
 * - US EPA SCALE ONLY. Other countries use different scales and
 *   breakpoints (e.g. India's CPCB, China's MEP). Do not present
 *   these numbers as a local AQI outside the US system.
 * - CALLER SUPPLIES CORRECTLY AVERAGED CONCENTRATIONS. Each
 *   pollutant has a fixed averaging period (24-hour PM, 8-hour
 *   ozone/CO, 1-hour SO2/NO2). Feeding an instantaneous sensor
 *   reading into a 24-hour slot gives a wrong AQI. The NowCast
 *   (AirNow's weighted recent-hours estimator for real-time
 *   readings) is NOT implemented here.
 * - This module reports the index and the EPA's health-effects
 *   wording. It is not medical advice and cannot predict any
 *   individual's response.
 * - Units are exactly the CFR table's units: ozone and CO in ppm,
 *   SO2 and NO2 in ppb, PM in micrograms per cubic metre. Many
 *   feeds report ozone in ppb; divide by 1000 before calling.
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/airQualityIndex
 */

/** AQI value of the top of the scale (EPA: "Beyond the AQI" above this). */
export const AQI_MAX = 500;

/**
 * Concentrations EPA specifies for AQI 500, by pollutant key
 * (Appendix G Table 2, footnote 4). These close the Hazardous band
 * in BREAKPOINTS below; the footnote's own text labels the SO2
 * value "1-hour" even though footnote 3 routes SO2 >= 200 to
 * 24-hour concentrations — quoted here as printed, not reconciled.
 */
export const AQI_500_CONCENTRATIONS = Object.freeze({
  o3_1h: 0.604,
  pm25: 325.4,
  pm10: 604,
  co: 50.4,
  so2: 1004,
  no2: 2049,
});

/**
 * The six AQI categories, in ascending order. `range` is the
 * inclusive AQI interval. `healthEffects` quotes EPA AirNow's
 * AQI Basics wording. `hex` is the TAD Table 2 RGB formula
 * rendered as a hex color.
 */
export const AQI_CATEGORIES = Object.freeze([
  Object.freeze({
    name: 'Good',
    colorName: 'Green',
    hex: '#00E400',
    range: Object.freeze([0, 50]),
    healthEffects:
      'Air quality is considered satisfactory, and air pollution poses little or no risk.',
  }),
  Object.freeze({
    name: 'Moderate',
    colorName: 'Yellow',
    hex: '#FFFF00',
    range: Object.freeze([51, 100]),
    healthEffects:
      'Air quality is acceptable; however, for some pollutants there may be a moderate health concern for a very small number of people who are unusually sensitive to air pollution.',
  }),
  Object.freeze({
    name: 'Unhealthy for Sensitive Groups',
    colorName: 'Orange',
    hex: '#FF7E00',
    range: Object.freeze([101, 150]),
    healthEffects:
      'Members of sensitive groups may experience health effects. The general public is not likely to be affected.',
  }),
  Object.freeze({
    name: 'Unhealthy',
    colorName: 'Red',
    hex: '#FF0000',
    range: Object.freeze([151, 200]),
    healthEffects:
      'Everyone may begin to experience health effects; members of sensitive groups may experience more serious health effects.',
  }),
  Object.freeze({
    name: 'Very Unhealthy',
    colorName: 'Purple',
    hex: '#8F3F97',
    range: Object.freeze([201, 300]),
    healthEffects:
      'Health warnings of emergency conditions. The entire population is more likely to be affected.',
  }),
  Object.freeze({
    name: 'Hazardous',
    colorName: 'Maroon',
    hex: '#7E0023',
    range: Object.freeze([301, 500]),
    healthEffects:
      'Health alert: everyone may experience more serious health effects.',
  }),
]);

/**
 * Pollutant-specific sensitive groups (EPA TAD Table 3), for
 * reports where a sub-index exceeds 100 (Appendix G section
 * 2.2.1(f)). Ozone's entry covers both averaging times.
 */
export const SENSITIVE_GROUPS = Object.freeze({
  o3: 'People with lung disease, children, older adults, people who are active outdoors (including outdoor workers), people with certain genetic variants, and people with diets limited in certain nutrients are the groups most at risk.',
  pm25: 'People with heart or lung disease, older adults, children, and people of lower socioeconomic status are the groups most at risk.',
  pm10: 'People with heart or lung disease, older adults, children, and people of lower socioeconomic status are the groups most at risk.',
  co: 'People with heart disease are the group most at risk.',
  so2: 'People with asthma, children, and older adults are the groups most at risk.',
  no2: 'People with asthma, children, and older adults are the groups most at risk.',
});

/**
 * Breakpoint tables: Appendix G Table 2, current text. Each band is
 * [concentrationLo, concentrationHi, aqiLo, aqiHi]. The Hazardous
 * band's concentrationHi is the AQI-500 concentration from
 * footnote 4. `decimals` is the Appendix G section 3.4(a)(i)
 * truncation: ozone 3 decimals (ppm), PM2.5 1 decimal, PM10
 * integer, CO 1 decimal, SO2/NO2 integer (ppb).
 *
 * `cappedBelow` / `cappedAbove` encode the Table 2 footnotes:
 * the pollutant does not define AQI values outside that side.
 */
const POLLUTANT_SPECS = Object.freeze({
  o3_8h: Object.freeze({
    label: 'Ozone (8-hour)',
    unit: 'ppm',
    decimals: 3,
    bands: Object.freeze([
      Object.freeze([0.0, 0.054, 0, 50]),
      Object.freeze([0.055, 0.07, 51, 100]),
      Object.freeze([0.071, 0.085, 101, 150]),
      Object.freeze([0.086, 0.105, 151, 200]),
      Object.freeze([0.106, 0.2, 201, 300]),
    ]),
    cappedAbove: Object.freeze({
      concentration: 0.2,
      aqi: 300,
      reason:
        '8-hour ozone does not define AQI values above 300 (Appendix G Table 2, footnote 2); use 1-hour ozone.',
    }),
  }),
  o3_1h: Object.freeze({
    label: 'Ozone (1-hour)',
    unit: 'ppm',
    decimals: 3,
    bands: Object.freeze([
      Object.freeze([0.125, 0.164, 101, 150]),
      Object.freeze([0.165, 0.204, 151, 200]),
      Object.freeze([0.205, 0.404, 201, 300]),
      Object.freeze([0.405, 0.604, 301, 500]),
    ]),
    cappedBelow: Object.freeze({
      concentration: 0.125,
      aqi: 101,
      reason:
        '1-hour ozone defines AQI values only from 101 up (Appendix G Table 2); use 8-hour ozone for lower values.',
    }),
  }),
  pm25: Object.freeze({
    label: 'PM2.5 (24-hour)',
    unit: 'µg/m³',
    decimals: 1,
    bands: Object.freeze([
      Object.freeze([0.0, 9.0, 0, 50]),
      Object.freeze([9.1, 35.4, 51, 100]),
      Object.freeze([35.5, 55.4, 101, 150]),
      Object.freeze([55.5, 125.4, 151, 200]),
      Object.freeze([125.5, 225.4, 201, 300]),
      Object.freeze([225.5, 325.4, 301, 500]),
    ]),
  }),
  pm10: Object.freeze({
    label: 'PM10 (24-hour)',
    unit: 'µg/m³',
    decimals: 0,
    bands: Object.freeze([
      Object.freeze([0, 54, 0, 50]),
      Object.freeze([55, 154, 51, 100]),
      Object.freeze([155, 254, 101, 150]),
      Object.freeze([255, 354, 151, 200]),
      Object.freeze([355, 424, 201, 300]),
      Object.freeze([425, 604, 301, 500]),
    ]),
  }),
  co: Object.freeze({
    label: 'Carbon monoxide (8-hour)',
    unit: 'ppm',
    decimals: 1,
    bands: Object.freeze([
      Object.freeze([0.0, 4.4, 0, 50]),
      Object.freeze([4.5, 9.4, 51, 100]),
      Object.freeze([9.5, 12.4, 101, 150]),
      Object.freeze([12.5, 15.4, 151, 200]),
      Object.freeze([15.5, 30.4, 201, 300]),
      Object.freeze([30.5, 50.4, 301, 500]),
    ]),
  }),
  so2: Object.freeze({
    label: 'Sulfur dioxide (1-hour)',
    unit: 'ppb',
    decimals: 0,
    bands: Object.freeze([
      Object.freeze([0, 35, 0, 50]),
      Object.freeze([36, 75, 51, 100]),
      Object.freeze([76, 185, 101, 150]),
      Object.freeze([186, 304, 151, 200]),
    ]),
    cappedAbove: Object.freeze({
      concentration: 304,
      aqi: 200,
      reason:
        '1-hour SO2 does not define AQI values of 200 or greater; those are calculated from 24-hour SO2 concentrations (Appendix G Table 2, footnote 3).',
    }),
  }),
  no2: Object.freeze({
    label: 'Nitrogen dioxide (1-hour)',
    unit: 'ppb',
    decimals: 0,
    bands: Object.freeze([
      Object.freeze([0, 53, 0, 50]),
      Object.freeze([54, 100, 51, 100]),
      Object.freeze([101, 360, 101, 150]),
      Object.freeze([361, 649, 151, 200]),
      Object.freeze([650, 1249, 201, 300]),
      Object.freeze([1250, 2049, 301, 500]),
    ]),
  }),
});

/** Pollutant keys, in Appendix G Table 2 column order. */
export const POLLUTANT_ORDER = Object.freeze([
  'o3_8h',
  'o3_1h',
  'pm25',
  'pm10',
  'co',
  'so2',
  'no2',
]);

/**
 * Public pollutant descriptors (label, unit, truncation decimals).
 * The breakpoint bands themselves stay internal; use `subIndex`
 * and `concentrationForAqi` to evaluate them.
 */
export const POLLUTANTS = Object.freeze(
  Object.fromEntries(
    POLLUTANT_ORDER.map((key) => {
      const spec = POLLUTANT_SPECS[key];
      return [
        key,
        Object.freeze({
          label: spec.label,
          unit: spec.unit,
          decimals: spec.decimals,
        }),
      ];
    }),
  ),
);

function specFor(pollutant) {
  const spec = POLLUTANT_SPECS[pollutant];
  if (spec === undefined) {
    throw new RangeError(
      `Unknown pollutant ${JSON.stringify(pollutant)}; expected one of ${POLLUTANT_ORDER.join(', ')}`,
    );
  }
  return spec;
}

function checkConcentration(concentration) {
  if (typeof concentration !== 'number') {
    throw new TypeError(
      `Concentration must be a number, got ${typeof concentration}`,
    );
  }
  if (!Number.isFinite(concentration)) {
    throw new RangeError('Concentration must be finite');
  }
  if (concentration < 0) {
    throw new RangeError('Concentration must not be negative');
  }
}

/**
 * Truncate a concentration per Appendix G section 3.4(a)(i) — toward
 * zero, to the pollutant's decimal places. Truncation is NOT
 * rounding: 35.55 µg/m³ PM2.5 becomes 35.5 (AQI 101), not 35.6.
 * The 1e-9 nudge only absorbs binary floating-point representation
 * error (e.g. 0.156 * 1000 === 155.99999999999997).
 */
export function truncateConcentration(pollutant, concentration) {
  const spec = specFor(pollutant);
  checkConcentration(concentration);
  const factor = 10 ** spec.decimals;
  return Math.floor(concentration * factor + 1e-9) / factor;
}

/**
 * Equation 1 (Appendix G section 3.4): piecewise-linear
 * interpolation between the two breakpoints containing Cp.
 * Ip = (IHi - ILo) / (BPHi - BPLo) * (Cp - BPLo) + ILo.
 */
function interpolate(band, concentration) {
  const [concLo, concHi, aqiLo, aqiHi] = band;
  return (
    ((aqiHi - aqiLo) / (concHi - concLo)) * (concentration - concLo) + aqiLo
  );
}

/**
 * Category descriptor for an AQI value. Values above 500 return the
 * Hazardous category with `beyondScale: true` ("Beyond the AQI" —
 * follow the Hazardous-category guidance).
 */
export function aqiCategory(aqi) {
  if (typeof aqi !== 'number') {
    throw new TypeError(`AQI must be a number, got ${typeof aqi}`);
  }
  if (!Number.isFinite(aqi)) {
    throw new RangeError('AQI must be finite');
  }
  if (aqi < 0) {
    throw new RangeError('AQI must not be negative');
  }
  const rounded = Math.round(aqi);
  const found = AQI_CATEGORIES.find(
    (category) => rounded >= category.range[0] && rounded <= category.range[1],
  );
  if (found !== undefined) {
    return {
      name: found.name,
      colorName: found.colorName,
      hex: found.hex,
      range: [...found.range],
      healthEffects: found.healthEffects,
      beyondScale: false,
    };
  }
  const hazardous = AQI_CATEGORIES[AQI_CATEGORIES.length - 1];
  return {
    name: hazardous.name,
    colorName: hazardous.colorName,
    hex: hazardous.hex,
    range: [...hazardous.range],
    healthEffects: hazardous.healthEffects,
    beyondScale: true,
  };
}

/**
 * Sub-index for one pollutant at one (already correctly averaged)
 * concentration. The returned `concentration` is the truncated
 * value actually used. When the pollutant does not define an AQI
 * for this concentration (Table 2 footnotes 2-3), `aqi` and
 * `category` are null and `capped` is true with the reason.
 * When the concentration exceeds the AQI-500 concentration,
 * the index extrapolates along the last segment (section 3.4(c))
 * and `beyondScale` is true.
 */
export function subIndex(pollutant, concentration) {
  const spec = specFor(pollutant);
  const truncated = truncateConcentration(pollutant, concentration);
  if (
    spec.cappedBelow !== undefined &&
    truncated < spec.cappedBelow.concentration
  ) {
    return {
      pollutant,
      concentration: truncated,
      aqi: null,
      category: null,
      capped: true,
      cappedReason: spec.cappedBelow.reason,
      beyondScale: false,
    };
  }
  if (
    spec.cappedAbove !== undefined &&
    truncated > spec.cappedAbove.concentration
  ) {
    return {
      pollutant,
      concentration: truncated,
      aqi: null,
      category: null,
      capped: true,
      cappedReason: spec.cappedAbove.reason,
      beyondScale: false,
    };
  }
  const bands = spec.bands;
  let band = bands.find((candidate) => truncated <= candidate[1]);
  let beyondScale = false;
  if (band === undefined) {
    // Above the top breakpoint: extrapolate along the last segment.
    band = bands[bands.length - 1];
    beyondScale = true;
  }
  // The 1e-9 nudge only absorbs binary floating-point representation
  // error at exact .5 boundaries (e.g. 8-hour ozone 0.078 ppm is
  // exactly 125.5 by hand but 125.4999… in binary).
  const aqi = Math.round(interpolate(band, truncated) + 1e-9);
  return {
    pollutant,
    concentration: truncated,
    aqi,
    category: aqiCategory(aqi).name,
    capped: false,
    cappedReason: null,
    beyondScale: beyondScale || aqi > AQI_MAX,
  };
}

/**
 * Overall AQI for a set of readings: `{ pm25: 35.9, o3_8h: 0.078,
 * ... }` keyed by pollutant. The AQI is the highest sub-index
 * (Appendix G section 3.4(d)); the pollutant that produces it is
 * the main pollutant. Capped sub-indices are reported in
 * `subIndices` but do not compete. Ties break in Table 2 column
 * order (POLLUTANT_ORDER), so the result is deterministic.
 * Throws when no readings are supplied. When every sub-index is
 * capped, `aqi`, `category`, and `mainPollutant` are null.
 */
export function overallAqi(readings) {
  if (
    readings === null ||
    typeof readings !== 'object' ||
    Array.isArray(readings)
  ) {
    throw new TypeError('Readings must be an object keyed by pollutant');
  }
  const keys = POLLUTANT_ORDER.filter((key) => Object.hasOwn(readings, key));
  if (keys.length === 0) {
    throw new RangeError(
      `At least one pollutant reading is required; expected one of ${POLLUTANT_ORDER.join(', ')}`,
    );
  }
  const subIndices = keys.map((key) => subIndex(key, readings[key]));
  const defined = subIndices.filter((entry) => entry.aqi !== null);
  if (defined.length === 0) {
    return {
      aqi: null,
      category: null,
      mainPollutant: null,
      subIndices,
    };
  }
  const best = defined.reduce((a, b) => (b.aqi > a.aqi ? b : a));
  return {
    aqi: best.aqi,
    category: best.category,
    mainPollutant: best.pollutant,
    subIndices,
  };
}

/**
 * Inverse of `subIndex`: the concentration that yields a given AQI
 * for a pollutant, plus the breakpoint band it falls in. Useful
 * for "what concentration is AQI 100?" readouts. The point
 * estimate is rounded to 6 decimals to clear floating-point noise;
 * the band bounds are exact table values. Returns a capped result
 * (concentration null) where the pollutant does not define that
 * AQI, and extrapolates past 500 with `beyondScale: true`.
 */
export function concentrationForAqi(pollutant, aqi) {
  const spec = specFor(pollutant);
  if (typeof aqi !== 'number') {
    throw new TypeError(`AQI must be a number, got ${typeof aqi}`);
  }
  if (!Number.isFinite(aqi)) {
    throw new RangeError('AQI must be finite');
  }
  if (aqi < 0) {
    throw new RangeError('AQI must not be negative');
  }
  const rounded = Math.round(aqi);
  const cappedReason = (cap) =>
    `AQI ${rounded} is not defined for ${spec.label} (${cap.reason})`;
  if (spec.cappedBelow !== undefined && rounded < spec.cappedBelow.aqi) {
    return {
      pollutant,
      aqi: rounded,
      concentration: null,
      concentrationLo: null,
      concentrationHi: null,
      capped: true,
      cappedReason: cappedReason(spec.cappedBelow),
      beyondScale: false,
    };
  }
  if (spec.cappedAbove !== undefined && rounded > spec.cappedAbove.aqi) {
    return {
      pollutant,
      aqi: rounded,
      concentration: null,
      concentrationLo: null,
      concentrationHi: null,
      capped: true,
      cappedReason: cappedReason(spec.cappedAbove),
      beyondScale: false,
    };
  }
  const bands = spec.bands;
  let band = bands.find(
    (candidate) => rounded >= candidate[2] && rounded <= candidate[3],
  );
  let beyondScale = false;
  if (band === undefined) {
    band = bands[bands.length - 1];
    beyondScale = true;
  }
  const [concLo, concHi, aqiLo, aqiHi] = band;
  const concentration =
    Math.round(
      (((rounded - aqiLo) * (concHi - concLo)) / (aqiHi - aqiLo) + concLo) *
        1e6,
    ) / 1e6;
  return {
    pollutant,
    aqi: rounded,
    concentration,
    concentrationLo: concLo,
    concentrationHi: concHi,
    capped: false,
    cappedReason: null,
    beyondScale: beyondScale || rounded > AQI_MAX,
  };
}
