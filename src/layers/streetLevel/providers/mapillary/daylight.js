/**
 * Daylight preference for the Mapillary nearest-image pick.
 *
 * A night shot of a street is hard to read: dark, noisy, often lit only by
 * headlights. When the nearest passing image was captured at night and a
 * daylight shot of the same spot sits close by, the daylight shot is the
 * better one to open. The preference is bounded and conservative:
 *
 * - only a daylight record within DAYLIGHT_PREFERENCE_FACTOR × the nearest
 *   distance displaces the nearest record, so the pick stays local;
 * - only a *known-night* nearest is displaced — an undated nearest stays,
 *   because its light is unknown, not night;
 * - daylight is the sun above the horizon at the capture time and the query
 *   point (solar elevation > 0°), from the standard low-precision USNO
 *   solar coordinates, the same family of maths as the satellite pass
 *   predictor. A few minutes of twilight error near sunrise/sunset only
 *   moves a dawn/dusk shot across the line; it never filters anything out.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Solar elevation above which a capture counts as daylight, in degrees. */
export const DAYLIGHT_MIN_ELEVATION_DEG = 0;

/**
 * How far away a daylight shot may sit and still win over a night nearest:
 * within this multiple of the nearest distance.
 */
export const DAYLIGHT_PREFERENCE_FACTOR = 2;

function norm360(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Solar elevation above the horizon, in degrees, for an observer at
 * `latDeg`/`lonDeg` at `dateMs` (UTC epoch milliseconds). NaN for invalid
 * inputs. Accurate to a fraction of a degree — plenty for a day/night line.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {number} dateMs
 * @returns {number}
 */
export function solarElevationDeg(latDeg, lonDeg, dateMs) {
  if (
    !Number.isFinite(latDeg) ||
    !Number.isFinite(lonDeg) ||
    !Number.isFinite(dateMs) ||
    latDeg < -90 ||
    latDeg > 90 ||
    lonDeg < -180 ||
    lonDeg > 180
  )
    return NaN;
  // Days since J2000.0; T is the same span in Julian centuries.
  const D = dateMs / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  const T = D / 36_525;
  const meanAnomalyDeg = norm360(357.529 + 0.98560028 * D);
  const meanLongitudeDeg = norm360(280.459 + 0.98564736 * D);
  const eclipticLongitudeDeg = norm360(
    meanLongitudeDeg +
      1.915 * Math.sin(meanAnomalyDeg * D2R) +
      0.02 * Math.sin(2 * meanAnomalyDeg * D2R),
  );
  const obliquityDeg = 23.439 - 0.00000036 * D;
  const rightAscensionDeg = norm360(
    Math.atan2(
      Math.cos(obliquityDeg * D2R) * Math.sin(eclipticLongitudeDeg * D2R),
      Math.cos(eclipticLongitudeDeg * D2R),
    ) * R2D,
  );
  const declinationRad = Math.asin(
    Math.sin(obliquityDeg * D2R) * Math.sin(eclipticLongitudeDeg * D2R),
  );
  const gmstDeg = norm360(
    280.46061837 +
      360.98564736629 * D +
      // Quadratic/cubic terms take Julian centuries, not days.
      0.000387933 * T * T -
      (T * T * T) / 38_710_000,
  );
  let hourAngleDeg = norm360(gmstDeg + lonDeg - rightAscensionDeg);
  if (hourAngleDeg > 180) hourAngleDeg -= 360;
  const latitudeRad = latDeg * D2R;
  const sinElevation =
    Math.sin(latitudeRad) * Math.sin(declinationRad) +
    Math.cos(latitudeRad) *
      Math.cos(declinationRad) *
      Math.cos(hourAngleDeg * D2R);
  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) * R2D;
}

/**
 * The light a capture was taken in: 'day' when the sun was above the
 * horizon at the capture time and position, 'night' when it was below,
 * 'unknown' when the capture time is missing, unusable, or in the future
 * (a bogus clock), or the position is invalid.
 * @param {{lat?: number, lon?: number, capturedAt?: number}} capture
 * @param {{nowMs?: number}} [options]
 * @returns {'day'|'night'|'unknown'}
 */
export function captureLight(
  { lat, lon, capturedAt } = {},
  { nowMs = Date.now() } = {},
) {
  const ms = Number(capturedAt);
  if (!Number.isFinite(ms) || ms <= 0 || ms > nowMs) return 'unknown';
  const elevation = solarElevationDeg(lat, lon, ms);
  if (!Number.isFinite(elevation)) return 'unknown';
  return elevation > DAYLIGHT_MIN_ELEVATION_DEG ? 'day' : 'night';
}

/**
 * Pick from distance-ascending `entries` (`{record, metres}`): the nearest
 * entry, unless it was captured at night and a daylight entry sits within
 * DAYLIGHT_PREFERENCE_FACTOR × its distance — then the nearest such daylight
 * entry. An undated nearest is never displaced. Returns null when empty.
 * @param {Array<{record: object, metres: number}>} entries
 * @param {{lat: number, lon: number}} query
 * @returns {object|null} The chosen record, or null.
 */
export function preferDaylight(entries, { lat, lon } = {}) {
  if (!entries?.length) return null;
  const nearest = entries[0];
  if (
    captureLight({ lat, lon, capturedAt: nearest.record?.captured_at }) !==
    'night'
  )
    return nearest.record;
  const limit = DAYLIGHT_PREFERENCE_FACTOR * nearest.metres;
  for (const entry of entries) {
    if (entry.metres > limit) break;
    if (
      captureLight({ lat, lon, capturedAt: entry.record?.captured_at }) ===
      'day'
    )
      return entry.record;
  }
  return nearest.record;
}
