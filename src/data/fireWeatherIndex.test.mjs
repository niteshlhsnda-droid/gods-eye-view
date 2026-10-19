import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FWI_COMPONENT_BY_CODE,
  FWI_DANGER_LEVELS,
  FWI_LEVEL_BY_CODE,
  FWI_SYSTEM_COMPONENTS,
  classifyFireWeatherIndex,
  fireWeatherDangerLevel,
  isSignificantFireDanger,
} from './fireWeatherIndex.js';

/**
 * External anchors. Every expected value below is a table entry from
 * the primary source, not a computation:
 * - CFS Fire Danger Group (2025), "The 2025 Update to the FWI
 *   System: Structure, Changes and Interpretation" (Information
 *   Report GLC-X-42), Table 1 (§5.3) — "Physically based national
 *   classifications of the FWI System and the primary physical
 *   process the classification has been based on. (Integer values
 *   are rounded.)":
 *   FFMC  0–75   76–84   85–89   90–92   93+
 *   DMC   0–10   11–25   26–45   46–60   61+
 *   DC    0–70   71–190  191–300 301–500 501+
 *   ISI   0–2    3–5     6–10    11–15   16+
 *   BUI   0–20   21–40   41–60   61–90   90+
 *   FWI   0–5    6–15    16–22   23–29   30+
 *   Physical basis: FFMC "Sustainable flaming ignition";
 *   DMC "Lightning ignition probability"; DC "Deep organic
 *   consumption"; ISI "Spread (transition to crowning)"; BUI
 *   "Surface fuel consumption"; FWI "Intensity and suppression
 *   difficulty".
 * - Copernicus EMS user guide (CEMS, ECMWF Confluence): "FWI
 *   values above 30 indicate high fire danger conditions" —
 *   corroborates the published 30+ Extreme break.
 */

test('six components in Table 1 order with frozen canonical codes', () => {
  assert.deepEqual(
    FWI_SYSTEM_COMPONENTS.map((entry) => entry.code),
    ['FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'],
  );
  assert.deepEqual(
    FWI_SYSTEM_COMPONENTS.map((entry) => entry.name),
    [
      'Fine Fuel Moisture Code',
      'Duff Moisture Code',
      'Drought Code',
      'Initial Spread Index',
      'Buildup Index',
      'Fire Weather Index',
    ],
  );
  assert.ok(Object.isFrozen(FWI_SYSTEM_COMPONENTS));
  assert.ok(FWI_SYSTEM_COMPONENTS.every(Object.isFrozen));
});

test('physical basis column is quoted verbatim for every component', () => {
  const expected = {
    FFMC: 'Sustainable flaming ignition',
    DMC: 'Lightning ignition probability',
    DC: 'Deep organic consumption',
    ISI: 'Spread (transition to crowning)',
    BUI: 'Surface fuel consumption',
    FWI: 'Intensity and suppression difficulty',
  };
  for (const [code, basis] of Object.entries(expected)) {
    assert.equal(FWI_COMPONENT_BY_CODE[code].physicalBasis, basis);
  }
});

test('verbatim FWI display bands match the published table', () => {
  assert.deepEqual(
    FWI_COMPONENT_BY_CODE.FWI.classes.map((entry) => entry.band),
    [
      [0, 5],
      [6, 15],
      [16, 22],
      [23, 29],
      [30, null],
    ],
  );
});

test('FWI class boundaries classify per the published edges', () => {
  const cases = [
    [0, 'LOW'],
    [5, 'LOW'],
    [6, 'MODERATE'],
    [15, 'MODERATE'],
    [16, 'HIGH'],
    [22, 'HIGH'],
    [23, 'VERY_HIGH'],
    [29, 'VERY_HIGH'],
    [30, 'EXTREME'],
    [100, 'EXTREME'],
  ];
  for (const [value, level] of cases) {
    assert.equal(fireWeatherDangerLevel('FWI', value), level, `FWI ${value}`);
  }
});

test('FFMC class boundaries classify per the published edges', () => {
  const cases = [
    [0, 'LOW'],
    [75, 'LOW'],
    [76, 'MODERATE'],
    [84, 'MODERATE'],
    [85, 'HIGH'],
    [89, 'HIGH'],
    [90, 'VERY_HIGH'],
    [92, 'VERY_HIGH'],
    [93, 'EXTREME'],
    [101, 'EXTREME'],
  ];
  for (const [value, level] of cases) {
    assert.equal(fireWeatherDangerLevel('FFMC', value), level, `FFMC ${value}`);
  }
});

test('DMC, DC, ISI, BUI boundary values land in the published class', () => {
  const cases = [
    ['DMC', 0, 'LOW'],
    ['DMC', 10, 'LOW'],
    ['DMC', 11, 'MODERATE'],
    ['DMC', 60, 'VERY_HIGH'],
    ['DMC', 61, 'EXTREME'],
    ['DC', 70, 'LOW'],
    ['DC', 71, 'MODERATE'],
    ['DC', 300, 'HIGH'],
    ['DC', 301, 'VERY_HIGH'],
    ['DC', 501, 'EXTREME'],
    ['ISI', 2, 'LOW'],
    ['ISI', 3, 'MODERATE'],
    ['ISI', 10, 'HIGH'],
    ['ISI', 11, 'VERY_HIGH'],
    ['ISI', 16, 'EXTREME'],
    ['BUI', 20, 'LOW'],
    ['BUI', 21, 'MODERATE'],
    ['BUI', 60, 'HIGH'],
    ['BUI', 61, 'VERY_HIGH'],
    ['BUI', 89.9, 'VERY_HIGH'],
  ];
  for (const [component, value, level] of cases) {
    assert.equal(
      fireWeatherDangerLevel(component, value),
      level,
      `${component} ${value}`,
    );
  }
});

test('shared printed edge resolves to the higher class (BUI 90 -> Extreme)', () => {
  // The printed table shows BUI Very High as 61–90 and Extreme as
  // 90+ ("integer values are rounded"); the classifier's
  // lower-bound tiling makes the Extreme floor inclusive.
  assert.equal(fireWeatherDangerLevel('BUI', 90), 'EXTREME');
});

test('fractional values fall in the lower-adjacent class', () => {
  assert.equal(fireWeatherDangerLevel('FWI', 5.5), 'LOW');
  assert.equal(fireWeatherDangerLevel('FWI', 15.9), 'MODERATE');
  assert.equal(fireWeatherDangerLevel('FFMC', 75.6), 'LOW');
  assert.equal(fireWeatherDangerLevel('ISI', 2.99), 'LOW');
});

test('component codes are case-insensitive and whitespace-tolerant', () => {
  assert.equal(fireWeatherDangerLevel('fwi', 30), 'EXTREME');
  assert.equal(fireWeatherDangerLevel(' Ffmc ', 93), 'EXTREME');
  assert.equal(classifyFireWeatherIndex('isi', 7).label, 'High');
});

test('entry shape carries published description and editorial group', () => {
  const entry = classifyFireWeatherIndex('FWI', 25);
  assert.equal(entry.component, 'FWI');
  assert.equal(entry.componentName, 'Fire Weather Index');
  assert.equal(entry.kind, 'fire-weather index');
  assert.equal(entry.value, 25);
  assert.equal(entry.level, 'VERY_HIGH');
  assert.equal(entry.severity, 4);
  assert.equal(entry.label, 'Very High');
  assert.deepEqual(entry.band, [23, 29]);
  assert.equal(entry.physicalBasis, 'Intensity and suppression difficulty');
  assert.equal(entry.description, FWI_LEVEL_BY_CODE.VERY_HIGH.description);
  assert.equal(entry.group, 'fire-danger');
  assert.ok(Object.isFrozen(entry));
});

test('danger levels carry severity order and frozen lookups', () => {
  assert.deepEqual(
    FWI_DANGER_LEVELS.map((entry) => entry.code),
    ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH', 'EXTREME'],
  );
  assert.deepEqual(
    FWI_DANGER_LEVELS.map((entry) => entry.severity),
    [1, 2, 3, 4, 5],
  );
  assert.equal(FWI_LEVEL_BY_CODE.HIGH.label, 'High');
  assert.ok(Object.isFrozen(FWI_DANGER_LEVELS));
});

test('isSignificantFireDanger is true at High and above', () => {
  assert.equal(isSignificantFireDanger('LOW'), false);
  assert.equal(isSignificantFireDanger('MODERATE'), false);
  assert.equal(isSignificantFireDanger('HIGH'), true);
  assert.equal(isSignificantFireDanger('VERY_HIGH'), true);
  assert.equal(isSignificantFireDanger('EXTREME'), true);
  assert.equal(isSignificantFireDanger('high'), true);
  assert.equal(
    isSignificantFireDanger(classifyFireWeatherIndex('DC', 250)),
    true,
  );
  assert.equal(
    isSignificantFireDanger(classifyFireWeatherIndex('DC', 150)),
    false,
  );
});

test('unknown components and values return null, never throw', () => {
  for (const component of ['GFMC', 'GSI', 'GFWI', 'ISI2', '', null, 42]) {
    assert.equal(classifyFireWeatherIndex(component, 5), null);
    assert.equal(fireWeatherDangerLevel(component, 5), null);
  }
  for (const value of [-1, NaN, Infinity, -Infinity, '5', null, undefined]) {
    assert.equal(classifyFireWeatherIndex('FWI', value), null);
    assert.equal(fireWeatherDangerLevel('FWI', value), null);
  }
  assert.equal(isSignificantFireDanger('EXTREMELY'), null);
  assert.equal(isSignificantFireDanger(null), null);
  assert.equal(isSignificantFireDanger({}), null);
});

test('grassland components are deliberately unsupported', () => {
  // GLC-X-42: "the grassland classifications have not been
  // previously tested and the validation is underway" — so GFMC /
  // GSI / GFWI stay out until the thresholds are final.
  assert.equal(fireWeatherDangerLevel('GFMC', 95), null);
  assert.equal(fireWeatherDangerLevel('GSI', 60), null);
  assert.equal(fireWeatherDangerLevel('GFWI', 35), null);
});
