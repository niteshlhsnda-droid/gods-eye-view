/**
 * Live Now i18n — consumes the ChatGPT lane's copy pack directly.
 *
 * The strings live in `docs/live-now/i18n.json` (flat `{en,hi,es,pt}`,
 * single-brace `{var}` placeholders, substituted at render time). This module
 * loads that JSON and serves it — it never re-authors strings. Card template
 * keys (`card.<type>.title1..3`) belong to the ingest layer; this module
 * serves the chrome keys (`panel.*`, `card.flyTo`, `time.*`, `confidence.*`,
 * `severity.*`, `tour.*`).
 */
import liveNowCopy from '../../docs/live-now/i18n.json' with { type: 'json' };

export const LIVE_NOW_LOCALES = Object.freeze(['en', 'hi', 'es', 'pt']);
export const LIVE_NOW_DEFAULT_LOCALE = 'en';
/** Same storage key the app i18n uses, so the panel follows the language switcher. */
export const LIVE_NOW_LOCALE_STORAGE_KEY = 'gev:locale:v1';

/**
 * Detect the UI locale: stored app preference, then the browser language,
 * then English. Pure and dependency-free (never imports src/i18n, so the
 * browser boundary stays self-contained).
 */
export function detectLocale(
  storage = globalThis.localStorage,
  navigatorRef = globalThis.navigator,
) {
  try {
    const stored = storage?.getItem?.(LIVE_NOW_LOCALE_STORAGE_KEY);
    if (LIVE_NOW_LOCALES.includes(stored)) return stored;
  } catch {
    /* Blocked storage falls through to navigator detection. */
  }
  try {
    const base = String(navigatorRef?.language || '')
      .toLowerCase()
      .split('-')[0];
    if (LIVE_NOW_LOCALES.includes(base)) return base;
  } catch {
    /* Ignore. */
  }
  return LIVE_NOW_DEFAULT_LOCALE;
}

/** Single-brace `{var}` interpolation (the copy pack's placeholder style). */
export function interpolateLiveNow(template, vars = {}) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] != null ? String(vars[name]) : match,
  );
}

function lookupLiveNow(locale, key) {
  const table = liveNowCopy?.[locale];
  const value = table?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Synchronous translator for Live Now chrome strings.
 * Falls back through: requested locale -> English -> the key itself.
 */
export function ln(locale, key, vars) {
  const template =
    lookupLiveNow(locale, key) ??
    lookupLiveNow(LIVE_NOW_DEFAULT_LOCALE, key) ??
    key;
  return interpolateLiveNow(template, vars);
}

/** Test seam: the set of chrome keys this module is expected to serve. */
export const LIVE_NOW_CHROME_KEYS = Object.freeze([
  'panel.title',
  'panel.subtitle',
  'panel.snapshotAge',
  'panel.snapshotNow',
  'panel.playTour',
  'panel.empty',
  'panel.sourcesStale',
  'panel.loading',
  'panel.unavailable',
  'panel.allFeedsStale',
  'panel.feedHealth',
  'panel.feedNever',
  'card.flyTo',
  'card.sourcesOne',
  'card.sourcesOther',
  'time.justNow',
  'time.minAgo',
  'time.hrAgo',
  'confidence.verified',
  'confidence.reported',
  'confidence.unconfirmed',
  'severity.1',
  'severity.2',
  'severity.3',
  'severity.4',
  'severity.5',
  'tour.noEvents',
]);
