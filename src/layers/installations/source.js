import { waitForSignal } from '../../sources/requestDeadline.js';
import {
  loadMilitaryNames,
  militaryNamesInView,
  nameMilitaryFragment,
} from '../../data/militaryNames.js';
import {
  createOpenFreeMapSource,
  decodeOpenFreeMapMilitaryTile,
} from '../../sources/openFreeMap.js';
import {
  mergeMilitaryFragments,
  militaryNameInView,
} from '../../sources/militaryTileGeometry.js';
import { tilesForBounds } from '../../data/tomtomTiles.js';
import {
  isUnavailableCapability,
  sourceResponseError,
} from '../../sources/capability.js';
import { normalizeMilitaryInstallations } from '../../data/militaryInstallationData.js';
import { isStaticHosting } from '../../sources/staticHosting.js';
import { throwIfStaticHosting } from '../../sources/needsDesktopServer.js';
import {
  OVERPASS_DIRECT_URL,
  OVERPASS_MIRROR_URL,
  OVERPASS_RETRY_PAUSE_MS,
} from '../alpr/policy.js';

/**
 * Element cap for the direct Overpass query below. Mirrors
 * MILITARY_INSTALLATION_ELEMENT_CAP in server/providers/military-installations/
 * constants.js (browser code cannot import server modules); the cap travels
 * with the payload so the client never hard-codes truncation silently.
 */
const MILITARY_INSTALLATION_DIRECT_ELEMENT_CAP = 700;

/** Abort-aware sleep for the OSM wiki's pause-before-retry on 429/406. */
function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Preserve legacy cache admission even when the explicit saturation flag is absent. */
export function installationResponseSaturated(payload) {
  if (typeof payload?.saturated === 'boolean') return payload.saturated;
  const cap = Number(payload?.elementCap);
  if (!Number.isFinite(cap) || cap <= 0) return false;
  return Array.isArray(payload?.elements) && payload.elements.length >= cap;
}

/**
 * OpenMapTiles carries `landuse=military` only from z9; coarser tiles omit it,
 * so a view that needs them would read as an empty (falsely all-clear) area.
 */
export const MILITARY_TILE_MIN_ZOOM = 9;

/** Per-view tile cap for installation tiles. */
export const MILITARY_TILE_MAX = 16;

/**
 * Pick the finest installation tile zoom that fits the view, or null when even
 * z9 would exceed the tile cap (the caller uses bundled named points).
 * @param {{south:number, west:number, north:number, east:number}} box View box.
 * @returns {number|null} Tile zoom.
 */
export function installationTileZoom(box) {
  let zoom =
    Math.max(box.north - box.south, box.east - box.west) > 0.2 ? 10 : 12;
  const fits = (z) =>
    tilesForBounds(box, z, { maxTiles: MILITARY_TILE_MAX + 1 }).length <=
    MILITARY_TILE_MAX;
  while (zoom > MILITARY_TILE_MIN_ZOOM && !fits(zoom)) zoom -= 1;
  return fits(zoom) ? zoom : null;
}

/**
 * Square window around a context subject that fits the installation tile cap
 * at the military minimum zoom: 100 km half-width at mid latitudes, shrinking
 * toward the poles where z9 tiles are shorter.
 * @param {{latitude:number, longitude:number}} anchor Subject position.
 * @returns {{south:number, west:number, north:number, east:number,
 *   radiusM:number}|null} Bounded box, or null for an invalid anchor.
 */
export function installationAnchorBox(anchor) {
  const { latitude, longitude } = anchor || {};
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 85 ||
    Math.abs(longitude) > 180
  )
    return null;
  for (let radiusM = 100_000; radiusM >= 10_000; radiusM *= 0.8) {
    const latSpan = radiusM / 111_320;
    const lonSpan =
      latSpan / Math.max(0.05, Math.cos((latitude * Math.PI) / 180));
    const box = {
      south: Math.max(-85, latitude - latSpan),
      north: Math.min(85, latitude + latSpan),
      west: Math.max(-180, longitude - lonSpan),
      east: Math.min(180, longitude + lonSpan),
    };
    if (
      tilesForBounds(box, MILITARY_TILE_MIN_ZOOM, {
        maxTiles: MILITARY_TILE_MAX + 1,
      }).length <= MILITARY_TILE_MAX
    )
      return { ...box, radiusM: Math.round(radiusM) };
  }
  return null;
}

/** Read mapped installations and explicit nearby-place searches through fixed endpoints. */
export function createInstallationSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  tileFetchImpl = (...args) => globalThis.fetch(...args),
  loadNames = loadMilitaryNames,
  mapTiles = createOpenFreeMapSource({
    fetchImpl: tileFetchImpl,
    decode: decodeOpenFreeMapMilitaryTile,
  }),
} = {}) {
  let overpassUnavailable = false;
  const installationIds = new Map();

  /**
   * POST one Overpass query to the direct public endpoint (CORS-safelisted
   * form encoding, no preflight), with the OSM wiki's 30 s pause before
   * retrying a 429/406 on the mirror and an immediate mirror fallback on a
   * 504 — the same hardening as the ALPR direct-Overpass path.
   */
  async function postOverpassDirect(query, signal) {
    const post = (url) =>
      fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal,
      });
    let response = await post(OVERPASS_DIRECT_URL);
    if (!response.ok) {
      if (response.status === 429 || response.status === 406) {
        try {
          await response.body?.cancel();
        } catch {
          /* already closed */
        }
        await sleepAbortable(OVERPASS_RETRY_PAUSE_MS, signal);
        signal?.throwIfAborted();
        response = await post(OVERPASS_MIRROR_URL);
      } else if (response.status === 504) {
        try {
          await response.body?.cancel();
        } catch {
          /* already closed */
        }
        response = await post(OVERPASS_MIRROR_URL);
      }
    }
    return response;
  }

  /**
   * Static-hosting path for mapped sites: query Overpass directly with the
   * verbatim query the desktop proxy runs (see
   * server/providers/military-installations.js), then shape the snapshot
   * exactly like the proxy response so ingestion needs no changes. A
   * transient upstream outage falls back to the tile path — the same
   * coverage-preserving fallback the proxy path uses — never to an empty
   * all-clear.
   */
  async function getDirectOverpassSites(box, signal, thinned) {
    const bbox = `${box.south},${box.west},${box.north},${box.east}`;
    const query = `[out:json][timeout:20];(nwr["military"~"^(airfield|naval_base|range|barracks|base)$"](${bbox});nwr["landuse"="military"](${bbox}););out center tags geom ${MILITARY_INSTALLATION_DIRECT_ELEMENT_CAP};`;
    let response;
    try {
      response = await postOverpassDirect(query, signal);
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      return getTileSites(box, signal, thinned);
    }
    signal?.throwIfAborted();
    let payload = null;
    try {
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      payload = await response.json();
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      return getTileSites(box, signal, thinned);
    }
    signal?.throwIfAborted();
    if (!Array.isArray(payload?.elements))
      throw new Error('Malformed installation snapshot');
    const retrievedAt = new Date().toISOString();
    const elements = payload.elements.slice(
      0,
      MILITARY_INSTALLATION_DIRECT_ELEMENT_CAP,
    );
    return {
      ...normalizeMilitaryInstallations({ elements }, retrievedAt),
      status: 'ready',
      saturated: elements.length >= MILITARY_INSTALLATION_DIRECT_ELEMENT_CAP,
    };
  }

  async function getNamedSites(box, signal, thinned = true) {
    const names = await waitForSignal(loadNames(), signal).catch((cause) => {
      signal?.throwIfAborted();
      throw Object.assign(
        new Error('Mapped names temporarily unavailable', { cause }),
        {
          failureReason: 'names_unavailable',
        },
      );
    });
    signal?.throwIfAborted();
    // The map keeps one site per display cell; queries can ask for all.
    const { records, count } = militaryNamesInView(
      names,
      box,
      thinned ? undefined : Infinity,
      thinned,
    );
    return {
      records,
      namedInView: count,
      wide: true,
      status: 'ready',
      tileSource: true,
      saturated: false,
      droppedCount: 0,
      source: 'OpenStreetMap',
    };
  }
  async function getTileSites(box, signal, thinned) {
    const zoom = installationTileZoom(box);
    if (zoom === null) return getNamedSites(box, signal, thinned);
    let names = null;
    const namesJob = waitForSignal(loadNames(), signal)
      .then((loaded) => {
        names = loaded;
        return loaded;
      })
      .catch(() => null);
    let result;
    try {
      result = await mapTiles.fetchBounds(box, { zoom, signal });
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      // Name the tile source: an Overpass reason here would be untrue.
      throw Object.assign(
        error instanceof Error ? error : new Error(String(error)),
        {
          failureReason: 'tiles_unavailable',
        },
      );
    }
    signal?.throwIfAborted();
    const snapshot = (names) => {
      const fragments = result.tiles
        .flatMap((tile) => tile.military)
        .map((record) => nameMilitaryFragment(record, names));
      const retrievedAt = new Date().toISOString();
      return {
        records: mergeMilitaryFragments(
          fragments.slice(0, 2048),
          installationIds,
        ).map((record) => ({
          ...militaryNameInView(record, box),
          retrievedAt,
          sources: record.sources.map((source) => ({ ...source, retrievedAt })),
        })),
        status: 'ready',
        droppedCount: 0,
        saturated: result.partial || fragments.length > 2048,
        source: 'OpenStreetMap tiles',
        tileSource: true,
      };
    };
    const payload = snapshot(names);
    if (!names)
      payload.enrichment = namesJob.then((loaded) =>
        loaded && !signal?.aborted ? snapshot(loaded) : null,
      );
    return payload;
  }
  return {
    destroy() {
      mapTiles.clear();
      installationIds.clear();
    },
    async getMappedSites(box, { exact = false, thinned = true, signal } = {}) {
      const { south, west, north, east } = box || {};
      if (
        ![south, west, north, east].every(Number.isFinite) ||
        south < -90 ||
        north > 90 ||
        west < -180 ||
        west > 180 ||
        east < -180 ||
        east > 180 ||
        north <= south ||
        east === west
      )
        throw new TypeError('A bounded installation viewport is required');
      signal?.throwIfAborted();
      if (east < west || north - south > 10 || east - west > 10)
        return getNamedSites(box, signal, thinned);
      if (overpassUnavailable) return getTileSites(box, signal, thinned);
      // Static hosting has no /api/military-installations proxy: query the
      // public Overpass API directly (the Google text-search half below is
      // still server-only and gets the honest state instead).
      if (isStaticHosting())
        return getDirectOverpassSites(box, signal, thinned);
      const query = new URLSearchParams(
        Object.entries({ south, west, north, east }).map(([key, value]) => [
          key,
          value.toFixed(5),
        ]),
      );
      if (exact) query.set('exact', '1');
      const response = await fetchImpl(`/api/military-installations?${query}`, {
        signal,
      });
      const body = await response.json();
      signal?.throwIfAborted();
      if (isUnavailableCapability(body)) {
        overpassUnavailable = true;
        return getTileSites(box, signal, thinned);
      }
      if (!response.ok)
        throw Object.assign(
          sourceResponseError(
            body,
            response,
            'Installation context unavailable',
          ),
          {
            failureReason: ['rate_limited', 'timeout', 'query_failed'].includes(
              body?.reason,
            )
              ? body.reason
              : 'unavailable',
          },
        );
      if (!Array.isArray(body?.elements))
        throw new Error('Malformed installation snapshot');
      return {
        ...normalizeMilitaryInstallations(
          body,
          body.retrievedAt || new Date().toISOString(),
        ),
        status: body.status,
        saturated: installationResponseSaturated(body),
      };
    },
    async searchNearby({ latitude, longitude, radiusM }, { signal } = {}) {
      // Google Places text search is a server-side keyed API with no keyless
      // direct equivalent: honest state on static hosting, not a doomed fetch.
      throwIfStaticHosting('Google Places text search');
      if (
        ![latitude, longitude, radiusM].every(Number.isFinite) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180 ||
        radiusM < 1000 ||
        radiusM > 50000
      )
        throw new TypeError('Invalid nearby installation search');
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `/api/google/text-search?${new URLSearchParams({
          q: 'military installation',
          lat: latitude.toFixed(5),
          lon: longitude.toFixed(5),
          radiusM: String(radiusM),
        })}`,
        { signal },
      );
      const payload = await response.json();
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error(
          payload?.error || `Google Places HTTP ${response.status}`,
        );
      if (!Array.isArray(payload?.places))
        throw new Error('Malformed nearby-place snapshot');
      return payload;
    },
  };
}
