/**
 * Toast service — @oddsrabbit/toastry (MIT) with a local DOM fallback.
 *
 * toastry is lazy-loaded; when it is unavailable the service renders stacked
 * toasts into its own `#gev-alert-toasts` container (never the app's `#toast`
 * singleton, which the shell owns) and animates them with src/ui/animate.js.
 */

import { fadeIn, fadeOut } from '../ui/animate.js';

let toastryToast = null;
let loadAttempted = false;

async function loadToastry() {
  if (toastryToast || loadAttempted) return toastryToast;
  loadAttempted = true;
  try {
    const module = await import('@oddsrabbit/toastry');
    const toast = module?.default ?? module?.toast;
    if (typeof toast === 'function') toastryToast = toast;
  } catch {
    toastryToast = null;
  }
  return toastryToast;
}

/** Test seam. */
export function __setToastryForTests(toast) {
  toastryToast = typeof toast === 'function' ? toast : null;
  loadAttempted = toast !== undefined;
}

/**
 * @param {object} [input]
 * @param {Document} [input.documentRef]
 */
export function createToastService({ documentRef = globalThis.document } = {}) {
  const ensureContainer = () => {
    let container = documentRef.getElementById?.('gev-alert-toasts');
    if (!container) {
      container = documentRef.createElement('div');
      container.id = 'gev-alert-toasts';
      container.className = 'gev-alert-toasts';
      container.setAttribute('aria-live', 'polite');
      documentRef.body?.appendChild(container);
    }
    return container;
  };

  const renderFallback = ({ title, message, kind }) => {
    const container = ensureContainer();
    if (!container) return;
    const toast = documentRef.createElement('div');
    toast.className = `gev-alert-toast gev-alert-${kind}`;
    toast.setAttribute('role', 'status');
    const heading = documentRef.createElement('strong');
    heading.textContent = title;
    const body = documentRef.createElement('span');
    body.textContent = message;
    const dismiss = documentRef.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'gev-alert-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => {
      void fadeOut(toast, { duration: 180 }).then(() => toast.remove());
    });
    toast.append(heading, body, dismiss);
    container.appendChild(toast);
    // Cap the stack so a flapping feed cannot flood the screen.
    while (container.children.length > 4) container.firstChild?.remove();
    void fadeIn(toast, { duration: 220 });
    setTimeout(() => {
      if (toast.isConnected)
        void fadeOut(toast, { duration: 250 }).then(() => toast.remove());
    }, 8000);
  };

  /**
   * Show one toast. Always resolves; never throws.
   * @param {object} input
   * @param {string} input.title
   * @param {string} input.message
   * @param {'info'|'success'|'warning'|'error'} [input.kind]
   */
  async function notify({ title = '', message = '', kind = 'info' } = {}) {
    const toast = (await loadToastry()) ?? toastryToast;
    if (toast) {
      try {
        toast(`${title} — ${message}`.replace(/^ — /, ''));
        return;
      } catch {
        /* Fall through to the DOM renderer. */
      }
    }
    try {
      renderFallback({ title, message, kind });
    } catch {
      /* A toast must never break the app. */
    }
  }

  return { notify };
}
