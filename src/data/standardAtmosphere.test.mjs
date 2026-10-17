import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISA_EARTH_RADIUS_M,
  LOWER_STRATOSPHERE_TOP_M,
  MAX_ALTITUDE_M,
  MIN_ALTITUDE_M,
  SEA_LEVEL_DENSITY_KG_PER_M3,
  SEA_LEVEL_PRESSURE_PA,
  SEA_LEVEL_TEMPERATURE_K,
  STRATOSPHERE_20KM_PRESSURE_PA,
  TROPOPAUSE_ALTITUDE_M,
  TROPOPAUSE_PRESSURE_PA,
  TROPOPAUSE_TEMPERATURE_K,
  altitudeFromDensityM,
  altitudeFromPressureM,
  densityAltitudeM,
  densityAltitudeRuleOfThumbM,
  geometricAltitudeM,
  geopotentialAltitudeM,
  isaDensityKgPerM3,
  isaPressureHpa,
  isaPressurePa,
  isaProperties,
  isaTemperatureC,
  isaTemperatureK,
  pressureAltitudeM,
  speedOfSoundMPerS,
} from './standardAtmosphere.js';

/**
 * External anchors: the ISA layer table (ISO 2533 / ICAO Doc 7488) —
 * sea level 101325 Pa / 288.15 K / 1.225 kg/m3, tropopause 11000 m /
 * 216.65 K / 22632 Pa, 20000 m / 5474.9 Pa, 32000 m / 228.65 K /
 * 868.02 Pa, speed of sound at sea level 340.294 m/s — and the FAA
 * altitude definitions (FAA-P-8740-2): pressure altitude is the
 * altitude in the standard atmosphere at the station pressure;
 * density altitude is pressure altitude corrected for nonstandard
 * temperature. All verified 2026-10-17.
 */

const SAMPLE_ALTITUDES_M = [
  -500, -430, 0, 500, 1000, 3000, 5000, 8000, 10000, 11000, 12000, 15000,
  20000, 22000, 25000, 28000, 32000,
];

test('sea-level constants match the ISA table', () => {
  assert.equal(SEA_LEVEL_PRESSURE_PA, 101325);
  assert.equal(SEA_LEVEL_TEMPERATURE_K, 288.15);
  assert.ok(Math.abs(SEA_LEVEL_DENSITY_KG_PER_M3 - 1.225) < 0.001);
  assert.equal(isaTemperatureK(0), 288.15);
  assert.equal(isaPressurePa(0), 101325);
  assert.ok(Math.abs(isaDensityKgPerM3(0) - 1.225) < 0.001);
  assert.ok(Math.abs(speedOfSoundMPerS(0) - 340.294) < 0.05);
});

test('tropopause anchors match the ISA table', () => {
  assert.equal(TROPOPAUSE_ALTITUDE_M, 11000);
  assert.equal(TROPOPAUSE_TEMPERATURE_K, 216.65);
  assert.equal(isaTemperatureK(11000), 216.65);
  assert.ok(Math.abs(TROPOPAUSE_PRESSURE_PA - 22632) < 2);
  assert.ok(Math.abs(isaPressurePa(11000) - 22632) < 2);
  assert.ok(Math.abs(isaDensityKgPerM3(11000) - 0.3639) < 0.001);
});

test('stratosphere anchors match the ISA table', () => {
  assert.equal(LOWER_STRATOSPHERE_TOP_M, 20000);
  assert.equal(isaTemperatureK(20000), 216.65);
  assert.ok(Math.abs(STRATOSPHERE_20KM_PRESSURE_PA - 5474.9) < 1);
  assert.ok(Math.abs(isaPressurePa(20000) - 5474.9) < 1);
  assert.ok(Math.abs(isaDensityKgPerM3(20000) - 0.088) < 0.001);
  assert.equal(isaTemperatureK(32000), 228.65);
  assert.ok(Math.abs(isaPressurePa(32000) - 868.02) < 1);
  assert.ok(Math.abs(isaDensityKgPerM3(32000) - 0.0132) < 0.0005);
});

test('temperature profile falls, flattens, then rises', () => {
  assert.ok(isaTemperatureK(0) > isaTemperatureK(5000));
  assert.ok(isaTemperatureK(5000) > isaTemperatureK(11000));
  assert.equal(isaTemperatureK(11000), isaTemperatureK(15000));
  assert.equal(isaTemperatureK(15000), isaTemperatureK(20000));
  assert.ok(isaTemperatureK(20000) < isaTemperatureK(32000));
  assert.ok(Math.abs(isaTemperatureC(0) - 15) < 1e-9);
  assert.ok(Math.abs(isaTemperatureC(11000) + 56.5) < 1e-9);
});

test('pressure and density fall monotonically with altitude', () => {
  let previousPressure = Number.POSITIVE_INFINITY;
  let previousDensity = Number.POSITIVE_INFINITY;
  for (const altitude of SAMPLE_ALTITUDES_M) {
    const pressure = isaPressurePa(altitude);
    const density = isaDensityKgPerM3(altitude);
    assert.ok(pressure < previousPressure);
    assert.ok(density < previousDensity);
    previousPressure = pressure;
    previousDensity = density;
  }
  assert.equal(isaPressureHpa(0), 1013.25);
});

test('altitude-from-pressure round-trips every sample altitude', () => {
  for (const altitude of SAMPLE_ALTITUDES_M) {
    const recovered = altitudeFromPressureM(isaPressurePa(altitude));
    assert.ok(
      Math.abs(recovered - altitude) < 0.01,
      `pressure round-trip at ${altitude} m recovered ${recovered}`,
    );
  }
});

test('altitude-from-density round-trips every sample altitude', () => {
  for (const altitude of SAMPLE_ALTITUDES_M) {
    const recovered = altitudeFromDensityM(isaDensityKgPerM3(altitude));
    assert.ok(
      Math.abs(recovered - altitude) < 0.01,
      `density round-trip at ${altitude} m recovered ${recovered}`,
    );
  }
});

test('standard QNH leaves pressure altitude equal to indicated altitude', () => {
  assert.ok(
    Math.abs(
      pressureAltitudeM({ qnhHpa: 1013.25, indicatedAltitudeM: 0 }),
    ) < 0.01,
  );
  assert.ok(
    Math.abs(
      pressureAltitudeM({ qnhHpa: 1013.25, indicatedAltitudeM: 1000 }) -
        1000,
    ) < 1,
  );
});

test('lower QNH raises pressure altitude, higher QNH lowers it', () => {
  const lowQnh = pressureAltitudeM({
    qnhHpa: 1003.25,
    indicatedAltitudeM: 0,
  });
  assert.ok(lowQnh > 80 && lowQnh < 90);
  const highQnh = pressureAltitudeM({
    qnhHpa: 1023.25,
    indicatedAltitudeM: 0,
  });
  assert.ok(highQnh < -80 && highQnh > -90);
  // Same station, different QNH reporting: the correction is symmetric.
  assert.ok(Math.abs(lowQnh + highQnh) < 1);
});

test('density altitude equals pressure altitude under ISA temperature', () => {
  assert.ok(
    Math.abs(
      densityAltitudeM({ pressureAltitudeM: 0, oatC: 15 }),
    ) < 0.01,
  );
  const isaAt5000 = isaTemperatureC(5000);
  assert.ok(
    Math.abs(
      densityAltitudeM({
        pressureAltitudeM: 5000,
        oatC: isaAt5000,
      }) - 5000,
    ) < 1,
  );
});

test('hot air raises density altitude, cold air lowers it', () => {
  const hot = densityAltitudeM({ pressureAltitudeM: 0, oatC: 30 });
  assert.ok(hot > 450 && hot < 600);
  const cold = densityAltitudeM({ pressureAltitudeM: 0, oatC: 0 });
  assert.ok(cold < 0 && cold > -700);
  const hotter = densityAltitudeM({ pressureAltitudeM: 0, oatC: 40 });
  assert.ok(hotter > hot);
});

test('rule of thumb tracks the exact density altitude', () => {
  const exact = densityAltitudeM({ pressureAltitudeM: 0, oatC: 30 });
  const approx = densityAltitudeRuleOfThumbM({
    pressureAltitudeM: 0,
    oatC: 30,
  });
  // FAA 120 ft/degC rule: 120 * 0.3048 * 15 = 548.6 m.
  assert.ok(Math.abs(approx - 548.64) < 0.01);
  assert.ok(Math.abs(approx - exact) / exact < 0.15);
});

test('speed of sound follows temperature, not pressure', () => {
  assert.ok(
    Math.abs(speedOfSoundMPerS(11000) - 295.05) < 0.5,
  );
  assert.equal(
    speedOfSoundMPerS(11000),
    speedOfSoundMPerS(20000),
    'isothermal layer has one speed of sound',
  );
  assert.ok(speedOfSoundMPerS(32000) > speedOfSoundMPerS(20000));
});

test('geopotential/geometric conversion matches the ISA table', () => {
  assert.equal(geopotentialAltitudeM(0), 0);
  assert.equal(geometricAltitudeM(0), 0);
  // ISA table: 11000 m geopotential = 11019 m geometric.
  assert.ok(Math.abs(geometricAltitudeM(11000) - 11019) < 1);
  // ISA table: 32000 m geopotential = 32162 m geometric (rounded).
  assert.ok(Math.abs(geometricAltitudeM(32000) - 32162) < 2);
  assert.ok(
    Math.abs(
      geopotentialAltitudeM(geometricAltitudeM(32000)) - 32000,
    ) < 0.01,
  );
  for (const altitude of SAMPLE_ALTITUDES_M) {
    assert.ok(
      Math.abs(
        geometricAltitudeM(geopotentialAltitudeM(altitude)) - altitude,
      ) < 0.01,
    );
  }
  assert.ok(ISA_EARTH_RADIUS_M === 6356766);
});

test('isaProperties is frozen and agrees with the single functions', () => {
  const props = isaProperties(5000);
  assert.ok(Object.isFrozen(props));
  assert.equal(props.altitudeM, 5000);
  assert.equal(props.temperatureK, isaTemperatureK(5000));
  assert.equal(props.pressurePa, isaPressurePa(5000));
  assert.equal(props.pressureHpa, isaPressureHpa(5000));
  assert.equal(props.densityKgPerM3, isaDensityKgPerM3(5000));
  assert.equal(props.speedOfSoundMPerS, speedOfSoundMPerS(5000));
  assert.equal(props.temperatureC, props.temperatureK - 273.15);
});

test('invalid inputs throw typed errors, never NaN', () => {
  assert.throws(() => isaTemperatureK(Number.NaN), TypeError);
  assert.throws(() => isaPressurePa('1000'), TypeError);
  assert.throws(() => isaTemperatureK(MAX_ALTITUDE_M + 1), RangeError);
  assert.throws(() => isaDensityKgPerM3(MIN_ALTITUDE_M - 1), RangeError);
  assert.throws(() => altitudeFromPressureM(0), RangeError);
  assert.throws(() => altitudeFromPressureM(200000), RangeError);
  assert.throws(() => altitudeFromDensityM(0), RangeError);
  assert.throws(() => altitudeFromDensityM(5), RangeError);
  assert.throws(
    () =>
      pressureAltitudeM({ qnhHpa: 500, indicatedAltitudeM: 0 }),
    RangeError,
  );
  assert.throws(
    () =>
      pressureAltitudeM({ qnhHpa: 1013.25, indicatedAltitudeM: 40000 }),
    RangeError,
  );
  assert.throws(
    () => densityAltitudeM({ pressureAltitudeM: 0, oatC: 200 }),
    RangeError,
  );
  assert.throws(
    () =>
      densityAltitudeRuleOfThumbM({
        pressureAltitudeM: 0,
        oatC: Number.NaN,
      }),
    TypeError,
  );
  assert.throws(() => geometricAltitudeM(MAX_ALTITUDE_M + 1), RangeError);
  assert.throws(() => geopotentialAltitudeM(100000), RangeError);
});
