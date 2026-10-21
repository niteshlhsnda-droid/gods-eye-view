/**
 * i18n — 4-language UI (EN, HI, ES, PT).
 *
 * i18next is loaded lazily and cached. Until it loads — or when the package is
 * unavailable — a bundled fallback interpolator serves every key from the
 * statically imported locales, so `t()` is always synchronous and safe to call
 * from any module (including the onboarding tour and story captions).
 */
import en from './locales/en.js';
import hi from './locales/hi.js';
import es from './locales/es.js';
import pt from './locales/pt.js';

export const SUPPORTED_LOCALES = Object.freeze(['en', 'hi', 'es', 'pt']);
export const DEFAULT_LOCALE = 'en';
export const I18N_STORAGE_KEY = 'gev:locale:v1';

export const LOCALE_NAMES = Object.freeze({
  en: 'English',
  hi: 'हिन्दी',
  es: 'Español',
  pt: 'Português',
});

const RESOURCES = Object.freeze({ en, hi, es, pt });

let i18nInstance = null;
let currentLocale = DEFAULT_LOCALE;
const listeners = new Set();

/** Nested lookup with dot-separated keys; undefined when missing. */
export function lookupKey(locale, key) {
  const table = RESOURCES[locale];
  if (!table || typeof key !== 'string') return undefined;
  let node = table;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * `{{var}}` interpolation. Missing or null vars render as empty — no raw
 * `{{…}}` placeholder ever reaches a toast or label (DS-23). Explicit `null`
 * is normalized because a default parameter only fires on `undefined`.
 */
export function interpolate(template, vars = {}) {
  if (typeof template !== 'string') return template;
  const v = vars ?? {};
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) =>
    v[name] != null ? String(v[name]) : '',
  );
}

/**
 * Synchronous translator. Falls back through: current locale -> English ->
 * the key itself. Works before initI18n() resolves.
 */
export function t(key, vars) {
  const template =
    lookupKey(currentLocale, key) ?? lookupKey(DEFAULT_LOCALE, key) ?? key;
  return interpolate(template, vars);
}

/** Test seam: reset module state between tests. */
export function __resetI18nForTests() {
  i18nInstance = null;
  currentLocale = DEFAULT_LOCALE;
  listeners.clear();
}

function detectLocale(storage) {
  try {
    const stored = storage?.getItem?.(I18N_STORAGE_KEY);
    if (SUPPORTED_LOCALES.includes(stored)) return stored;
  } catch {
    /* Blocked storage falls through to navigator detection. */
  }
  try {
    const tag = globalThis.navigator?.language || '';
    const base = tag.toLowerCase().split('-')[0];
    if (SUPPORTED_LOCALES.includes(base)) return base;
  } catch {
    /* Ignore. */
  }
  return DEFAULT_LOCALE;
}

/**
 * Initialize the translator. Resolves to the active locale.
 * @param {object} [input]
 * @param {string} [input.lng] Override the detected locale.
 * @param {{getItem: Function}|null} [input.storage]
 */
export async function initI18n({ lng, storage } = {}) {
  currentLocale = SUPPORTED_LOCALES.includes(lng) ? lng : detectLocale(storage);
  try {
    const module = await import('i18next');
    const factory = module?.default ?? module;
    const instance = factory?.createInstance?.() ?? factory;
    if (instance?.init) {
      await instance.init({
        lng: currentLocale,
        fallbackLng: DEFAULT_LOCALE,
        resources: Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [
            locale,
            { translation: RESOURCES[locale] },
          ]),
        ),
        interpolation: { escapeValue: false },
      });
      i18nInstance = instance;
    }
  } catch {
    i18nInstance = null;
  }
  return currentLocale;
}

/** Current locale code. */
export function getLocale() {
  return currentLocale;
}

/**
 * Switch language: persists, re-applies to the DOM, notifies listeners.
 * @returns {Promise<string>} The new locale.
 */
export async function setLanguage(lng, { storage, documentRef } = {}) {
  if (!SUPPORTED_LOCALES.includes(lng)) return currentLocale;
  currentLocale = lng;
  try {
    storage?.setItem?.(I18N_STORAGE_KEY, lng);
  } catch {
    /* Best effort. */
  }
  try {
    if (i18nInstance?.changeLanguage) await i18nInstance.changeLanguage(lng);
  } catch {
    /* The fallback translator already follows currentLocale. */
  }
  applyI18n(documentRef ?? globalThis.document);
  for (const listener of [...listeners]) {
    try {
      listener(lng);
    } catch {
      /* Listener errors must not break the switch. */
    }
  }
  return currentLocale;
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLanguageChanged(listener) {
  if (typeof listener === 'function') listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Apply translations to the DOM: [data-i18n] text, [data-i18n-aria-label],
 * [data-i18n-title], [data-i18n-ph] (placeholder).
 */
export function applyI18n(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  const paint = (selector, apply) => {
    for (const el of root.querySelectorAll(selector)) {
      const key = el.getAttribute(selector.slice(1, -1));
      if (!key) continue;
      const value = t(key);
      if (value !== key) apply(el, value);
    }
  };
  paint('[data-i18n]', (el, value) => {
    el.textContent = value;
  });
  paint('[data-i18n-aria-label]', (el, value) => {
    el.setAttribute('aria-label', value);
  });
  paint('[data-i18n-title]', (el, value) => {
    el.setAttribute('title', value);
  });
  paint('[data-i18n-ph]', (el, value) => {
    el.setAttribute('placeholder', value);
  });
  try {
    root.documentElement?.setAttribute?.('lang', currentLocale);
  } catch {
    /* Best effort. */
  }
}

/**
 * Render a compact language switcher (fixed, bottom-right). Self-contained so
 * no baseline markup has to change.
 */
export function createLanguageSwitcher({
  documentRef = globalThis.document,
  storage,
  onToast = () => {},
} = {}) {
  const existing = documentRef.getElementById?.('gev-lang-switcher');
  if (existing) return { element: existing, destroy: () => existing.remove() };
  const wrap = documentRef.createElement('label');
  wrap.id = 'gev-lang-switcher';
  wrap.className = 'gev-lang-switcher';
  const caption = documentRef.createElement('span');
  caption.textContent = t('lang.label');
  caption.setAttribute('data-i18n', 'lang.label');
  const select = documentRef.createElement('select');
  select.setAttribute('aria-label', t('lang.label'));
  for (const locale of SUPPORTED_LOCALES) {
    const option = documentRef.createElement('option');
    option.value = locale;
    option.textContent = LOCALE_NAMES[locale];
    if (locale === currentLocale) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', async () => {
    await setLanguage(select.value, { storage, documentRef });
    caption.textContent = t('lang.label');
    select.setAttribute('aria-label', t('lang.label'));
    onToast(t('lang.label'));
  });
  wrap.append(caption, select);
  documentRef.body?.appendChild(wrap);
  return {
    element: wrap,
    destroy: () => wrap.remove(),
  };
}
