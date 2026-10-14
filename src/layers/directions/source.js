import { isStaticHosting } from '../../sources/staticHosting.js';
import {
  normalizeRouteProfile,
  projectRouteResult,
} from '../../data/placeProviderPayloads.js';
import { normalizeOsrmSteps } from '../../data/routeSteps.js';

/** Public FOSSGIS OSRM demo server — the same upstream the desktop proxy uses. */
export const OSRM_DIRECT_BASE = 'https://routing.openstreetmap.de';

/**
 * Minimum spacing between route requests from this client (FOSSGIS demo
 * server policy: ≤ 1 request per second; one route per user action anyway).
 */
export const OSRM_CLIENT_THROTTLE_MS = 1200;

/** Build the existing route-proxy query from geographic endpoints. */
export function directionsRequestUrl(mode, a, b) {
  const coords = `${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}`;
  return `/api/route?profile=${encodeURIComponent(mode)}&coords=${encodeURIComponent(coords)}&steps=1`;
}

/** Last direct upstream request start; module-scoped so tabs share the budget. */
let lastDirectRouteRequestAt = 0;

/**
 * Space direct upstream route requests at least OSRM_CLIENT_THROTTLE_MS
 * apart. Rejects on abort, mirroring the layer's route timeout.
 */
async function throttleDirectRouteRequest(signal, throttleMs) {
  const wait = throttleMs - (Date.now() - lastDirectRouteRequestAt);
  if (wait <= 0) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, wait);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Route request aborted', 'AbortError'),
      );
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Call the public FOSSGIS OSRM server directly (static hosting: no `/api/*`
 * backend) and project the result with the same client-safe normalizers the
 * desktop proxy uses, producing the exact `{ok, geometry, steps, …}` payload
 * `normalizeRoutePayload` expects.
 */
async function getRouteDirect(
  { mode, a, b },
  { signal, fetchImpl, throttleMs },
) {
  const profile = normalizeRouteProfile(mode);
  if (!profile) throw new Error(`Unsupported route profile "${mode}"`);
  const osrmProfile = profile === 'car' ? 'driving' : profile;
  signal?.throwIfAborted();
  await throttleDirectRouteRequest(signal, throttleMs);
  lastDirectRouteRequestAt = Date.now();
  signal?.throwIfAborted();
  const coords = `${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}`;
  // Same upstream the desktop proxy itself calls: routed-<profile> base,
  // OSRM service profile in the path (driving for car).
  const upstream =
    `${OSRM_DIRECT_BASE}/routed-${profile}/route/v1/${osrmProfile}/${coords}` +
    '?overview=full&geometries=geojson&alternatives=false&steps=true';
  let response;
  try {
    response = await fetchImpl(upstream, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(
      'Routing unavailable — no response from the routing service',
    );
  }
  signal?.throwIfAborted();
  if (response.status === 429 || response.status === 504)
    throw new Error('Routing is busy — try again in a moment');
  let osrm;
  try {
    osrm = await response.json();
  } catch {
    throw new Error('Routing unavailable (HTTP ' + response.status + ')');
  }
  signal?.throwIfAborted();
  const route = osrm?.routes?.[0];
  if (osrm?.code !== 'Ok' || !route?.geometry?.coordinates?.length)
    return { ok: false, error: 'no route found' };
  const payload = projectRouteResult(route, profile);
  const { steps, truncated } = normalizeOsrmSteps(route);
  payload.steps = steps;
  if (truncated) payload.stepsTruncated = true;
  return payload;
}

/** Acquire route records using caller-owned transport and an optional endpoint. */
export function createDirectionsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = '/api/route',
  routeThrottleMs = OSRM_CLIENT_THROTTLE_MS,
} = {}) {
  return {
    async getRoute({ mode, a, b }, { signal } = {}) {
      signal?.throwIfAborted();
      // Static hosting has no /api backend: route against the public
      // FOSSGIS OSRM demo server directly (same upstream as the proxy).
      if (isStaticHosting())
        return getRouteDirect(
          { mode, a, b },
          { signal, fetchImpl, throttleMs: routeThrottleMs },
        );
      const query = directionsRequestUrl(mode, a, b).split('?')[1];
      const response = await fetchImpl(`${endpoint}?${query}`, {
        signal,
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      signal?.throwIfAborted();
      if (response.status === 429) {
        throw new Error(
          typeof payload?.error === 'string' && payload.error
            ? `${payload.error} — try again in a moment`
            : 'Routing is rate limited — try again in a moment',
        );
      }
      if (!response.ok && !payload?.error)
        throw new Error(`Routing unavailable (HTTP ${response.status})`);
      return payload;
    },
  };
}
