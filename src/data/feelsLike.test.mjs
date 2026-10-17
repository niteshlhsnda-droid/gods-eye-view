import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BELOW_CAUTION,
  DEW_POINT_MAGNUS_A,
  DEW_POINT_MAGNUS_B_C,
  HEAT_INDEX_CATEGORIES,
  WIND_CHILL_MAX_TEMP_F,
  WIND_CHILL_MIN_WIND_MPH,
  dewPointC,
  dewPointF,
  feelsLikeF,
  heatIndexC,
  heatIndexCategory,
  heatIndexF,
  windChillC,
  windChillF,
} from './feelsLike.js';

/**
 * External anchors, all fetched 2026-10-17:
 * - NOAA WPC heat-index equation page
 *   (http://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml)
 *   for the Rothfusz regression, adjustments, and simple-first
 *   procedure.
 * - NWS "What is the heat index?" (https://www.weather.gov/ama/heatindex)
 *   for the danger categories and the 100 °F / 55% -> 124 °F and
 *   100 °F / 15% -> 96 °F chart anchors.
 * - NWS "Wind Chill Questions" (https://www.weather.gov/safety/cold-faqs)
 *   for the 2001 wind-chill formula and its domain.
 * - NWS wind-chill chart (https://www.weather.gov/arx/wind_chill)
 *   for the chart anchors (20 °F / 20 mph -> 4 °F, 0 °F / 10 mph
 *   -> -16 °F).
 * - Alduchov & Eskridge (1996) for the dew-point Magnus constants;
 *   cross-checked against worked examples using the 17.67 / 243.5
 *   variant (30 °C / 70% -> 23.94 °C, 25 °C / 60% -> 16.7 °C),
 *   which agree with these constants to within 0.02 °C.
 */

/** Assert actual is within tol of expected. */
function closeTo(actual, expected, tol, message) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    message ?? `expected ${actual} within ${tol} of ${expected}`,
  );
}

test('heat index matches the NWS chart anchors', () => {
  // NWS: 100 °F at 55% humidity feels like 124 °F.
  closeTo(heatIndexF(100, 55), 124, 0.5, '100 °F / 55%');
  // NWS: 100 °F at 15% humidity feels like 96 °F.
  closeTo(heatIndexF(100, 15), 96, 0.5, '100 °F / 15%');
  closeTo(heatIndexF(90, 55), 97, 0.5, '90 °F / 55%');
});

test('heat index uses the simple formula below 80 °F', () => {
  // 0.5 * (75 + 61 + (75-68)*1.2 + 50*0.094) = 74.55, and the
  // average with the temperature is below 80, so no regression.
  closeTo(heatIndexF(75, 50), 74.55, 1e-9);
  // Near the boundary: 80 °F / 40% stays on the simple formula.
  closeTo(heatIndexF(80, 40), 79.58, 1e-9);
});

test('heat index uses the full Rothfusz regression at 80 °F and above', () => {
  // 90 °F / 40%: no humidity adjustment applies.
  closeTo(heatIndexF(90, 40), 90.68, 0.05);
});

test('heat index low-humidity adjustment subtracts', () => {
  // 100 °F / 10%: unadjusted regression is 94.75; the NWS
  // adjustment subtracts ((13-10)/4)*sqrt((17-|100-95|)/17) = 0.63.
  closeTo(heatIndexF(100, 10), 94.12, 0.05);
  assert.ok(heatIndexF(100, 10) < heatIndexF(100, 13));
});

test('heat index high-humidity adjustment adds', () => {
  // 85 °F / 90%: unadjusted regression is 101.58; the NWS
  // adjustment adds ((90-85)/10)*((87-85)/5) = 0.20.
  closeTo(heatIndexF(85, 90), 101.78, 0.05);
  assert.ok(heatIndexF(85, 90) > heatIndexF(85, 85));
});

test('heat index can fall below the air temperature in dry air', () => {
  assert.ok(heatIndexF(100, 15) < 100);
  assert.ok(heatIndexF(100, 10) < 100);
});

test('heat index categories are the four NWS bands', () => {
  assert.equal(HEAT_INDEX_CATEGORIES.length, 4);
  assert.ok(Object.isFrozen(HEAT_INDEX_CATEGORIES));
  assert.deepEqual(
    HEAT_INDEX_CATEGORIES.map((entry) => entry.name),
    ['Caution', 'Extreme Caution', 'Danger', 'Extreme Danger'],
  );
  assert.deepEqual(
    HEAT_INDEX_CATEGORIES.map((entry) => entry.minF),
    [80, 90, 103, 125],
  );
  assert.deepEqual(
    HEAT_INDEX_CATEGORIES.map((entry) => entry.maxF),
    [90, 103, 125, null],
  );
  for (const entry of HEAT_INDEX_CATEGORIES) {
    assert.ok(Object.isFrozen(entry));
  }
});

test('heat index category boundaries take the higher band', () => {
  assert.equal(heatIndexCategory(79.9), BELOW_CAUTION);
  assert.equal(heatIndexCategory(80).name, 'Caution');
  assert.equal(heatIndexCategory(89.9).name, 'Caution');
  assert.equal(heatIndexCategory(90).name, 'Extreme Caution');
  assert.equal(heatIndexCategory(102.9).name, 'Extreme Caution');
  assert.equal(heatIndexCategory(103).name, 'Danger');
  assert.equal(heatIndexCategory(124.9).name, 'Danger');
  assert.equal(heatIndexCategory(125).name, 'Extreme Danger');
  assert.equal(heatIndexCategory(200).name, 'Extreme Danger');
  assert.equal(heatIndexCategory(80), HEAT_INDEX_CATEGORIES[0]);
  assert.equal(heatIndexCategory(125), HEAT_INDEX_CATEGORIES[3]);
});

test('heat index category effects come from the NWS table', () => {
  assert.match(HEAT_INDEX_CATEGORIES[0].effect, /Fatigue possible/);
  assert.match(HEAT_INDEX_CATEGORIES[1].effect, /heat exhaustion possible/);
  assert.match(HEAT_INDEX_CATEGORIES[2].effect, /heat exhaustion likely/);
  assert.equal(HEAT_INDEX_CATEGORIES[3].effect, 'Heat stroke highly likely');
});

test('wind chill matches the NWS chart anchors', () => {
  closeTo(windChillF(20, 20), 4, 0.5, '20 °F / 20 mph');
  closeTo(windChillF(30, 10), 21.2, 0.3, '30 °F / 10 mph');
  closeTo(windChillF(0, 10), -16, 0.5, '0 °F / 10 mph');
  closeTo(windChillF(40, 5), 36.5, 0.5, '40 °F / 5 mph');
  closeTo(windChillF(10, 25), -11, 0.5, '10 °F / 25 mph');
});

test('wind chill domain constants match the NWS definition', () => {
  assert.equal(WIND_CHILL_MAX_TEMP_F, 50);
  assert.equal(WIND_CHILL_MIN_WIND_MPH, 3);
});

test('wind chill is colder than the air temperature', () => {
  assert.ok(windChillF(30, 10) < 30);
  assert.ok(windChillF(0, 20) < 0);
});

test('dew point matches worked Magnus examples', () => {
  closeTo(dewPointC(30, 70), 23.93, 0.05, '30 °C / 70%');
  closeTo(dewPointC(25, 60), 16.7, 0.05, '25 °C / 60%');
  closeTo(dewPointC(20, 50), 9.26, 0.05, '20 °C / 50%');
});

test('dew point equals the air temperature at 100% humidity', () => {
  closeTo(dewPointC(25, 100), 25, 1e-9);
  closeTo(dewPointC(0, 100), 0, 1e-9);
  closeTo(dewPointF(77, 100), 77, 1e-9);
});

test('dew point constants are the Alduchov & Eskridge values', () => {
  assert.equal(DEW_POINT_MAGNUS_A, 17.625);
  assert.equal(DEW_POINT_MAGNUS_B_C, 243.04);
});

test('Celsius and Fahrenheit entry points agree', () => {
  closeTo(
    heatIndexC((100 - 32) * (5 / 9), 55),
    ((heatIndexF(100, 55) - 32) * 5) / 9,
    1e-9,
  );
  closeTo(
    windChillC((20 - 32) * (5 / 9), 20 * 1.609344),
    ((windChillF(20, 20) - 32) * 5) / 9,
    1e-9,
  );
  closeTo(dewPointF(86, 70), (dewPointC(30, 70) * 9) / 5 + 32, 1e-9);
  closeTo(dewPointF(77, 60), 62.06, 0.1, '77 °F / 60%');
});

test('feels-like picks heat index when hot and humid', () => {
  const result = feelsLikeF({ tempF: 100, humidityPct: 55, windMph: 5 });
  assert.equal(result.method, 'heat-index');
  assert.equal(result.valueF, heatIndexF(100, 55));
  assert.ok(Object.isFrozen(result));
});

test('feels-like picks wind chill when cold and windy', () => {
  const result = feelsLikeF({ tempF: 20, humidityPct: 50, windMph: 20 });
  assert.equal(result.method, 'wind-chill');
  assert.equal(result.valueF, windChillF(20, 20));
});

test('feels-like falls back to air temperature when mild or calm', () => {
  assert.deepEqual(feelsLikeF({ tempF: 70, humidityPct: 50, windMph: 10 }), {
    valueF: 70,
    method: 'air-temperature',
  });
  // Cold but calm (wind at the 3 mph floor): no wind chill.
  assert.deepEqual(feelsLikeF({ tempF: 30, windMph: 3 }), {
    valueF: 30,
    method: 'air-temperature',
  });
  // Hot but humidity unknown: no heat index.
  assert.deepEqual(feelsLikeF({ tempF: 90 }), {
    valueF: 90,
    method: 'air-temperature',
  });
});

test('feels-like boundaries follow the NWS domains', () => {
  assert.equal(feelsLikeF({ tempF: 80, humidityPct: 50 }).method, 'heat-index');
  assert.equal(feelsLikeF({ tempF: 50, windMph: 10 }).method, 'wind-chill');
  assert.equal(
    feelsLikeF({ tempF: 50.1, windMph: 10 }).method,
    'air-temperature',
  );
});

test('invalid inputs throw', () => {
  for (const bad of [Number.NaN, Infinity, '90', undefined, null]) {
    assert.throws(() => heatIndexF(bad, 50), TypeError, String(bad));
    assert.throws(() => heatIndexF(90, bad), TypeError, String(bad));
    assert.throws(() => windChillF(bad, 10), TypeError, String(bad));
    assert.throws(() => windChillF(30, bad), TypeError, String(bad));
    assert.throws(() => dewPointC(bad, 50), TypeError, String(bad));
    assert.throws(() => dewPointC(20, bad), TypeError, String(bad));
    assert.throws(() => heatIndexCategory(bad), TypeError, String(bad));
  }
  for (const badRh of [-1, 101]) {
    assert.throws(() => heatIndexF(90, badRh), RangeError);
    assert.throws(() => dewPointC(20, badRh), RangeError);
    assert.throws(
      () => feelsLikeF({ tempF: 90, humidityPct: badRh }),
      RangeError,
    );
  }
  // Dew point needs strictly positive humidity (ln(0) is undefined).
  assert.throws(() => dewPointC(20, 0), RangeError);
  // Wind chill outside its NWS domain throws.
  assert.throws(() => windChillF(51, 10), RangeError);
  assert.throws(() => windChillF(30, 3), RangeError);
  assert.throws(() => windChillF(30, 0), RangeError);
  assert.throws(() => windChillF(30, -1), RangeError);
  assert.throws(() => feelsLikeF({ tempF: 30, windMph: -1 }), RangeError);
  assert.throws(() => feelsLikeF({}), TypeError);
});
