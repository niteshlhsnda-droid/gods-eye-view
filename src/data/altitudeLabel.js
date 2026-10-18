/**
 * Display-only altitude labels with unit and datum always attached.
 *
 * A bare "5000" next to a dot on a globe is not an altitude — it is a
 * number waiting to be misread. The feeds this app renders report
 * heights in different units and against different datums, and today
 * nothing records either: ADS-B reports aircraft altitude in feet
 * (barometric, conventionally read against mean sea level), terrain
 * and camera heights are often metres above ground level, and GNSS
 * receivers report height above the WGS 84 ellipsoid. A panel that
 * mixes two of those sources and prints bare numbers invites a reader
 * to compare an MSL altitude with an AGL height as if they were the
 * same quantity — for an aircraft at 5,000 ft AGL over 4,000 ft
 * terrain, the MSL altitude is 9,000 ft, and the bare numbers differ
 * by 4,000 ft. The ellipsoid/MSL gap is subtler and just as real:
 * geoid separation reaches roughly 100 m, so a GNSS "altitude" and a
 * barometric MSL altitude for the same point can disagree by more
 * than a city block's height with neither being wrong.
 *
 * These helpers are the single source of truth for turning an
 * altitude and its source-reported unit and datum into a
 * human-readable label. They are display-only: they never feed
 * filters, thresholds, sorting, or queries, and they never convert
 * — a converted value must be re-labelled with its new unit and
 * datum by the caller, never silently relabelled here.
 *
 * Honesty rules, enforced here so no call site can get them wrong:
 * - Never print a bare number as if the unit were known. A known
 *   unit renders as "5000 ft"; a missing or malformed unit renders
 *   as "5000 (unit unknown)", never as a bare "5000" and never as a
 *   defaulted "5000 ft".
 * - Never print an altitude without its datum. MSL, AGL, and
 *   ellipsoid heights are different quantities that happen to share
 *   units. A known datum renders as "5000 ft · MSL"; a missing or
 *   malformed datum renders as "5000 ft (datum unknown)", never as
 *   a bare "5000 ft" that invites the reader to assume the datum.
 * - Never invent a unit or datum. A missing unit is "unit unknown",
 *   never defaulted to feet because "most aviation feeds use feet".
 *   A missing datum is "datum unknown", never defaulted to MSL
 *   because "most panels show MSL".
 * - Never expand a code this module has not verified. Unit and
 *   datum spellings outside the verified tables are rejected
 *   outright and read "unknown" — there is no verbatim-quoting
 *   escape hatch here, because an unverified datum on an altitude
 *   label would be read as a claim, not a quote.
 * - Never let a bad altitude produce a label. A missing,
 *   non-numeric, or non-finite altitude renders as "Altitude
 *   unknown", never as "0 ft" (Number(null) and Number('') are both
 *   0 — both are rejected explicitly, not coerced). Zero itself is
 *   valid: sea level is a real altitude. Negative values are valid
 *   too: terrain and water below sea level (the Dead Sea shore is
 *   about -430 m) genuinely have negative altitude. A negative
 *   value is a below-sea-level altitude, never relabelled as a
 *   depth by this module.
 * - Never accept a flight level as an altitude. "FL350" is a
 *   pressure altitude expressed in hundreds of feet, not an
 *   altitude of 350 anything — passing it here would print a
 *   label off by a factor of 100. Flight-level spellings are
 *   rejected outright; a surface that shows flight levels must
 *   label them as flight levels, not launder them through this
 *   module.
 */

/** Verified unit spellings (lowercased, trimmed) -> canonical code. */
const KNOWN_UNITS = new Map([
  ['m', 'm'],
  ['m.', 'm'],
  ['metre', 'm'],
  ['metres', 'm'],
  ['meter', 'm'],
  ['meters', 'm'],
  ['ft', 'ft'],
  ['ft.', 'ft'],
  ['foot', 'ft'],
  ['feet', 'ft'],
  ['km', 'km'],
  ['km.', 'km'],
  ['kilometre', 'km'],
  ['kilometres', 'km'],
  ['kilometer', 'km'],
  ['kilometers', 'km'],
]);

/** Canonical unit code -> verified expanded name. */
const UNIT_NAMES = new Map([
  ['m', 'metres'],
  ['ft', 'feet'],
  ['km', 'kilometres'],
]);

/** Verified datum spellings (lowercased, trimmed) -> canonical datum. */
const KNOWN_DATUMS = new Map([
  ['msl', 'msl'],
  ['mean sea level', 'msl'],
  ['amsl', 'msl'],
  ['above mean sea level', 'msl'],
  ['above sea level', 'msl'],
  ['asl', 'msl'],
  ['sea level', 'msl'],
  ['agl', 'agl'],
  ['above ground level', 'agl'],
  ['above ground', 'agl'],
  ['height above ground', 'agl'],
  ['ellipsoid', 'ellipsoid'],
  ['ellipsoidal', 'ellipsoid'],
  ['ellipsoid height', 'ellipsoid'],
  ['height above ellipsoid', 'ellipsoid'],
  ['above ellipsoid', 'ellipsoid'],
  ['wgs84', 'ellipsoid'],
  ['wgs 84', 'ellipsoid'],
  ['wgs84 ellipsoid', 'ellipsoid'],
  ['wgs 84 ellipsoid', 'ellipsoid'],
  ['hae', 'ellipsoid'],
]);

/** Canonical datum -> compact label phrase. */
const DATUM_LABELS = new Map([
  ['msl', 'MSL'],
  ['agl', 'AGL'],
  ['ellipsoid', 'above WGS 84 ellipsoid'],
]);

/** Canonical datum -> verified expanded name (long-form surfaces). */
const DATUM_NAMES = new Map([
  ['msl', 'mean sea level'],
  ['agl', 'above ground level'],
  ['ellipsoid', 'above the WGS 84 ellipsoid'],
]);

/**
 * Canonicalizes a source-reported unit spelling to its canonical code.
 * @param {unknown} unit - Source-reported unit (e.g. 'feet', 'm', 'km').
 * @returns {string|null} Canonical code ('m' | 'ft' | 'km'),
 *   or null when the unit is missing, non-string, or unverified.
 */
export function normalizeAltitudeUnit(unit) {
  if (typeof unit !== 'string') return null;
  return KNOWN_UNITS.get(unit.trim().toLowerCase()) ?? null;
}

/**
 * Canonicalizes a source-reported datum spelling to its canonical datum.
 * @param {unknown} datum - Source-reported datum (e.g. 'MSL', 'AGL', 'HAE').
 * @returns {string|null} Canonical datum ('msl' | 'agl' | 'ellipsoid'),
 *   or null when the datum is missing, non-string, or unverified.
 */
export function normalizeAltitudeDatum(datum) {
  if (typeof datum !== 'string') return null;
  return KNOWN_DATUMS.get(datum.trim().toLowerCase()) ?? null;
}

/**
 * Verified expanded name for a unit code, for long-form surfaces.
 * @param {unknown} unit - Unit code or source spelling.
 * @returns {string|null} E.g. 'feet', or null for anything unverified.
 */
export function altitudeUnitName(unit) {
  const code = normalizeAltitudeUnit(unit);
  return code === null ? null : UNIT_NAMES.get(code);
}

/**
 * Verified expanded name for a datum, for long-form surfaces.
 * @param {unknown} datum - Datum or source spelling.
 * @returns {string|null} E.g. 'mean sea level', or null for anything unverified.
 */
export function altitudeDatumName(datum) {
  const canonical = normalizeAltitudeDatum(datum);
  return canonical === null ? null : DATUM_NAMES.get(canonical);
}

/**
 * Parses an altitude value the way the speed module parses speeds,
 * except negatives are valid here: numbers pass through, numeric
 * strings coerce, and the values that Number() silently turns into 0
 * (null, '', whitespace) are rejected explicitly, as are booleans,
 * objects, and non-finite numbers.
 * @param {unknown} value - Candidate altitude value.
 * @returns {number|null} Finite number, or null.
 */
function parseAltitudeValue(value) {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

/**
 * Renders an altitude value: integers as-is, others to one decimal.
 * @param {number} value - Finite altitude.
 * @returns {string} E.g. '5000', '12.5', '-430'.
 */
function formatAltitudeValue(value) {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

/**
 * Formats an altitude with its unit and datum always attached.
 * @param {unknown} value - Altitude value (number or numeric string).
 * @param {{unit?: unknown, datum?: unknown}} [options] - Source-reported
 *   unit and datum. Both are optional in the call, but an omitted or
 *   unverified one renders as unknown — never as an assumed default.
 * @returns {string} E.g. '5000 ft · MSL', '120 m · AGL',
 *   '350 m · above WGS 84 ellipsoid', '5000 ft (datum unknown)',
 *   '120 (unit unknown) · MSL', '120 (unit unknown, datum unknown)',
 *   or 'Altitude unknown'.
 */
export function formatAltitudeLabel(value, options) {
  const parsed = parseAltitudeValue(value);
  if (parsed === null) return 'Altitude unknown';
  const opts = options !== null && typeof options === 'object' ? options : {};
  const unit = normalizeAltitudeUnit(opts.unit);
  const datum = normalizeAltitudeDatum(opts.datum);
  const number = formatAltitudeValue(parsed);
  if (unit !== null && datum !== null) {
    return `${number} ${unit} · ${DATUM_LABELS.get(datum)}`;
  }
  if (unit !== null) {
    return `${number} ${unit} (datum unknown)`;
  }
  if (datum !== null) {
    return `${number} (unit unknown) · ${DATUM_LABELS.get(datum)}`;
  }
  return `${number} (unit unknown, datum unknown)`;
}
