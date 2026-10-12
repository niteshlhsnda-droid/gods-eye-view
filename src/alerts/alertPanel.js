/**
 * Alert Me panel — the subscription surface for the alert center.
 *
 * A small dialog opened from the top-center "Alert me" button. Three rows
 * (quakes, satellite flyovers, new tropical cyclones) each carry a toggle;
 * every toggle persists through the alert center's own storage.
 */
import { ALERT_KINDS } from './index.js';
import { fadeIn, fadeOut, slideDown } from '../ui/animate.js';

const PANEL_ID = 'gev-alert-panel';

const ROW_LABEL_KEYS = Object.freeze({
  quakes: 'alerts.quakesRow',
  flyovers: 'alerts.flyoversRow',
  cyclones: 'alerts.cyclonesRow',
});

/**
 * @param {object} input
 * @param {Document} [input.documentRef]
 * @param {HTMLElement} [input.anchorEl] The Alert Me button (positions the panel).
 * @param {object} input.alertCenter createAlertCenter() instance.
 * @param {() => void} [input.onFlyoverSubscribe] Background hook, e.g. refresh the TLE cache.
 * @param {(message: string) => void} [input.onToast]
 * @param {(key: string) => string} [input.t]
 * @returns {{close: () => void, element: HTMLElement|null}}
 */
export function openAlertPanel({
  documentRef = globalThis.document,
  anchorEl = null,
  alertCenter,
  onFlyoverSubscribe = () => {},
  onToast = () => {},
  t = (key) => key,
} = {}) {
  const tr = (key, fallback) => {
    const value = t(key);
    return typeof value === 'string' && value !== key ? value : fallback;
  };
  if (!alertCenter) {
    onToast(tr('alerts.unavailable', 'Alerts are unavailable right now'));
    return { close: () => {}, element: null };
  }
  const existing = documentRef.getElementById(PANEL_ID);
  if (existing) existing.remove();

  const backdrop = documentRef.createElement('div');
  backdrop.className = 'gev-alert-backdrop';
  const panel = documentRef.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'gev-alert-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', tr('alerts.title', 'Alert me'));

  const heading = documentRef.createElement('p');
  heading.className = 'gev-alert-heading';
  heading.textContent = tr('alerts.title', 'Alert me');
  panel.appendChild(heading);

  const list = documentRef.createElement('div');
  list.className = 'gev-alert-rows';
  list.setAttribute('role', 'list');

  const paintToggle = (button, on) => {
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.textContent = on
      ? tr('alerts.unsubscribe', 'Stop alerts')
      : tr('alerts.subscribe', 'Alert me');
  };

  for (const kind of ALERT_KINDS) {
    const row = documentRef.createElement('div');
    row.className = 'gev-alert-row';
    row.setAttribute('role', 'listitem');

    const label = documentRef.createElement('span');
    label.className = 'gev-alert-row-label';
    label.textContent = tr(ROW_LABEL_KEYS[kind], kind);
    row.appendChild(label);

    const toggle = documentRef.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gev-alert-toggle';
    paintToggle(toggle, alertCenter.isSubscribed(kind));
    toggle.addEventListener('click', () => {
      if (alertCenter.isSubscribed(kind)) {
        alertCenter.unsubscribe(kind);
      } else {
        if (kind === 'flyovers') {
          try {
            onFlyoverSubscribe();
          } catch {
            /* Best effort. */
          }
        }
        alertCenter.subscribe(kind, {});
      }
      paintToggle(toggle, alertCenter.isSubscribed(kind));
      onToast(tr('alerts.saved', 'Alert preferences saved'));
    });
    row.appendChild(toggle);
    list.appendChild(row);
  }
  panel.appendChild(list);

  const hint = documentRef.createElement('p');
  hint.className = 'gev-alert-hint';
  hint.textContent = tr(
    'alerts.pushLater',
    'Push notifications are coming later — toasts for now.',
  );
  panel.appendChild(hint);

  // Position: under the anchor button when measurable, else top-center.
  const rect = anchorEl?.getBoundingClientRect?.();
  if (rect && rect.width > 0) {
    panel.style.left = `${Math.max(8, rect.left + rect.width / 2 - 170)}px`;
    panel.style.top = `${rect.bottom + 10}px`;
  } else {
    panel.style.left = '50%';
    panel.style.top = '64px';
    panel.style.transform = 'translateX(-50%)';
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    documentRef.removeEventListener('keydown', onKeyDown, true);
    const done = () => {
      panel.remove();
      backdrop.remove();
    };
    void fadeOut(panel, { duration: 160 }).then(done, done);
    anchorEl?.focus?.({ preventScroll: true });
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  documentRef.addEventListener('keydown', onKeyDown, true);
  backdrop.addEventListener('click', close);

  documentRef.body.append(backdrop, panel);
  void fadeIn(backdrop, { duration: 160 });
  void slideDown(panel, { duration: 220 });
  panel.querySelector('button')?.focus?.({ preventScroll: true });

  return { close, element: panel };
}
