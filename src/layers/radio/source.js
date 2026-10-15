import { isStaticHosting } from '../../sources/staticHosting.js';
import { normalizeRadioBrowserStation } from '../../sources/radioBrowser.js';
import {
  DIRECTORY_ENDPOINT,
  RADIO_UUID_RE,
  RADIO_BROWSER_SERVERS_URL,
  RADIO_BROWSER_FALLBACK_BASE,
  RADIO_BROWSER_DIRECTORY_LIMIT,
  RADIO_BROWSER_TAG_LIMIT,
  RADIO_BROWSER_QUERY_CONCURRENCY,
  RADIO_BROWSER_CATEGORY_TAGS,
  RADIO_BROWSER_CATALOG_INSTANCE,
} from './policy.js';

/**
 * Resolve the Radio Browser backend base URL: bootstrap
 * https://all.api.radio-browser.info/json/servers and use the first server.
 * Falls back to https://de1.api.radio-browser.info when the bootstrap fails.
 * Never de.radio-browser.info (unreachable from our network).
 */
async function resolveRadioBrowserBase(fetchImpl, signal) {
  try {
    const response = await fetchImpl(RADIO_BROWSER_SERVERS_URL, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (response?.ok) {
      const servers = await response.json();
      const name = Array.isArray(servers)
        ? servers
            .map((server) => server?.name)
            .find((name) => typeof name === 'string' && name.length > 0)
        : null;
      if (name) return `https://${name}`;
    }
  } catch {
    // Bootstrap is best-effort; the fallback base keeps the layer working.
  }
  return RADIO_BROWSER_FALLBACK_BASE;
}

/** Fetch URL list with bounded concurrency; a failed URL resolves to null. */
async function fetchJsonBodies(urls, fetchImpl, signal) {
  const results = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const index = next++;
      try {
        const response = await fetchImpl(urls[index], {
          signal,
          headers: { Accept: 'application/json' },
        });
        results[index] = response?.ok ? await response.json() : null;
      } catch {
        results[index] = null;
      }
    }
  }
  const workers = [];
  const count = Math.min(RADIO_BROWSER_QUERY_CONCURRENCY, urls.length);
  for (let i = 0; i < count; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/**
 * Build the radio directory directly from Radio Browser (static hosting:
 * no `/api/*` backend). Runs the broad directory search plus the category
 * tag queries, normalizes every row with the shared client-safe
 * `normalizeRadioBrowserStation` (HTTPS-only streams, geo required, text
 * cleaned), dedupes by station id, and synthesizes the strict directory
 * body `ingestion.update()` validates.
 */
async function fetchStaticRadioDirectory(fetchImpl, signal) {
  signal?.throwIfAborted();
  const base = await resolveRadioBrowserBase(fetchImpl, signal);
  signal?.throwIfAborted();
  const broadUrl =
    `${base}/json/stations/search?has_geo_info=true&is_https=true` +
    `&hidebroken=true&order=clickcount&reverse=true` +
    `&limit=${RADIO_BROWSER_DIRECTORY_LIMIT}`;
  const tagUrls = RADIO_BROWSER_CATEGORY_TAGS.map(
    (tag) =>
      `${base}/json/stations/bytag/${encodeURIComponent(tag)}?limit=${RADIO_BROWSER_TAG_LIMIT}`,
  );
  const [broadRows, ...tagRows] = await fetchJsonBodies(
    [broadUrl, ...tagUrls],
    fetchImpl,
    signal,
  );
  signal?.throwIfAborted();
  const seen = new Set();
  const stations = [];
  for (const rows of [broadRows, ...tagRows]) {
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      const station = normalizeRadioBrowserStation(raw);
      if (!station || seen.has(station.id)) continue;
      seen.add(station.id);
      stations.push(station);
    }
  }
  if (stations.length === 0)
    throw new Error('Radio Browser returned no usable stations');
  const degraded =
    !Array.isArray(broadRows) ||
    broadRows.length === 0 ||
    tagRows.some((rows) => !Array.isArray(rows));
  return {
    stations,
    updatedAt: new Date().toISOString(),
    stale: false,
    degraded,
    acceptedGeneration: 1,
    catalogInstance: RADIO_BROWSER_CATALOG_INSTANCE,
  };
}

/** Supply directory metadata and click reporting; audio stays with the broadcaster. */
export function createRadioSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getDirectory({ signal } = {}) {
      signal?.throwIfAborted();
      // Static hosting has no /api backend: fetch Radio Browser directly.
      if (isStaticHosting())
        return fetchStaticRadioDirectory(fetchImpl, signal);
      const response = await fetchImpl(DIRECTORY_ENDPOINT, { signal });
      if (!response.ok)
        throw new Error(`Radio directory returned ${response.status}`);
      const body = await response.json();
      signal?.throwIfAborted();
      return body;
    },
    async recordClick(id, { signal } = {}) {
      if (typeof id !== 'string' || !RADIO_UUID_RE.test(id))
        throw new Error('Invalid radio station id');
      // Best-effort reporting only; silently skip it where no backend exists.
      if (isStaticHosting()) return;
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `/api/radio/click/${encodeURIComponent(id)}`,
        {
          method: 'POST',
          signal,
        },
      );
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error(`Radio click returned ${response.status}`);
    },
  };
}
