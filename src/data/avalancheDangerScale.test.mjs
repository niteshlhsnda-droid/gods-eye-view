import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVALANCHE_DANGER_LEVELS,
  EAWS_DANGER_PATTERNS,
  MOST_ACCIDENTS_LEVEL,
  STEEP_SLOPE_DEGREES,
  avalancheDangerLevel,
  avalancheDangerPattern,
  isSignificantDanger,
} from './avalancheDangerScale.js';

/**
 * External anchors (fetched 2026-10-18):
 * - EAWS matrix derivation paper (Part A), Table 1 "European avalanche
 *   danger scale (EAWS, 2023c)" — verbatim stability and
 *   likelihood-of-triggering text for levels 1-5, plus the steep-slope
 *   (30°) and additional-load footnotes,
 *   https://nhess.copernicus.org/preprints/nhess-2024-48/nhess-2024-48-manuscript-version3.pdf
 * - Icelandic Met Office (EAWS member service),
 *   https://en.vedur.is/avalanches/forecast/help/
 * - EAWS bulletins showing dp-code usage, e.g.
 *   https://static.avalanche.report/simple/2023-01-04/en.html
 */

test('table has 5 frozen levels 1-5 in order', () => {
  assert.equal(AVALANCHE_DANGER_LEVELS.length, 5);
  assert.ok(Object.isFrozen(AVALANCHE_DANGER_LEVELS));
  AVALANCHE_DANGER_LEVELS.forEach((entry, index) => {
    assert.equal(entry.level, index + 1);
    assert.ok(Object.isFrozen(entry));
  });
});

test('names follow the EAWS scale', () => {
  assert.deepEqual(
    AVALANCHE_DANGER_LEVELS.map((entry) => entry.name),
    ['Low', 'Moderate', 'Considerable', 'High', 'Very High'],
  );
});

test('stability column matches the published EAWS wording verbatim', () => {
  assert.deepEqual(
    AVALANCHE_DANGER_LEVELS.map((entry) => entry.stability),
    [
      'The snowpack is well bonded and stable in general.',
      'The snowpack is only moderately well bonded on some steep slopes*; otherwise well bonded in general.',
      'The snowpack is moderately to poorly bonded on many steep slopes*.',
      'The snowpack is poorly bonded on most steep slopes*.',
      'The snowpack is poorly bonded and largely unstable in general.',
    ],
  );
});

test('triggering column matches the published EAWS wording verbatim', () => {
  assert.deepEqual(
    AVALANCHE_DANGER_LEVELS.map((entry) => entry.triggering),
    [
      'Triggering is generally possible only from high additional loads** in isolated areas of very steep, extreme terrain. Only small and medium-sized natural avalanches are possible.',
      'Triggering is possible primarily from high additional loads**, particularly on the indicated steep slopes*. Very large natural avalanches are unlikely.',
      'Triggering is possible even from low additional loads** particularly on the indicated steep slopes*. In certain situations some large, in isolated cases very large natural avalanches are possible.',
      'Triggering is likely even by low additional loads** on many steep slopes*. In some cases, numerous large and often very large natural avalanches can be expected.',
      'Numerous very large and often extremely large natural avalanches can be expected, even in moderately steep terrain*.',
    ],
  );
});

test('travel advice is present for every level and escalates to avoidance', () => {
  for (const entry of AVALANCHE_DANGER_LEVELS) {
    assert.equal(typeof entry.travelAdvice, 'string');
    assert.ok(entry.travelAdvice.length > 0);
  }
  assert.equal(
    AVALANCHE_DANGER_LEVELS[0].travelAdvice,
    'Travel is generally safe.',
  );
  assert.match(
    AVALANCHE_DANGER_LEVELS[4].travelAdvice,
    /Avoid avalanche terrain/,
  );
});

test('EAWS steep-slope definition is 30 degrees', () => {
  assert.equal(STEEP_SLOPE_DEGREES, 30);
});

test('most accidents occur at Considerable (level 3)', () => {
  assert.equal(MOST_ACCIDENTS_LEVEL, 3);
  assert.equal(
    AVALANCHE_DANGER_LEVELS[MOST_ACCIDENTS_LEVEL - 1].name,
    'Considerable',
  );
});

test('avalancheDangerLevel maps 1-5 to the right entries', () => {
  for (let level = 1; level <= 5; level += 1) {
    const entry = avalancheDangerLevel(level);
    assert.equal(entry.level, level);
    assert.equal(entry, AVALANCHE_DANGER_LEVELS[level - 1]);
  }
});

test('avalancheDangerLevel returns null for unknown or out-of-range input, never throws', () => {
  for (const bad of [
    0,
    6,
    -1,
    100,
    2.5,
    NaN,
    Infinity,
    'low',
    '3',
    null,
    undefined,
    {},
    [],
  ]) {
    assert.equal(avalancheDangerLevel(bad), null);
  }
});

test('ten frozen danger patterns dp1-dp10 in order', () => {
  assert.equal(EAWS_DANGER_PATTERNS.length, 10);
  assert.ok(Object.isFrozen(EAWS_DANGER_PATTERNS));
  EAWS_DANGER_PATTERNS.forEach((entry, index) => {
    assert.equal(entry.code, `dp${index + 1}`);
    assert.ok(Object.isFrozen(entry));
    assert.ok(entry.name.length > 0);
    assert.ok(entry.description.length > 0);
  });
});

test('danger pattern names match the EAWS typical situations', () => {
  assert.deepEqual(
    EAWS_DANGER_PATTERNS.map((entry) => entry.name),
    [
      'Deep persistent weak layer',
      'Gliding snow',
      'Rain',
      'Cold following warm / warm following cold',
      'Snowfall after a long period of cold',
      'Cold, loose snow and wind',
      'Snow-poor areas in snow-rich surroundings',
      'Buried surface hoar',
      'Graupel',
      'Springtime scenario',
    ],
  );
});

test('avalancheDangerPattern accepts dp codes, bulletin style, and plain numbers', () => {
  assert.equal(
    avalancheDangerPattern('dp1').name,
    'Deep persistent weak layer',
  );
  assert.equal(avalancheDangerPattern('DP.3').name, 'Rain');
  assert.equal(avalancheDangerPattern('dp10').name, 'Springtime scenario');
  assert.equal(
    avalancheDangerPattern(7).name,
    'Snow-poor areas in snow-rich surroundings',
  );
  assert.equal(avalancheDangerPattern('dp9'), EAWS_DANGER_PATTERNS[8]);
});

test('avalancheDangerPattern returns null for unknown codes, never throws', () => {
  for (const bad of [
    'dp0',
    'dp11',
    'dp',
    'wind slab',
    '',
    0,
    11,
    2.5,
    NaN,
    null,
    undefined,
    {},
    [],
  ]) {
    assert.equal(avalancheDangerPattern(bad), null);
  }
});

test('isSignificantDanger is restrictive from Considerable up, null when unknown', () => {
  assert.equal(isSignificantDanger(1), false);
  assert.equal(isSignificantDanger(2), false);
  assert.equal(isSignificantDanger(3), true);
  assert.equal(isSignificantDanger(4), true);
  assert.equal(isSignificantDanger(5), true);
  assert.equal(isSignificantDanger(0), null);
  assert.equal(isSignificantDanger(6), null);
  assert.equal(isSignificantDanger('high'), null);
  assert.equal(isSignificantDanger(null), null);
});
