import { isStaticHosting } from '../../sources/staticHosting.js';
import {
  GBFS_NEEDS_DESKTOP_SERVER_CODE,
  gbfsStaticNeedsServerMessage,
  isGbfsDirectHostAllowed,
} from './directFetch.js';

/**
 * Read a GBFS station document: through the bounded server proxy on the
 * desktop, directly from the operator feed on static hosting (where the
 * feed host allows cross-origin browser fetch).
 */
export function createBikeshareSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  /** Shared response validation for both the proxy and the direct path. */
  async function readGbfsPayload(response, signal) {
    if (!response.ok) throw new Error('GBFS HTTP ' + response.status);
    const payload = await response.json();
    signal?.throwIfAborted();
    if (!payload || typeof payload !== 'object')
      throw new Error('Malformed GBFS payload');
    return payload;
  }

  return {
    async getStations(upstreamUrl, { signal } = {}) {
      const url = new URL(upstreamUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw new TypeError('A public HTTPS GBFS URL is required');
      signal?.throwIfAborted();
      // Static hosting has no /api backend: fetch the operator feed directly.
      // The browser sends `Origin` automatically, which is what makes the
      // CloudFront-backed feeds emit their CORS headers.
      if (isStaticHosting()) {
        if (!isGbfsDirectHostAllowed(url.hostname)) {
          const error = new Error(
            gbfsStaticNeedsServerMessage(url.hostname.toLowerCase()),
          );
          error.code = GBFS_NEEDS_DESKTOP_SERVER_CODE;
          throw error;
        }
        const response = await fetchImpl(url.href, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal,
        });
        return readGbfsPayload(response, signal);
      }
      const response = await fetchImpl(
        '/api/gbfs/' + encodeURIComponent(url.href),
        { method: 'GET', headers: { Accept: 'application/json' }, signal },
      );
      return readGbfsPayload(response, signal);
    },
  };
}
