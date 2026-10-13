/**
 * Live Now event card — severity chip, title, summary, time-ago, source
 * count, confidence label, "Fly there" button.
 *
 * Accessibility: the card is an <article> in the tab order (Enter/Space
 * activates fly-to, same as the button). Severity is conveyed by icon glyph
 * + translated text label, never color alone. No casualty speculation is
 * ever added client-side — card copy comes from the server templates, which
 * the ChatGPT lane reviewed for the severity-5 aviation/maritime gate.
 */
import { ln } from './strings.js';

/** Icon glyphs paired with the translated severity label (never color alone). */
export const SEVERITY_ICONS = Object.freeze({
  1: '○',
  2: '◔',
  3: '◑',
  4: '◉',
  5: '⬤',
});

export function severityIcon(severity) {
  return SEVERITY_ICONS[severity] ?? '○';
}

/** Human "time ago" from the copy pack (`time.*` keys, all four languages). */
export function formatTimeAgo(iso, nowMs, locale) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const minutes = Math.max(0, Math.round((nowMs - at) / 60000));
  if (minutes < 1) return ln(locale, 'time.justNow');
  if (minutes < 60) return ln(locale, 'time.minAgo', { m: minutes });
  return ln(locale, 'time.hrAgo', { h: Math.round(minutes / 60) });
}

export function formatSourceCount(count, locale) {
  const n = Number(count);
  if (n === 1) return ln(locale, 'card.sourcesOne');
  return ln(locale, 'card.sourcesOther', { n: Number.isFinite(n) ? n : 0 });
}

function el(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Build one event card element.
 *
 * @param {Object} event LiveEvent from the frozen contract.
 * @param {Object} options
 * @param {Document} [options.documentRef]
 * @param {string} [options.locale='en']
 * @param {number} [options.nowMs=Date.now()]
 * @param {(event:Object)=>void} [options.onFlyTo]
 * @returns {HTMLElement} The card <article>.
 */
export function createEventCard(
  event,
  {
    documentRef = globalThis.document,
    locale = 'en',
    nowMs = Date.now(),
    onFlyTo = () => {},
  } = {},
) {
  const card = el(documentRef, 'article', 'ln-card');
  card.setAttribute('role', 'listitem');
  card.tabIndex = 0;
  card.dataset.eventId = String(event?.id ?? '');
  card.setAttribute(
    'aria-label',
    `${ln(locale, `severity.${event?.severity}`)}: ${event?.title ?? ''}`,
  );
  if (event?.confidence === 'unconfirmed') card.classList.add('ln-unconfirmed');

  const chip = el(
    documentRef,
    'span',
    `ln-chip ln-sev-${event?.severity ?? 1}`,
  );
  const chipIcon = el(
    documentRef,
    'span',
    'ln-chip-icon',
    severityIcon(event?.severity),
  );
  chipIcon.setAttribute('aria-hidden', 'true');
  const chipText = el(
    documentRef,
    'span',
    'ln-chip-text',
    ln(locale, `severity.${event?.severity}`),
  );
  chip.append(chipIcon, chipText);

  const confidence = el(
    documentRef,
    'span',
    `ln-confidence ln-conf-${event?.confidence ?? 'reported'}`,
    ln(locale, `confidence.${event?.confidence}`),
  );

  const head = el(documentRef, 'div', 'ln-card-head');
  head.append(chip, confidence);

  const title = el(documentRef, 'h3', 'ln-card-title', event?.title ?? '');
  const summary = el(documentRef, 'p', 'ln-card-summary', event?.summary ?? '');

  const meta = el(documentRef, 'div', 'ln-card-meta');
  const time = el(
    documentRef,
    'span',
    'ln-card-time',
    formatTimeAgo(event?.updatedAt ?? event?.startedAt, nowMs, locale),
  );
  const sources = el(
    documentRef,
    'span',
    'ln-card-sources',
    formatSourceCount(event?.sources?.length ?? 0, locale),
  );
  meta.append(time, sources);

  const flyTo = el(documentRef, 'button', 'ln-flyto', ln(locale, 'card.flyTo'));
  flyTo.type = 'button';

  const activate = (ev) => {
    ev?.preventDefault?.();
    onFlyTo(event);
  };
  flyTo.addEventListener('click', activate);
  card.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      // Space would also scroll the carousel; the button handles its own key.
      if (ev.target === card) activate(ev);
    }
  });

  card.append(head, title, summary, meta, flyTo);
  return card;
}
