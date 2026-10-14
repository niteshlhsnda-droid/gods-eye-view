import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { isStaticHosting } from '../../sources/staticHosting.js';
import { normalizeFirePerimeterSnapshot } from './records.js';

/** NIFC WFIGS current interagency perimeters FeatureServer (keyless, CORS-open). */
export const WFIGS_QUERY_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';

/** Attribute fields the layer's cards consume. */
export const WFIGS_OUT_FIELDS = Object.freeze([
  'poly_IncidentName',
  'attr_UniqueFireIdentifier',
  'attr_IncidentSize',
  'attr_PercentContained',
  'attr_POOState',
  'attr_IncidentTypeCategory',
  'attr_FireDiscoveryDateTime',
  'poly_DateCurrent',
  'attr_FireCause',
  'attr_FireBehaviorGeneral',
  'attr_TotalIncidentPersonnel',
  'attr_POOCounty',
  'attr_EstimatedCostToDate',
  'attr_IncidentComplexityLevel',
  'attr_CpxName',
]);

/** ArcGIS service-level maxRecordCount: the safe page size. */
export const WFIGS_PAGE_SIZE = 1000;
/** NIFC refreshes WFIGS every 5 minutes; the client cache matches that cycle. */
export const WFIGS_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
/** Upper bound on pages per refresh (runaway paging guard). */
export const WFIGS_MAX_PAGES = 10;
/** Generous cap: a full un-generalized snapshot is ~1 MB. */
export const WFIGS_RESPONSE_LIMIT = 80 * 1024 * 1024;

function wfigsPageUrl(resultOffset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: WFIGS_OUT_FIELDS.join(','),
    maxAllowableOffset: '0.001',
    outSR: '4326',
    f: 'geojson',
    resultOffset: String(resultOffset),
    resultRecordCount: String(WFIGS_PAGE_SIZE),
  });
  return `${WFIGS_QUERY_URL}?${params.toString()}`;
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    /* already closed */
  }
}

/**
 * Query WFIGS directly, paging on properties.exceededTransferLimit, and
 * normalize with the shared snapshot normalizer. No API key, no proxy.
 */
async function fetchWfigsDirectSnapshot(fetchImpl, signal) {
  const features = [];
  let resultOffset = 0;
  for (let page = 0; page < WFIGS_MAX_PAGES; page++) {
    signal?.throwIfAborted();
    const response = await fetchImpl(wfigsPageUrl(resultOffset), { signal });
    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`WFIGS HTTP ${response.status}`);
    }
    const payload = await readResponseJsonCapped(
      response,
      WFIGS_RESPONSE_LIMIT,
      signal,
    );
    signal?.throwIfAborted();
    if (!payload || !Array.isArray(payload.features))
      throw new Error('Malformed WFIGS response');
    features.push(...payload.features);
    if (payload.properties?.exceededTransferLimit !== true) break;
    resultOffset += WFIGS_PAGE_SIZE;
  }
  const rows = normalizeFirePerimeterSnapshot({
    type: 'FeatureCollection',
    features,
  });
  if (!rows) throw new Error('Malformed WFIGS response');
  return rows;
}

/** Request a normalized snapshot through the bounded WFIGS acquisition. */
export function createWfigsPerimeterSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  // 5-minute client snapshot cache (matches the NIFC refresh cycle).
  let cached = null;
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      if (!isStaticHosting()) {
        const response = await fetchImpl('/api/fire-perimeters', { signal });
        if (!response.ok) throw new Error(`WFIGS HTTP ${response.status}`);
        const payload = await readResponseJsonCapped(
          response,
          WFIGS_RESPONSE_LIMIT,
          signal,
        );
        signal?.throwIfAborted();
        if (!Array.isArray(payload?.rows))
          throw new Error('Malformed perimeter snapshot');
        return payload.rows;
      }
      // Static hosting: no /api/* proxy, query WFIGS directly.
      const now = Date.now();
      if (cached && now - cached.fetchedAt < WFIGS_SNAPSHOT_TTL_MS)
        return cached.rows;
      const rows = await fetchWfigsDirectSnapshot(fetchImpl, signal);
      signal?.throwIfAborted();
      cached = { rows, fetchedAt: Date.now() };
      return rows;
    },
  };
}
