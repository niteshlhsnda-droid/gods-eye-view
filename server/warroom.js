import { Server } from 'socket.io';
import * as Y from 'yjs';
import {
  WARROOM_PATH,
  ANNOTATIONS_ARRAY,
  WARROOM_EVENTS,
} from '../src/warroom/protocol.js';

/**
 * War-room transport server (Socket.IO + Yjs).
 *
 * Each war room is a socket.io room holding one in-memory Y.Doc. Sync uses a
 * deliberate star topology instead of the y-websocket handshake:
 *  - on join the server sends the full document state (`Y.encodeStateAsUpdate`)
 *    so a (re)connecting client can never miss history;
 *  - every client broadcasts the incremental update it just produced; the
 *    server applies it to the room doc and relays it to the other peers.
 * Yjs updates are commutative, so this converges without vector clocks.
 *
 * Presence (cursor/selection) rides plain JSON socket.io events — a simpler
 * stand-in for y-protocols awareness, documented as such.
 *
 * Mount: `createWarroomServer({ httpServer })` — the orchestrator wires it
 * into the standalone/dev server. No persistence: room docs live in memory
 * and die with the process (documented limitation, not a bug).
 */

export { WARROOM_PATH, ANNOTATIONS_ARRAY };

export function createWarroomServer({
  httpServer,
  path = WARROOM_PATH,
  maxRooms = 100,
} = {}) {
  if (!httpServer) throw new TypeError('An httpServer is required');
  const io = new Server(httpServer, {
    path,
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1_000_000,
  });

  /** roomId -> { doc: Y.Doc, peers: Map<socketId, user> } */
  const rooms = new Map();

  function getRoom(roomId) {
    let room = rooms.get(roomId);
    if (!room) {
      if (rooms.size >= maxRooms)
        throw new Error(`Room limit reached (${maxRooms})`);
      room = { doc: new Y.Doc(), peers: new Map() };
      rooms.set(roomId, room);
    }
    return room;
  }

  function peerList(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];
    return [...room.peers.entries()].map(([socketId, user]) => ({
      socketId,
      user,
    }));
  }

  io.on('connection', (socket) => {
    const joined = new Set();

    socket.on(WARROOM_EVENTS.join, ({ roomId, user } = {}, ack) => {
      try {
        if (typeof roomId !== 'string' || !roomId)
          throw new Error('roomId required');
        const room = getRoom(roomId);
        room.peers.set(socket.id, user ?? { id: socket.id });
        socket.join(roomId);
        joined.add(roomId);
        const state = Y.encodeStateAsUpdate(room.doc);
        socket.emit(WARROOM_EVENTS.state, { roomId, update: state });
        io.to(roomId).emit(WARROOM_EVENTS.peers, {
          roomId,
          peers: peerList(roomId),
        });
        ack?.({ ok: true, peers: peerList(roomId) });
      } catch (error) {
        ack?.({ ok: false, error: error?.message || String(error) });
      }
    });

    socket.on(WARROOM_EVENTS.yjsUpdate, ({ roomId, update } = {}) => {
      const room = rooms.get(roomId);
      if (!room || !joined.has(roomId)) return;
      if (!(update instanceof Uint8Array)) return;
      try {
        Y.applyUpdate(room.doc, update);
        socket.to(roomId).emit(WARROOM_EVENTS.yjsUpdate, {
          roomId,
          update,
          from: socket.id,
        });
      } catch (error) {
        socket.emit(WARROOM_EVENTS.error, {
          roomId,
          error: `invalid update: ${error?.message || error}`,
        });
      }
    });

    socket.on(WARROOM_EVENTS.presence, ({ roomId, presence } = {}) => {
      if (!rooms.has(roomId) || !joined.has(roomId)) return;
      socket.to(roomId).emit(WARROOM_EVENTS.presence, {
        roomId,
        presence: presence ?? null,
        from: socket.id,
      });
    });

    socket.on(WARROOM_EVENTS.leave, ({ roomId } = {}, ack) => {
      leaveRoom(roomId);
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      for (const roomId of [...joined]) leaveRoom(roomId);
    });

    function leaveRoom(roomId) {
      const room = rooms.get(roomId);
      if (!room || !joined.has(roomId)) return;
      joined.delete(roomId);
      socket.leave(roomId);
      room.peers.delete(socket.id);
      io.to(roomId).emit(WARROOM_EVENTS.peers, {
        roomId,
        peers: peerList(roomId),
      });
      if (room.peers.size === 0) rooms.delete(roomId); // drop empty room docs
    }
  });

  return {
    io,
    /** Test/diagnostics hooks (not for production use). */
    roomCount: () => rooms.size,
    getRoomDoc: (roomId) => rooms.get(roomId)?.doc ?? null,
    close: () =>
      new Promise((resolve, reject) =>
        io.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
