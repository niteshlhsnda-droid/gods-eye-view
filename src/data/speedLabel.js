/**
 * Display-only speed labels with unit and basis always attached.
 *
 * A bare "120" next to a moving dot is not a speed — it is a number
 * waiting to be misread. The feeds this app renders report speeds in
 * different units and on different bases, and today nothing records
 * either: ADS-B reports aircraft ground speed in knots, a pitot reports
 * airspeed (in knots or mph depending on the source), AIS reports vessel
 * speed over ground in knots, a vessel log reports speed through water,
 * and NHC reports wind speed in knots. A panel that mixes two of those
 * sources and prints bare numbers invites a reader to compare a
 * ground speed with an airspeed as if they were the same quantity —
 * for an aircraft in a 100-knot headwind they differ by 100 knots.
 * The existing `formatKnots` helper (`src/data/detectionDraw.js`)
 * attaches a unit ("14 kn") but no basis: correct for a vessel panel
 * where speed over ground is the only speed shown, and silently
 * ambiguous anywhere a second basis can appear.
 *
 * These helpers are the single source of truth for turning a speed
 * and its source-reported unit and basis into a human-readable label.
 * They are display-only: they never feed filters, thresholds,
 * sorting, or queries, and they never convert — a converted value
 * must be re-labelled with its new unit by the caller, never
 * silently relabelled here.
 *
 * Honesty rules, enforced here so no call site can get them wrong:
 * - Never print a bare number as if the unit were known. A known
 *   unit renders as "120 kn"; a missing or malformed unit renders
 *   as "120 (unit unknown)", never as a bare "120" and never as a
 *   defaulted "120 kn".
 * - Never print a vehicle speed without its basis. Ground speed,
 *   airspeed, water speed, and wind speed are different quantities
 *   that happen to share units. A known basis renders as
 *   "120 kn · ground speed"; a missing or malformed basis renders
 *   as "120 kn (basis unknown)", never as a bare "120 kn" that
 *   invites the reader to assume the basis.
 * - Never invent a unit or basis. A missing unit is "unit unknown",
 *   never defaulted to knots because "most feeds use knots". A
 *   missing basis is "basis unknown", never defaulted to ground
 *   speed because "most panels show ground speed".
 * - Never expand a code this module has not verified. Unit and
 *   basis spellings outside the verified tables are rejected
 *   outright and read "unknown" — there is no verbatim-quoting
 *   escape hatch here, because an unverified unit on a speed label
 *   would be read as a claim, not a quote.
 * - Never let a bad speed produce a label. A missing, non-numeric,
 *   non-finite, or negative speed renders as "Speed unknown", never
 *   as "0 kn" (Number(null) and Number('') are both 0 — both are
 *   rejected explicitly, not coerced). Zero itself is valid: a
 *   moored vessel or parked aircraft genuinely has zero speed.
 * - Never conflate indicated and true airspeed in the label. Both
 *   are airspeed for display ("airspeed"), and the IAS/TAS
 *   sub-distinction is not carried by this module — a surface that
 *   needs it must say so explicitly, not lean on this label.
 */

/** Verified unit spellings (lowercased, trimmed) -> canonical code. */
const KNOWN_UNITS = new Map([
  ['kn', 'kn'],
  ['knot', 'kn'],
  ['knots', 'kn'],
  ['kt', 'kn'],
  ['kts', 'kn'],
  ['km/h', 'km/h'],
  ['kph', 'km/h'],
  ['kmh', 'km/h'],
  ['kmph', 'km/h'],
  ['m/s', 'm/s'],
  ['mps', 'm/s'],
  ['m/sec', 'm/s'],
  ['mph', 'mph'],
  ['mi/h', 'mph'],
  ['mi/hr', 'mph'],
]);

/** Canonical unit code -> verified expanded name. */
const UNIT_NAMES = new Map([
  ['kn', 'knots'],
  ['km/h', 'kilometres per hour'],
  ['m/s', 'metres per second'],
  ['mph', 'miles per hour'],
]);

/** Verified basis spellings (lowercased, trimmed) -> canonical basis. */
const KNOWN_BASES = new Map([
  ['ground', 'ground'],
  ['ground speed', 'ground'],
  ['ground-speed', 'ground'],
  ['over ground', 'ground'],
  ['over-ground', 'ground'],
  ['sog', 'ground'],
  ['air', 'air'],
  ['airspeed', 'air'],
  ['air-speed', 'air'],
  ['air speed', 'air'],
  ['tas', 'air'],
  ['ias', 'air'],
  ['true airspeed', 'air'],
  ['true-airspeed', 'air'],
  ['indicated airspeed', 'air'],
  ['indicated-airspeed', 'air'],
  ['water', 'water'],
  ['water speed', 'water'],
  ['water-speed', 'water'],
  ['through water', 'water'],
  ['through-water', 'water'],
  ['stw', 'water'],
  ['wind', 'wind'],
  ['wind speed', 'wind'],
  ['wind-speed', 'wind'],
]);

/** Canonical basis -> verified expanded name (the label's basis phrase). */
const BASIS_NAMES = new Map([
  ['ground', 'ground speed'],
  ['air', 'airspeed'],
  ['water', 'water speed'],
  ['wind', 'wind speed'],
]);

/**
 * Canonicalizes a source-reported unit spelling to its canonical code.
 * @param {unknown} unit - Source-reported unit (e.g. 'knots', 'kph', 'm/s').
 * @returns {string|null} Canonical code ('kn' | 'km/h' | 'm/s' | 'mph'),
 *   or null when the unit is missing, non-string, or unverified.
 */
export function normalizeSpeedUnit(unit) {
  if (typeof unit !== 'string') return null;
  return KNOWN_UNITS.get(unit.trim().toLowerCase()) ?? null;
}

/**
 * Canonicalizes a source-reported basis spelling to its canonical basis.
 * @param {unknown} basis - Source-reported basis (e.g. 'ground', 'SOG', 'TAS').
 * @returns {string|null} Canonical basis ('ground' | 'air' | 'water' | 'wind'),
 *   or null when the basis is missing, non-string, or unverified.
 */
export function normalizeSpeedBasis(basis) {
  if (typeof basis !== 'string') return null;
  return KNOWN_BASES.get(basis.trim().toLowerCase()) ?? null;
}

/**
 * Verified expanded name for a unit code, for long-form surfaces.
 * @param {unknown} unit - Unit code or source spelling.
 * @returns {string|null} E.g. 'knots', or null for anything unverified.
 */
export function speedUnitName(unit) {
  const code = normalizeSpeedUnit(unit);
  return code === null ? null : UNIT_NAMES.get(code);
}

/**
 * Verified expanded name for a basis, for long-form surfaces.
 * @param {unknown} basis - Basis or source spelling.
 * @returns {string|null} E.g. 'ground speed', or null for anything unverified.
 */
export function speedBasisName(basis) {
  const canonical = normalizeSpeedBasis(basis);
  return canonical === null ? null : BASIS_NAMES.get(canonical);
}

/**
 * Parses a speed value the way the magnitude module parses magnitudes:
 * numbers pass through, numeric strings coerce, and the values that
 * Number() silently turns into 0 (null, '', whitespace) are rejected
 * explicitly, as are booleans, objects, non-finite numbers, and
 * negatives (a speed is a magnitude).
 * @param {unknown} value - Candidate speed value.
 * @returns {number|null} Finite, non-negative number, or null.
 */
function parseSpeedValue(value) {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Renders a speed value: integers as-is, others to one decimal.
 * @param {number} value - Finite, non-negative speed.
 * @returns {string} E.g. '120', '12.5'.
 */
function formatSpeedValue(value) {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

/**
 * Formats a speed with its unit and basis always attached.
 * @param {unknown} value - Speed value (number or numeric string).
 * @param {{unit?: unknown, basis?: unknown}} [options] - Source-reported
 *   unit and basis. Both are optional in the call, but an omitted or
 *   unverified one renders as unknown — never as an assumed default.
 * @returns {string} E.g. '120 kn · ground speed',
 *   '120 kn (basis unknown)', '120 (unit unknown) · ground speed',
 *   '120 (unit unknown, basis unknown)', or 'Speed unknown'.
 */
export function formatSpeedLabel(value, options) {
  const parsed = parseSpeedValue(value);
  if (parsed === null) return 'Speed unknown';
  const opts = options !== null && typeof options === 'object' ? options : {};
  const unit = normalizeSpeedUnit(opts.unit);
  const basis = normalizeSpeedBasis(opts.basis);
  const number = formatSpeedValue(parsed);
  if (unit !== null && basis !== null) {
    return `${number} ${unit} · ${BASIS_NAMES.get(basis)}`;
  }
  if (unit !== null) {
    return `${number} ${unit} (basis unknown)`;
  }
  if (basis !== null) {
    return `${number} (unit unknown) · ${BASIS_NAMES.get(basis)}`;
  }
  return `${number} (unit unknown, basis unknown)`;
}
