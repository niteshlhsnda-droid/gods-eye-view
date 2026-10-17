/**
 * Solar position: elevation + azimuth of the Sun from latitude,
 * longitude, and timestamp, plus golden-hour / blue-hour window
 * derivation and a day/night determination.
 *
 * Why a new module: GEV already has a sun-times-style helper family
 * in mind (Cycles 1-6 added sunTimes, moonPhase, Beaufort,
 * feelsLike, ICAO Standard Atmosphere, and FAA flightCategories),
 * but nothing that answers "where exactly is the Sun right now?"
 * for a camera, a shadow, or a golden-hour badge. This module is
 * that answer: one pure function for the instantaneous position,
 * one for the day's windows, and small predicates for day / night /
 * golden / blue hour, all sharing the same equations so the badge
 * and the windows can never disagree.
 *
 * Model: the NOAA Solar Calculator equations, which NOAA documents
 * as based on Jean Meeus, "Astronomical Algorithms" (2nd edition).
 * Julian day -> Julian century -> geometric mean longitude and
 * anomaly of the Sun -> equation of center -> true and apparent
 * longitude -> obliquity correction -> declination and equation of
 * time -> true solar time -> hour angle -> zenith / elevation /
 * azimuth. The full step-by-step derivation is implemented in
 * `solarCoordinates` below; every constant below is a NOAA / Meeus
 * constant, not a fitted value.
 *
 * Sources (primary sources only; no blog summaries):
 * - NOAA Global Monitoring Laboratory, "Solar Calculation Details"
 *   https://gml.noaa.gov/grad/solcalc/calcdetails.html
 *   (calculations based on Meeus, Astronomical Algorithms; sunrise
 *   and sunset assume 0.833 degrees of atmospheric refraction;
 *   refraction model table; accuracy: sunrise/sunset theoretically
 *   accurate to within a minute for |latitude| <= 72 degrees, and
 *   within 10 minutes outside those latitudes).
 * - NOAA Global Monitoring Laboratory, Solar Calculator
 *   https://gml.noaa.gov/grad/solcalc/
 *   (equation of time, solar declination, solar noon, apparent
 *   sunrise/sunset, azimuth/elevation outputs this module mirrors).
 * - Jean Meeus, "Astronomical Algorithms", 2nd edition, 1998,
 *   Chapter 25 (solar coordinates) and Chapter 28 (equation of
 *   time) — the published source of the NOAA equations.
 * - U.S. Naval Observatory, "Approximate Solar Coordinates"
 *   https://aa.usno.navy.mil/data/ApproximateSolarCoordinates
 *   (independent statement of the same low-precision solar
 *   algorithm; used only as a cross-check on the constants).
 *
 * Accuracy limits — read before using the numbers:
 * - DISPLAY-GRADE, NOT NAVIGATION-GRADE. This module computes the
 *   GEOMETRIC (vacuum) position of the Sun's centre. Atmospheric
 *   refraction is NOT modeled: near the horizon the apparent Sun
 *   sits up to ~0.6 degrees higher than the geometric position, so
 *   the geometric sunrise/sunset here can differ from the apparent
 *   (observed) sunrise/sunset by a few minutes, more at high
 *   latitudes where the Sun rises at a shallow angle.
 * - The NOAA sunrise/sunset convention folds in 0.833 degrees
 *   (refraction + the Sun's apparent radius) and reports the
 *   APPARENT upper-limb sunrise/sunset. This module deliberately
 *   does NOT do that: `sunrise` / `sunset` are the instants the
 *   geometric centre crosses elevation 0 degrees, so that the
 *   windows are exactly consistent with `sunPosition` (the
 *   elevation AT the returned sunrise/sunset is 0, by construction).
 *   Callers that need the apparent upper-limb times should apply
 *   their own -0.833-degree threshold on top.
 * - The underlying approximations are ~0.01-degree class (NOAA:
 *   sunrise/sunset within a minute for |latitude| <= 72 degrees).
 *   Do not use this for navigation, surveying, legal sunrise/sunset
 *   certification, or any purpose where minutes matter — NOAA
 *   itself says it cannot certify sunrise/sunset data.
 * - Golden hour is the widely used 0 to 6 degree band (Sun between
 *   the horizon and 6 degrees up); blue hour is the -6 to -4 degree
 *   band (Sun between 6 and 4 degrees below the horizon, inside
 *   civil twilight). Both bands are conventions, not physics —
 *   photographers disagree by a degree or two — so the thresholds
 *   are exported constants, not buried magic numbers.
 * - All times are UTC. `sunWindows` uses the UTC calendar day of
 *   the input date. Dates outside roughly 1800-2100 still compute,
 *   but the Meeus low-precision series degrades outside that range.
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/sunPosition
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const MINUTES_PER_DAY = 1440;

/** Golden hour: the Sun is at most this far above the horizon (degrees). */
export const GOLDEN_HOUR_MAX_ELEVATION_DEG = 6;

/** Blue hour: the Sun is at least this far below the horizon (degrees). */
export const BLUE_HOUR_MIN_ELEVATION_DEG = -6;

/** Blue hour: the Sun is at most this far below the horizon (degrees). */
export const BLUE_HOUR_MAX_ELEVATION_DEG = -4;

/** Civil twilight: the Sun is at most this far below the horizon (degrees). */
export const CIVIL_TWILIGHT_ELEVATION_DEG = -6;

/** Nautical twilight: the Sun is at most this far below the horizon (degrees). */
export const NAUTICAL_TWILIGHT_ELEVATION_DEG = -12;

/** Astronomical twilight: the Sun is at most this far below the horizon (degrees). */
export const ASTRONOMICAL_TWILIGHT_ELEVATION_DEG = -18;

/**
 * Geometric sunrise/sunset threshold (degrees): the elevation of
 * the Sun's centre at sunrise/sunset. Geometric, NOT the NOAA
 * apparent upper-limb -0.833-degree threshold — see the module
 * header on why.
 */
export const SUNRISE_SUNSET_ELEVATION_DEG = 0;

/** Day phases, from brightest to darkest. */
export const DAY_PHASES = Object.freeze([
  'day',
  'civilTwilight',
  'nauticalTwilight',
  'astronomicalTwilight',
  'night',
]);

function assertLatitude(latitudeDeg) {
  if (
    typeof latitudeDeg !== 'number' ||
    !Number.isFinite(latitudeDeg) ||
    latitudeDeg < -90 ||
    latitudeDeg > 90
  ) {
    throw new TypeError(
      `latitudeDeg must be a finite number in [-90, 90], got ${String(latitudeDeg)}`,
    );
  }
}

function assertLongitude(longitudeDeg) {
  if (
    typeof longitudeDeg !== 'number' ||
    !Number.isFinite(longitudeDeg) ||
    longitudeDeg < -180 ||
    longitudeDeg > 180
  ) {
    throw new TypeError(
      `longitudeDeg must be a finite number in [-180, 180], got ${String(longitudeDeg)}`,
    );
  }
}

function assertDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
}

function assertLatLonDate(latitudeDeg, longitudeDeg, date) {
  assertLatitude(latitudeDeg);
  assertLongitude(longitudeDeg);
  assertDate(date);
}

function normalizeDegrees360(degrees) {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function sinDeg(degrees) {
  return Math.sin(degrees * DEG_TO_RAD);
}

function cosDeg(degrees) {
  return Math.cos(degrees * DEG_TO_RAD);
}

function tanDeg(degrees) {
  return Math.tan(degrees * DEG_TO_RAD);
}

function asinDeg(value) {
  return Math.asin(value) * RAD_TO_DEG;
}

function atan2Deg(y, x) {
  return Math.atan2(y, x) * RAD_TO_DEG;
}

/**
 * Core NOAA / Meeus solar coordinates at one instant: declination
 * and equation of time, from which elevation / azimuth follow.
 * Internal: callers want `sunPosition`.
 *
 * @param {number} latitudeDeg latitude in degrees, [-90, 90].
 * @param {number} longitudeDeg longitude in degrees, [-180, 180].
 * @param {Date} date timestamp (UTC).
 * @returns {{declinationDeg: number, equationOfTimeMinutes: number,
 *   hourAngleDeg: number, elevationDeg: number, azimuthDeg: number,
 *   zenithDeg: number}} the solar coordinates.
 */
function solarCoordinates(latitudeDeg, longitudeDeg, date) {
  // Julian day (Meeus: JD = Unix epoch 2440587.5 + days since epoch).
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  // Julian century since J2000.0.
  const julianCentury = (julianDay - 2451545.0) / 36525;

  // Geometric mean longitude of the Sun, degrees.
  const meanLongitude = normalizeDegrees360(
    280.46646 + julianCentury * (36000.76983 + julianCentury * 0.0003032),
  );
  // Geometric mean anomaly of the Sun, degrees.
  const meanAnomaly = normalizeDegrees360(
    357.52911 + julianCentury * (35999.05029 - julianCentury * 0.0001537),
  );
  // Eccentricity of Earth's orbit.
  const eccentricity =
    0.016708634 - julianCentury * (0.000042037 + julianCentury * 0.0000001267);

  // Equation of center: the Sun's true longitude minus its mean
  // longitude, degrees.
  const equationOfCenter =
    sinDeg(meanAnomaly) *
      (1.914602 - julianCentury * (0.004817 + julianCentury * 0.000014)) +
    sinDeg(2 * meanAnomaly) * (0.019993 - julianCentury * 0.000101) +
    sinDeg(3 * meanAnomaly) * 0.000289;

  const trueLongitude = meanLongitude + equationOfCenter;
  // Apparent longitude: true longitude corrected for nutation and
  // aberration (the -0.00569 - 0.00478*sin(omega) terms).
  const omega = 125.04 - 1934.136 * julianCentury;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * sinDeg(omega);

  // Mean obliquity of the ecliptic, degrees, plus nutation correction.
  const meanObliquity =
    23 +
    (26 +
      (21.448 -
        julianCentury *
          (46.815 + julianCentury * (0.00059 - julianCentury * 0.001813))) /
        60) /
      60;
  const obliquityCorrection = meanObliquity + 0.00256 * cosDeg(omega);

  // Solar declination, degrees.
  const declinationDeg = asinDeg(
    sinDeg(obliquityCorrection) * sinDeg(apparentLongitude),
  );

  // Equation of time, minutes (apparent solar time minus mean solar
  // time). The varY factor is tan(obliquity/2)^2.
  const varY = Math.tan((obliquityCorrection * DEG_TO_RAD) / 2) ** 2;
  const equationOfTimeMinutes =
    4 *
    RAD_TO_DEG *
    (varY * sinDeg(2 * meanLongitude) -
      2 * eccentricity * sinDeg(meanAnomaly) +
      4 *
        eccentricity *
        varY *
        sinDeg(meanAnomaly) *
        cosDeg(2 * meanLongitude) -
      0.5 * varY * varY * sinDeg(4 * meanLongitude) -
      1.25 * eccentricity * eccentricity * sinDeg(2 * meanAnomaly));

  // True solar time, minutes since UTC midnight, wrapped to [0, 1440).
  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000;
  const trueSolarTimeMinutes =
    (((utcMinutes + equationOfTimeMinutes + 4 * longitudeDeg) %
      MINUTES_PER_DAY) +
      MINUTES_PER_DAY) %
    MINUTES_PER_DAY;

  // Hour angle, degrees: 0 at solar noon, negative in the morning,
  // positive in the afternoon.
  let hourAngleDeg = trueSolarTimeMinutes / 4 - 180;
  if (hourAngleDeg < -180) {
    hourAngleDeg += 360;
  }

  // Solar zenith angle: acos(sin(lat)*sin(decl) + cos(lat)*cos(decl)*cos(HRA)).
  const cosZenith = Math.min(
    1,
    Math.max(
      -1,
      sinDeg(latitudeDeg) * sinDeg(declinationDeg) +
        cosDeg(latitudeDeg) * cosDeg(declinationDeg) * cosDeg(hourAngleDeg),
    ),
  );
  const zenithDeg = Math.acos(cosZenith) * RAD_TO_DEG;
  const elevationDeg = 90 - zenithDeg;

  // Solar azimuth, clockwise from north: atan2(sin(HRA),
  // cos(HRA)*sin(lat) - tan(decl)*cos(lat)) + 180 degrees.
  // At the exact zenith (elevation 90 degrees) the azimuth is
  // undefined; the formula then yields 180 degrees (atan2(0, 0)
  // is 0 in IEEE Math.atan2). Callers must not read direction into
  // an azimuth reported at elevation ~90 degrees.
  const azimuthDeg = normalizeDegrees360(
    atan2Deg(
      sinDeg(hourAngleDeg),
      cosDeg(hourAngleDeg) * sinDeg(latitudeDeg) -
        tanDeg(declinationDeg) * cosDeg(latitudeDeg),
    ) + 180,
  );

  return {
    declinationDeg,
    equationOfTimeMinutes,
    hourAngleDeg,
    elevationDeg,
    azimuthDeg,
    zenithDeg,
  };
}

/**
 * Instantaneous solar position: geometric elevation and azimuth of
 * the Sun's centre at a latitude / longitude / timestamp.
 *
 * Azimuth is clockwise from north: 0 = due north, 90 = due east,
 * 180 = due south, 270 = due west. Elevation is degrees above the
 * horizon (negative when the Sun is below it). Neither value is
 * corrected for atmospheric refraction (see the module header).
 *
 * @param {number} latitudeDeg latitude in degrees, [-90, 90].
 * @param {number} longitudeDeg longitude in degrees, [-180, 180].
 * @param {Date} date timestamp (UTC).
 * @returns {Readonly<{elevationDeg: number, azimuthDeg: number,
 *   zenithDeg: number, declinationDeg: number, hourAngleDeg: number,
 *   equationOfTimeMinutes: number}>} the solar position.
 */
export function sunPosition(latitudeDeg, longitudeDeg, date) {
  assertLatLonDate(latitudeDeg, longitudeDeg, date);
  const coords = solarCoordinates(latitudeDeg, longitudeDeg, date);
  return Object.freeze({
    elevationDeg: coords.elevationDeg,
    azimuthDeg: coords.azimuthDeg,
    zenithDeg: coords.zenithDeg,
    declinationDeg: coords.declinationDeg,
    hourAngleDeg: coords.hourAngleDeg,
    equationOfTimeMinutes: coords.equationOfTimeMinutes,
  });
}

/**
 * Day phase at an instant, from the geometric solar elevation:
 * 'day' above the horizon, then civil / nautical / astronomical
 * twilight bands, then 'night' below -18 degrees.
 *
 * @param {number} latitudeDeg latitude in degrees, [-90, 90].
 * @param {number} longitudeDeg longitude in degrees, [-180, 180].
 * @param {Date} date timestamp (UTC).
 * @returns {'day'|'civilTwilight'|'nauticalTwilight'|'astronomicalTwilight'|'night'}
 *   the day phase.
 */
export function dayPhase(latitudeDeg, longitudeDeg, date) {
  assertLatLonDate(latitudeDeg, longitudeDeg, date);
  const { elevationDeg } = solarCoordinates(latitudeDeg, longitudeDeg, date);
  if (elevationDeg > SUNRISE_SUNSET_ELEVATION_DEG) {
    return 'day';
  }
  if (elevationDeg > CIVIL_TWILIGHT_ELEVATION_DEG) {
    return 'civilTwilight';
  }
  if (elevationDeg > NAUTICAL_TWILIGHT_ELEVATION_DEG) {
    return 'nauticalTwilight';
  }
  if (elevationDeg > ASTRONOMICAL_TWILIGHT_ELEVATION_DEG) {
    return 'astronomicalTwilight';
  }
  return 'night';
}

/**
 * Whether the Sun's geometric centre is above the horizon.
 *
 * @param {number} latitudeDeg latitude in degrees, [-90, 90].
 * @param {number} longitudeDeg longitude in degrees, [-180, 180].
 * @param {Date} date timestamp (UTC).
 * @returns {boolean} true in daytime.
 */
export function isDaytime(latitudeDeg, longitudeDeg, date) {
  return dayPhase(latitudeDeg, longitudeDeg, date) === 'day';
}

/**
 * Whether the instant is in golden hour: the Sun between the
 * horizon and 6 degrees up (inclusive of both edges).
 *
 * @param {number} latitudeDeg latitude in degrees, [-90, 90].
 * @param {number} longitudeDeg longitude in degrees, [-180, 180].
 * @param {Date} date timestamp (UTC).
 * @returns {boolean} true in golden hour.
 */
export function isGoldenHour(latitudeDeg, longitudeDeg, date) {
  assertLatLonDate(latitudeDeg, longitudeDeg, date);
  const { elevationDeg } = solarCoordinates(latitudeDeg, longitudeDeg, date);
  return (
    elevationDeg >= SUNRISE_SUNSET_ELEVATION_DEG &&
    elevationDeg <= GOLDEN_HOUR_MAX_ELEVATION_DEG
  );
}

/**
 * Whether the instant is in blue hour: the Sun between 6 and 4
 * degrees below the horizon (inclusive of both edges), inside
 * civil twilight.
 *
 * @param {number} latitudeDeg latitude in degrees, [-90, 90].
 * @param {number} longitudeDeg longitude in degrees, [-180, 180].
 * @param {Date} date timestamp (UTC).
 * @returns {boolean} true in blue hour.
 */
export function isBlueHour(latitudeDeg, longitudeDeg, date) {
  assertLatLonDate(latitudeDeg, longitudeDeg, date);
  const { elevationDeg } = solarCoordinates(latitudeDeg, longitudeDeg, date);
  return (
    elevationDeg >= BLUE_HOUR_MIN_ELEVATION_DEG &&
    elevationDeg <= BLUE_HOUR_MAX_ELEVATION_DEG
  );
}

/**
 * Solar noon for a UTC calendar day: the instant of maximum solar
 * elevation. Computed analytically (720 - 4*longitude - equation
 * of time, in minutes from UTC midnight) with one refinement pass
 * re-evaluating the equation of time at the first estimate, so the
 * result is accurate to well under a second.
 *
 * @param {number} latitudeDeg latitude in degrees (unused except
 *   for validation symmetry with the other exports).
 * @param {number} longitudeDeg longitude in degrees, [-180, 180].
 * @param {Date} date any instant on the UTC calendar day.
 * @returns {Date} solar noon (UTC).
 */
export function solarNoon(latitudeDeg, longitudeDeg, date) {
  assertLatLonDate(latitudeDeg, longitudeDeg, date);
  const dayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  let noonMinutes =
    720 -
    4 * longitudeDeg -
    solarCoordinates(
      latitudeDeg,
      longitudeDeg,
      new Date(dayStart + 720 * 60000),
    ).equationOfTimeMinutes;
  // One refinement pass: re-evaluate the equation of time at the
  // first estimate. It changes by < 0.1 minute across the day, so
  // one pass converges to well under a second.
  noonMinutes =
    720 -
    4 * longitudeDeg -
    solarCoordinates(
      latitudeDeg,
      longitudeDeg,
      new Date(dayStart + noonMinutes * 60000),
    ).equationOfTimeMinutes;
  const wrapped =
    ((noonMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return new Date(dayStart + wrapped * 60000);
}

function elevationAt(latitudeDeg, longitudeDeg, dayStartMs, minutes) {
  return solarCoordinates(
    latitudeDeg,
    longitudeDeg,
    new Date(dayStartMs + minutes * 60000),
  ).elevationDeg;
}

/**
 * All instants in a UTC day where the elevation crosses a threshold,
 * in ascending minutes-from-midnight order, found by a 1-minute
 * scan plus bisection to ~0.5 s precision. Crossings within a
 * microsecond of each other are de-duplicated (an exact grid hit
 * would otherwise register twice).
 *
 * @param {number} latitudeDeg latitude in degrees.
 * @param {number} longitudeDeg longitude in degrees.
 * @param {number} dayStartMs UTC midnight of the day, as epoch ms.
 * @param {number} thresholdDeg elevation threshold in degrees.
 * @returns {Array<number>} crossing times in minutes from midnight.
 */
function findCrossings(latitudeDeg, longitudeDeg, dayStartMs, thresholdDeg) {
  const crossings = [];
  let prevMinutes = 0;
  let prevDiff =
    elevationAt(latitudeDeg, longitudeDeg, dayStartMs, 0) - thresholdDeg;
  const push = (minutes) => {
    if (
      crossings.length === 0 ||
      minutes - crossings[crossings.length - 1] > 1 / 60000
    ) {
      crossings.push(minutes);
    }
  };
  if (prevDiff === 0) {
    push(0);
  }
  for (let minutes = 1; minutes <= MINUTES_PER_DAY; minutes += 1) {
    const diff =
      elevationAt(latitudeDeg, longitudeDeg, dayStartMs, minutes) -
      thresholdDeg;
    if (diff === 0) {
      push(minutes);
    } else if ((prevDiff < 0 && diff > 0) || (prevDiff > 0 && diff < 0)) {
      // Bisect [prevMinutes, minutes] to ~0.5 s.
      let low = prevMinutes;
      let high = minutes;
      let lowDiff = prevDiff;
      for (let i = 0; i < 40 && high - low > 1 / 120; i += 1) {
        const mid = (low + high) / 2;
        const midDiff =
          elevationAt(latitudeDeg, longitudeDeg, dayStartMs, mid) -
          thresholdDeg;
        if ((lowDiff < 0 && midDiff > 0) || (lowDiff > 0 && midDiff < 0)) {
          high = mid;
        } else {
          low = mid;
          lowDiff = midDiff;
        }
      }
      push((low + high) / 2);
    }
    prevMinutes = minutes;
    prevDiff = diff;
  }
  return crossings;
}

/**
 * All sub-intervals of a UTC day whose elevation lies inside
 * [lowerDeg, upperDeg] (inclusive), as [start, end] minute pairs.
 * The day is split at every crossing of either threshold, so each
 * segment is wholly inside or outside the band; segments are
 * merged where they touch.
 *
 * @param {number} latitudeDeg latitude in degrees.
 * @param {number} longitudeDeg longitude in degrees.
 * @param {number} dayStartMs UTC midnight of the day, as epoch ms.
 * @param {number} lowerDeg band lower edge, degrees.
 * @param {number} upperDeg band upper edge, degrees.
 * @returns {Array<[number, number]>} band intervals in minutes from midnight.
 */
function bandIntervals(
  latitudeDeg,
  longitudeDeg,
  dayStartMs,
  lowerDeg,
  upperDeg,
) {
  const cuts = new Set([0, MINUTES_PER_DAY]);
  for (const crossing of findCrossings(
    latitudeDeg,
    longitudeDeg,
    dayStartMs,
    lowerDeg,
  )) {
    cuts.add(crossing);
  }
  for (const crossing of findCrossings(
    latitudeDeg,
    longitudeDeg,
    dayStartMs,
    upperDeg,
  )) {
    cuts.add(crossing);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const intervals = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end - start < 1 / 120) {
      continue;
    }
    const midElevation = elevationAt(
      latitudeDeg,
      longitudeDeg,
      dayStartMs,
      (start + end) / 2,
    );
    if (midElevation >= lowerDeg && midElevation <= upperDeg) {
      const last = intervals[intervals.length - 1];
      if (last && Math.abs(last[1] - start) < 1 / 60) {
        last[1] = end;
      } else {
        intervals.push([start, end]);
      }
    }
  }
  return intervals;
}

/**
 * The Sun's windows for one UTC calendar day: geometric sunrise /
 * sunset (centre crossing elevation 0), solar noon, day length,
 * polar day/night flags, and every golden-hour and blue-hour
 * window that day.
 *
 * Sunrise is the first upward centre-crossing of elevation 0 in
 * the UTC day (null when the day holds no upward crossing);
 * sunset is the last downward crossing (null when none). On days
 * where the local day straddles UTC midnight, sunrise can fall
 * after sunset and dayLengthMinutes is then null. The polar flags
 * describe the whole UTC day: polarDay means the Sun never sets
 * that UTC day, polarNight means it never rises. At longitudes
 * far from UTC the "day" can straddle two local days; callers
 * showing local days should query the UTC days the local day
 * overlaps.
 *
 * @param {number} latitudeDeg latitude in degrees, [-90, 90].
 * @param {number} longitudeDeg longitude in degrees, [-180, 180].
 * @param {Date} date any instant on the UTC calendar day.
 * @returns {Readonly<{
 *   date: Date,
 *   sunrise: Date|null, sunset: Date|null, solarNoon: Date,
 *   dayLengthMinutes: number|null, polarDay: boolean,
 *   polarNight: boolean,
 *   goldenHourWindows: ReadonlyArray<Readonly<{start: Date, end: Date}>>,
 *   blueHourWindows: ReadonlyArray<Readonly<{start: Date, end: Date}>>,
 *   midnightElevationDeg: number
 * }>} the day's solar windows (all times UTC).
 */
export function sunWindows(latitudeDeg, longitudeDeg, date) {
  assertLatLonDate(latitudeDeg, longitudeDeg, date);
  const dayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const noon = solarNoon(latitudeDeg, longitudeDeg, date);

  const daytime = bandIntervals(
    latitudeDeg,
    longitudeDeg,
    dayStart,
    SUNRISE_SUNSET_ELEVATION_DEG,
    90,
  );
  // Sunrise is the first UPWARD centre-crossing of elevation 0 in
  // this UTC day; sunset is the last DOWNWARD crossing. Either is
  // null when the day holds no crossing in that direction (polar
  // day/night, or a polar transition day with only one crossing).
  const zeroCrossings = findCrossings(
    latitudeDeg,
    longitudeDeg,
    dayStart,
    SUNRISE_SUNSET_ELEVATION_DEG,
  );
  const risingCrossings = [];
  const fallingCrossings = [];
  for (const crossing of zeroCrossings) {
    // Sample just inside the day on the side the crossing moves
    // toward: after the crossing, except at the 24:00 edge where
    // the sample must fall before it.
    const probe =
      crossing >= MINUTES_PER_DAY - 1 / 120 ? crossing - 0.5 : crossing + 0.5;
    const after = elevationAt(latitudeDeg, longitudeDeg, dayStart, probe);
    if (after > SUNRISE_SUNSET_ELEVATION_DEG) {
      risingCrossings.push(crossing);
    } else {
      fallingCrossings.push(crossing);
    }
  }
  const sunrise =
    risingCrossings.length > 0
      ? new Date(dayStart + risingCrossings[0] * 60000)
      : null;
  const sunset =
    fallingCrossings.length > 0
      ? new Date(
          dayStart + fallingCrossings[fallingCrossings.length - 1] * 60000,
        )
      : null;

  const midnightElevation = elevationAt(latitudeDeg, longitudeDeg, dayStart, 0);
  const polarDay =
    daytime.length === 1 &&
    daytime[0][0] === 0 &&
    daytime[0][1] === MINUTES_PER_DAY;
  const polarNight = daytime.length === 0;

  const toWindow = ([start, end]) =>
    Object.freeze({
      start: new Date(dayStart + start * 60000),
      end: new Date(dayStart + end * 60000),
    });

  return Object.freeze({
    date: new Date(dayStart),
    sunrise,
    sunset,
    solarNoon: noon,
    dayLengthMinutes:
      sunrise !== null &&
      sunset !== null &&
      sunset.getTime() > sunrise.getTime()
        ? (sunset.getTime() - sunrise.getTime()) / 60000
        : null,
    polarDay,
    polarNight,
    goldenHourWindows: Object.freeze(
      bandIntervals(
        latitudeDeg,
        longitudeDeg,
        dayStart,
        SUNRISE_SUNSET_ELEVATION_DEG,
        GOLDEN_HOUR_MAX_ELEVATION_DEG,
      ).map(toWindow),
    ),
    blueHourWindows: Object.freeze(
      bandIntervals(
        latitudeDeg,
        longitudeDeg,
        dayStart,
        BLUE_HOUR_MIN_ELEVATION_DEG,
        BLUE_HOUR_MAX_ELEVATION_DEG,
      ).map(toWindow),
    ),
    // Exposed for tests / debugging: the elevation at UTC midnight,
    // which decides the polar flags above.
    midnightElevationDeg: midnightElevation,
  });
}
