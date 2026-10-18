/**
 * Display-only earthquake magnitude-type labels.
 *
 * A bare "M5.2" reads as one uniform scale, but the USGS feed reports
 * magnitudes on several different scales: moment (Mw), local (Ml),
 * body-wave (Mb), surface-wave (Ms), duration (Md), and moment variants
 * (Mww, Mwc, Mwb, Mwr, Mwp). The scales are calibrated to roughly agree
 * near magnitude 6, but they diverge for large, deep, or distant events —
 * an Ml and an Mw of the same event are two different measurements, not
 * two spellings of one number. The feed carries the scale in
 * `properties.magType`, but nothing in the app reads it: the overlay
 * title renders a bare `M${mag.toFixed(1)}` ("M5.2"), silently dropping
 * the scale. Two events labelled "M5.2" can therefore be on different
 * scales, and a reader comparing them is comparing unlike with unlike.
 *
 * These helpers are the single source of truth for turning a magnitude
 * and its feed-reported type into a human-readable label. They are
 * display-only: they never feed filters, thresholds, sorting, or
 * queries.
 *
 * Honesty rules, enforced here so no call site can get them wrong:
 * - Never print a bare magnitude as if the scale were known. A known
 *   type renders as "M5.2 (Mw)"; a missing or malformed type renders as
 *   "M5.2 (scale unknown)", never as a bare "M5.2".
 * - Never call any magnitude "Richter". The Richter scale is the local
 *   magnitude Ml, and only Ml may be named "Local magnitude". Press
 *   usage of "Richter" for Mw is a misnomer (USGS: magnitudes above 4.0
 *   are generally moment magnitude, and "M" without a type in a USGS
 *   press release is implicitly moment — but the feed's magType is the
 *   authority here, and a missing magType is unknown, not implicitly Mw).
 * - Never invent a type. A missing magType is "scale unknown", never a
 *   defaulted Mw.
 * - Never expand a code this module has not verified. Feed codes
 *   outside the verified table that still look like magnitude codes
 *   (M + 1-4 letters) are quoted verbatim — "M5.2 (Mlv)" reports
 *   exactly what the feed said — but `magnitudeTypeName` returns null
 *   for them, so no call site can show an expanded name it has not
 *   verified. Codes that do not look like magnitude codes ("banana",
 *   "M", "M5.2") are rejected outright and read "scale unknown".
 * - Never let a bad magnitude produce a label. A missing, non-numeric,
 *   or non-finite magnitude renders as "Magnitude unknown", never as
 *   "M0.0" (Number(null) and Number('') are both 0 — both are rejected
 *   explicitly, not coerced).
 */

/** Verified feed codes (lowercased) -> canonical code + verified name. */
const KNOWN_TYPES = new Map([
  ['mw', { code: 'Mw', name: 'Moment magnitude' }],
  ['mww', { code: 'Mww', name: 'Moment magnitude (W-phase)' }],
  [
    'mwc',
    {
      code: 'Mwc',
      name: 'Moment magnitude (centroid, long-period surface waves)',
    },
  ],
  [
    'mwb',
    {
      code: 'Mwb',
      name: 'Moment magnitude (centroid, long-period body waves)',
    },
  ],
  [
    'mwr',
    {
      code: 'Mwr',
      name: 'Moment magnitude (regional, whole seismogram)',
    },
  ],
  ['mwp', { code: 'Mwp', name: 'Moment magnitude (P-wave integral)' }],
  // USGS lists this scale as "Mi or Mwp" — one scale, two spellings.
  ['mi', { code: 'Mwp', name: 'Moment magnitude (P-wave integral)' }],
  ['ml', { code: 'Ml', name: 'Local magnitude' }],
  ['mb', { code: 'Mb', name: 'Body-wave magnitude' }],
  ['ms', { code: 'Ms', name: 'Surface-wave magnitude' }],
  ['md', { code: 'Md', name: 'Duration magnitude' }],
  // USGS lists this scale as "mb_Lg, mb_lg, or MLg" — canonicalized to
  // the USGS page's own spelling, never to an invented "Mlg".
  ['mb_lg', { code: 'mb_Lg', name: 'Lg-wave magnitude' }],
  ['mblg', { code: 'mb_Lg', name: 'Lg-wave magnitude' }],
  ['mlg', { code: 'mb_Lg', name: 'Lg-wave magnitude' }],
]);

/** Canonical code -> verified expanded name (deduped from KNOWN_TYPES). */
const NAMES_BY_CODE = new Map(
  [...KNOWN_TYPES.values()].map(({ code, name }) => [code, name]),
);

/** Shape of a plausible magnitude code: M + 1-4 letters/underscore. */
const MAG_CODE_SHAPE = /^M[A-Za-z_]{1,4}$/;

/**
 * Canonical magnitude-type code for a feed `magType` value, or null
 * when the value is missing, malformed, or carries no scale.
 * Known codes canonicalize ("MW" -> "Mw", "Mi" -> "Mwp",
 * "mb_lg" -> "mb_Lg"). Unlisted but shape-valid M-codes pass through
 * verbatim ("Mlv" -> "Mlv") so the label quotes the feed, never a guess.
 */
export function normalizeMagType(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const known = KNOWN_TYPES.get(trimmed.toLowerCase());
  if (known) return known.code;
  if (MAG_CODE_SHAPE.test(trimmed)) return trimmed;
  return null;
}

/**
 * Verified expanded name for a magnitude type ("Mw" -> "Moment
 * magnitude"), or null when the type is missing, malformed, or an
 * unlisted code with no verified expansion. Never returns a guessed
 * name for an unlisted code.
 */
export function magnitudeTypeName(value) {
  const code = normalizeMagType(value);
  if (code === null) return null;
  return NAMES_BY_CODE.get(code) ?? null;
}

/**
 * "M5.2 (Mw)" for a known type, "M5.2 (scale unknown)" when the type is
 * missing or malformed, "Magnitude unknown" when the magnitude itself is
 * missing, non-numeric, or non-finite. Magnitudes render to one decimal,
 * matching the existing overlay title. Negative magnitudes (micro-
 * earthquakes) are formatted, never clamped — the feed validator owns
 * range checks, not this formatter.
 */
export function formatMagnitudeLabel(mag, magType) {
  if (
    typeof mag === 'boolean' ||
    mag === null ||
    mag === undefined ||
    (typeof mag === 'string' && mag.trim() === '')
  )
    return 'Magnitude unknown';
  const value = Number(mag);
  if (!Number.isFinite(value)) return 'Magnitude unknown';
  const code = normalizeMagType(magType);
  if (code === null) return `M${value.toFixed(1)} (scale unknown)`;
  return `M${value.toFixed(1)} (${code})`;
}
