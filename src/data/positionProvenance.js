/**
 * Display-only aircraft position-provenance labels.
 *
 * A dot on the map is not a position — it is a claim about how a position
 * was measured and what the renderer did with it. Today nothing labels
 * either. The feeds this app renders mix very different measurement
 * sources: an ADS-B position is the aircraft's own GNSS fix, a multilaterated
 * (MLAT) position is computed by the receiver network from arrival times and
 * is meaningfully less precise, and the app's own dead-reckon then draws the
 * dot somewhere between or beyond the actual fixes. A panel that prints
 * every track as if it were a GPS point invites the reader to trust a
 * multilaterated fix or a forecast exactly as much as a GNSS fix.
 *
 * Two dimensions, always stated together:
 *
 * SOURCE — how the fix was measured.
 * - ADS-B: the aircraft reported its own GNSS position. High precision.
 * - MLAT: the receiver network multilaterated the position from Mode S
 *   replies. Lower precision than ADS-B — must never read as a GPS point.
 * - Upstream (ADS-B + MLAT): OpenSky-style snapshots merge ADS-B and MLAT
 *   without per-fix attribution (the adsb.lol fallback carries a per-record
 *   MLAT flag upstream, but this app does not consume it). Per-fix source
 *   is undisclosed here, so a plain 'ADS-B' claim would be fabrication.
 * - Local ADS-B receiver: the app's own receiver network (readsb/dump1090),
 *   known-good ADS-B.
 *
 * RENDERED AS — what the dot on the map actually is.
 * - Observed fix: the icon sits on a real reported fix.
 * - Interpolated: the renderer walks a straight chord between two known
 *   fixes (the normal render-delay regime — the dot is almost never exactly
 *   on a fix). A turning aircraft's true path differs from the chord.
 * - Extrapolated: dead-reckoned past the newest fix (a stale-feed coast or
 *   the pre-history warm-up). This is a forecast, never an observation.
 *
 * These helpers are the single source of truth for turning a position
 * source and its rendered form into a human-readable label. They are
 * display-only: they never feed filters, thresholds, sorting, or queries,
 * and they never judge whether a fix is good enough to show.
 *
 * Honesty rules, enforced here so no call site can get them wrong:
 * - Never label an upstream fix as plain ADS-B. OpenSky and adsb.lol merge
 *   ADS-B and MLAT without per-fix attribution this app reads. 'Upstream
 *   (ADS-B + MLAT)' is the claim; anything narrower is invention.
 * - Never imply GPS precision for MLAT or for computed positions. The
 *   MLAT label says 'multilaterated'; interpolated and extrapolated labels
 *   say so explicitly. Precision equivalence with a GNSS fix is never
 *   implied.
 * - Never invent a source. An unknown source renders as 'position source
 *   undisclosed', never defaulted to ADS-B because 'most tracks are ADS-B'.
 * - Never call an extrapolated display a current position. It renders as
 *   'extrapolated forecast — not an observation', never as 'live' or
 *   'current'.
 * - Never expand a code this module has not verified. Source and
 *   rendered-as spellings outside the verified tables are rejected
 *   outright and read as unknown — there is no verbatim-quoting escape
 *   hatch here, because an unverified provenance phrase on a track label
 *   would be read as a claim, not a quote.
 */

/** Verified source spellings (lowercased, trimmed) -> canonical code. */
const KNOWN_SOURCES = new Map([
  ['ads-b', 'ads-b'],
  ['adsb', 'ads-b'],
  ['ads b', 'ads-b'],
  ['aircraft-reported gnss', 'ads-b'],
  ['mlat', 'mlat'],
  ['multilateration', 'mlat'],
  ['multilaterated', 'mlat'],
  ['upstream-mix', 'upstream-mix'],
  ['upstream mix', 'upstream-mix'],
  ['upstream (ads-b + mlat)', 'upstream-mix'],
  ['ads-b + mlat', 'upstream-mix'],
  ['opensky', 'upstream-mix'],
  ['opensky upstream', 'upstream-mix'],
  ['adsb.lol', 'upstream-mix'],
  ['adsb lol', 'upstream-mix'],
  ['local-adsb', 'local-adsb'],
  ['local ads-b', 'local-adsb'],
  ['local adsb', 'local-adsb'],
  ['own receiver', 'local-adsb'],
  ['local receiver', 'local-adsb'],
  ['readsb', 'local-adsb'],
  ['dump1090', 'local-adsb'],
]);

/** Canonical source code -> compact label phrase. */
const SOURCE_LABELS = new Map([
  ['ads-b', 'ADS-B (aircraft-reported GNSS)'],
  ['mlat', 'MLAT (multilaterated)'],
  ['upstream-mix', 'Upstream (ADS-B + MLAT)'],
  ['local-adsb', 'Local ADS-B receiver'],
]);

/** Canonical source code -> verified expanded name (long-form surfaces). */
const SOURCE_NAMES = new Map([
  ['ads-b', 'aircraft-reported ADS-B GNSS position'],
  ['mlat', 'network-multilaterated position (lower precision than ADS-B)'],
  [
    'upstream-mix',
    'upstream snapshot (ADS-B and MLAT mixed; per-fix source undisclosed)',
  ],
  ['local-adsb', 'local ADS-B receiver position'],
]);

/** Verified rendered-as spellings (lowercased, trimmed) -> canonical code. */
const KNOWN_RENDERED = new Map([
  ['observed', 'observed'],
  ['fix', 'observed'],
  ['observed fix', 'observed'],
  ['interpolated', 'interpolated'],
  ['interpolated between fixes', 'interpolated'],
  ['extrapolated', 'extrapolated'],
  ['dead-reckoned', 'extrapolated'],
  ['dead reckoned', 'extrapolated'],
  ['forecast', 'extrapolated'],
  ['coasted', 'extrapolated'],
  ['coasting', 'extrapolated'],
]);

/** Canonical rendered-as code -> compact label phrase. */
const RENDERED_LABELS = new Map([
  ['observed', 'observed fix'],
  ['interpolated', 'interpolated between fixes'],
  ['extrapolated', 'extrapolated forecast — not an observation'],
]);

/**
 * Canonicalizes a source-reported position-source spelling to its
 * canonical code.
 * @param {unknown} source - Source-reported source (e.g. 'MLAT', 'OpenSky').
 * @returns {string|null} Canonical code ('ads-b' | 'mlat' | 'upstream-mix' |
 *   'local-adsb'), or null when the source is missing, non-string, or
 *   unverified.
 */
export function normalizePositionSource(source) {
  if (typeof source !== 'string') return null;
  return KNOWN_SOURCES.get(source.trim().toLowerCase()) ?? null;
}

/**
 * Canonicalizes a reported rendered-as spelling to its canonical code.
 * @param {unknown} renderedAs - Reported rendering form (e.g. 'dead-reckoned').
 * @returns {string|null} Canonical code ('observed' | 'interpolated' |
 *   'extrapolated'), or null when missing, non-string, or unverified.
 */
export function normalizeRenderedPosition(renderedAs) {
  if (typeof renderedAs !== 'string') return null;
  return KNOWN_RENDERED.get(renderedAs.trim().toLowerCase()) ?? null;
}

/**
 * Verified expanded name for a position source, for long-form surfaces.
 * @param {unknown} source - Source code or source spelling.
 * @returns {string|null} E.g. 'network-multilaterated position (lower
 *   precision than ADS-B)', or null for anything unverified.
 */
export function positionSourceName(source) {
  const code = normalizePositionSource(source);
  return code === null ? null : SOURCE_NAMES.get(code);
}

/**
 * Formats a position-provenance label: source and rendered form together.
 * @param {{source?: unknown, renderedAs?: unknown}} [options] - The position
 *   source and what the rendered dot actually is. Both are optional in the
 *   call, but an omitted or unverified one renders as unknown — never as an
 *   assumed default.
 * @returns {string} E.g. 'ADS-B (aircraft-reported GNSS) · observed fix',
 *   'Upstream (ADS-B + MLAT) · interpolated between fixes',
 *   'Local ADS-B receiver · extrapolated forecast — not an observation',
 *   'MLAT (multilaterated) · position rendering unknown',
 *   'position source undisclosed · observed fix', or
 *   'Position provenance unknown'.
 */
export function formatPositionProvenanceLabel(options) {
  const opts = options !== null && typeof options === 'object' ? options : {};
  const source = normalizePositionSource(opts.source);
  const rendered = normalizeRenderedPosition(opts.renderedAs);
  const sourceText =
    source !== null ? SOURCE_LABELS.get(source) : 'position source undisclosed';
  const renderedText =
    rendered !== null
      ? RENDERED_LABELS.get(rendered)
      : 'position rendering unknown';
  if (source === null && rendered === null)
    return 'Position provenance unknown';
  return `${sourceText} · ${renderedText}`;
}
