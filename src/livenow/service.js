/**
 * Live Now data service — fetch, validate, cache.
 *
 * Primary: `GET /api/live-now` (the frozen DeepSeek contract, schema
 * "gev/live-now" v1). Fallback: the static cache the server also writes,
 * `public/data/live-now.json` (served at `/data/live-now.json`). A working
 * panel on stale data always beats a dead panel: the last good payload is
 * kept in sessionStorage and served when the network fails.
 *
 * Pure apart from injected seams (`fetchImpl`, `storage`, `now`) so the
 * whole policy is unit-testable without a browser or server.
 */

export const LIVE_NOW_API_PATH = '/api/live-now';
export const LIVE_NOW_STATIC_PATH = '/data/live-now.json';
export const LIVE_NOW_CACHE_KEY = 'gev:livenow:cache:v1';
export const LIVE_NOW_SCHEMA = 'gev/live-now';
export const LIVE_NOW_VERSION = 1;
export const LIVE_NOW_MAX_EVENTS = 12;

const EVENT_TYPES = new Set([
  'cyclone',
  'quake',
  'fire',
  'news',
  'aviation',
  'maritime',
  'space',
  'weather',
]);
const CONFIDENCES = new Set(['verified', 'reported', 'unconfirmed']);

function isIsoString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateEvent(event, index) {
  const at = `events[${index}]`;
  if (!event || typeof event !== 'object') return `${at}: not an object`;
  if (typeof event.id !== 'string' || !event.id) return `${at}: missing id`;
  if (!EVENT_TYPES.has(event.type)) return `${at}: bad type ${event.type}`;
  if (typeof event.title !== 'string' || !event.title)
    return `${at}: missing title`;
  if (!Number.isFinite(event.lat) || Math.abs(event.lat) > 90)
    return `${at}: bad lat`;
  if (!Number.isFinite(event.lon) || Math.abs(event.lon) > 180)
    return `${at}: bad lon`;
  if (
    !Number.isInteger(event.severity) ||
    event.severity < 1 ||
    event.severity > 5
  )
    return `${at}: bad severity`;
  if (!isIsoString(event.startedAt)) return `${at}: bad startedAt`;
  if (!CONFIDENCES.has(event.confidence))
    return `${at}: bad confidence ${event.confidence}`;
  if (
    !Array.isArray(event.sources) ||
    event.sources.length === 0 ||
    event.sources.some((s) => typeof s?.name !== 'string')
  )
    return `${at}: sources must be a non-empty [{name, url}] list`;
  return null;
}

/**
 * Validate a decoded payload against the frozen contract.
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateLiveNowPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['payload is not an object'] };
  }
  if (payload.schema !== LIVE_NOW_SCHEMA)
    errors.push(`schema must be ${LIVE_NOW_SCHEMA}`);
  if (payload.version !== LIVE_NOW_VERSION)
    errors.push(`version must be ${LIVE_NOW_VERSION}`);
  if (!isIsoString(payload.generatedAt)) errors.push('bad generatedAt');
  if (!Array.isArray(payload.events)) {
    errors.push('events must be an array');
  } else {
    if (payload.events.length > LIVE_NOW_MAX_EVENTS)
      errors.push(`events must be <= ${LIVE_NOW_MAX_EVENTS}`);
    payload.events.forEach((event, index) => {
      const problem = validateEvent(event, index);
      if (problem) errors.push(problem);
    });
  }
  if (
    payload.staleSources !== undefined &&
    !Array.isArray(payload.staleSources)
  )
    errors.push('staleSources must be an array when present');
  return { ok: errors.length === 0, errors };
}

function readCache(storage) {
  try {
    const raw = storage?.getItem?.(LIVE_NOW_CACHE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return validateLiveNowPayload(payload).ok ? payload : null;
  } catch {
    return null;
  }
}

function writeCache(storage, payload) {
  try {
    storage?.setItem?.(LIVE_NOW_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* Storage full or blocked: the in-memory payload still works. */
  }
}

async function tryFetch(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
  });
  if (!response || !response.ok) return null;
  const payload = await response.json();
  return validateLiveNowPayload(payload).ok ? payload : null;
}

/**
 * Load the Live Now payload.
 *
 * Order: live API -> static JSON fallback -> last cached payload.
 * Never throws for transport problems; reports `{error}` instead so the
 * panel can render its empty/degraded state.
 *
 * @returns {Promise<{payload:Object|null, fresh:boolean, fromCache:boolean, error?:string}>}
 *   `fresh` is true when the payload came from the network this call.
 */
export async function fetchLiveNow({
  fetchImpl = globalThis.fetch,
  storage = globalThis.sessionStorage,
  apiPath = LIVE_NOW_API_PATH,
  staticPath = LIVE_NOW_STATIC_PATH,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    const cached = readCache(storage);
    return cached
      ? { payload: cached, fresh: false, fromCache: true }
      : { payload: null, fresh: false, fromCache: false, error: 'no-fetch' };
  }
  for (const url of [apiPath, staticPath]) {
    try {
      const payload = await tryFetch(fetchImpl, url);
      if (payload) {
        writeCache(storage, payload);
        return { payload, fresh: true, fromCache: false };
      }
    } catch {
      /* Try the next source. */
    }
  }
  const cached = readCache(storage);
  if (cached) return { payload: cached, fresh: false, fromCache: true };
  return {
    payload: null,
    fresh: false,
    fromCache: false,
    error: 'live-now-unavailable',
  };
}

/** Minutes since `generatedAt` (for the "last checked Xm ago" empty state). */
export function minutesSinceGenerated(payload, nowMs = Date.now()) {
  const at = Date.parse(payload?.generatedAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((nowMs - at) / 60000));
}

/** True when ≥1 event is severity-5 and started within the last 6 hours. */
export function hasFreshCriticalEvent(events, nowMs = Date.now()) {
  const sixHoursMs = 6 * 60 * 60 * 1000;
  return (events || []).some(
    (event) =>
      event?.severity === 5 &&
      Number.isFinite(Date.parse(event.startedAt)) &&
      nowMs - Date.parse(event.startedAt) < sixHoursMs,
  );
}
