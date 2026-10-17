/**
 * @file Coordinate precision honesty: never display more decimals than the
 * source accuracy justifies.
 *
 * Six decimals (≈0.11 m steps) on a coordinate whose source is only accurate
 * to a kilometre is a false claim: the reader cannot tell which digits are
 * measurement and which are noise. The fix is mechanical — round the
 * DISPLAYED coordinate to the decimals the claimed accuracy supports — so
 * this module is the single place that mapping lives. Call sites pass the
 * source's stated accuracy in metres; the module picks the decimals, the
 * formatted string, and the one-line honesty note a UI can show beside it.
 *
 * Decimal → grid-step table (1° of latitude ≈ 111,320 m; longitude steps
 * are smaller away from the equator, so these are worst-case / conservative):
 *
 * | decimals | step    | use when source accuracy is |
 * |----------|---------|-----------------------------|
 * | 1        | ~11.1 km| >= 10 km                    |
 * | 2        | ~1.11 km| >= 1 km                     |
 * | 3        | ~111 m  | >= 100 m, or unknown        |
 * | 4        | ~11.1 m | >= 10 m                     |
 * | 5        | ~1.11 m | >= 1 m                      |
 * | 6        | ~0.11 m | < 1 m (survey-grade / exact) |
 *
 * Boundaries are inclusive at the top (`>=`): an accuracy of exactly 1 km
 * earns 2 decimals, never 3. Unknown accuracy defaults to 3 decimals — a
 * city-block-scale display that claims nothing finer — and the note says so.
 *
 * Deliberate non-goal: internal identity must NOT use this. Render keys,
 * cache keys, hashes, and API query parameters keep full precision —
 * rounding there would merge distinct positions. This module is for
 * human-readable display only.
 *
 * Rule: docs/coordinate-precision.md.
 *
 * @module data/coordinatePrecision
 */

/** Decimals used when the caller cannot state a source accuracy. */
const UNKNOWN_ACCURACY_DECIMALS = 3;

function assertAccuracy(accuracyMeters) {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
    throw new TypeError('accuracyMeters must be a non-negative finite number');
  }
}

/**
 * How many decimals a coordinate display may show for a source accurate to
 * `accuracyMeters`. `null`/`undefined` means the accuracy is unknown and
 * yields the conservative 3-decimal default. Negative, NaN, or infinite
 * accuracy is a programmer error and throws.
 * @param {number|null|undefined} accuracyMeters Source accuracy in metres.
 * @returns {number} Decimals from 1 to 6.
 */
export function precisionDecimals(accuracyMeters) {
  if (accuracyMeters == null) return UNKNOWN_ACCURACY_DECIMALS;
  assertAccuracy(accuracyMeters);
  if (accuracyMeters >= 10_000) return 1;
  if (accuracyMeters >= 1_000) return 2;
  if (accuracyMeters >= 100) return 3;
  if (accuracyMeters >= 10) return 4;
  if (accuracyMeters >= 1) return 5;
  return 6;
}

/**
 * Format one coordinate for display, rounded to the decimals the source
 * accuracy justifies. Returns null for a non-finite value so callers can
 * fall back (never print "NaN" as a coordinate).
 * @param {number} value Latitude or longitude in decimal degrees.
 * @param {number|null|undefined} accuracyMeters Source accuracy in metres.
 * @returns {string|null} Rounded coordinate, or null when `value` is unusable.
 */
export function formatCoordinate(value, accuracyMeters) {
  if (!Number.isFinite(value)) return null;
  return value.toFixed(precisionDecimals(accuracyMeters));
}

/**
 * Format a lat/lon pair for display as `"lat, lon"`, both rounded to the
 * same accuracy-justified decimals. Returns null when either value is
 * non-finite.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number|null|undefined} accuracyMeters Source accuracy in metres.
 * @returns {string|null} `"lat, lon"`, or null when either value is unusable.
 */
export function formatLatLon(lat, lon, accuracyMeters) {
  const formattedLat = formatCoordinate(lat, accuracyMeters);
  const formattedLon = formatCoordinate(lon, accuracyMeters);
  if (formattedLat == null || formattedLon == null) return null;
  return `${formattedLat}, ${formattedLon}`;
}

/**
 * Human label for a source accuracy, for badges and notes.
 * @param {number|null|undefined} accuracyMeters Source accuracy in metres.
 * @returns {string} e.g. `"≈1.5 km"`, `"≈250 m"`, or `"accuracy unknown"`.
 */
export function accuracyLabel(accuracyMeters) {
  if (accuracyMeters == null) return 'accuracy unknown';
  assertAccuracy(accuracyMeters);
  if (accuracyMeters >= 1000) {
    const km = accuracyMeters / 1000;
    return `≈${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `≈${Number.isInteger(accuracyMeters) ? accuracyMeters : accuracyMeters.toFixed(1)} m`;
}

/**
 * One-line honesty note for display beside a coordinate, naming the
 * decimals shown and the accuracy they match — so the rounding itself is
 * disclosed rather than silent.
 * @param {number|null|undefined} accuracyMeters Source accuracy in metres.
 * @returns {string} Display-ready note.
 */
export function coordinatePrecisionNote(accuracyMeters) {
  const decimals = precisionDecimals(accuracyMeters);
  if (accuracyMeters == null) {
    return (
      `Source accuracy unknown — coordinates shown to ${decimals} decimal ` +
      'places (≈111 m) so the display does not imply false precision.'
    );
  }
  const label = accuracyLabel(accuracyMeters);
  return (
    `Coordinates shown to ${decimals} decimal ` +
    `${decimals === 1 ? 'place' : 'places'}, matching the source accuracy ` +
    `(${label}); extra decimals would imply false precision.`
  );
}
