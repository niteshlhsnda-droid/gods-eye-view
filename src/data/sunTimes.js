/**
 * Sunrise / sunset / twilight / golden-hour times for a UTC day.
 *
 * Algorithm: the NOAA Solar Calculator spreadsheet equations (NOAA Global
 * Monitoring Laboratory, public-domain US-government formulas):
 * fractional year γ, equation of time, and solar declination are the
 * Fourier series published in the NOAA solar-equations reference
 * (https://gml.noaa.gov/grad/solcalc/solareqns.PDF), and event times come
 * from the hour-angle formula with the standard zenith angles:
 * 90.833° for sunrise/sunset (refraction + solar semidiameter),
 * 96° civil, 102° nautical, 108° astronomical twilight. Golden hour is the
 * span while the sun's centre is between 0° and +6° above the horizon.
 *
 * Why a new module: the only solar math in the app today is a simplified
 * elevation estimate in `src/hud.js` (~line 511, declination approximated,
 * solar noon fixed at 12:00) — it cannot answer "when is sunrise here".
 * Ruling #6's "next sunrise/sunset first" progressive-load order and the
 * Live Now "Now Over" view both need real event times; this is the pure
 * calculation they can share.
 *
 * Pure: no DOM, no Cesium, no imports, no network, no timezone database.
 * All returned times are UTC `Date`s. Near ±180° longitude an event can
 * fall on the adjacent UTC date; callers must display the Date as given,
 * not re-derive it from the input day.
 *
 * Accuracy: single-evaluation (declination/equation-of-time at noon) —
 * within ~2 minutes of published almanac values at mid-latitudes.
 * Polar regions return null events + a `polar` flag instead of a number.
 *
 * @module data/sunTimes
 */

/** Zenith for sunrise/sunset: 90° + 34′ refraction + 16′ semidiameter. */
export const ZENITH_SUNRISE_SUNSET = 90.833;
/** Zeniths for civil / nautical / astronomical twilight. */
export const ZENITH_CIVIL = 96;
export const ZENITH_NAUTICAL = 102;
export const ZENITH_ASTRONOMICAL = 108;
/** Zenith for the top of golden hour (sun 6° above the horizon). */
export const ZENITH_GOLDEN_HOUR_TOP = 84;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

function dayOfYearUTC(midnightMs) {
  const jan1 = Date.UTC(new Date(midnightMs).getUTCFullYear(), 0, 1);
  return Math.round((midnightMs - jan1) / DAY_MS) + 1;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * NOAA Fourier series: equation of time (minutes) and declination (radians)
 * for a fractional year gamma (radians).
 */
function solarEphemeris(gamma) {
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  return { eqTime, decl };
}

/**
 * Minutes-from-midnight (UTC) of a solar event at the given zenith, or
 * null when the sun never reaches that zenith on this day (polar day/night).
 * `solarNoonMin` is the day's solar-noon minute; `latRad`/`decl` are in
 * radians. `cosH` outside [-1, 1] means no crossing.
 */
function eventMinutes(solarNoonMin, latRad, decl, zenithDeg, morning) {
  const cosH =
    (Math.cos((zenithDeg * Math.PI) / 180) -
      Math.sin(latRad) * Math.sin(decl)) /
    (Math.cos(latRad) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null;
  const hourAngleDeg = (Math.acos(cosH) * 180) / Math.PI;
  return solarNoonMin + (morning ? -4 : 4) * hourAngleDeg;
}

/**
 * Sun times for the UTC day containing `date`.
 * @param {{latitude:number, longitude:number, date:Date}} input
 * @returns {{utcDate:string, solarNoon:Date, sunrise:Date|null,
 *   sunset:Date|null, dayLengthMs:number|null, civilDawn:Date|null,
 *   civilDusk:Date|null, nauticalDawn:Date|null, nauticalDusk:Date|null,
 *   astronomicalDawn:Date|null, astronomicalDusk:Date|null,
 *   goldenHourMorning:{start:Date, end:Date}|null,
 *   goldenHourEvening:{start:Date, end:Date}|null,
 *   polar:'day'|'night'|null}}
 */
export function sunTimes({ latitude, longitude, date }) {
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new RangeError(`Invalid lat/lon: ${latitude}, ${longitude}`);
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
  const year = date.getUTCFullYear();
  const midnightMs = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const daysInYear = isLeapYear(year) ? 366 : 365;
  // Fractional year at local noon (NOAA spreadsheet convention).
  const gamma = ((2 * Math.PI) / daysInYear) * (dayOfYearUTC(midnightMs) - 1);
  const { eqTime, decl } = solarEphemeris(gamma);
  const latRad = (latitude * Math.PI) / 180;
  const solarNoonMin = 720 - 4 * longitude - eqTime;
  const at = (minutes) =>
    minutes === null ? null : new Date(midnightMs + minutes * MIN_MS);

  const sunriseMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_SUNRISE_SUNSET,
    true,
  );
  const sunsetMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_SUNRISE_SUNSET,
    false,
  );
  const civilDawnMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_CIVIL,
    true,
  );
  const civilDuskMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_CIVIL,
    false,
  );
  const nauticalDawnMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_NAUTICAL,
    true,
  );
  const nauticalDuskMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_NAUTICAL,
    false,
  );
  const astronomicalDawnMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_ASTRONOMICAL,
    true,
  );
  const astronomicalDuskMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_ASTRONOMICAL,
    false,
  );

  // Polar flag from the sunrise/sunset cosine: >1 means the sun never
  // rises (polar night), <-1 means it never sets (polar day).
  let polar = null;
  if (sunriseMin === null && sunsetMin === null) {
    const cosH =
      (Math.cos((ZENITH_SUNRISE_SUNSET * Math.PI) / 180) -
        Math.sin(latRad) * Math.sin(decl)) /
      (Math.cos(latRad) * Math.cos(decl));
    polar = cosH > 1 ? 'night' : 'day';
  }

  // Golden hour: sun centre between 0° and +6° elevation.
  const goldenTopMorningMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_GOLDEN_HOUR_TOP,
    true,
  );
  const goldenTopEveningMin = eventMinutes(
    solarNoonMin,
    latRad,
    decl,
    ZENITH_GOLDEN_HOUR_TOP,
    false,
  );
  const goldenHourMorning =
    sunriseMin !== null && goldenTopMorningMin !== null
      ? { start: at(sunriseMin), end: at(goldenTopMorningMin) }
      : null;
  const goldenHourEvening =
    sunsetMin !== null && goldenTopEveningMin !== null
      ? { start: at(goldenTopEveningMin), end: at(sunsetMin) }
      : null;

  return {
    utcDate: new Date(midnightMs).toISOString().slice(0, 10),
    solarNoon: at(solarNoonMin),
    sunrise: at(sunriseMin),
    sunset: at(sunsetMin),
    dayLengthMs:
      sunriseMin !== null && sunsetMin !== null
        ? (sunsetMin - sunriseMin) * MIN_MS
        : null,
    civilDawn: at(civilDawnMin),
    civilDusk: at(civilDuskMin),
    nauticalDawn: at(nauticalDawnMin),
    nauticalDusk: at(nauticalDuskMin),
    astronomicalDawn: at(astronomicalDawnMin),
    astronomicalDusk: at(astronomicalDuskMin),
    goldenHourMorning,
    goldenHourEvening,
    polar,
  };
}
