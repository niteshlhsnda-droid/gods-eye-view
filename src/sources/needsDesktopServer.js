/**
 * Honest "needs desktop server" terminal state for server-only layers on
 * static hosting.
 *
 * On static hosting (e.g. GitHub Pages) there is no `/api/*` backend, so a
 * layer whose only source is a same-origin API route must not fire doomed
 * requests or spin retry loops against 404s. Each such source throws the
 * coded error built here BEFORE any fetch, and the layer's ingestion treats
 * it as terminal: the honest message renders on the row/panel, no backoff is
 * scheduled, and later update ticks return early.
 *
 * Backoff still applies where a transient UPSTREAM is the cause (e.g. a
 * direct Overpass query shedding load) — never against a missing `/api`
 * route, which can only resolve with a different page, not a retry.
 *
 * Kept cesium-free on purpose: layer `source.js` modules import this under
 * the import-direction boundary (sources may not reach rendering/platform
 * dependencies).
 */

import { isStaticHosting } from './staticHosting.js';

/** Error code marking the static-hosting honest state (terminal, no retry). */
export const NEEDS_DESKTOP_SERVER_CODE = 'NEEDS_DESKTOP_SERVER';

/**
 * Build the terminal honest-state error for a server-only feed.
 * @param {string} label Human layer noun phrase, e.g. 'Flights'.
 * @returns {Error} Coded error with `.code === NEEDS_DESKTOP_SERVER_CODE`.
 */
export function needsDesktopServerError(label) {
  const error = new Error(`${label} — needs the desktop server`);
  error.name = 'NeedsDesktopServerError';
  error.code = NEEDS_DESKTOP_SERVER_CODE;
  return error;
}

/**
 * True when the error is the static-hosting honest state: terminal, so the
 * caller must NOT schedule a retry or backoff for it.
 * @param {*} error
 * @returns {boolean}
 */
export function isNeedsDesktopServerError(error) {
  return error?.code === NEEDS_DESKTOP_SERVER_CODE;
}

/**
 * Throw the honest-state error when this page has no `/api` backend.
 * Call at the top of every server-only source method, before any fetch, so
 * the doomed request never starts and retry loops have nothing to retry.
 * Read at request time — the static-hosting probe may resolve after module
 * load, and `isStaticHosting()` is false until it does, so desktop behavior
 * (probed or unprobed) never changes.
 * @param {string} label Human layer noun phrase, e.g. 'Flights'.
 */
export function throwIfStaticHosting(label) {
  if (isStaticHosting()) throw needsDesktopServerError(label);
}
