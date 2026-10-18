import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_STAGE,
  BELOW_ACTION,
  FLOOD_CATEGORIES,
  MAJOR_FLOOD,
  MINOR_FLOOD,
  MODERATE_FLOOD,
  classifyFloodStage,
  floodStage,
  isFloodingCategory,
} from './floodCategories.js';

/**
 * External anchors, all fetched 2026-10-18:
 * - NWS "About Hydrograph" (https://water.noaa.gov/about/hydrograph):
 *   official definitions of Action Stage / Minor / Moderate / Major
 *   flooding and of stage (water-surface level relative to a datum).
 * - NOAA NWS Glossary, "Flood Categories": the Minor / Moderate /
 *   Major / Record flooding definitions and the structural note that
 *   "all three of the lower flood categories (minor, moderate, major)
 *   do not necessarily exist for a given forecast point... However, at
 *   least one of these three flood categories must start at flood
 *   stage".
 * - NWS AHPS regional-map inline-frame documentation: observation-map
 *   marker colors Minor (orange), Moderate (red), Major (violet),
 *   Action (yellow), no flooding (green).
 *
 * The fixture thresholds below are synthetic (a generic four-threshold
 * gauge); the anchors under test are the NWS definitions, the closed
 * lower bounds ("at or above flood stage"), and the glossary's
 * missing-category rule -- not any real gauge's numbers.
 */

const GAUGE = Object.freeze({ action: 18, minor: 20, moderate: 24, major: 28 });

/** Small stage offset so epsilon tests stay clear of float noise. */
const EPS = 1e-6;

test('category list has the five AHPS categories in ascending severity', () => {
  assert.deepEqual(
    FLOOD_CATEGORIES.map((c) => c.key),
    [
      'below_action',
      'action_stage',
      'minor_flood',
      'moderate_flood',
      'major_flood',
    ],
  );
});

test('category objects are frozen with NWS definitions and AHPS marker colors', () => {
  for (const category of FLOOD_CATEGORIES) {
    assert.ok(Object.isFrozen(category), `${category.key} should be frozen`);
    assert.ok(
      category.definition.length > 20,
      `${category.key} should carry its definition`,
    );
  }
  assert.ok(MINOR_FLOOD.definition.includes('Minimal or no property damage'));
  assert.ok(
    MODERATE_FLOOD.definition.includes(
      'Some inundation of structures and roads',
    ),
  );
  assert.ok(
    MAJOR_FLOOD.definition.includes(
      'Extensive inundation of structures and roads',
    ),
  );
  assert.ok(ACTION_STAGE.definition.includes('mitigation action'));
  assert.equal(MINOR_FLOOD.markerColor, 'orange');
  assert.equal(MODERATE_FLOOD.markerColor, 'red');
  assert.equal(MAJOR_FLOOD.markerColor, 'violet');
  assert.equal(ACTION_STAGE.markerColor, 'yellow');
  assert.equal(BELOW_ACTION.markerColor, 'green');
});

test('stage below action threshold is Below Action', () => {
  assert.equal(classifyFloodStage(17.5, GAUGE), BELOW_ACTION);
  assert.equal(classifyFloodStage(GAUGE.action - EPS, GAUGE), BELOW_ACTION);
});

test('stage exactly at the action threshold is Action Stage (closed lower bound)', () => {
  assert.equal(classifyFloodStage(GAUGE.action, GAUGE), ACTION_STAGE);
  assert.equal(classifyFloodStage(GAUGE.action + EPS, GAUGE), ACTION_STAGE);
});

test('stage exactly at the minor threshold is Minor Flood', () => {
  assert.equal(classifyFloodStage(GAUGE.minor, GAUGE), MINOR_FLOOD);
  assert.equal(classifyFloodStage(GAUGE.minor - EPS, GAUGE), ACTION_STAGE);
  assert.equal(classifyFloodStage(GAUGE.minor + EPS, GAUGE), MINOR_FLOOD);
});

test('stage exactly at the moderate threshold is Moderate Flood', () => {
  assert.equal(classifyFloodStage(GAUGE.moderate, GAUGE), MODERATE_FLOOD);
  assert.equal(classifyFloodStage(GAUGE.moderate - EPS, GAUGE), MINOR_FLOOD);
});

test('stage exactly at the major threshold is Major Flood', () => {
  assert.equal(classifyFloodStage(GAUGE.major, GAUGE), MAJOR_FLOOD);
  assert.equal(classifyFloodStage(GAUGE.major - EPS, GAUGE), MODERATE_FLOOD);
  assert.equal(classifyFloodStage(GAUGE.major + EPS, GAUGE), MAJOR_FLOOD);
});

test('stage far above major stays Major Flood (open-ended top band)', () => {
  assert.equal(classifyFloodStage(GAUGE.major + 10, GAUGE), MAJOR_FLOOD);
});

test('missing action threshold still classifies flood bands', () => {
  const noAction = { minor: 20, moderate: 24, major: 28 };
  assert.equal(classifyFloodStage(19.9, noAction), BELOW_ACTION);
  assert.equal(classifyFloodStage(20, noAction), MINOR_FLOOD);
  assert.equal(classifyFloodStage(28, noAction), MAJOR_FLOOD);
});

test('gauge where flooding begins at moderate (NWS missing-category rule)', () => {
  // Per the NWS glossary, minor need not exist at a gauge; the flood
  // stage here starts at moderate.
  const moderateOnly = { action: 18, moderate: 24, major: 28 };
  assert.equal(classifyFloodStage(23.999, moderateOnly), ACTION_STAGE);
  assert.equal(classifyFloodStage(24, moderateOnly), MODERATE_FLOOD);
  assert.equal(classifyFloodStage(27.999, moderateOnly), MODERATE_FLOOD);
  assert.equal(classifyFloodStage(28, moderateOnly), MAJOR_FLOOD);
});

test('gauge with only a major threshold defined', () => {
  const majorOnly = { major: 28 };
  assert.equal(classifyFloodStage(27.9, majorOnly), BELOW_ACTION);
  assert.equal(classifyFloodStage(28, majorOnly), MAJOR_FLOOD);
});

test('floodStage returns the lowest defined flood threshold', () => {
  assert.equal(floodStage(GAUGE), 20);
  assert.equal(floodStage({ action: 18, moderate: 24, major: 28 }), 24);
  assert.equal(floodStage({ major: 28 }), 28);
});

test('isFloodingCategory is true only for the three NWS flood categories', () => {
  assert.equal(isFloodingCategory(MINOR_FLOOD), true);
  assert.equal(isFloodingCategory(MODERATE_FLOOD), true);
  assert.equal(isFloodingCategory(MAJOR_FLOOD), true);
  assert.equal(isFloodingCategory(ACTION_STAGE), false);
  assert.equal(isFloodingCategory(BELOW_ACTION), false);
});

test('isFloodingCategory rejects non-category inputs', () => {
  assert.throws(() => isFloodingCategory(null), TypeError);
  assert.throws(() => isFloodingCategory('minor_flood'), TypeError);
  assert.throws(() => isFloodingCategory(3), TypeError);
});

test('non-finite or non-numeric stage is rejected', () => {
  assert.throws(() => classifyFloodStage(NaN, GAUGE), TypeError);
  assert.throws(() => classifyFloodStage(Infinity, GAUGE), TypeError);
  assert.throws(() => classifyFloodStage('20', GAUGE), TypeError);
  assert.throws(() => classifyFloodStage(undefined, GAUGE), TypeError);
});

test('thresholds must be an object', () => {
  assert.throws(() => classifyFloodStage(20, null), TypeError);
  assert.throws(() => classifyFloodStage(20, [18, 20, 24, 28]), TypeError);
  assert.throws(() => classifyFloodStage(20, '20'), TypeError);
});

test('thresholds must define at least one flood level (NWS glossary rule)', () => {
  assert.throws(() => classifyFloodStage(20, {}), RangeError);
  assert.throws(() => classifyFloodStage(20, { action: 18 }), RangeError);
  assert.throws(() => floodStage({ action: 18 }), RangeError);
});

test('thresholds must be strictly increasing action < minor < moderate < major', () => {
  assert.throws(
    () => classifyFloodStage(20, { action: 20, minor: 20 }),
    RangeError,
  );
  assert.throws(
    () => classifyFloodStage(20, { action: 21, minor: 20 }),
    RangeError,
  );
  assert.throws(
    () => classifyFloodStage(20, { minor: 24, moderate: 24 }),
    RangeError,
  );
  assert.throws(
    () => classifyFloodStage(20, { minor: 20, moderate: 24, major: 23 }),
    RangeError,
  );
  assert.throws(
    () => classifyFloodStage(20, { minor: 20, moderate: 24, major: 24 }),
    RangeError,
  );
});

test('non-finite threshold values are rejected', () => {
  assert.throws(() => classifyFloodStage(20, { minor: NaN }), TypeError);
  assert.throws(() => classifyFloodStage(20, { minor: Infinity }), TypeError);
  assert.throws(() => classifyFloodStage(20, { minor: '20' }), TypeError);
});

test('equal thresholds between bands are never accepted, even far from the reading', () => {
  // A degenerate gauge must not silently collapse two categories into one.
  assert.throws(
    () => classifyFloodStage(10, { action: 10, minor: 10 }),
    RangeError,
  );
});
