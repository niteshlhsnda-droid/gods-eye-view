import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODIFIED_MERCALLI_BY_INTENSITY,
  MODIFIED_MERCALLI_BY_ROMAN,
  MODIFIED_MERCALLI_MAX,
  MODIFIED_MERCALLI_MIN,
  MODIFIED_MERCALLI_SCALE,
  classifyModifiedMercalli,
  modifiedMercalliDescription,
  modifiedMercalliShaking,
} from './modifiedMercalli.js';

/**
 * External anchors. Every expected value below is a table
 * entry from the primary sources, not a computation:
 * - USGS, "The Severity of an Earthquake" (GIP 1989-288-913):
 *   the abbreviated description of all 12 levels.
 *   https://pubs.usgs.gov/gip/earthq4/severitygip.html
 * - USGS ShakeMap legend: perceived-shaking labels I Not
 *   felt, II-III Weak, IV Light, V Moderate, VI Strong,
 *   VII Very Strong, VIII Severe, IX Violent, X Extreme.
 *   https://earthquake.usgs.gov/product/losspager/nn00510518/us/1442597448496/expolegend.pdf
 */

test('scale table has 12 entries in weakest-first order with frozen entries', () => {
  assert.equal(MODIFIED_MERCALLI_MIN, 1);
  assert.equal(MODIFIED_MERCALLI_MAX, 12);
  assert.equal(MODIFIED_MERCALLI_SCALE.length, 12);
  assert.ok(Object.isFrozen(MODIFIED_MERCALLI_SCALE));
  for (const entry of MODIFIED_MERCALLI_SCALE) {
    assert.ok(Object.isFrozen(entry));
  }
  assert.deepEqual(
    MODIFIED_MERCALLI_SCALE.map((entry) => entry.intensity),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.deepEqual(
    MODIFIED_MERCALLI_SCALE.map((entry) => entry.roman),
    ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
  );
  assert.deepEqual(
    MODIFIED_MERCALLI_SCALE.map((entry) => entry.perceivedShaking),
    [
      'Not felt',
      'Weak',
      'Weak',
      'Light',
      'Moderate',
      'Strong',
      'Very strong',
      'Severe',
      'Violent',
      'Extreme',
      'Extreme',
      'Extreme',
    ],
  );
});

test('descriptions are the verbatim USGS abridged wordings', () => {
  assert.deepEqual(
    MODIFIED_MERCALLI_SCALE.map((entry) => entry.description),
    [
      'Not felt except by a very few under especially favorable conditions.',
      'Felt only by a few persons at rest, especially on upper floors of buildings. Delicately suspended objects may swing.',
      'Felt quite noticeably by persons indoors, especially on upper floors of buildings. Many people do not recognize it as an earthquake. Standing motor cars may rock slightly. Vibration similar to the passing of a truck. Duration estimated.',
      'Felt indoors by many, outdoors by few during the day. At night, some awakened. Dishes, windows, doors disturbed; walls make cracking sound. Sensation like heavy truck striking building. Standing motor cars rocked noticeably.',
      'Felt by nearly everyone; many awakened. Some dishes, windows broken. Unstable objects overturned. Pendulum clocks may stop.',
      'Felt by all, many frightened. Some heavy furniture moved; a few instances of fallen plaster. Damage slight.',
      'Damage negligible in buildings of good design and construction; slight to moderate in well-built ordinary structures; considerable damage in poorly built or badly designed structures; some chimneys broken.',
      'Damage slight in specially designed structures; considerable damage in ordinary substantial buildings with partial collapse. Damage great in poorly built structures. Fall of chimneys, factory stacks, columns, monuments, walls. Heavy furniture overturned.',
      'Damage considerable in specially designed structures; well-designed frame structures thrown out of plumb. Damage great in substantial buildings, with partial collapse. Buildings shifted off foundations.',
      'Some well-built wooden structures destroyed; most masonry and frame structures destroyed with foundations. Rail bent.',
      'Few, if any (masonry) structures remain standing. Bridges destroyed. Rails bent greatly.',
      'Damage total. Lines of sight and level are distorted. Objects thrown into the air.',
    ],
  );
});

test('lookup maps cover every level by number and by Roman numeral', () => {
  for (const entry of MODIFIED_MERCALLI_SCALE) {
    assert.equal(MODIFIED_MERCALLI_BY_INTENSITY[entry.intensity], entry);
    assert.equal(MODIFIED_MERCALLI_BY_ROMAN[entry.roman], entry);
    assert.equal(classifyModifiedMercalli(entry.intensity), entry);
    assert.equal(classifyModifiedMercalli(entry.roman), entry);
  }
  assert.equal(Object.keys(MODIFIED_MERCALLI_BY_INTENSITY).length, 12);
  assert.equal(Object.keys(MODIFIED_MERCALLI_BY_ROMAN).length, 12);
});

test('Roman input is case-insensitive and trims whitespace', () => {
  assert.equal(classifyModifiedMercalli('vii').intensity, 7);
  assert.equal(classifyModifiedMercalli('  XII ').intensity, 12);
  assert.equal(classifyModifiedMercalli('\tiv\n').intensity, 4);
  assert.equal(classifyModifiedMercalli('x').intensity, 10);
});

test('unknown / out-of-range / non-canonical input returns null, never throws', () => {
  for (const bad of [
    0,
    -1,
    13,
    100,
    1.5,
    5.4,
    -0.5,
    Number.NaN,
    Infinity,
    -Infinity,
  ]) {
    assert.equal(classifyModifiedMercalli(bad), null, `number ${bad}`);
    assert.equal(modifiedMercalliShaking(bad), null, `shaking ${bad}`);
    assert.equal(modifiedMercalliDescription(bad), null, `desc ${bad}`);
  }
  for (const bad of [
    '',
    '   ',
    '0',
    '4',
    '12',
    'XIII',
    'XIV',
    'IIII',
    'VIIII',
    'IIV',
    'IV-V',
    'VII-VIII',
    '5.4',
    'MMI VII',
    'VII.',
    'M7',
    null,
    undefined,
    true,
    false,
    {},
    [],
    7n,
    12n,
  ]) {
    assert.equal(classifyModifiedMercalli(bad), null, `input ${String(bad)}`);
    assert.equal(modifiedMercalliShaking(bad), null);
    assert.equal(modifiedMercalliDescription(bad), null);
  }
});

test('helpers return the entry fields for valid input', () => {
  assert.equal(modifiedMercalliShaking(1), 'Not felt');
  assert.equal(modifiedMercalliShaking('VIII'), 'Severe');
  assert.equal(modifiedMercalliShaking('xii'), 'Extreme');
  assert.equal(
    modifiedMercalliDescription(12),
    'Damage total. Lines of sight and level are distorted. Objects thrown into the air.',
  );
  assert.equal(
    modifiedMercalliDescription('V'),
    'Felt by nearly everyone; many awakened. Some dishes, windows broken. Unstable objects overturned. Pendulum clocks may stop.',
  );
});

test('no magnitude-to-intensity conversion is offered', () => {
  // A magnitude is not an intensity: feeding one must not
  // yield a level. 6.3 is a plausible magnitude and is not
  // an integer 1-12, so it must return null rather than
  // silently becoming intensity VI.
  assert.equal(classifyModifiedMercalli(6.3), null);
  assert.equal(classifyModifiedMercalli(7.9), null);
});
