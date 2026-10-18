import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEOMAGNETIC_STORM_BY_KEY,
  GEOMAGNETIC_STORM_SCALE,
  KP_MAX,
  KP_STORM_MIN,
  PROTON_FLUX_STORM_MIN_PFU,
  RADIO_BLACKOUT_BY_KEY,
  RADIO_BLACKOUT_SCALE,
  SOLAR_RADIATION_STORM_BY_KEY,
  SOLAR_RADIATION_STORM_SCALE,
  XRAY_FLUX_BLACKOUT_MIN_W_PER_M2,
  classifyGeomagneticStorm,
  classifyRadioBlackout,
  classifySolarRadiationStorm,
  classifySpaceWeather,
} from './spaceWeatherScales.js';

/**
 * External anchors. Every expected value below is a table entry
 * from the primary sources, not a computation:
 * - NOAA / NWS SWPC, "NOAA Space Weather Scales"
 *   (spaceweather.gov/noaa-space-weather-scales): G1 Kp = 5,
 *   G2 Kp = 6, G3 Kp = 7, G4 "Kp = 8, including a 9-", G5 Kp = 9;
 *   S1 10, S2 10^2, S3 10^3, S4 10^4, S5 10^5 pfu (>= 10 MeV
 *   particles, 5-minute averages); R1 M1 (10^-5), R2 M5
 *   (5 x 10^-5), R3 X1 (10^-4), R4 X10 (10^-3), R5 X20
 *   (2 x 10^-3) W/m2; descriptors Minor / Moderate / Strong /
 *   Severe / Extreme on all three scales.
 * - NOAA / NWS SWPC, "Solar Flares (Radio Blackouts)": R1 M1 /
 *   R2 M5 / R3 X1 / R4 X10 / R5 X20 with fluxes 0.00001 /
 *   0.00005 / 0.0001 / 0.001 / 0.002 W/m2; the R scale is tied to
 *   the flare's max peak soft X-ray flux, reached or expected.
 * - NOAA / NWS SWPC, "Solar Radiation Storm": an S storm starts
 *   when >= 10 MeV proton flux equals or exceeds 10 pfu and ends
 *   at the last time it is measured at or above 10 pfu.
 * - NOAA SWPC, "GOES Proton Flux": S-scale thresholds
 *   (10, 100, 1000, 10000, 100000 pfu).
 * There is no G0 / S0 / R0 row in the NOAA tables — below-scale
 * inputs return null.
 */

test('scale tables have 5 entries each in weakest-first order, frozen, with published thresholds', () => {
  assert.deepEqual(
    GEOMAGNETIC_STORM_SCALE.map((entry) => entry.key),
    ['G1', 'G2', 'G3', 'G4', 'G5'],
  );
  assert.deepEqual(
    GEOMAGNETIC_STORM_SCALE.map((entry) => entry.threshold),
    [5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    SOLAR_RADIATION_STORM_SCALE.map((entry) => entry.key),
    ['S1', 'S2', 'S3', 'S4', 'S5'],
  );
  assert.deepEqual(
    SOLAR_RADIATION_STORM_SCALE.map((entry) => entry.threshold),
    [10, 100, 1000, 10000, 100000],
  );
  assert.deepEqual(
    RADIO_BLACKOUT_SCALE.map((entry) => entry.key),
    ['R1', 'R2', 'R3', 'R4', 'R5'],
  );
  assert.deepEqual(
    RADIO_BLACKOUT_SCALE.map((entry) => entry.threshold),
    [1e-5, 5e-5, 1e-4, 1e-3, 2e-3],
  );
  assert.deepEqual(
    RADIO_BLACKOUT_SCALE.map((entry) => entry.flareClass),
    ['M1', 'M5', 'X1', 'X10', 'X20'],
  );
  for (const scale of [
    GEOMAGNETIC_STORM_SCALE,
    SOLAR_RADIATION_STORM_SCALE,
    RADIO_BLACKOUT_SCALE,
  ]) {
    assert.deepEqual(
      scale.map((entry) => entry.descriptor),
      ['Minor', 'Moderate', 'Strong', 'Severe', 'Extreme'],
    );
    assert.deepEqual(
      scale.map((entry) => entry.level),
      [1, 2, 3, 4, 5],
    );
    assert.ok(Object.isFrozen(scale));
    for (const entry of scale) {
      assert.ok(Object.isFrozen(entry));
    }
  }
  assert.deepEqual(Object.keys(GEOMAGNETIC_STORM_BY_KEY), [
    'G1',
    'G2',
    'G3',
    'G4',
    'G5',
  ]);
  assert.deepEqual(Object.keys(SOLAR_RADIATION_STORM_BY_KEY), [
    'S1',
    'S2',
    'S3',
    'S4',
    'S5',
  ]);
  assert.deepEqual(Object.keys(RADIO_BLACKOUT_BY_KEY), [
    'R1',
    'R2',
    'R3',
    'R4',
    'R5',
  ]);
  assert.equal(KP_STORM_MIN, 5);
  assert.equal(KP_MAX, 9);
  assert.equal(PROTON_FLUX_STORM_MIN_PFU, 10);
  assert.equal(XRAY_FLUX_BLACKOUT_MIN_W_PER_M2, 1e-5);
});

test('G scale: published Kp thresholds classify to the published level', () => {
  const cases = [
    [5, 'G1'],
    [6, 'G2'],
    [7, 'G3'],
    [8, 'G4'],
    [9, 'G5'],
  ];
  for (const [kp, key] of cases) {
    assert.equal(classifyGeomagneticStorm(kp).key, key, `Kp ${kp}`);
  }
});

test('G scale: fractional Kp follows half-open bands; Kp 9- (~8.67) is G4, only Kp 9 is G5', () => {
  assert.equal(classifyGeomagneticStorm(5.5).key, 'G1');
  assert.equal(classifyGeomagneticStorm(5.99).key, 'G1');
  assert.equal(classifyGeomagneticStorm(6.0).key, 'G2');
  assert.equal(classifyGeomagneticStorm(7.99).key, 'G3');
  // Kp 9- in thirds notation is 8 + 2/3 — inside G4's band per
  // the table's "Kp = 8, including a 9-" wording.
  assert.equal(classifyGeomagneticStorm(8 + 2 / 3).key, 'G4');
  assert.equal(classifyGeomagneticStorm(8.999).key, 'G4');
  assert.equal(classifyGeomagneticStorm(9).key, 'G5');
});

test('G scale: below Kp 5 returns null, never G1 (no G0 in the NOAA table)', () => {
  assert.equal(classifyGeomagneticStorm(0), null);
  assert.equal(classifyGeomagneticStorm(4), null);
  assert.equal(classifyGeomagneticStorm(4.99), null);
  // A forecast maximum of 4.67 is below the G1 threshold as given;
  // forecast products may round it up, this classifier does not.
  assert.equal(classifyGeomagneticStorm(4.67), null);
});

test('G scale: invalid Kp throws TypeError', () => {
  for (const bad of [
    Number.NaN,
    Infinity,
    -Infinity,
    -1,
    -0.5,
    9.01,
    10,
    '5',
    null,
    undefined,
  ]) {
    assert.throws(
      () => classifyGeomagneticStorm(bad),
      TypeError,
      `kp ${String(bad)}`,
    );
  }
});

test('S scale: published pfu thresholds classify to the published level', () => {
  const cases = [
    [10, 'S1'],
    [100, 'S2'],
    [1000, 'S3'],
    [10000, 'S4'],
    [100000, 'S5'],
  ];
  for (const [flux, key] of cases) {
    assert.equal(classifySolarRadiationStorm(flux).key, key, `${flux} pfu`);
  }
});

test('S scale: fractional / between-threshold flux follows half-open bands; S5 open-ended', () => {
  assert.equal(classifySolarRadiationStorm(9.999), null);
  assert.equal(classifySolarRadiationStorm(10.5).key, 'S1');
  assert.equal(classifySolarRadiationStorm(99.9).key, 'S1');
  assert.equal(classifySolarRadiationStorm(999.9).key, 'S2');
  assert.equal(classifySolarRadiationStorm(9999.9).key, 'S3');
  assert.equal(classifySolarRadiationStorm(99999.9).key, 'S4');
  assert.equal(classifySolarRadiationStorm(100000).key, 'S5');
  assert.equal(classifySolarRadiationStorm(1000000).key, 'S5');
});

test('S scale: below 10 pfu returns null, never S1', () => {
  assert.equal(classifySolarRadiationStorm(0), null);
  assert.equal(classifySolarRadiationStorm(9), null);
});

test('S scale: invalid flux throws TypeError', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, -1, '10', null]) {
    assert.throws(
      () => classifySolarRadiationStorm(bad),
      TypeError,
      `flux ${String(bad)}`,
    );
  }
});

test('R scale: published flux thresholds classify to the published level', () => {
  const cases = [
    [1e-5, 'R1'],
    [5e-5, 'R2'],
    [1e-4, 'R3'],
    [1e-3, 'R4'],
    [2e-3, 'R5'],
  ];
  for (const [flux, key] of cases) {
    assert.equal(classifyRadioBlackout(flux).key, key, `${flux} W/m2`);
  }
});

test('R scale: between-threshold flux follows half-open bands; R5 open-ended', () => {
  assert.equal(classifyRadioBlackout(0.999e-5), null);
  assert.equal(classifyRadioBlackout(4.9e-5).key, 'R1');
  assert.equal(classifyRadioBlackout(9.9e-5).key, 'R2');
  assert.equal(classifyRadioBlackout(9.9e-4).key, 'R3');
  assert.equal(classifyRadioBlackout(1.9e-3).key, 'R4');
  assert.equal(classifyRadioBlackout(2e-3).key, 'R5');
  // An X25-class peak (2.5e-3) is still R5 — the scale tops out.
  assert.equal(classifyRadioBlackout(2.5e-3).key, 'R5');
  assert.equal(classifyRadioBlackout(1e-2).key, 'R5');
});

test('R scale: below 10^-5 W/m2 returns null, never R1', () => {
  assert.equal(classifyRadioBlackout(0), null);
  assert.equal(classifyRadioBlackout(9e-6), null);
});

test('R scale: invalid flux throws TypeError', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, -1, '0.0001', null]) {
    assert.throws(
      () => classifyRadioBlackout(bad),
      TypeError,
      `flux ${String(bad)}`,
    );
  }
});

test('classifySpaceWeather: classifies each scale independently; omitted measures are null', () => {
  const all = classifySpaceWeather({
    kp: 7,
    protonFluxPfu: 500,
    xrayFluxWPerM2: 1e-4,
  });
  assert.equal(all.geomagnetic.key, 'G3');
  assert.equal(all.solarRadiation.key, 'S2');
  assert.equal(all.radioBlackout.key, 'R3');

  // Scales are independent: a strong geomagnetic storm with no
  // radiation storm and no blackout.
  const mixed = classifySpaceWeather({
    kp: 9,
    protonFluxPfu: 5,
    xrayFluxWPerM2: 0,
  });
  assert.equal(mixed.geomagnetic.key, 'G5');
  assert.equal(mixed.solarRadiation, null);
  assert.equal(mixed.radioBlackout, null);

  // Omitted measures are "no reading", not level 1.
  assert.deepEqual(classifySpaceWeather({}), {
    geomagnetic: null,
    solarRadiation: null,
    radioBlackout: null,
  });
  assert.deepEqual(classifySpaceWeather({ kp: 5 }), {
    geomagnetic: GEOMAGNETIC_STORM_BY_KEY.G1,
    solarRadiation: null,
    radioBlackout: null,
  });
});

test('classifySpaceWeather: non-object, unknown key, or invalid measure throws TypeError', () => {
  for (const bad of [null, undefined, 'G1', 5, [], true]) {
    assert.throws(
      () => classifySpaceWeather(bad),
      TypeError,
      `observation ${String(bad)}`,
    );
  }
  // Unknown key (e.g. a typo for protonFluxPfu) fails loudly
  // instead of silently classifying as null.
  assert.throws(() => classifySpaceWeather({ protonFlux: 100 }), TypeError);
  assert.throws(() => classifySpaceWeather({ kp: 10 }), TypeError);
  assert.throws(() => classifySpaceWeather({ protonFluxPfu: -1 }), TypeError);
  assert.throws(
    () => classifySpaceWeather({ xrayFluxWPerM2: Number.NaN }),
    TypeError,
  );
});

test('effect glosses carry the published severity framing per level', () => {
  assert.match(
    GEOMAGNETIC_STORM_BY_KEY.G1.effect,
    /weak power grid fluctuations/i,
  );
  assert.match(
    GEOMAGNETIC_STORM_BY_KEY.G5.effect,
    /complete collapse or blackouts/i,
  );
  assert.match(SOLAR_RADIATION_STORM_BY_KEY.S1.effect, /Biological: none/);
  assert.match(
    SOLAR_RADIATION_STORM_BY_KEY.S5.effect,
    /satellites may be rendered useless/i,
  );
  assert.match(
    RADIO_BLACKOUT_BY_KEY.R1.effect,
    /weak or minor degradation of HF radio/i,
  );
  assert.match(
    RADIO_BLACKOUT_BY_KEY.R5.effect,
    /complete HF .* radio blackout on the entire sunlit side/i,
  );
});
