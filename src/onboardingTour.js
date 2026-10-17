/**
 * Onboarding guided tour — driver.js (MIT).
 *
 * Extends the first-run mission launcher (src/firstRunExperience.js): after the
 * launcher is dismissed (or skipped for a returning visitor), a short guided
 * tour highlights the chrome that matters — search, layers, share, style, and
 * voice — exactly once per browser. driver.js is lazy-loaded; every step
 * targets an element that must EXIST before it is shown, and missing targets
 * are skipped rather than breaking the tour.
 */
import { t as translate } from './i18n/index.js';

/** Durable "the tour has been seen" marker. Separate from the launcher keys. */
export const ONBOARDING_TOUR_STORAGE_KEY = 'gev:onboarding-tour:v1';
/** Per-session guard so a re-init in the same tab never replays the tour. */
export const ONBOARDING_TOUR_SESSION_KEY = 'gev:onboarding-tour-session:v1';

/**
 * Build the tour steps as pure data. Steps whose selector matches nothing are
 * filtered at drive time.
 * @param {(key: string) => string} [t]
 * @returns {Array<{id: string, selector: string, title: string, description: string}>}
 */
export function buildTourSteps(t = translate) {
  const tr = (key, fallback) => {
    const value = t(key);
    return typeof value === 'string' && value !== key ? value : fallback;
  };
  return [
    {
      id: 'search',
      selector: '#location-bar',
      title: tr('tour.search.title', 'Search anywhere'),
      description: tr(
        'tour.search.body',
        'Type a city, landmark or coordinates to fly the globe there instantly.',
      ),
    },
    {
      id: 'layers',
      selector: '#control-panel',
      title: tr('tour.layers.title', 'Data layers'),
      description: tr(
        'tour.layers.body',
        'Toggle aircraft, vessels, satellites, earthquakes, CCTV and more. Each layer shows live, snapshot, simulated or archival data — check its label.',
      ),
    },
    {
      id: 'share',
      selector: '#share-btn',
      title: tr('tour.share.title', 'Share a scene'),
      description: tr(
        'tour.share.body',
        'Share your exact view — camera, layers and style — as a link, or send it straight to WhatsApp.',
      ),
    },
    {
      id: 'style',
      selector: '#style-indicator',
      title: tr('tour.style.title', 'Visual styles'),
      description: tr(
        'tour.style.body',
        'Switch the render style — normal, night vision, thermal, surveillance — from the display controls.',
      ),
    },
    {
      id: 'voice',
      selector: '#gev-voice-button',
      title: tr('tour.voice.title', 'Talk to the map'),
      description: tr(
        'tour.voice.body',
        'The GEV MIC button lets you command the globe hands-free: “show earthquakes”, “fly to Patna”.',
      ),
    },
  ];
}

/**
 * Filter steps to those whose target exists in the document.
 * @param {Array} steps
 * @param {Document} documentRef
 * @returns {Array}
 */
export function stepsWithExistingTargets(steps, documentRef) {
  if (!documentRef?.querySelector) return [];
  return steps.filter((step) => {
    try {
      return Boolean(documentRef.querySelector(step.selector));
    } catch {
      return false;
    }
  });
}

function readStored(kind, injected, key) {
  try {
    const store =
      injected !== undefined
        ? injected
        : kind === 'session'
          ? globalThis.sessionStorage
          : globalThis.localStorage;
    return store?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(kind, injected, key, value) {
  try {
    const store =
      injected !== undefined
        ? injected
        : kind === 'session'
          ? globalThis.sessionStorage
          : globalThis.localStorage;
    store?.setItem?.(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drive the tour now. Resolves false when driver.js is unavailable or there is
 * nothing to highlight.
 */
export async function startOnboardingTour({
  documentRef = globalThis.document,
  t = translate,
} = {}) {
  const steps = stepsWithExistingTargets(buildTourSteps(t), documentRef);
  if (!steps.length) return false;
  let driverFactory;
  try {
    const module = await import('driver.js');
    driverFactory =
      module?.driver ?? module?.default?.driver ?? module?.default;
  } catch {
    return false;
  }
  if (typeof driverFactory !== 'function') return false;
  try {
    const tour = driverFactory({
      showProgress: true,
      allowClose: true,
      steps: steps.map((step) => ({
        element: step.selector,
        popover: { title: step.title, description: step.description },
      })),
    });
    tour.drive();
    return true;
  } catch {
    return false;
  }
}

/** Mark the tour seen (durable) — called once it has driven. */
export function markTourSeen(storage) {
  return writeStored('local', storage, ONBOARDING_TOUR_STORAGE_KEY, 'seen');
}

function markTourSessionSeen(sessionStorageRef) {
  return writeStored(
    'session',
    sessionStorageRef,
    ONBOARDING_TOUR_SESSION_KEY,
    'seen',
  );
}

/**
 * Maybe auto-start the tour. Starts at most once per browser (durable key) and
 * never in share/embed sessions or while another surface owns the screen.
 * @param {object} input
 * @param {Document} [input.documentRef]
 * @param {{getItem: Function}|null} [input.storage]
 * @param {{getItem: Function}|null} [input.sessionStorageRef]
 * @param {{search?: string}|null} [input.location]
 * @param {() => boolean} [input.exclusiveSurfaceActive]
 * @param {number} [input.delayMs]
 * @returns {Promise<boolean>} True when the tour actually drove.
 */
export async function maybeStartOnboardingTour({
  documentRef = globalThis.document,
  storage,
  sessionStorageRef,
  location = globalThis.location,
  exclusiveSurfaceActive = () => false,
  delayMs = 1200,
} = {}) {
  if (readStored('local', storage, ONBOARDING_TOUR_STORAGE_KEY) === 'seen')
    return false;
  if (
    readStored('session', sessionStorageRef, ONBOARDING_TOUR_SESSION_KEY) ===
    'seen'
  )
    return false;
  const params = new URLSearchParams(location?.search || '');
  if (params.get('welcome') === '0') return false;
  if (params.get('embed') === '1' || globalThis.GEV_EMBED_INLINE === true)
    return false;
  // A share link's author already chose the experience; never tour them.
  if ((location?.hash || '').length > 1) return false;
  if (exclusiveSurfaceActive()) return false;

  markTourSessionSeen(sessionStorageRef);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (exclusiveSurfaceActive()) return false;
  const drove = await startOnboardingTour({ documentRef });
  if (drove) markTourSeen(storage);
  return drove;
}
