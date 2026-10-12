/**
 * War-room wire protocol constants, shared by the Socket.IO server
 * (server/warroom.js, node) and the browser client (src/warroom/index.js).
 * Kept dependency-free so both runtimes can import it.
 */

export const WARROOM_PATH = '/warroom';
export const ANNOTATIONS_ARRAY = 'annotations';

export const WARROOM_EVENTS = Object.freeze({
  join: 'warroom:join',
  leave: 'warroom:leave',
  state: 'warroom:state',
  yjsUpdate: 'warroom:yjs-update',
  presence: 'warroom:presence',
  peers: 'warroom:peers',
  error: 'warroom:error',
});
