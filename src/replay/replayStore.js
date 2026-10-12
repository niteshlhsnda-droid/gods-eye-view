/**
 * Session replay store — pure, dependency-free ring buffer for rrweb events.
 *
 * Sessions are kept in memory under a byte budget; when the budget is
 * exceeded the oldest sessions are evicted first. Persistence (localStorage)
 * is layered on top by src/replay/index.js — this module never touches it,
 * which keeps every byte of eviction logic unit-testable.
 */

export const DEFAULT_REPLAY_BUDGET_BYTES = 5_000_000;

/**
 * Validate the rrweb event envelope: a non-empty array where every entry
 * carries a numeric `type` and `timestamp`.
 */
export function isValidReplayPayload(payload) {
  if (!Array.isArray(payload) || payload.length === 0) return false;
  return payload.every(
    (event) =>
      event != null &&
      typeof event === 'object' &&
      Number.isFinite(event.type) &&
      Number.isFinite(event.timestamp),
  );
}

/**
 * @param {object} [input]
 * @param {number} [input.maxBytes]
 * @param {() => number} [input.now]
 * @param {() => number} [input.random]
 */
export function createReplayStore({
  maxBytes = DEFAULT_REPLAY_BUDGET_BYTES,
  now = () => Date.now(),
  random = () => Math.random(),
} = {}) {
  const sessions = new Map();
  let usedBytes = 0;

  const makeId = () =>
    `gev-replay-${now().toString(36)}-${Math.floor(random() * 0xffffffff).toString(36)}`;

  const sizeOf = (events) => {
    try {
      return JSON.stringify(events).length;
    } catch {
      return 0;
    }
  };

  const evictToFit = (incomingBytes) => {
    if (incomingBytes > maxBytes) return false;
    const ordered = [...sessions.values()].sort(
      (a, b) => a.startedAt - b.startedAt,
    );
    for (const session of ordered) {
      if (usedBytes + incomingBytes <= maxBytes) break;
      sessions.delete(session.id);
      usedBytes -= session.bytes;
    }
    return usedBytes + incomingBytes <= maxBytes;
  };

  return {
    /** Start a session; returns its id. */
    startSession(meta = {}) {
      const id = makeId();
      sessions.set(id, {
        id,
        startedAt: now(),
        meta: { ...meta },
        events: [],
        bytes: 0,
      });
      return id;
    },

    /** Append one rrweb event. Returns false when the event cannot fit. */
    push(sessionId, event) {
      const session = sessions.get(sessionId);
      if (!session || !isValidReplayPayload([event])) return false;
      const bytes = sizeOf([event]);
      // Temporarily exclude this session's own bytes from eviction pressure so
      // a live session is not evicted by its own newest event.
      sessions.delete(sessionId);
      usedBytes -= session.bytes;
      const fits = evictToFit(session.bytes + bytes);
      if (!fits) {
        sessions.set(sessionId, session);
        usedBytes += session.bytes;
        return false;
      }
      session.events.push(event);
      session.bytes += bytes;
      sessions.set(sessionId, session);
      usedBytes += session.bytes;
      return true;
    },

    getSession(sessionId) {
      const session = sessions.get(sessionId);
      return session ? [...session.events] : null;
    },

    hasSession(sessionId) {
      return sessions.has(sessionId);
    },

    deleteSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return false;
      sessions.delete(sessionId);
      usedBytes -= session.bytes;
      return true;
    },

    clear() {
      sessions.clear();
      usedBytes = 0;
    },

    listSessions() {
      return [...sessions.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((session) => ({
          id: session.id,
          startedAt: session.startedAt,
          eventCount: session.events.length,
          bytes: session.bytes,
          meta: { ...session.meta },
        }));
    },

    /** Serialize one session for export (download / handoff). */
    exportSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      return JSON.stringify({
        kind: 'gev-session-replay',
        version: 1,
        id: session.id,
        startedAt: session.startedAt,
        meta: session.meta,
        events: session.events,
      });
    },

    /**
     * Import a previously exported session. Returns the session id (the
     * original id is preserved when free, so `?gev-replay=<id>` links survive
     * a reload), or null when the payload is invalid or cannot fit the budget.
     */
    importSession(json) {
      let payload;
      try {
        payload = JSON.parse(json);
      } catch {
        return null;
      }
      if (
        payload?.kind !== 'gev-session-replay' ||
        !isValidReplayPayload(payload.events)
      )
        return null;
      const id =
        typeof payload.id === 'string' &&
        payload.id &&
        !sessions.has(payload.id)
          ? payload.id
          : makeId();
      const events = payload.events;
      const bytes = sizeOf(events);
      if (!evictToFit(bytes)) return null;
      sessions.set(id, {
        id,
        startedAt: now(),
        meta: { ...(payload.meta || {}), importedFrom: payload.id ?? null },
        events: [...events],
        bytes,
      });
      usedBytes += bytes;
      return id;
    },

    stats() {
      return { sessionCount: sessions.size, usedBytes, maxBytes };
    },
  };
}
