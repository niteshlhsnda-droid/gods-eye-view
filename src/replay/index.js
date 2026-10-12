/**
 * Session replay — rrweb (MIT) record + replay for DOM-session links.
 *
 * This is DOM-session replay: it records what the OPERATOR did (clicks,
 * panel opens, layer toggles) so a session can be replayed exactly. It is a
 * different mechanism from the Gemini lane's Director Mode share links, which
 * replay camera tours from an asset bundle — the two share no files, no URL
 * params, and no code. Replay links use `?gev-replay=<sessionId>`.
 *
 * Honest limits, documented where they bite:
 * - The WebGL canvas replays as its last DOM snapshot, not as live pixels.
 *   `recordCanvas: true` would capture it at a steep size cost; the default
 *   keeps sessions small and the tradeoff is stated in the UI copy.
 * - A replay link resolves only where the session bytes live (this browser's
 *   storage, or an imported file). True cross-device links need a backend and
 *   are out of scope for this milestone.
 */
import { createReplayStore, isValidReplayPayload } from './replayStore.js';
import { fadeIn, fadeOut } from '../ui/animate.js';

export const REPLAY_PARAM = 'gev-replay';
export const REPLAY_STORAGE_KEY = 'gev:session-replays:v1';

async function loadRrweb() {
  try {
    return await import('rrweb');
  } catch {
    return null;
  }
}

/**
 * @param {object} [input]
 * @param {Document} [input.documentRef]
 * @param {object} [input.store] createReplayStore() instance.
 * @param {{getItem: Function, setItem: Function}|null} [input.storage]
 * @param {(message: string) => void} [input.onToast]
 */
export function createSessionRecorder({
  documentRef = globalThis.document,
  store = createReplayStore(),
  storage,
  onToast = () => {},
} = {}) {
  let sessionId = null;
  let stopRecording = null;
  let recording = false;

  const persist = () => {
    if (!storage?.setItem) return;
    try {
      const sessions = store.listSessions();
      const payload = sessions.slice(0, 5).map((meta) => ({
        ...meta,
        events: store.getSession(meta.id),
      }));
      storage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* Storage is best-effort; the in-memory session still replays. */
    }
  };

  const restore = () => {
    let payload;
    try {
      payload = JSON.parse(storage?.getItem?.(REPLAY_STORAGE_KEY) ?? 'null');
    } catch {
      return;
    }
    if (!Array.isArray(payload)) return;
    for (const entry of payload.slice(0, 5)) {
      if (isValidReplayPayload(entry?.events)) {
        store.importSession(
          JSON.stringify({
            kind: 'gev-session-replay',
            version: 1,
            id: entry.id,
            startedAt: entry.startedAt,
            meta: entry.meta,
            events: entry.events,
          }),
        );
      }
    }
  };
  restore();

  /** Start recording DOM mutations into a new session. */
  async function start({ meta = {} } = {}) {
    if (recording) return { ok: true, sessionId };
    const rrweb = await loadRrweb();
    const record = rrweb?.record;
    if (typeof record !== 'function') {
      onToast('Session recording is unavailable (rrweb not installed)');
      return { ok: false, reason: 'rrweb-missing' };
    }
    sessionId = store.startSession(meta);
    try {
      stopRecording = record({
        emit: (event) => {
          if (!store.push(sessionId, event)) stopRecording?.();
        },
        // Canvas pixels are deliberately NOT recorded: capturing WebGL at
        // 60fps balloons sessions past the storage budget. The DOM (panels,
        // clicks, layer toggles) is what replays.
        recordCanvas: false,
      });
    } catch {
      sessionId = null;
      return { ok: false, reason: 'record-failed' };
    }
    recording = true;
    return { ok: true, sessionId };
  }

  function stop() {
    try {
      stopRecording?.();
    } catch {
      /* Best effort. */
    }
    stopRecording = null;
    recording = false;
    persist();
    return sessionId;
  }

  /** A replay link for the latest session (same-browser unless exported). */
  function getReplayUrl(id = sessionId) {
    if (!id || !store.hasSession(id)) return null;
    try {
      const url = new URL(globalThis.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set(REPLAY_PARAM, id);
      return url.href;
    } catch {
      return null;
    }
  }

  /** Download the session as a JSON file for handoff / archiving. */
  function exportFile(id = sessionId) {
    const json = id ? store.exportSession(id) : null;
    if (!json) return false;
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const anchor = documentRef.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${id}.gev-replay.json`;
      documentRef.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(anchor.href);
        anchor.remove();
      }, 1000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * On page load with `?gev-replay=<id>`: mount the rrweb Replayer in a modal
   * overlay. Returns true when a replay actually started.
   */
  async function maybeRestoreReplay() {
    let id = null;
    try {
      id = new URLSearchParams(globalThis.location.search).get(REPLAY_PARAM);
    } catch {
      return false;
    }
    if (!id || !store.hasSession(id)) return false;
    const rrweb = await loadRrweb();
    const Replayer = rrweb?.Replayer;
    if (typeof Replayer !== 'function') return false;
    const events = store.getSession(id);
    if (!isValidReplayPayload(events)) return false;

    const overlay = documentRef.createElement('div');
    overlay.className = 'gev-replay-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Session replay');
    const bar = documentRef.createElement('div');
    bar.className = 'gev-replay-bar';
    const label = documentRef.createElement('span');
    label.textContent =
      'Replaying recorded session — the globe canvas shows its last state';
    const close = documentRef.createElement('button');
    close.type = 'button';
    close.textContent = '✕ Close replay';
    bar.append(label, close);
    const stage = documentRef.createElement('div');
    stage.className = 'gev-replay-stage';
    overlay.append(bar, stage);
    documentRef.body.appendChild(overlay);

    let player = null;
    try {
      player = new Replayer(events, { root: stage });
      player.play();
    } catch {
      overlay.remove();
      return false;
    }
    const teardown = () => {
      try {
        player?.pause();
      } catch {
        /* Best effort. */
      }
      void fadeOut(overlay, { duration: 200 }).then(() => overlay.remove());
    };
    close.addEventListener('click', teardown);
    void fadeIn(overlay, { duration: 250 });
    return true;
  }

  return {
    start,
    stop,
    getReplayUrl,
    exportFile,
    maybeRestoreReplay,
    listSessions: () => store.listSessions(),
    deleteSession: (id) => {
      const ok = store.deleteSession(id);
      persist();
      return ok;
    },
    get isRecording() {
      return recording;
    },
    get sessionId() {
      return sessionId;
    },
  };
}

export { createReplayStore, isValidReplayPayload };
