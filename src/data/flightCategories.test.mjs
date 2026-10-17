import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLIGHT_CATEGORIES,
  FLIGHT_CATEGORY_CEILING_COVERAGES,
  FLIGHT_CATEGORY_INFO,
  FLIGHT_CATEGORY_NON_CEILING_COVERAGES,
  IFR_CEILING_FT,
  IFR_VISIBILITY_SM,
  MVFR_CEILING_FT,
  MVFR_VISIBILITY_SM,
  VFR_CEILING_FT,
  VFR_VISIBILITY_SM,
  VLIFR_CEILING_FT,
  VLIFR_VISIBILITY_SM,
  ceilingCategory,
  ceilingFromCloudLayers,
  flightCategory,
  flightCategoryDetailed,
  visibilityCategory,
  worseFlightCategory,
} from './flightCategories.js';

/**
 * External anchors, all fetched and verified 2026-10-17:
 * - FAA Aeronautical Information Manual, Chapter 7, §7-1-7
 *   "Categorical Ceiling and Visibility Conditions"
 *   (https://www.faa.gov/air_traffic/publications/ATpubs/AIM_html/chap7_section_1.html):
 *   LIFR ceiling < 500 ft and/or visibility < 1 sm; IFR ceiling 500 to
 *   < 1,000 ft and/or visibility 1 to < 3 sm; MVFR ceiling 1,000 to
 *   3,000 ft and/or visibility 3 to 5 sm inclusive; VFR ceiling
 *   > 3,000 ft and visibility > 5 sm, includes sky clear.
 * - NWS "Ceiling and Visibility"
 *   (https://www.weather.gov/zme/safety_cigvis) for the same threshold
 *   table and visibility in statute miles.
 * - ForeFlight (https://blog.foreflight.com/staging/9401/2015/02/19/flight-rules-thrown-out/)
 *   for NWS VLIFR = ceiling < 200 ft and/or visibility < 1/2 sm, and
 *   for flight category describing observed/forecast weather, not the
 *   flight rules in force.
 */

test('threshold constants match the FAA AIM table', () => {
  assert.equal(VFR_CEILING_FT, 3000);
  assert.equal(VFR_VISIBILITY_SM, 5);
  assert.equal(MVFR_CEILING_FT, 1000);
  assert.equal(MVFR_VISIBILITY_SM, 3);
  assert.equal(IFR_CEILING_FT, 500);
  assert.equal(IFR_VISIBILITY_SM, 1);
  assert.equal(VLIFR_CEILING_FT, 200);
  assert.equal(VLIFR_VISIBILITY_SM, 0.5);
});

test('category list and info match the conventional map vocabulary', () => {
  assert.deepEqual(FLIGHT_CATEGORIES, ['VFR', 'MVFR', 'IFR', 'LIFR']);
  assert.ok(Object.isFrozen(FLIGHT_CATEGORIES));
  assert.equal(FLIGHT_CATEGORY_INFO.VFR.name, 'Visual Flight Rules');
  assert.equal(FLIGHT_CATEGORY_INFO.VFR.color, 'green');
  assert.equal(FLIGHT_CATEGORY_INFO.MVFR.name, 'Marginal Visual Flight Rules');
  assert.equal(FLIGHT_CATEGORY_INFO.MVFR.color, 'blue');
  assert.equal(FLIGHT_CATEGORY_INFO.IFR.name, 'Instrument Flight Rules');
  assert.equal(FLIGHT_CATEGORY_INFO.IFR.color, 'red');
  assert.equal(FLIGHT_CATEGORY_INFO.LIFR.name, 'Low Instrument Flight Rules');
  assert.equal(FLIGHT_CATEGORY_INFO.LIFR.color, 'magenta');
  assert.equal(
    FLIGHT_CATEGORY_INFO.VLIFR.name,
    'Very Low Instrument Flight Rules',
  );
  assert.equal(FLIGHT_CATEGORY_INFO.VLIFR.color, 'magenta');
  assert.ok(Object.isFrozen(FLIGHT_CATEGORY_INFO));
  assert.ok(Object.isFrozen(FLIGHT_CATEGORY_INFO.VFR));
  assert.deepEqual(FLIGHT_CATEGORY_CEILING_COVERAGES, ['BKN', 'OVC', 'VV']);
  assert.deepEqual(FLIGHT_CATEGORY_NON_CEILING_COVERAGES, [
    'FEW',
    'SCT',
    'CLR',
    'SKC',
    'NSC',
    'NCD',
  ]);
});

test('ceilingCategory honours every AIM boundary', () => {
  assert.equal(ceilingCategory(null), 'VFR');
  assert.equal(ceilingCategory(undefined), 'VFR');
  assert.equal(ceilingCategory(3001), 'VFR');
  assert.equal(ceilingCategory(3000), 'MVFR');
  assert.equal(ceilingCategory(1000), 'MVFR');
  assert.equal(ceilingCategory(999), 'IFR');
  assert.equal(ceilingCategory(500), 'IFR');
  assert.equal(ceilingCategory(499), 'LIFR');
  assert.equal(ceilingCategory(0), 'LIFR');
});

test('visibilityCategory honours every AIM boundary', () => {
  assert.equal(visibilityCategory(5.1), 'VFR');
  assert.equal(visibilityCategory(5), 'MVFR');
  assert.equal(visibilityCategory(3), 'MVFR');
  assert.equal(visibilityCategory(2.9), 'IFR');
  assert.equal(visibilityCategory(1), 'IFR');
  assert.equal(visibilityCategory(0.9), 'LIFR');
  assert.equal(visibilityCategory(0), 'LIFR');
});

test('flightCategory takes the worse of ceiling and visibility', () => {
  assert.equal(
    flightCategory({ ceilingFt: 5000, visibilitySm: 10 }),
    'VFR',
  );
  assert.equal(
    flightCategory({ ceilingFt: 2500, visibilitySm: 10 }),
    'MVFR',
  );
  assert.equal(
    flightCategory({ ceilingFt: 5000, visibilitySm: 2 }),
    'IFR',
  );
  // The fog case from the module docs: high ceiling, near-zero visibility.
  assert.equal(
    flightCategory({ ceilingFt: 5000, visibilitySm: 0.5 }),
    'LIFR',
  );
  assert.equal(
    flightCategory({ ceilingFt: 400, visibilitySm: 10 }),
    'LIFR',
  );
  // No ceiling (clear / few / scattered only) counts as VFR.
  assert.equal(flightCategory({ visibilitySm: 10 }), 'VFR');
  assert.equal(flightCategory({ ceilingFt: null, visibilitySm: 2 }), 'IFR');
  // Exact AIM boundaries: 3000 ft / 5 sm is MVFR, not VFR.
  assert.equal(
    flightCategory({ ceilingFt: 3000, visibilitySm: 5 }),
    'MVFR',
  );
  assert.equal(
    flightCategory({ ceilingFt: 1000, visibilitySm: 3 }),
    'MVFR',
  );
  assert.equal(
    flightCategory({ ceilingFt: 500, visibilitySm: 1 }),
    'IFR',
  );
});

test('flightCategoryDetailed splits the worst end into VLIFR', () => {
  assert.equal(
    flightCategoryDetailed({ ceilingFt: 199, visibilitySm: 10 }),
    'VLIFR',
  );
  assert.equal(
    flightCategoryDetailed({ ceilingFt: 5000, visibilitySm: 0.4 }),
    'VLIFR',
  );
  // Boundaries are exclusive: exactly 200 ft / 0.5 sm stays LIFR.
  assert.equal(
    flightCategoryDetailed({ ceilingFt: 200, visibilitySm: 10 }),
    'LIFR',
  );
  assert.equal(
    flightCategoryDetailed({ ceilingFt: 5000, visibilitySm: 0.5 }),
    'LIFR',
  );
  // Above the VLIFR split it agrees with the four-category classifier.
  assert.equal(
    flightCategoryDetailed({ ceilingFt: 5000, visibilitySm: 10 }),
    'VFR',
  );
  assert.equal(
    flightCategoryDetailed({ ceilingFt: 2500, visibilitySm: 10 }),
    'MVFR',
  );
  assert.equal(
    flightCategoryDetailed({ ceilingFt: 800, visibilitySm: 2 }),
    'IFR',
  );
  assert.equal(
    flightCategoryDetailed({ ceilingFt: 300, visibilitySm: 0.75 }),
    'LIFR',
  );
  assert.equal(flightCategoryDetailed({ visibilitySm: 0.4 }), 'VLIFR');
  assert.equal(flightCategoryDetailed({ visibilitySm: 10 }), 'VFR');
});

test('worseFlightCategory orders best to worst', () => {
  assert.equal(worseFlightCategory('VFR', 'VFR'), 'VFR');
  assert.equal(worseFlightCategory('VFR', 'LIFR'), 'LIFR');
  assert.equal(worseFlightCategory('LIFR', 'VFR'), 'LIFR');
  assert.equal(worseFlightCategory('MVFR', 'IFR'), 'IFR');
  assert.equal(worseFlightCategory('IFR', 'MVFR'), 'IFR');
  assert.equal(worseFlightCategory('LIFR', 'VLIFR'), 'VLIFR');
  assert.equal(worseFlightCategory('VLIFR', 'VFR'), 'VLIFR');
  assert.throws(() => worseFlightCategory('VFR', 'CAVOK'), TypeError);
  assert.throws(() => worseFlightCategory('CAVOK', 'VFR'), TypeError);
});

test('ceilingFromCloudLayers takes the lowest BKN / OVC / VV layer', () => {
  assert.equal(ceilingFromCloudLayers([]), null);
  assert.equal(
    ceilingFromCloudLayers([
      { coverage: 'FEW', baseFt: 1000 },
      { coverage: 'SCT', baseFt: 2000 },
    ]),
    null,
  );
  assert.equal(
    ceilingFromCloudLayers([{ coverage: 'CLR' }]),
    null,
  );
  assert.equal(
    ceilingFromCloudLayers([
      { coverage: 'FEW', baseFt: 800 },
      { coverage: 'BKN', baseFt: 2500 },
    ]),
    2500,
  );
  assert.equal(
    ceilingFromCloudLayers([
      { coverage: 'OVC', baseFt: 3000 },
      { coverage: 'BKN', baseFt: 1500 },
    ]),
    1500,
  );
  assert.equal(
    ceilingFromCloudLayers([{ coverage: 'VV', baseFt: 300 }]),
    300,
  );
  assert.equal(
    ceilingFromCloudLayers([
      { coverage: 'SKC' },
      { coverage: 'NSC' },
      { coverage: 'NCD' },
    ]),
    null,
  );
});

test('invalid inputs throw TypeError or RangeError', () => {
  assert.throws(() => ceilingCategory(-1), RangeError);
  assert.throws(() => ceilingCategory(Number.NaN), TypeError);
  assert.throws(() => ceilingCategory(Number.POSITIVE_INFINITY), TypeError);
  assert.throws(() => ceilingCategory('1000'), TypeError);
  assert.throws(() => visibilityCategory(-0.5), RangeError);
  assert.throws(() => visibilityCategory(undefined), TypeError);
  assert.throws(() => flightCategory(null), TypeError);
  assert.throws(() => flightCategory('VFR'), TypeError);
  assert.throws(() => flightCategory({}), TypeError);
  assert.throws(
    () => flightCategory({ ceilingFt: -10, visibilitySm: 10 }),
    RangeError,
  );
  assert.throws(
    () => flightCategoryDetailed({ ceilingFt: 1000, visibilitySm: -1 }),
    RangeError,
  );
  assert.throws(() => ceilingFromCloudLayers(null), TypeError);
  assert.throws(() => ceilingFromCloudLayers([null]), TypeError);
  assert.throws(
    () => ceilingFromCloudLayers([{ coverage: 5 }]),
    TypeError,
  );
  assert.throws(
    () => ceilingFromCloudLayers([{ coverage: 'BKN' }]),
    TypeError,
  );
  assert.throws(
    () => ceilingFromCloudLayers([{ coverage: 'XYZ', baseFt: 1000 }]),
    TypeError,
  );
});
