/**
 * Live Now panel — the toolbar entry point and bottom-sheet carousel.
 *
 * `createLiveNowPanel` wires a toolbar button (globe icon + pulsing dot) to
 * a bottom sheet that renders the ranked event carousel from
 * `GET /api/live-now`. The sheet renders from the last cached payload
 * synchronously (panel-open <300ms on cached JSON) and refreshes in the
 * background; stale sources degrade to a badge (`panel.sourcesStale`)
 * instead of killing the view.
 *
 * Honest-state rules (Phase 0): the panel never presents an empty world as
 * "nothing happening". When every feed is stale/unavailable, an empty list
 * renders `panel.allFeedsStale`; when no payload could be fetched at all,
 * it renders `panel.unavailable` instead of loading forever. Whenever the
 * payload carries `feedHealth.feeds`, a per-feed status list (label, state,
 * age / last success) renders at the foot of the sheet. The subtitle is the
 * snapshot's own timestamp (`panel.snapshotAge` / `panel.snapshotNow`) —
 * the payload refreshes every 10 minutes, so the panel never claims the
 * events are happening "right now".
 *
 * All DOM is built from injected `documentRef` (default: the real
 * document); styles are injected once as a `<style>` tag so the module is
 * self-contained. Wiring seams (`flyTo`, `onPlayTourProject`, `onToast`,
 * `fetchData`) keep Cesium, the director, and shell services outside this
 * module.
 */
import { ln, detectLocale } from './strings.js';
import {
  fetchLiveNow,
  minutesSinceGenerated,
  hasFreshCriticalEvent,
} from './service.js';
import { createEventCard } from './card.js';
import { buildLiveNowTour, encodeTourFragment } from './tour.js';

export const LIVE_NOW_SHEET_ID = 'gev-live-now-sheet';
export const LIVE_NOW_BACKDROP_ID = 'gev-live-now-backdrop';
export const LIVE_NOW_DOT_CLASS = 'live-now-dot';

/** Feed states that still count as "the world is being observed". */
const HEALTHY_FEED_STATES = new Set([
  'nominal',
  'loading',
  'degraded',
  'partial',
  'fallback',
]);

/**
 * True when the payload carries feeds and none of them is healthy —
 * the "we don't know" case, which must never render as a quiet planet.
 */
export function allFeedsUnhealthy(feeds) {
  if (!Array.isArray(feeds) || feeds.length === 0) return false;
  return feeds.every((feed) => !HEALTHY_FEED_STATES.has(feed?.state));
}

/**
 * Human age of a feed's last successful update, from the `time.*` keys.
 * Unparsable/missing `lastUpdate` renders `panel.feedNever`.
 */
export function formatFeedAge(feed, locale, nowMs) {
  const at = Date.parse(feed?.lastUpdate);
  if (!Number.isFinite(at)) return ln(locale, 'panel.feedNever');
  const diffMs = nowMs - at;
  if (diffMs < 0) return ln(locale, 'time.justNow');
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return ln(locale, 'time.justNow');
  if (minutes < 60) return ln(locale, 'time.minAgo', { m: minutes });
  return ln(locale, 'time.hrAgo', { h: Math.floor(minutes / 60) });
}

const STYLE_ID = 'gev-live-now-styles';

function injectStyles(documentRef) {
  if (documentRef.getElementById(STYLE_ID)) return;
  const style = documentRef.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${LIVE_NOW_BACKDROP_ID}{position:fixed;inset:0;background:rgba(2,6,18,.45);z-index:60}
#${LIVE_NOW_SHEET_ID}{position:fixed;left:0;right:0;bottom:0;z-index:61;max-height:62vh;display:flex;flex-direction:column;background:#0a1030;color:#e8ecff;border-top:1px solid #2a3a7a;border-radius:16px 16px 0 0;box-shadow:0 -12px 48px rgba(0,0,0,.55);font-family:system-ui,sans-serif}
.ln-sheet-head{display:flex;align-items:center;gap:12px;padding:14px 18px 8px}
.ln-sheet-title{margin:0;font-size:18px;letter-spacing:.02em}
.ln-sheet-sub{margin:2px 0 0;font-size:12px;color:#9aa6d8}
.ln-stale-badge{margin-left:auto;font-size:11px;padding:4px 10px;border-radius:999px;background:#3a2a10;color:#fbbf24;border:1px solid #8a6a20;white-space:nowrap}
.ln-close{margin-left:8px;background:none;border:1px solid #2a3a7a;color:#e8ecff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:14px}
.ln-stale-badge + .ln-close{margin-left:0}
.ln-carousel{flex:1;overflow-x:auto;display:flex;gap:12px;padding:10px 18px;scroll-snap-type:x mandatory;list-style:none;margin:0}
.ln-card{scroll-snap-align:start;flex:0 0 min(320px,82vw);background:#111a44;border:1px solid #2a3a7a;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}
.ln-card:focus-visible,.ln-flyto:focus-visible,.ln-close:focus-visible,.ln-tour-btn:focus-visible{outline:2px solid #7dd3fc;outline-offset:2px}
.ln-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.ln-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid}
.ln-chip-icon{font-size:12px}
.ln-sev-1{color:#7dd3fc;border-color:#7dd3fc}.ln-sev-2{color:#a3e635;border-color:#a3e635}.ln-sev-3{color:#facc15;border-color:#facc15}.ln-sev-4{color:#fb923c;border-color:#fb923c}.ln-sev-5{color:#f87171;border-color:#f87171}
.ln-confidence{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9aa6d8}
.ln-conf-unconfirmed{color:#fbbf24;font-weight:700}
.ln-unconfirmed{border-style:dashed}
.ln-card-title{margin:0;font-size:15px;line-height:1.35}
.ln-card-summary{margin:0;font-size:12.5px;line-height:1.5;color:#c3cbf2}
.ln-card-meta{display:flex;gap:12px;font-size:11px;color:#9aa6d8;margin-top:auto}
.ln-flyto{align-self:flex-start;background:#1d2a6e;color:#fff;border:1px solid #3a4fa0;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px}
.ln-flyto:hover{background:#2a3a9e}
.ln-sheet-foot{display:flex;gap:10px;align-items:center;padding:10px 18px 16px}
.ln-tour-btn{background:#ff7a1a;color:#1a0e02;border:none;border-radius:10px;padding:10px 18px;font-weight:700;font-size:14px;cursor:pointer}
.ln-tour-btn:hover{background:#ff8c3d}
.ln-empty{padding:26px 18px;text-align:center;color:#9aa6d8;font-size:14px}
.ln-feed-health{border-top:1px solid #2a3a7a;padding:10px 18px 16px}
.ln-feed-health-title{margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9aa6d8}
.ln-feed-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.ln-feed-item{font-size:12px;color:#c3cbf2}
.ln-loading{padding:26px 18px;text-align:center;color:#9aa6d8;font-size:14px}
#live-now-btn{position:relative}
#live-now-btn .${LIVE_NOW_DOT_CLASS}{position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:50%;background:#f87171;box-shadow:0 0 6px #f87171;animation:ln-dot-pulse 1.6s ease-in-out infinite}
#live-now-btn .${LIVE_NOW_DOT_CLASS}[hidden]{display:none}
@keyframes ln-dot-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.5);opacity:.55}}
@media (prefers-reduced-motion:reduce){#live-now-btn .${LIVE_NOW_DOT_CLASS}{animation:none}}
`;
  const head =
    documentRef.head || documentRef.getElementsByTagName?.('head')?.[0];
  (head || documentRef.documentElement || documentRef).appendChild(style);
}

function el(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {Object} options
 * @param {Document} [options.documentRef]
 * @param {HTMLElement} options.button The toolbar entry button.
 * @param {(opts?:Object)=>Promise<Object>} [options.fetchData] Resolves the service result shape.
 * @param {(event:Object)=>void} [options.flyTo]
 * @param {(project:Object, fragment:string)=>void} [options.onPlayTourProject] Shell plays the director project.
 * @param {(payload:Object|null)=>void} [options.onData] Called after every fetch with the latest payload (or null).
 * @param {(message:string)=>void} [options.onToast]
 * @param {number} [options.refreshIntervalMs=600000] Background refresh cadence.
 * @param {()=>number} [options.nowMs]
 */
export function createLiveNowPanel({
  documentRef = globalThis.document,
  button,
  fetchData = (opts) => fetchLiveNow(opts),
  flyTo = () => {},
  onPlayTourProject = () => {},
  onData = () => {},
  onToast = () => {},
  refreshIntervalMs = 10 * 60 * 1000,
  nowMs = () => Date.now(),
} = {}) {
  if (!button)
    throw new TypeError('createLiveNowPanel requires the toolbar button');
  injectStyles(documentRef);

  let _open = false;
  let _lastResult = null;
  let _lastError = null;
  let _timer = null;
  let _sheetNodes = null;

  const locale = () => detectLocale();

  function setDotVisible(visible) {
    const dot = button.querySelector?.(`.${LIVE_NOW_DOT_CLASS}`);
    if (dot) dot.hidden = !visible;
    button.setAttribute('aria-expanded', String(_open));
  }

  async function refresh({ silent = true } = {}) {
    let result;
    try {
      result = await fetchData();
    } catch {
      result = {
        payload: null,
        fresh: false,
        fromCache: false,
        error: 'fetch-failed',
      };
    }
    if (result?.payload) {
      _lastResult = result;
      _lastError = null;
      try {
        onData(result.payload);
      } catch {
        /* Marker updates must never break the panel. */
      }
    } else if (result?.error) {
      // No payload and a failed fetch: remember it so the sheet renders
      // the explicit unavailable state instead of loading forever.
      _lastError = result.error;
    }
    const events = _lastResult?.payload?.events ?? [];
    setDotVisible(hasFreshCriticalEvent(events, nowMs()));
    if (_open) renderSheet();
    return result;
  }

  function closeSheet() {
    if (_sheetNodes) {
      _sheetNodes.dispose();
      _sheetNodes.backdrop.remove();
      _sheetNodes.sheet.remove();
      _sheetNodes = null;
    }
    _open = false;
    setDotVisible(
      hasFreshCriticalEvent(_lastResult?.payload?.events ?? [], nowMs()),
    );
    try {
      button.focus?.();
    } catch {
      /* Focus restore is best-effort. */
    }
  }

  function renderSheet() {
    if (!_sheetNodes) return;
    const { sheet } = _sheetNodes;
    const loc = locale();
    const result = _lastResult;
    const payload = result?.payload ?? null;

    while (sheet.firstChild) sheet.firstChild.remove();

    const head = el(documentRef, 'div', 'ln-sheet-head');
    const titleWrap = el(documentRef, 'div', '');
    // The panel is a snapshot, not a live feed: the payload refreshes every
    // 10 minutes, so the subtitle carries the snapshot's own timestamp.
    const snapshotMinutes =
      payload && payload.generatedAt != null
        ? minutesSinceGenerated(payload, nowMs())
        : null;
    const subtitle =
      snapshotMinutes == null
        ? ln(loc, 'panel.subtitle')
        : snapshotMinutes < 1
          ? ln(loc, 'panel.snapshotNow')
          : ln(loc, 'panel.snapshotAge', { m: snapshotMinutes });
    titleWrap.append(
      el(documentRef, 'h2', 'ln-sheet-title', ln(loc, 'panel.title')),
      el(documentRef, 'p', 'ln-sheet-sub', subtitle),
    );
    head.append(titleWrap);

    const staleCount = payload?.staleSources?.length ?? 0;
    if (staleCount > 0) {
      head.append(
        el(
          documentRef,
          'span',
          'ln-stale-badge',
          ln(loc, 'panel.sourcesStale', { n: staleCount }),
        ),
      );
    }
    const close = el(documentRef, 'button', 'ln-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeSheet);
    head.append(close);
    sheet.append(head);

    const body = el(documentRef, 'div', 'ln-carousel');
    body.setAttribute('role', 'list');
    const events = payload?.events ?? [];
    const feeds = Array.isArray(payload?.feedHealth?.feeds)
      ? payload.feedHealth.feeds
      : [];
    if (!payload) {
      if (_lastError) {
        const unavailable = el(
          documentRef,
          'p',
          'ln-empty',
          ln(loc, 'panel.unavailable'),
        );
        unavailable.setAttribute('role', 'status');
        body.append(unavailable);
      } else {
        body.append(
          el(documentRef, 'p', 'ln-loading', ln(loc, 'panel.loading')),
        );
        body.setAttribute('aria-busy', 'true');
      }
    } else if (events.length === 0) {
      const empty = el(
        documentRef,
        'p',
        'ln-empty',
        allFeedsUnhealthy(feeds)
          ? ln(loc, 'panel.allFeedsStale')
          : ln(loc, 'panel.empty', {
              m: minutesSinceGenerated(payload, nowMs()) ?? 0,
            }),
      );
      empty.setAttribute('role', 'status');
      body.append(empty);
    } else {
      for (const event of events) {
        body.append(
          createEventCard(event, {
            documentRef,
            locale: loc,
            nowMs: nowMs(),
            onFlyTo: (ev) => flyTo(ev),
          }),
        );
      }
    }
    sheet.append(body);

    if (events.length > 0) {
      const foot = el(documentRef, 'div', 'ln-sheet-foot');
      const tourBtn = el(
        documentRef,
        'button',
        'ln-tour-btn',
        ln(loc, 'panel.playTour'),
      );
      tourBtn.type = 'button';
      tourBtn.addEventListener('click', () => {
        let built;
        try {
          built = buildLiveNowTour(events);
        } catch {
          onToast(ln(loc, 'tour.noEvents'));
          return;
        }
        let fragment = '';
        try {
          fragment = encodeTourFragment(built.project);
        } catch {
          fragment = '';
        }
        onPlayTourProject(built.project, fragment);
        closeSheet();
      });
      foot.append(tourBtn);
      sheet.append(foot);
    }

    if (feeds.length > 0) {
      const health = el(documentRef, 'div', 'ln-feed-health');
      health.append(
        el(
          documentRef,
          'h3',
          'ln-feed-health-title',
          ln(loc, 'panel.feedHealth'),
        ),
      );
      const list = el(documentRef, 'ul', 'ln-feed-list');
      for (const feed of feeds) {
        const label = feed?.label ?? feed?.id ?? '?';
        const state = feed?.state ?? 'unknown';
        list.append(
          el(
            documentRef,
            'li',
            'ln-feed-item',
            `${label} · ${state} · ${formatFeedAge(feed, loc, nowMs())}`,
          ),
        );
      }
      health.append(list);
      sheet.append(health);
    }
  }

  function openSheet() {
    if (_open) return;
    _open = true;
    setDotVisible(
      hasFreshCriticalEvent(_lastResult?.payload?.events ?? [], nowMs()),
    );

    const backdrop = el(documentRef, 'div', '');
    backdrop.id = LIVE_NOW_BACKDROP_ID;
    const sheet = el(documentRef, 'section', '');
    sheet.id = LIVE_NOW_SHEET_ID;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', ln(locale(), 'panel.title'));

    backdrop.addEventListener('click', closeSheet);
    const onKey = (event) => {
      if (event.key === 'Escape') closeSheet();
    };
    documentRef.addEventListener('keydown', onKey);

    _sheetNodes = {
      backdrop,
      sheet,
      dispose() {
        documentRef.removeEventListener('keydown', onKey);
      },
    };

    (documentRef.body || documentRef.documentElement).append(backdrop, sheet);
    renderSheet();
    // Kick a background refresh; the sheet already shows cached data.
    void refresh({ silent: true }).then(() => {
      if (_open) renderSheet();
    });
    try {
      sheet.querySelector?.('.ln-close')?.focus?.();
    } catch {
      /* Focus is best-effort. */
    }
  }

  function toggle() {
    if (_open) closeSheet();
    else openSheet();
  }

  const onClick = () => toggle();
  button.addEventListener('click', onClick);

  // Re-render the open sheet when the app language changes underneath us.
  const onStorage = (event) => {
    if (event?.key === 'gev:locale:v1' && _open) renderSheet();
  };
  if (typeof documentRef.defaultView?.addEventListener === 'function') {
    documentRef.defaultView.addEventListener('storage', onStorage);
  }

  function start() {
    void refresh({ silent: true });
    if (refreshIntervalMs > 0 && typeof setInterval === 'function') {
      _timer = setInterval(
        () => void refresh({ silent: true }),
        refreshIntervalMs,
      );
    }
  }

  function stop() {
    if (_timer) clearInterval(_timer);
    _timer = null;
    if (_open) closeSheet();
  }

  return {
    open: openSheet,
    close: closeSheet,
    toggle,
    refresh,
    start,
    stop,
    get isOpen() {
      return _open;
    },
    get lastPayload() {
      return _lastResult?.payload ?? null;
    },
  };
}
