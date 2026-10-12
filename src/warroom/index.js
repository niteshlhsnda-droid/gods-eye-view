import { io } from 'socket.io-client';
import * as Y from 'yjs';
import { WARROOM_PATH, ANNOTATIONS_ARRAY, WARROOM_EVENTS } from './protocol.js';
import {
  createAnnotation,
  validateAnnotation,
  indexAnnotations,
} from './annotations.js';

export {
  createAnnotation,
  validateAnnotation,
  upsertAnnotation,
  removeAnnotation,
  indexAnnotations,
  ANNOTATION_KINDS,
} from './annotations.js';
export { WARROOM_PATH, ANNOTATIONS_ARRAY };

/**
 * War-room client: Socket.IO transport + Yjs shared annotations.
 *
 * Lifecycle: `const room = createWarroomClient({ url, roomId, user });`
 * `await room.connect()` joins the room and applies the server's full
 * document state. `room.addAnnotation({...})` / `room.removeAnnotation(id)`
 * mutate the shared Y.Array; remote edits arrive via `onAnnotations`.
 * Presence (cursor/selection) is best-effort JSON over `setPresence` /
 * `onPresence`.
 */
export function createWarroomClient({
  url,
  roomId,
  user = { id: 'anonymous' },
  path = WARROOM_PATH,
} = {}) {
  if (!url) throw new TypeError('A war-room server url is required');
  if (!roomId) throw new TypeError('A roomId is required');

  const doc = new Y.Doc();
  const annotationsArray = doc.getArray(ANNOTATIONS_ARRAY);
  let socket = null;
  let connected = false;
  const annotationListeners = new Set();
  const presenceListeners = new Set();
  const peerListeners = new Set();

  function snapshot() {
    return annotationsArray.toArray().map((a) => ({ ...a }));
  }

  function notifyAnnotations() {
    const list = snapshot();
    for (const listener of annotationListeners) {
      try {
        listener(list);
      } catch (error) {
        console.warn('[WarRoom] annotation listener failed:', error);
      }
    }
  }

  const room = {
    get roomId() {
      return roomId;
    },
    get connected() {
      return connected;
    },
    get doc() {
      return doc;
    },

    async connect() {
      if (socket) return;
      socket = io(url, { path, transports: ['websocket', 'polling'] });

      socket.on(WARROOM_EVENTS.state, ({ roomId: rid, update } = {}) => {
        if (rid !== roomId || !(update instanceof Uint8Array)) return;
        Y.applyUpdate(doc, update);
        notifyAnnotations();
      });
      socket.on(WARROOM_EVENTS.yjsUpdate, ({ roomId: rid, update } = {}) => {
        if (rid !== roomId || !(update instanceof Uint8Array)) return;
        Y.applyUpdate(doc, update);
        notifyAnnotations();
      });
      socket.on(
        WARROOM_EVENTS.presence,
        ({ roomId: rid, presence, from } = {}) => {
          if (rid !== roomId) return;
          for (const listener of presenceListeners)
            listener({ from, presence });
        },
      );
      socket.on(WARROOM_EVENTS.peers, ({ roomId: rid, peers } = {}) => {
        if (rid !== roomId) return;
        for (const listener of peerListeners) listener(peers);
      });

      doc.on('update', (update) => {
        if (socket?.connected)
          socket.emit(WARROOM_EVENTS.yjsUpdate, { roomId, update });
      });
      annotationsArray.observe(() => notifyAnnotations());

      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const ack = await socket.emitWithAck(WARROOM_EVENTS.join, {
        roomId,
        user,
      });
      if (!ack?.ok) throw new Error(ack?.error || 'war-room join failed');
      connected = true;
      return ack.peers ?? [];
    },

    addAnnotation(fields) {
      const annotation = createAnnotation({
        ...fields,
        author: fields?.author ?? user?.id ?? 'anonymous',
      });
      annotationsArray.push([annotation]);
      return annotation;
    },

    removeAnnotation(id) {
      const index = annotationsArray.toArray().findIndex((a) => a?.id === id);
      if (index >= 0) annotationsArray.delete(index, 1);
      return index >= 0;
    },

    listAnnotations() {
      return snapshot();
    },

    onAnnotations(listener) {
      annotationListeners.add(listener);
      return () => annotationListeners.delete(listener);
    },

    setPresence(presence) {
      socket?.emit(WARROOM_EVENTS.presence, {
        roomId,
        presence: presence ?? null,
      });
    },

    onPresence(listener) {
      presenceListeners.add(listener);
      return () => presenceListeners.delete(listener);
    },

    onPeers(listener) {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },

    async disconnect() {
      try {
        await socket
          ?.emitWithAck(WARROOM_EVENTS.leave, { roomId })
          .catch(() => null);
      } finally {
        socket?.disconnect();
        socket = null;
        connected = false;
      }
    },
  };
  return room;
}
