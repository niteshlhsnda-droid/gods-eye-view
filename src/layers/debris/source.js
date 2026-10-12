import { DEBRIS_GROUP_PATHS } from './policy.js';

/** Read debris TLE catalog text from the group endpoint with a supplied transport. */
export function createDebrisSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async readGroup(group, { signal } = {}) {
      if (!DEBRIS_GROUP_PATHS.has(group))
        throw new TypeError('Unknown debris group');
      signal?.throwIfAborted();
      const response = await fetchImpl(`/api/celestrak/${group}`, { signal });
      const text = response.ok ? await response.text() : '';
      signal?.throwIfAborted();
      const stale = response.headers?.get?.('x-tle-cache') === 'STALE-ERROR';
      return { ok: response.ok, status: response.status, text, stale };
    },
  };
}
