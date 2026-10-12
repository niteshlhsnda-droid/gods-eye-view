/**
 * Tour share links — replayable auto-tour URLs via the share-hash mechanism.
 *
 * Follows the same channel as src/sharelink.js (URL-hash state): a tour link
 * is `#tour=<base64url(JSON scene document)>`. The receiving page decodes the
 * project with `decodeTourLink`, validates it through the director's scene
 * document validation, and hands it to the tour runner for replay.
 *
 * Bounded like the rest of the sharing surface: tour projects are a few KB;
 * anything above 256 KiB is refused.
 */
import { parseSceneDocument } from '../document.js';

const TOUR_HASH_KEY = 'tour';
const MAX_TOUR_LINK_BYTES = 256 * 1024;

const encode = (text) =>
  Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const decode = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const body = remainder ? padded + '='.repeat(4 - remainder) : padded;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body))
    throw new Error('malformed tour payload');
  return Buffer.from(body, 'base64').toString('utf8');
};

/**
 * Encode a tour scene-document project into a hash fragment.
 * @param {Object} project Validated tour project (e.g. from buildEventTour).
 * @returns {string} `#tour=...` fragment.
 */
export function encodeTourLink(project) {
  const text = JSON.stringify(project);
  if (Buffer.byteLength(text, 'utf8') > MAX_TOUR_LINK_BYTES)
    throw new Error('tour exceeds share size limit');
  return `#${TOUR_HASH_KEY}=${encode(text)}`;
}

/**
 * Decode and validate a hash fragment back into a tour project.
 * @param {string} hash location.hash-style fragment (`#tour=...` or `tour=...`).
 * @returns {Object|null} Validated project, or null when no tour is present.
 */
export function decodeTourLink(hash) {
  if (typeof hash !== 'string') return null;
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(fragment);
  const payload = params.get(TOUR_HASH_KEY);
  if (!payload) return null;
  if (payload.length > Math.ceil(MAX_TOUR_LINK_BYTES / 3) * 4)
    throw new Error('tour exceeds share size limit');
  const text = decode(payload);
  return parseSceneDocument(text);
}

/**
 * Build a full share URL for a tour.
 * @param {Object} project Validated tour project.
 * @param {string} baseUrl Page URL the fragment is appended to.
 */
export function tourShareUrl(project, baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl)
    throw new Error('baseUrl is required');
  return `${baseUrl}${encodeTourLink(project)}`;
}

/**
 * Standalone hash watcher: when a `#tour=` fragment arrives, restore the tour
 * and hand it to `onRestore(project)`. Designed to run before the camera
 * ShareLinkManager so the tour, not a static camera, owns the first frame.
 */
export function installTourLinkWatcher({
  onRestore,
  location = globalThis.location,
} = {}) {
  if (typeof onRestore !== 'function') throw new Error('onRestore is required');
  const check = () => {
    const project = decodeTourLink(location.hash || '');
    if (project) onRestore(project);
    return project;
  };
  const watched = check();
  const listener = () => check();
  globalThis.addEventListener?.('hashchange', listener);
  return {
    checked: watched,
    dispose() {
      globalThis.removeEventListener?.('hashchange', listener);
    },
  };
}
