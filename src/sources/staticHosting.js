/**
 * Static-hosting detection for layers.
 *
 * On static hosting (e.g. GitHub Pages) no `/api/*` backend exists, so layers
 * whose only source is a same-origin API route must not attempt doomed
 * requests or spin forever. They consult this module instead and either
 * switch to a keyless direct upstream or show an honest "needs desktop
 * server" state.
 *
 * Detection is one cheap GET against a route the desktop server always serves
 * (TomTom status answers 200 even keyless), bounded by
 * STATIC_API_PROBE_TIMEOUT_MS. The outcome is cached process-wide: the first
 * `probeApiAvailable()` performs the request, later calls reuse the result.
 * `isStaticHosting()` is the synchronous read layers use on their load paths;
 * it is false (not null) until the probe resolves, so unprobed environments
 * (unit tests, non-browser runtimes) keep today's behavior.
 *
 * Location note: this lives in `src/sources/` rather than `src/app/` so that
 * layer `source.js` modules can import it without violating the
 * source-must-not-import-rendering/application boundary rule.
 */

/** Cheap always-registered desktop route used as the API liveness probe. */
export const STATIC_API_PROBE_PATH = '/api/tomtom/status';

/** Upper bound for one probe round-trip; the app must never wait on this. */
export const STATIC_API_PROBE_TIMEOUT_MS = 3000;

/** Cached probe outcome: null until the first probe resolves. */
let cachedApiAvailable = null;
/** In-flight probe shared by concurrent callers. */
let inFlightProbe = null;

function probeTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal?.timeout === 'function')
    return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer?.unref === 'function') timer.unref();
  return controller.signal;
}

function defaultFetchImpl() {
  // Detection only makes sense for a real page: without a browser location
  // there is no origin to probe, so assume the server exists (not static).
  // `location` is read as a member of globalThis (not a bare `window`
  // reference) so this module stays free of the bare browser globals the
  // import-direction boundary forbids inside portable source graphs.
  if (typeof globalThis.location?.href !== 'string') return null;
  return typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : null;
}

/**
 * Probe whether this page's origin serves the desktop `/api/*` backend.
 * Resolves true on any 2xx from the probe route, false on 404, network
 * failure, or timeout. Concurrent callers share one request; the outcome is
 * cached for the life of the page.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] - Defaults to the page fetch.
 * @param {number} [options.timeoutMs] - Per-probe deadline.
 * @param {string} [options.probePath] - Probe route.
 * @returns {Promise<boolean>} True when the API backend answered.
 */
export async function probeApiAvailable({
  fetchImpl,
  timeoutMs = STATIC_API_PROBE_TIMEOUT_MS,
  probePath = STATIC_API_PROBE_PATH,
} = {}) {
  if (cachedApiAvailable !== null) return cachedApiAvailable;
  if (inFlightProbe) return inFlightProbe;
  const fetchFn = fetchImpl ?? defaultFetchImpl();
  inFlightProbe = (async () => {
    if (typeof fetchFn !== 'function') return true;
    try {
      const response = await fetchFn(probePath, {
        method: 'GET',
        cache: 'no-store',
        signal: probeTimeoutSignal(timeoutMs),
      });
      return response?.ok === true;
    } catch {
      return false;
    }
  })();
  try {
    cachedApiAvailable = await inFlightProbe;
  } finally {
    inFlightProbe = null;
  }
  return cachedApiAvailable;
}

/**
 * Last probe outcome, or null when the probe has not run yet.
 * @returns {boolean|null}
 */
export function isApiAvailable() {
  return cachedApiAvailable;
}

/**
 * Synchronous read for layer load paths: true once the probe has confirmed
 * there is no `/api/*` backend. False (never null) before the probe resolves,
 * so layers keep today's behavior until detection completes.
 * @returns {boolean}
 */
export function isStaticHosting() {
  return cachedApiAvailable === false;
}

/** Test seam: forget the cached probe outcome. */
export function resetStaticHostingProbe() {
  cachedApiAvailable = null;
  inFlightProbe = null;
}
