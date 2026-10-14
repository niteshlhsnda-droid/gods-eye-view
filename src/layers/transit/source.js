import { fetchTransitHistory } from '../../sources/transitHistory.js';
import { isStaticHosting } from '../../sources/staticHosting.js';
import { needsDesktopServerError } from '../../sources/needsDesktopServer.js';

/** Request transit snapshots through caller-owned transport. */
export function createTransitSource({
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return {
    /** Read the public catalog of enabled feeds. */
    async getFeeds({ signal } = {}) {
      // Static hosting has no /api/transit backend: settle into the honest
      // terminal state instead of a doomed request + retry storm.
      if (isStaticHosting()) throw needsDesktopServerError('Transit feeds');
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/transit/feeds', {
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok)
        throw new Error('Transit feeds HTTP ' + response.status);
      const body = await response.json();
      signal?.throwIfAborted();
      if (!Array.isArray(body?.feeds))
        throw new Error('Malformed transit feed catalog');
      return body.feeds;
    },
    getHistory(feedId, vehicleId, { signal } = {}) {
      signal?.throwIfAborted();
      // Static hosting has no /api/transit backend: reject with the honest
      // terminal error instead of a doomed request. A rejection (not a sync
      // throw) preserves the existing sync-throw contract for abort/validation
      // and the callers' .then().catch() chains.
      if (isStaticHosting())
        return Promise.reject(needsDesktopServerError('Transit feeds'));
      return fetchTransitHistory(feedId, vehicleId, signal, fetchImpl);
    },
    requestSnapshot(feedId, { signal } = {}) {
      signal?.throwIfAborted();
      if (typeof feedId !== 'string' || !feedId || feedId.length > 160)
        throw new TypeError('A transit feed identifier is required');
      if (isStaticHosting())
        return Promise.reject(needsDesktopServerError('Transit feeds'));
      return Promise.resolve(
        fetchImpl(`/api/transit/vehicles/${encodeURIComponent(feedId)}`, {
          signal,
          headers: { Accept: 'application/json' },
        }),
      ).then((response) => {
        signal?.throwIfAborted();
        return {
          ok: response.ok,
          status: response.status,
          headers: response.headers,
          async json() {
            const body = await response.json();
            signal?.throwIfAborted();
            return body;
          },
        };
      });
    },
  };
}
