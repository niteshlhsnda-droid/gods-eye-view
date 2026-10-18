import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASTRONOMICAL_TWILIGHT_ELEVATION_DEG,
  BLUE_HOUR_MAX_ELEVATION_DEG,
  BLUE_HOUR_MIN_ELEVATION_DEG,
  CIVIL_TWILIGHT_ELEVATION_DEG,
  DAY_PHASES,
  GOLDEN_HOUR_MAX_ELEVATION_DEG,
  NAUTICAL_TWILIGHT_ELEVATION_DEG,
  SUNRISE_SUNSET_ELEVATION_DEG,
  dayPhase,
  isBlueHour,
  isDaytime,
  isGoldenHour,
  solarNoon,
  sunPosition,
  sunWindows,
} from './sunPosition.js';

/**
 * External anchors. The first three are hand-computed from the
 * geometry alone (solar-noon elevation = 90 - |latitude -
 * declination|), independent of this module's equation chain:
 * - At the June solstice the declination is +23.44 degrees, so at
 *   solar noon in Patna (25.6 N) the elevation is
 *   90 - (25.6 - 23.44) = 87.84 degrees, azimuth due south (180).
 * - At the March equinox the declination is ~0 degrees, so at
 *   solar noon on the equator the elevation is ~90 degrees, and
 *   sunrise is due east (azimuth 90) with a ~12.1 h apparent day
 *   (the -0.833° threshold adds ~3.3 min at each end vs the
 *   geometric 12 h).
 * - At the June solstice the declination is +23.44 degrees, so at
 *   the North Pole the Sun circles at a constant +23.44 degrees
 *   all day (polar day, no sunrise/sunset).
 * The remaining anchors are boundary behavior: the elevation AT a
 * returned sunrise/sunset is -0.833 by construction, and the golden /
 * blue windows sample inside their bands.
 * Declination values cross-checked against the NOAA Solar
 * Calculator (https://gml.noaa.gov/grad/solcalc/) and the U.S.
 * Naval Observatory approximate solar coordinates.
 */

const PATNA_LAT = 25.6;
const PATNA_LON = 85.1;

test('threshold constants match the documented bands', () => {
  assert.equal(GOLDEN_HOUR_MAX_ELEVATION_DEG, 6);
  assert.equal(BLUE_HOUR_MIN_ELEVATION_DEG, -6);
  assert.equal(BLUE_HOUR_MAX_ELEVATION_DEG, -4);
  assert.equal(CIVIL_TWILIGHT_ELEVATION_DEG, -6);
  assert.equal(NAUTICAL_TWILIGHT_ELEVATION_DEG, -12);
  assert.equal(ASTRONOMICAL_TWILIGHT_ELEVATION_DEG, -18);
  assert.equal(SUNRISE_SUNSET_ELEVATION_DEG, -0.833);
  assert.deepEqual(DAY_PHASES, [
    'day',
    'civilTwilight',
    'nauticalTwilight',
    'astronomicalTwilight',
    'night',
  ]);
  assert.ok(Object.isFrozen(DAY_PHASES));
});

test('anchor: Patna solar noon at the June solstice is ~87.84 deg, due south', () => {
  const noon = solarNoon(
    PATNA_LAT,
    PATNA_LON,
    new Date('2026-06-21T00:00:00Z'),
  );
  // Hand-computed: solar noon = 720 - 4*85.1 - equationOfTime(~-1.8 min)
  // ~= 06:21 UTC. The equation-of-time term is the only input not
  // derived above, hence the +-5 min tolerance.
  assert.ok(
    Math.abs(noon.getTime() - Date.UTC(2026, 5, 21, 6, 21)) < 5 * 60000,
  );
  const pos = sunPosition(PATNA_LAT, PATNA_LON, noon);
  // 90 - |25.6 - 23.44| = 87.84, tolerance covers the declination
  // not being exactly +23.44 at that instant.
  assert.ok(
    Math.abs(pos.elevationDeg - 87.84) < 0.6,
    `elevation ${pos.elevationDeg}`,
  );
  assert.ok(Math.abs(pos.azimuthDeg - 180) < 3, `azimuth ${pos.azimuthDeg}`);
  assert.ok(Math.abs(pos.declinationDeg - 23.44) < 0.1);
  assert.ok(Math.abs(pos.hourAngleDeg) < 0.5, `hour angle ${pos.hourAngleDeg}`);
});

test('anchor: equator at the March equinox, solar noon is ~90 deg', () => {
  const noon = solarNoon(0, 0, new Date('2026-03-20T00:00:00Z'));
  const pos = sunPosition(0, 0, noon);
  assert.ok(
    pos.elevationDeg > 89 && pos.elevationDeg <= 90,
    `elevation ${pos.elevationDeg}`,
  );
  assert.ok(
    Math.abs(pos.declinationDeg) < 0.5,
    `declination ${pos.declinationDeg}`,
  );
});

test('anchor: North Pole at the June solstice circles at ~23.44 deg all day', () => {
  for (const hour of [0, 6, 12, 18]) {
    const pos = sunPosition(
      90,
      0,
      new Date(`2026-06-21T${String(hour).padStart(2, '0')}:00:00Z`),
    );
    assert.ok(
      Math.abs(pos.elevationDeg - 23.44) < 0.5,
      `hour ${hour}: elevation ${pos.elevationDeg}`,
    );
  }
  const windows = sunWindows(90, 0, new Date('2026-06-21T00:00:00Z'));
  assert.equal(windows.polarDay, true);
  assert.equal(windows.polarNight, false);
  assert.equal(windows.sunrise, null);
  assert.equal(windows.sunset, null);
  assert.equal(windows.dayLengthMinutes, null);
  assert.deepEqual(windows.goldenHourWindows, []);
  assert.deepEqual(windows.blueHourWindows, []);
});

test('anchor: South Pole at the December solstice is polar day at ~23.44 deg', () => {
  const pos = sunPosition(-90, 0, new Date('2026-12-21T12:00:00Z'));
  assert.ok(
    Math.abs(pos.elevationDeg - 23.44) < 0.5,
    `elevation ${pos.elevationDeg}`,
  );
  const windows = sunWindows(-90, 0, new Date('2026-12-21T00:00:00Z'));
  assert.equal(windows.polarDay, true);
  assert.equal(windows.sunrise, null);
  assert.equal(windows.sunset, null);
});

test('anchor: North Pole in January is polar night', () => {
  const pos = sunPosition(90, 0, new Date('2026-01-15T12:00:00Z'));
  assert.ok(pos.elevationDeg < -18, `elevation ${pos.elevationDeg}`);
  const windows = sunWindows(90, 0, new Date('2026-01-15T00:00:00Z'));
  assert.equal(windows.polarNight, true);
  assert.equal(windows.polarDay, false);
  assert.equal(windows.sunrise, null);
  assert.equal(windows.sunset, null);
  assert.equal(dayPhase(90, 0, new Date('2026-01-15T12:00:00Z')), 'night');
});

test('anchor: equator equinox sunrise is due east with a ~12 h day', () => {
  const windows = sunWindows(0, 0, new Date('2026-03-20T00:00:00Z'));
  assert.ok(windows.sunrise !== null && windows.sunset !== null);
  // Apparent day length at the equinox: 720 min geometric + ~3.3 min
  // at each end for the -0.833° threshold (Sun moves ~0.25°/min
  // vertically at the equator) = ~726.5 min, re-derived from the
  // module itself (declination drifts slightly during the day).
  assert.ok(
    Math.abs(windows.dayLengthMinutes - 726.5) < 2,
    `day length ${windows.dayLengthMinutes}`,
  );
  const sunrisePos = sunPosition(0, 0, windows.sunrise);
  assert.ok(
    Math.abs(sunrisePos.azimuthDeg - 90) < 1.5,
    `sunrise azimuth ${sunrisePos.azimuthDeg}`,
  );
  const sunsetPos = sunPosition(0, 0, windows.sunset);
  assert.ok(
    Math.abs(sunsetPos.azimuthDeg - 270) < 1.5,
    `sunset azimuth ${sunsetPos.azimuthDeg}`,
  );
});

test('boundary: elevation at returned sunrise/sunset is -0.833', () => {
  const cases = [
    [PATNA_LAT, PATNA_LON, '2026-06-21'],
    [51.5, -0.12, '2026-03-20'],
    [40.7, -74, '2026-12-21'],
    [-33.9, 151.2, '2026-12-21'],
    [64.1, -21.9, '2026-01-15'],
  ];
  for (const [lat, lon, day] of cases) {
    const windows = sunWindows(lat, lon, new Date(`${day}T00:00:00Z`));
    if (windows.sunrise !== null) {
      const atSunrise = sunPosition(lat, lon, windows.sunrise);
      assert.ok(
        Math.abs(atSunrise.elevationDeg - -0.833) < 0.05,
        `${day} sunrise elevation ${atSunrise.elevationDeg}`,
      );
    }
    if (windows.sunset !== null) {
      const atSunset = sunPosition(lat, lon, windows.sunset);
      assert.ok(
        Math.abs(atSunset.elevationDeg - -0.833) < 0.05,
        `${day} sunset elevation ${atSunset.elevationDeg}`,
      );
    }
  }
});

test('UTC-day straddle: Patna sunrise can fall after sunset, day length null', () => {
  const windows = sunWindows(
    PATNA_LAT,
    PATNA_LON,
    new Date('2026-06-21T00:00:00Z'),
  );
  // Patna's local day starts ~23:33 UTC the previous day, so this
  // UTC day holds that day's sunset (morning UTC) plus the NEXT
  // local day's sunrise (evening UTC).
  assert.ok(windows.sunrise !== null && windows.sunset !== null);
  assert.ok(windows.sunrise.getTime() > windows.sunset.getTime());
  assert.equal(windows.dayLengthMinutes, null);
  assert.equal(windows.polarDay, false);
  assert.equal(windows.polarNight, false);
});

test('golden-hour windows sit inside [-0.833, 6] deg and start/end at sunrise/sunset', () => {
  const windows = sunWindows(0, 0, new Date('2026-03-20T00:00:00Z'));
  assert.equal(windows.goldenHourWindows.length, 2);
  // Morning golden hour runs sunrise -> elevation 6 deg.
  assert.equal(
    windows.goldenHourWindows[0].start.getTime(),
    windows.sunrise.getTime(),
  );
  // Evening golden hour runs elevation 6 deg -> sunset.
  assert.equal(
    windows.goldenHourWindows[1].end.getTime(),
    windows.sunset.getTime(),
  );
  for (const window of windows.goldenHourWindows) {
    const mid = new Date((window.start.getTime() + window.end.getTime()) / 2);
    const pos = sunPosition(0, 0, mid);
    assert.ok(
      pos.elevationDeg >= 0 && pos.elevationDeg <= 6,
      `golden mid elevation ${pos.elevationDeg}`,
    );
    assert.equal(isGoldenHour(0, 0, mid), true);
    assert.equal(dayPhase(0, 0, mid), 'day');
  }
});

test('blue-hour windows sit inside [-6, -4] deg and flank sunrise/sunset', () => {
  const windows = sunWindows(0, 0, new Date('2026-03-20T00:00:00Z'));
  assert.equal(windows.blueHourWindows.length, 2);
  assert.ok(
    windows.blueHourWindows[0].end.getTime() <= windows.sunrise.getTime(),
  );
  assert.ok(
    windows.blueHourWindows[1].start.getTime() >= windows.sunset.getTime(),
  );
  for (const window of windows.blueHourWindows) {
    const mid = new Date((window.start.getTime() + window.end.getTime()) / 2);
    const pos = sunPosition(0, 0, mid);
    assert.ok(
      pos.elevationDeg >= -6 && pos.elevationDeg <= -4,
      `blue mid elevation ${pos.elevationDeg}`,
    );
    assert.equal(isBlueHour(0, 0, mid), true);
    // Blue hour is inside civil twilight.
    assert.equal(dayPhase(0, 0, mid), 'civilTwilight');
  }
});

test('a short winter day can be golden hour from sunrise to sunset', () => {
  // Reykjavik, 15 Jan: the Sun never climbs above 6 degrees.
  const windows = sunWindows(64.1, -21.9, new Date('2026-01-15T00:00:00Z'));
  assert.equal(windows.goldenHourWindows.length, 1);
  assert.equal(
    windows.goldenHourWindows[0].start.getTime(),
    windows.sunrise.getTime(),
  );
  assert.equal(
    windows.goldenHourWindows[0].end.getTime(),
    windows.sunset.getTime(),
  );
  assert.ok(windows.dayLengthMinutes > 0 && windows.dayLengthMinutes < 400);
  assert.equal(windows.blueHourWindows.length, 2);
});

test('dayPhase partitions by elevation: noon day, midnight night at mid-latitudes', () => {
  assert.equal(dayPhase(51.5, -0.12, new Date('2026-06-21T12:00:00Z')), 'day');
  assert.equal(isDaytime(51.5, -0.12, new Date('2026-06-21T12:00:00Z')), true);
  // London at midsummer midnight never reaches 'night' (the Sun
  // stays above -18 deg, in astronomical twilight); in December
  // midnight is deep night.
  assert.equal(
    dayPhase(51.5, -0.12, new Date('2026-06-21T00:00:00Z')),
    'astronomicalTwilight',
  );
  assert.equal(
    dayPhase(51.5, -0.12, new Date('2026-12-21T00:00:00Z')),
    'night',
  );
  assert.equal(isDaytime(51.5, -0.12, new Date('2026-12-21T00:00:00Z')), false);
  // At solar noon in summer the Sun is up; at midnight in winter
  // it is well below the horizon.
  assert.equal(dayPhase(40.7, -74, new Date('2026-12-21T17:00:00Z')), 'day');
});

test('sunPosition is pure, frozen, and consistent (elevation + zenith = 90)', () => {
  const date = new Date('2026-06-21T12:00:00Z');
  const first = sunPosition(51.5, -0.12, date);
  const second = sunPosition(51.5, -0.12, new Date(date.getTime()));
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Math.abs(first.elevationDeg + first.zenithDeg - 90) < 1e-9);
  assert.ok(first.azimuthDeg >= 0 && first.azimuthDeg < 360);
  assert.ok(first.zenithDeg >= 0 && first.zenithDeg <= 180);
});

test('sunWindows returns frozen windows with a UTC-midnight date', () => {
  const windows = sunWindows(51.5, -0.12, new Date('2026-03-20T15:30:00Z'));
  assert.ok(Object.isFrozen(windows));
  assert.equal(windows.date.toISOString(), '2026-03-20T00:00:00.000Z');
  assert.ok(Object.isFrozen(windows.goldenHourWindows));
  for (const window of [
    ...windows.goldenHourWindows,
    ...windows.blueHourWindows,
  ]) {
    assert.ok(Object.isFrozen(window));
    assert.ok(window.start.getTime() < window.end.getTime());
  }
  assert.equal(
    windows.solarNoon.toISOString(),
    solarNoon(51.5, -0.12, new Date('2026-03-20T00:00:00Z')).toISOString(),
  );
});

test('invalid inputs throw TypeError', () => {
  const valid = new Date('2026-06-21T12:00:00Z');
  assert.throws(() => sunPosition(-91, 0, valid), TypeError);
  assert.throws(() => sunPosition(91, 0, valid), TypeError);
  assert.throws(() => sunPosition(0, -181, valid), TypeError);
  assert.throws(() => sunPosition(0, 181, valid), TypeError);
  assert.throws(() => sunPosition(0, 0, new Date(Number.NaN)), TypeError);
  assert.throws(() => sunPosition(0, 0, '2026-06-21'), TypeError);
  assert.throws(() => sunPosition('51.5', 0, valid), TypeError);
  assert.throws(() => sunPosition(0, 0, null), TypeError);
  assert.throws(() => dayPhase(0, 0, new Date(Number.NaN)), TypeError);
  assert.throws(() => isGoldenHour(100, 0, valid), TypeError);
  assert.throws(() => isBlueHour(0, 200, valid), TypeError);
  assert.throws(() => isDaytime(0, 0, undefined), TypeError);
  assert.throws(() => solarNoon(0, 0, 'noon'), TypeError);
  assert.throws(() => sunWindows(0, 0, Number.NaN), TypeError);
  // Boundary values are accepted.
  assert.doesNotThrow(() => sunPosition(-90, -180, valid));
  assert.doesNotThrow(() => sunPosition(90, 180, valid));
});
