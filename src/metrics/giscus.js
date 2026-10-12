/**
 * @module metrics/giscus
 * @description Config-gated giscus (GitHub Discussions) comment embed.
 *
 * No secrets are involved — giscus identifiers (repo, repoId, categoryId)
 * are public — but the embed must still be explicitly configured by the
 * maintainer, so every entry point here no-ops until the config is complete.
 * See `docs/GISCUS.md` for the two-minute setup.
 */

/** giscus client script. */
export const GISCUS_CLIENT_SRC = 'https://giscus.app/client.js';

/** Placeholder markers that must be replaced by the maintainer. */
const PLACEHOLDERS = new Set(['', 'OWNER/REPO', '<FILL:repo>', 'REPLACE-ME']);

/** Default (unconfigured) giscus configuration. */
export const GISCUS_CONFIG_DEFAULT = Object.freeze({
  enabled: false,
  repo: 'OWNER/REPO',
  repoId: '',
  category: 'General',
  categoryId: '',
  mapping: 'pathname',
  strict: '0',
  reactionsEnabled: '1',
  emitMetadata: '0',
  inputPosition: 'bottom',
  theme: 'dark',
  lang: 'en',
  loading: 'lazy',
});

/**
 * Merge maintainer overrides onto the default config.
 * @param {object} [overrides={}]
 * @returns {object} Frozen config object.
 */
export function resolveGiscusConfig(overrides = {}) {
  return Object.freeze({ ...GISCUS_CONFIG_DEFAULT, ...(overrides || {}) });
}

/**
 * A config is usable only when explicitly enabled AND the public giscus
 * identifiers are filled in (no placeholders).
 * @param {object} [config={}]
 * @returns {boolean}
 */
export function isGiscusConfigured(config = {}) {
  const merged = { ...GISCUS_CONFIG_DEFAULT, ...(config || {}) };
  return (
    merged.enabled === true &&
    !PLACEHOLDERS.has(String(merged.repo || '').trim()) &&
    !PLACEHOLDERS.has(String(merged.repoId || '').trim()) &&
    !PLACEHOLDERS.has(String(merged.categoryId || '').trim())
  );
}

/**
 * Mount the giscus widget into a host element. No-op unless configured.
 * @param {HTMLElement|null} host Container element.
 * @param {object} [config={}] Giscus config (see {@link resolveGiscusConfig}).
 * @returns {{ok: boolean, reason?: string}}
 */
export function mountGiscus(host, config = {}) {
  if (!isGiscusConfigured(config)) {
    return { ok: false, reason: 'not-configured' };
  }
  if (!host || typeof host.appendChild !== 'function') {
    return { ok: false, reason: 'no-dom' };
  }
  const merged = { ...GISCUS_CONFIG_DEFAULT, ...(config || {}) };
  let script = null;
  try {
    script = host.ownerDocument.createElement('script');
  } catch {
    return { ok: false, reason: 'no-dom' };
  }
  script.src = GISCUS_CLIENT_SRC;
  script.async = true;
  script.setAttribute('crossorigin', 'anonymous');
  const attributes = {
    'data-repo': merged.repo,
    'data-repo-id': merged.repoId,
    'data-category': merged.category,
    'data-category-id': merged.categoryId,
    'data-mapping': merged.mapping,
    'data-strict': merged.strict,
    'data-reactions-enabled': merged.reactionsEnabled,
    'data-emit-metadata': merged.emitMetadata,
    'data-input-position': merged.inputPosition,
    'data-theme': merged.theme,
    'data-lang': merged.lang,
    'data-loading': merged.loading,
  };
  for (const [key, value] of Object.entries(attributes)) {
    script.setAttribute(key, String(value));
  }
  host.appendChild(script);
  return { ok: true };
}
