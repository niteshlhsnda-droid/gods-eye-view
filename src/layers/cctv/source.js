import {
  ACTIVE_FRAME_REFRESH_MS,
  FRAME_ENDPOINT,
  MEDIA_ENDPOINT,
} from './sourcePolicy.js';

/**
 * Windy Webcams API v3 (api.windy.com/webcams). Free tier: image URLs are
 * tokenised and expire after 10 minutes (HTTP 401 once expired), so Windy
 * cameras are fetched fresh on every page load and NEVER written into the
 * build-time static snapshot.
 *
 * SAFETY ARCHITECTURE (founder rule): the Windy API key must NEVER ship
 * in the public GitHub Pages bundle or the public repo — a static site's
 * JS is readable by anyone, so a baked-in key is a public key and would
 * be abused and burned. Therefore this adapter takes the key ONLY as an
 * explicit createCctvSource option supplied by local/self-hosted config
 * (never committed, never read from a VITE_* build var — Vite inlines
 * VITE_* values into the client bundle). On the public demo the option
 * is unset, the adapter stays OFF by default, and the panel reports
 * 'missing-key' instead of silently showing nothing; the public camera
 * layer is carried by the keyless sources (OpenTrafficCamMap, DOT/511).
 * A build-time-fetched Windy list cannot substitute: without the key the
 * visitor's browser cannot refresh the tokenised image URLs, and Windy's
 * keyless player embeds are iframes, which this layer's img/video path
 * does not render. Do not "fix" this by re-adding a build-env key read.
 */
export const WINDY_API_URL = 'https://api.windy.com/webcams/api/v3/webcams';
/** Anchor areas for the per-load nearby queries (radius 100 km, max 250). */
export const WINDY_AREAS = [
  { name: 'New York', lat: 40.7128, lon: -74.006, radiusKm: 100 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194, radiusKm: 100 },
  { name: 'Austin', lat: 30.2672, lon: -97.7431, radiusKm: 100 },
  { name: 'London', lat: 51.5074, lon: -0.1278, radiusKm: 100 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522, radiusKm: 100 },
  { name: 'Berlin', lat: 52.52, lon: 13.405, radiusKm: 100 },
  { name: 'Tallinn', lat: 59.437, lon: 24.7536, radiusKm: 100 },
  { name: 'Helsinki', lat: 60.1699, lon: 24.9384, radiusKm: 100 },
  { name: 'Vancouver', lat: 49.2827, lon: -123.1207, radiusKm: 100 },
  { name: 'Calgary', lat: 51.0447, lon: -114.0719, radiusKm: 100 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, radiusKm: 100 },
  { name: 'Delhi', lat: 28.6139, lon: 77.209, radiusKm: 100 },
  { name: 'Patna', lat: 25.5941, lon: 85.1376, radiusKm: 100 },
];
function pickWindyImage(images) {
  const current = images?.current;
  if (!current || typeof current !== 'object') return '';
  for (const key of ['preview', 'thumbnail', 'icon']) {
    if (typeof current[key] === 'string' && current[key].startsWith('http'))
      return current[key];
  }
  for (const value of Object.values(current)) {
    if (typeof value === 'string' && value.startsWith('http')) return value;
  }
  return '';
}
/**
 * Map one Windy v3 webcam into the catalog source shape. Returns null for
 * inactive webcams and for entries without usable coordinates or an image
 * URL. Feed type is 'image': a refreshing snapshot is CONTINUOUS, never
 * LIVE (house rule 7), and the panel renders it as SNAPSHOT.
 */
export function mapWindyWebcam(webcam) {
  if (!webcam || typeof webcam !== 'object') return null;
  if (webcam.status !== 'active') return null;
  const lat = Number(webcam.location?.latitude);
  const lon = Number(webcam.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const url = pickWindyImage(webcam.images);
  if (!url) return null;
  const title = String(webcam.title || '').trim();
  return {
    id: `windy-${webcam.webcamId}`,
    name: title || `Windy webcam ${webcam.webcamId}`,
    city: String(webcam.location?.city || '').trim(),
    cityId: '',
    provider: 'Windy',
    lat,
    lon,
    feedType: 'image',
    url,
    snapshotUrl: url,
    license: '',
    credit: 'Windy.com',
    code: '',
    sourceKind: 'windy',
    poseSource: 'windy',
  };
}
async function fetchWindyArea({ fetchImpl, key, area, limit, signal }) {
  const params = new URLSearchParams({
    nearby: `${area.lat},${area.lon},${area.radiusKm}`,
    include: 'images,location,player,urls',
    limit: String(limit),
    sortKey: 'popularity',
    sortDirection: 'desc',
    lang: 'en',
  });
  const response = await fetchImpl(`${WINDY_API_URL}?${params}`, {
    headers: { 'X-WINDY-API-KEY': key },
    cache: 'no-store',
    signal,
  });
  if (!response.ok)
    throw new Error(`Windy HTTP ${response.status} for ${area.name}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.webcams))
    throw new Error(`Windy malformed payload for ${area.name}`);
  return payload.webcams.map(mapWindyWebcam).filter(Boolean);
}
/**
 * Fetch Windy cameras for all areas. Never throws for a missing key or a
 * failed area: missing key → { cameras: [], status: 'missing-key' };
 * every area failing → status 'error'; any area succeeding → 'ok'.
 * Results are deduped by id and are valid for this page load only.
 */
export async function fetchWindyCameras({
  fetchImpl = (...args) => globalThis.fetch(...args),
  key = '',
  areas = WINDY_AREAS,
  limit = 30,
  signal,
} = {}) {
  if (!key) return { cameras: [], status: 'missing-key' };
  signal?.throwIfAborted();
  const settled = await Promise.allSettled(
    areas.map((area) =>
      fetchWindyArea({ fetchImpl, key, area, limit, signal }),
    ),
  );
  const byId = new Map();
  let succeeded = 0;
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    succeeded += 1;
    for (const camera of result.value) byId.set(camera.id, camera);
  }
  return {
    cameras: [...byId.values()],
    status: succeeded > 0 ? 'ok' : 'error',
  };
}
function safeNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function frameUrlFor(camera, refreshMs = ACTIVE_FRAME_REFRESH_MS) {
  const cadenceMs = Math.max(
    1000,
    safeNumber(refreshMs, ACTIVE_FRAME_REFRESH_MS),
  );
  const tick = Math.floor(Date.now() / cadenceMs);
  const params = new URLSearchParams({
    label: camera.name,
    city: camera.city,
    lat: camera.lat.toFixed(6),
    lon: camera.lon.toFixed(6),
    heading: String(Math.round(camera.headingDeg)),
    fov: String(Math.round(camera.fovDeg)),
    pitch: String(Math.round(camera.pitchDeg || -10)),
    ts: String(tick),
  });
  return `${FRAME_ENDPOINT}/${encodeURIComponent(camera.id)}?${params.toString()}`;
}
function mediaUrlFor(camera) {
  return `${MEDIA_ENDPOINT}/${encodeURIComponent(camera.id)}?ts=${Math.floor(Date.now() / 15000)}`;
}
/**
 * Build-time static camera snapshot, shipped with the static site so the
 * CCTV layer works where no proxy server exists (GitHub Pages serves no
 * /api routes). Generated by scripts/build-cctv-snapshot.mjs from the same
 * server catalog loaders the dev proxy uses. Base-relative: the demo is a
 * project site under /gods-eye-view/, so an absolute /data path would miss.
 */
function staticSnapshotUrl() {
  const base = import.meta.env?.BASE_URL || '/';
  return `${base}data/cctv-sources.json`;
}
/** OpenTrafficCamMap import output (scripts/import-opentrafficcammap.mjs). */
function staticOpentrafficUrl() {
  const base = import.meta.env?.BASE_URL || '/';
  return `${base}data/cctv-opentraffic.json`;
}
function isVideoFeedType(feedType) {
  return feedType === 'mp4' || feedType === 'hls' || feedType === 'webm';
}
function withTick(url, tick) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}cctvTs=${tick}`;
}
/** Supply catalog/health records and the existing registered camera URL families. */
export function createCctvSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  // No build-env fallback on purpose (see the safety note above): an
  // unset key means Windy stays off and reports 'missing-key'.
  windyApiKey = '',
  windyAreas = WINDY_AREAS,
  windyLimit = 30,
} = {}) {
  /**
   * Direct upstream URLs per camera id, populated from the static snapshot
   * whenever the proxy catalog is unreachable. The layer's catalog builder
   * drops the upstream URL (it keeps only feedConfigured), so the map — not
   * the camera record — is what lets frame/media URLs bypass the proxy.
   */
  const directById = new Map();
  async function read(path, key, { signal } = {}) {
    signal?.throwIfAborted();
    const response = await fetchImpl(path, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Camera source HTTP ' + response.status);
    const payload = await response.json();
    signal?.throwIfAborted();
    if (!Array.isArray(payload?.[key]))
      throw new Error('Malformed camera ' + key + ' snapshot');
    return payload;
  }
  /**
   * Read the static snapshot. Only reached when the proxy is absent: a 404
   * (static hosting serves no /api routes) or a network failure. Any other
   * proxy failure — a 403, a malformed 200 payload, a caller abort — keeps
   * its original error so dev/proxy behavior and its tests never change.
   */
  async function readStaticSnapshot({ signal } = {}) {
    signal?.throwIfAborted();
    const response = await fetchImpl(staticSnapshotUrl(), {
      cache: 'no-store',
      signal,
    });
    if (!response.ok)
      throw new Error('Camera static snapshot HTTP ' + response.status);
    const payload = await response.json();
    signal?.throwIfAborted();
    if (!Array.isArray(payload?.sources))
      throw new Error('Malformed camera static snapshot');
    // OpenTrafficCamMap import is additive and optional: a missing or stale
    // import file must never break the base catalog.
    let opentraffic = [];
    try {
      const otResponse = await fetchImpl(staticOpentrafficUrl(), {
        cache: 'no-store',
        signal,
      });
      if (otResponse.ok) {
        const otPayload = await otResponse.json();
        if (Array.isArray(otPayload?.sources)) opentraffic = otPayload.sources;
      }
    } catch {
      opentraffic = [];
    }
    signal?.throwIfAborted();
    return {
      ...payload,
      sources: [...payload.sources, ...opentraffic],
      opentrafficSources: opentraffic.length,
    };
  }
  function rememberDirectUrls(sources) {
    for (const item of sources) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim();
      if (!id) continue;
      directById.set(id, {
        url: typeof item.url === 'string' ? item.url : '',
        snapshotUrl:
          typeof item.snapshotUrl === 'string' ? item.snapshotUrl : '',
        feedType: String(item.feedType || '').toLowerCase(),
      });
    }
  }
  function isStaticFallbackError(error) {
    if (error?.name === 'AbortError') return false;
    if (typeof error?.message === 'string')
      return (
        error.message.startsWith('Camera source HTTP 404') ||
        error.name === 'TypeError'
      );
    return false;
  }
  return {
    async getCatalog(options) {
      let payload;
      try {
        payload = await read('/api/cctv/sources', 'sources', options);
      } catch (error) {
        if (!isStaticFallbackError(error)) throw error;
        payload = await readStaticSnapshot(options);
        rememberDirectUrls(payload.sources);
      }
      // Windy is per-page-load only (tokenised URLs expire in 10 minutes on
      // the free tier) and is appended in every regime; without a key it
      // contributes nothing and reports 'missing-key' instead of failing.
      let windy = { cameras: [], status: 'missing-key' };
      try {
        windy = await fetchWindyCameras({
          fetchImpl,
          key: windyApiKey,
          areas: windyAreas,
          limit: windyLimit,
          signal: options?.signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        windy = { cameras: [], status: 'error' };
      }
      if (windy.cameras.length) {
        rememberDirectUrls(windy.cameras);
        payload = {
          ...payload,
          sources: [...payload.sources, ...windy.cameras],
        };
      }
      return {
        ...payload,
        windyStatus: windy.status,
        windyCount: windy.cameras.length,
      };
    },
    getHealth(options) {
      return read('/api/cctv/health', 'cameras', options);
    },
    getFrameUrl(camera, refreshMs = ACTIVE_FRAME_REFRESH_MS) {
      const entry = directById.get(String(camera?.id || ''));
      const direct =
        entry?.snapshotUrl ||
        (entry && !isVideoFeedType(entry.feedType) ? entry.url : '');
      if (direct) {
        const cadenceMs = Math.max(
          1000,
          safeNumber(refreshMs, ACTIVE_FRAME_REFRESH_MS),
        );
        return withTick(direct, Math.floor(Date.now() / cadenceMs));
      }
      return frameUrlFor(camera, refreshMs);
    },
    getMediaUrl(camera) {
      const entry = directById.get(String(camera?.id || ''));
      if (entry?.url && isVideoFeedType(entry.feedType))
        return withTick(entry.url, Math.floor(Date.now() / 15000));
      return mediaUrlFor(camera);
    },
    /** Read one current frame through the registered frame endpoint. */
    async getFrame(camera, { signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(this.getFrameUrl(camera), {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new Error('Camera frame HTTP ' + response.status);
      const bytes = new Uint8Array(await response.arrayBuffer());
      signal?.throwIfAborted();
      const type = response.headers.get('content-type') || '';
      return { contentType: type.split(';')[0].trim().toLowerCase(), bytes };
    },
  };
}
