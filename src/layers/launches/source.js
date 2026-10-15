import { throwIfStaticHosting } from '../../sources/needsDesktopServer.js';

/** Read launch records and their optional active-orbit catalog with explicit cancellation. */
export function createLaunchSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  /** The launch payload, and whether the proxy served it from a stale cache. */
  async function getLaunchSnapshot({ signal } = {}) {
    // Static hosting has no /api/launches backend: settle into the honest
    // terminal state instead of a doomed request + retry storm.
    throwIfStaticHosting('Space missions');
    signal?.throwIfAborted();
    const response = await fetchImpl('/api/launches', { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    signal?.throwIfAborted();
    if (!Array.isArray(payload) && !Array.isArray(payload?.results))
      throw new Error('Malformed launch snapshot');
    return {
      payload,
      stale: response.headers?.get?.('x-gev-cache') === 'STALE-ERROR',
    };
  }
  return {
    getLaunchSnapshot,
    async getLaunches(options) {
      return (await getLaunchSnapshot(options)).payload;
    },
    async getActiveTle({ signal } = {}) {
      throwIfStaticHosting('Space missions');
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/celestrak/active', { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      signal?.throwIfAborted();
      return text;
    },
  };
}
