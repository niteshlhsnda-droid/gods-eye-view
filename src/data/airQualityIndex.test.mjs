import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AQI_500_CONCENTRATIONS,
  AQI_CATEGORIES,
  AQI_MAX,
  POLLUTANTS,
  POLLUTANT_ORDER,
  SENSITIVE_GROUPS,
  aqiCategory,
  concentrationForAqi,
  overallAqi,
  subIndex,
  truncateConcentration,
} from './airQualityIndex.js';

/**
 * External anchors. Every expected value below is hand-computed
 * from 40 CFR Part 58, Appendix G, Table 2 (current text) with
 * Equation 1, Ip = (IHi - ILo) / (BPHi - BPLo) * (Cp - BPLo) + ILo,
 * rounded to the nearest integer — independent of this module's
 * band lookup. Boundary values are table entries, not computed:
 * - PM2.5 9.0 -> 50, 9.1 -> 51, 35.4 -> 100, 35.5 -> 101,
 *   55.4 -> 150, 125.4 -> 200, 225.4 -> 300, 325.4 -> 500.
 * - PM10 210 -> (150-101)/(254-155)*(210-155)+101 = 128.2 -> 128
 *   (the Appendix G worked example; its PM10 and 1-hour ozone
 *   parts still match Table 2).
 * - 1-hour ozone 0.156 ppm -> (150-101)/(0.164-0.125)*
 *   (0.156-0.125)+101 = 139.9 -> 140 (Appendix G worked example).
 * - 8-hour ozone 0.078 ppm -> (150-101)/(0.085-0.071)*
 *   (0.078-0.071)+101 = 125.5 -> 126 (round half up).
 * - 8-hour ozone 0.130 ppm -> (300-201)/(0.200-0.106)*
 *   (0.130-0.106)+201 = 226.3 -> 226 per CURRENT Table 2. The
 *   Appendix G worked example prints 206 for this input, which
 *   matches the PRE-2015 breakpoints (0.116-0.374 -> 201-300);
 *   this module follows Table 2.
 * - CO 8.4 ppm -> (100-51)/(9.4-4.5)*(8.4-4.5)+51 = 90 exactly.
 * - PM2.5 12.0 -> (100-51)/(35.4-9.1)*(12.0-9.1)+51 = 56.4 -> 56.
 * - PM2.5 400 (above the AQI-500 concentration 325.4) extrapolates
 *   along the last segment: 500 + (400-325.4)*199/99.9 = 648.6
 *   -> 649, beyond the scale.
 * - NO2 3000 ppb extrapolates: 500 + (3000-2049)*199/799 = 736.9
 *   -> 737, beyond the scale.
 */

test('category table matches Appendix G / TAD names, ranges, and RGB colors', () => {
  assert.equal(AQI_CATEGORIES.length, 6);
  assert.deepEqual(
    AQI_CATEGORIES.map((category) => category.name),
    [
      'Good',
      'Moderate',
      'Unhealthy for Sensitive Groups',
      'Unhealthy',
      'Very Unhealthy',
      'Hazardous',
    ],
  );
  assert.deepEqual(
    AQI_CATEGORIES.map((category) => category.hex),
    ['#00E400', '#FFFF00', '#FF7E00', '#FF0000', '#8F3F97', '#7E0023'],
  );
  assert.deepEqual(
    AQI_CATEGORIES.map((category) => category.range),
    [
      [0, 50],
      [51, 100],
      [101, 150],
      [151, 200],
      [201, 300],
      [301, 500],
    ],
  );
  assert.ok(Object.isFrozen(AQI_CATEGORIES));
  assert.equal(AQI_MAX, 500);
  assert.deepEqual(AQI_500_CONCENTRATIONS, {
    o3_1h: 0.604,
    pm25: 325.4,
    pm10: 604,
    co: 50.4,
    so2: 1004,
    no2: 2049,
  });
});

test('aqiCategory returns the category at every boundary', () => {
  const cases = [
    [0, 'Good', '#00E400', false],
    [50, 'Good', '#00E400', false],
    [51, 'Moderate', '#FFFF00', false],
    [100, 'Moderate', '#FFFF00', false],
    [101, 'Unhealthy for Sensitive Groups', '#FF7E00', false],
    [150, 'Unhealthy for Sensitive Groups', '#FF7E00', false],
    [151, 'Unhealthy', '#FF0000', false],
    [200, 'Unhealthy', '#FF0000', false],
    [201, 'Very Unhealthy', '#8F3F97', false],
    [300, 'Very Unhealthy', '#8F3F97', false],
    [301, 'Hazardous', '#7E0023', false],
    [500, 'Hazardous', '#7E0023', false],
    [501, 'Hazardous', '#7E0023', true],
    [649, 'Hazardous', '#7E0023', true],
  ];
  for (const [aqi, name, hex, beyondScale] of cases) {
    const category = aqiCategory(aqi);
    assert.equal(category.name, name, `AQI ${aqi}`);
    assert.equal(category.hex, hex, `AQI ${aqi}`);
    assert.equal(category.beyondScale, beyondScale, `AQI ${aqi}`);
    assert.ok(category.healthEffects.length > 0, `AQI ${aqi}`);
  }
});

test('pollutant descriptors use CFR units and truncation decimals', () => {
  assert.deepEqual(POLLUTANT_ORDER, [
    'o3_8h',
    'o3_1h',
    'pm25',
    'pm10',
    'co',
    'so2',
    'no2',
  ]);
  assert.ok(Object.isFrozen(POLLUTANT_ORDER));
  assert.equal(POLLUTANTS.pm25.unit, 'µg/m³');
  assert.equal(POLLUTANTS.pm25.decimals, 1);
  assert.equal(POLLUTANTS.pm10.decimals, 0);
  assert.equal(POLLUTANTS.o3_8h.unit, 'ppm');
  assert.equal(POLLUTANTS.o3_8h.decimals, 3);
  assert.equal(POLLUTANTS.co.decimals, 1);
  assert.equal(POLLUTANTS.so2.unit, 'ppb');
  assert.equal(POLLUTANTS.no2.unit, 'ppb');
  assert.equal(POLLUTANTS.so2.label, 'Sulfur dioxide (1-hour)');
});

test('sensitive groups cover every pollutant family', () => {
  assert.match(SENSITIVE_GROUPS.o3, /lung disease/);
  assert.match(SENSITIVE_GROUPS.pm25, /heart or lung disease/);
  assert.match(SENSITIVE_GROUPS.pm10, /heart or lung disease/);
  assert.match(SENSITIVE_GROUPS.co, /heart disease/);
  assert.match(SENSITIVE_GROUPS.so2, /asthma/);
  assert.match(SENSITIVE_GROUPS.no2, /asthma/);
});

test('truncateConcentration truncates toward zero, never rounds', () => {
  assert.equal(truncateConcentration('pm25', 35.55), 35.5);
  assert.equal(truncateConcentration('pm25', 9.04), 9.0);
  assert.equal(truncateConcentration('o3_8h', 0.0549), 0.054);
  assert.equal(truncateConcentration('o3_1h', 0.1569), 0.156);
  assert.equal(truncateConcentration('co', 4.49), 4.4);
  assert.equal(truncateConcentration('pm10', 54.9), 54);
  assert.equal(truncateConcentration('so2', 35.9), 35);
  assert.equal(truncateConcentration('no2', 53.9), 53);
});

test('PM2.5 sub-index: boundaries, interpolation, and the 2024 bands', () => {
  const cases = [
    [0, 0, 'Good'],
    [9.0, 50, 'Good'],
    [9.1, 51, 'Moderate'],
    [12.0, 56, 'Moderate'],
    [35.4, 100, 'Moderate'],
    [35.5, 101, 'Unhealthy for Sensitive Groups'],
    [35.9, 102, 'Unhealthy for Sensitive Groups'],
    [55.4, 150, 'Unhealthy for Sensitive Groups'],
    [55.5, 151, 'Unhealthy'],
    [125.4, 200, 'Unhealthy'],
    [125.5, 201, 'Very Unhealthy'],
    [225.4, 300, 'Very Unhealthy'],
    [225.5, 301, 'Hazardous'],
    [325.4, 500, 'Hazardous'],
  ];
  for (const [concentration, aqi, category] of cases) {
    const result = subIndex('pm25', concentration);
    assert.equal(result.aqi, aqi, `PM2.5 ${concentration}`);
    assert.equal(result.category, category, `PM2.5 ${concentration}`);
    assert.equal(result.capped, false);
    assert.equal(result.beyondScale, false);
  }
  // Pre-2024 bands would put 150.4 at the top of Unhealthy (200);
  // current Table 2 puts it in Very Unhealthy: 99/99.9*24.9+201 = 225.7.
  assert.equal(subIndex('pm25', 150.4).aqi, 226);
});

test('PM10 sub-index matches the Appendix G worked example', () => {
  assert.equal(subIndex('pm10', 0).aqi, 0);
  assert.equal(subIndex('pm10', 54).aqi, 50);
  assert.equal(subIndex('pm10', 55).aqi, 51);
  assert.equal(subIndex('pm10', 210).aqi, 128);
  assert.equal(subIndex('pm10', 604).aqi, 500);
  const beyond = subIndex('pm10', 700);
  assert.equal(beyond.aqi, 607);
  assert.equal(beyond.beyondScale, true);
});

test('ozone sub-indices: both averaging times and the stale-example gap', () => {
  // 8-hour ozone, current Table 2.
  const eightHour = [
    [0, 0],
    [0.054, 50],
    [0.055, 51],
    [0.07, 100],
    [0.071, 101],
    [0.078, 126],
    [0.085, 150],
    [0.086, 151],
    [0.105, 200],
    [0.106, 201],
    [0.13, 226],
    [0.2, 300],
  ];
  for (const [concentration, aqi] of eightHour) {
    assert.equal(
      subIndex('o3_8h', concentration).aqi,
      aqi,
      `8-hour ozone ${concentration}`,
    );
  }
  // 1-hour ozone, including the Appendix G worked example (0.156 -> 140).
  assert.equal(subIndex('o3_1h', 0.125).aqi, 101);
  assert.equal(subIndex('o3_1h', 0.156).aqi, 140);
  assert.equal(subIndex('o3_1h', 0.164).aqi, 150);
  assert.equal(subIndex('o3_1h', 0.205).aqi, 201);
  assert.equal(subIndex('o3_1h', 0.404).aqi, 300);
  assert.equal(subIndex('o3_1h', 0.405).aqi, 301);
  assert.equal(subIndex('o3_1h', 0.604).aqi, 500);
  const beyond = subIndex('o3_1h', 0.7);
  assert.equal(beyond.aqi, 596);
  assert.equal(beyond.beyondScale, true);
});

test('CO, SO2, NO2 sub-indices at band boundaries', () => {
  assert.equal(subIndex('co', 0).aqi, 0);
  assert.equal(subIndex('co', 4.4).aqi, 50);
  assert.equal(subIndex('co', 4.5).aqi, 51);
  assert.equal(subIndex('co', 8.4).aqi, 90);
  assert.equal(subIndex('co', 50.4).aqi, 500);
  assert.equal(subIndex('so2', 35).aqi, 50);
  assert.equal(subIndex('so2', 75).aqi, 100);
  assert.equal(subIndex('so2', 185).aqi, 150);
  assert.equal(subIndex('so2', 304).aqi, 200);
  assert.equal(subIndex('no2', 53).aqi, 50);
  assert.equal(subIndex('no2', 100).aqi, 100);
  assert.equal(subIndex('no2', 360).aqi, 150);
  assert.equal(subIndex('no2', 649).aqi, 200);
  assert.equal(subIndex('no2', 1249).aqi, 300);
  assert.equal(subIndex('no2', 2049).aqi, 500);
  const beyond = subIndex('no2', 3000);
  assert.equal(beyond.aqi, 737);
  assert.equal(beyond.beyondScale, true);
});

test('truncation is applied before the breakpoint lookup', () => {
  // 35.55 truncates to 35.5 -> 101; rounding first would give 35.6 -> 102.
  assert.equal(subIndex('pm25', 35.55).concentration, 35.5);
  assert.equal(subIndex('pm25', 35.55).aqi, 101);
  // 9.04 truncates to 9.0 -> 50; rounding first would give 9.0 too,
  // but 9.06 truncates to 9.0 while rounding gives 9.1 -> 51.
  assert.equal(subIndex('pm25', 9.06).concentration, 9.0);
  assert.equal(subIndex('pm25', 9.06).aqi, 50);
  assert.equal(subIndex('o3_8h', 0.0549).aqi, 50);
  assert.equal(subIndex('pm10', 54.9).aqi, 50);
});

test('Table 2 footnotes: capped results where a pollutant is undefined', () => {
  const o3High = subIndex('o3_8h', 0.201);
  assert.equal(o3High.aqi, null);
  assert.equal(o3High.category, null);
  assert.equal(o3High.capped, true);
  assert.match(o3High.cappedReason, /footnote 2/);
  const o3Low = subIndex('o3_1h', 0.124);
  assert.equal(o3Low.aqi, null);
  assert.equal(o3Low.capped, true);
  assert.match(o3Low.cappedReason, /only from 101/);
  const so2High = subIndex('so2', 305);
  assert.equal(so2High.aqi, null);
  assert.equal(so2High.capped, true);
  assert.match(so2High.cappedReason, /footnote 3/);
});

test('overallAqi reports the highest sub-index and its main pollutant', () => {
  const result = overallAqi({ pm25: 35.9, o3_8h: 0.078, pm10: 210 });
  assert.equal(result.aqi, 128);
  assert.equal(result.category, 'Unhealthy for Sensitive Groups');
  assert.equal(result.mainPollutant, 'pm10');
  assert.deepEqual(
    result.subIndices.map((entry) => [entry.pollutant, entry.aqi]),
    [
      ['o3_8h', 126],
      ['pm25', 102],
      ['pm10', 128],
    ],
  );
});

test('overallAqi skips capped sub-indices and breaks ties in table order', () => {
  // 8-hour ozone 0.201 is capped; the other two tie at 50, and
  // pm25 precedes pm10 in Table 2 column order.
  const result = overallAqi({ o3_8h: 0.201, pm25: 9.0, pm10: 54 });
  assert.equal(result.aqi, 50);
  assert.equal(result.mainPollutant, 'pm25');
  assert.equal(
    result.subIndices.find((entry) => entry.pollutant === 'o3_8h').capped,
    true,
  );
  const allCapped = overallAqi({ o3_8h: 0.201, so2: 305 });
  assert.equal(allCapped.aqi, null);
  assert.equal(allCapped.category, null);
  assert.equal(allCapped.mainPollutant, null);
});

test('concentrationForAqi inverts the interpolation at boundaries', () => {
  assert.equal(concentrationForAqi('pm25', 0).concentration, 0);
  assert.equal(concentrationForAqi('pm25', 50).concentration, 9.0);
  assert.equal(concentrationForAqi('pm25', 100).concentration, 35.4);
  assert.deepEqual(concentrationForAqi('pm25', 100).concentrationLo, 9.1);
  assert.deepEqual(concentrationForAqi('pm25', 100).concentrationHi, 35.4);
  assert.equal(concentrationForAqi('pm25', 500).concentration, 325.4);
  assert.equal(concentrationForAqi('no2', 500).concentration, 2049);
  assert.equal(concentrationForAqi('o3_1h', 150).concentration, 0.164);
  // Inverse of a ROUNDED aqi is not the original concentration:
  // 0.156 ppm forward-maps to 139.95, which rounds to 140, so the
  // inverse of 140 is 0.15604, a hair above 0.156.
  assert.ok(
    Math.abs(concentrationForAqi('o3_1h', 140).concentration - 0.156) < 1e-3,
  );
  const beyond = concentrationForAqi('pm25', 600);
  assert.equal(beyond.beyondScale, true);
  assert.ok(Math.abs(beyond.concentration - 375.601005) < 1e-6);
  assert.equal(concentrationForAqi('o3_8h', 301).capped, true);
  assert.equal(concentrationForAqi('o3_1h', 50).capped, true);
  assert.equal(concentrationForAqi('so2', 201).capped, true);
});

test('validation: unknown pollutants, bad concentrations, empty readings', () => {
  assert.throws(() => subIndex('o3', 0.05), RangeError);
  assert.throws(() => subIndex('pm25', -1), RangeError);
  assert.throws(() => subIndex('pm25', Number.NaN), RangeError);
  assert.throws(() => subIndex('pm25', Infinity), RangeError);
  assert.throws(() => subIndex('pm25', '35.5'), TypeError);
  assert.throws(() => truncateConcentration('pm25', -0.1), RangeError);
  assert.throws(() => aqiCategory(-1), RangeError);
  assert.throws(() => aqiCategory('100'), TypeError);
  assert.throws(() => concentrationForAqi('pm25', -5), RangeError);
  assert.throws(() => overallAqi({}), RangeError);
  assert.throws(() => overallAqi({ ozone: 0.05 }), RangeError);
  assert.throws(() => overallAqi([]), TypeError);
  assert.throws(() => overallAqi(null), TypeError);
});
