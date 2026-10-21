/**
 * Alert Me — subscription center for quakes, satellite flyovers, and
 * new tropical cyclones.
 *
 * The cyclone row alerts on every newly-appearing active storm — there is
 * no landfall or proximity gate behind it (DS-09), so the label must never
 * promise landfalls. Toasts now; push notifications explicitly later.
 * `getPushStatus()` / `requestPushPermission()` document the deferred
 * milestone and never prompt the user today.
 */
import {
  filterNewQuakes,
  filterNewStorms,
  findFlyovers,
  createCycloneProvider,
  DEFAULT_QUAKE_MIN_MAG,
  DEFAULT_FLYOVER_RADIUS_KM,
  FLYOVER_COOLDOWN_MS,
} from './providers.js';

export const ALERT_KINDS = Object.freeze(['quakes', 'flyovers', 'cyclones']);
export const ALERT_STORAGE_KEY = 'gev:alerts:v1';
export const QUAKE_POLL_MS = 5 * 60 * 1000;
export const FLYOVER_POLL_MS = 60 * 1000;
export const CYCLONE_POLL_MS = 30 * 60 * 1000;

/**
 * @param {object} input
 * @param {{notify: (toast: object) => Promise<void>}} input.toastService
 * @param {() => Promise<Array>} [input.quakeSource] Async () => normalized USGS rows.
 * @param {() => Promise<{storms: Array}>} [input.cycloneSource] Async () => cyclone snapshot.
 * @param {() => Array<{name: string, tle1: string, tle2: string}>} [input.getSatellites]
 * @param {() => {lat: number, lon: number}|null} [input.getTarget]
 * @param {{getItem: Function, setItem: Function}|null} [input.storage]
 * @param {(key: string, vars?: object) => string} [input.t]
 * @param {object} [input.timers] { setInterval, clearInterval } seam.
 * @param {() => number} [input.now] Clock seam (epoch-ms).
 */
export function createAlertCenter({
  toastService,
  quakeSource = null,
  cycloneSource = null,
  getSatellites = () => [],
  getTarget = () => null,
  storage = null,
  t = (key, vars) => key,
  timers = { setInterval, clearInterval },
  now = () => Date.now(),
} = {}) {
  const subscriptions = new Map();
  const intervals = new Map();
  let seenQuakeIds = new Set();
  let seenStormIds = new Set();
  const lastFlyoverAlert = new Map();
  const watcherStartedAt = now();
  const cycloneProvider = createCycloneProvider({ cycloneSource });

  const tr = (key, vars, fallback) => {
    const value = t(key, vars);
    return typeof value === 'string' && value !== key ? value : fallback;
  };
  const notify = (toast) => {
    try {
      return Promise.resolve(toastService?.notify(toast));
    } catch {
      return Promise.resolve();
    }
  };

  const persist = () => {
    if (!storage?.setItem) return;
    try {
      storage.setItem(
        ALERT_STORAGE_KEY,
        JSON.stringify({
          subscriptions: Object.fromEntries(subscriptions),
        }),
      );
    } catch {
      /* Best effort. */
    }
  };

  const restore = () => {
    let saved;
    try {
      saved = JSON.parse(storage?.getItem?.(ALERT_STORAGE_KEY) ?? 'null');
    } catch {
      return;
    }
    const entries = saved?.subscriptions;
    if (!entries || typeof entries !== 'object') return;
    for (const kind of ALERT_KINDS) {
      if (entries[kind] && typeof entries[kind] === 'object')
        subscriptions.set(kind, { ...entries[kind] });
    }
  };
  restore();

  async function checkQuakes() {
    if (!subscriptions.has('quakes') || typeof quakeSource !== 'function')
      return;
    const { minMag = DEFAULT_QUAKE_MIN_MAG } = subscriptions.get('quakes');
    let rows;
    try {
      rows = await quakeSource();
    } catch {
      return;
    }
    const { alerts, seenIds } = filterNewQuakes(rows, {
      minMag,
      seenIds: seenQuakeIds,
      sinceMs: watcherStartedAt,
    });
    seenQuakeIds = seenIds;
    for (const alert of alerts) {
      await notify({
        kind: 'warning',
        title: tr('alerts.quake', null, 'Earthquake alert'),
        message: tr(
          'alerts.quake',
          { mag: alert.mag.toFixed(1), place: alert.place },
          `M${alert.mag.toFixed(1)} earthquake — ${alert.place}`,
        ),
      });
    }
  }

  async function checkFlyovers() {
    if (!subscriptions.has('flyovers')) return;
    const { radiusKm = DEFAULT_FLYOVER_RADIUS_KM } =
      subscriptions.get('flyovers');
    const target = getTarget();
    if (!target) return;
    const at = now();
    const hits = findFlyovers({
      satellites: getSatellites(),
      target,
      radiusKm,
      date: new Date(at),
    });
    for (const hit of hits) {
      const last = lastFlyoverAlert.get(hit.name) || 0;
      if (at - last < FLYOVER_COOLDOWN_MS) continue;
      lastFlyoverAlert.set(hit.name, at);
      await notify({
        kind: 'info',
        title: tr('alerts.flyover', null, 'Satellite flyover'),
        message: tr(
          'alerts.flyover',
          { name: hit.name },
          `${hit.name} is passing overhead`,
        ),
      });
    }
  }

  async function checkCyclones() {
    if (!subscriptions.has('cyclones')) return;
    if (cycloneProvider.status === 'not-configured') {
      // No source wired (tests, embed builds): say so once, then stand down.
      await notify({
        kind: 'info',
        title: tr('alerts.subscribe', null, 'Alert me'),
        message: cycloneProvider.reason,
      });
      subscriptions.delete('cyclones');
      persist();
      return;
    }
    const { alerts: storms } = await cycloneProvider.check();
    const { alerts, seenIds } = filterNewStorms(storms, {
      seenIds: seenStormIds,
    });
    seenStormIds = seenIds;
    for (const storm of alerts) {
      await notify({
        kind: 'warning',
        title: tr('alerts.cycloneTitle', null, 'New tropical cyclone'),
        message: tr(
          'alerts.cyclone',
          {
            name: storm.name,
            classification: storm.classification,
            windKt: storm.windKt ?? '?',
          },
          `${storm.name} (${storm.classification}) — ${storm.windKt ?? '?'} kt winds`,
        ),
      });
    }
  }

  /** Subscribe to a kind. Options: quakes { minMag }, flyovers { radiusKm }. */
  function subscribe(kind, options = {}) {
    if (!ALERT_KINDS.includes(kind)) return false;
    subscriptions.set(kind, { ...options });
    persist();
    if (kind === 'quakes') {
      void checkQuakes();
      intervals.set(
        kind,
        timers.setInterval(() => void checkQuakes(), QUAKE_POLL_MS),
      );
    } else if (kind === 'flyovers') {
      void checkFlyovers();
      intervals.set(
        kind,
        timers.setInterval(() => void checkFlyovers(), FLYOVER_POLL_MS),
      );
    } else if (kind === 'cyclones') {
      void checkCyclones();
      intervals.set(
        kind,
        timers.setInterval(() => void checkCyclones(), CYCLONE_POLL_MS),
      );
    }
    return true;
  }

  function unsubscribe(kind) {
    if (!subscriptions.has(kind)) return false;
    subscriptions.delete(kind);
    const timer = intervals.get(kind);
    if (timer != null) timers.clearInterval(timer);
    intervals.delete(kind);
    persist();
    return true;
  }

  function destroy() {
    for (const timer of intervals.values()) timers.clearInterval(timer);
    intervals.clear();
  }

  return {
    subscribe,
    unsubscribe,
    destroy,
    isSubscribed: (kind) => subscriptions.has(kind),
    list: () =>
      ALERT_KINDS.filter((kind) => subscriptions.has(kind)).map((kind) => ({
        kind,
        options: { ...subscriptions.get(kind) },
        status: kind === 'cyclones' ? cycloneProvider.status : 'active',
      })),
    /** Test seam: run one watcher pass on demand. */
    checkNow: async (kind) => {
      if (kind === 'quakes') await checkQuakes();
      else if (kind === 'flyovers') await checkFlyovers();
      else if (kind === 'cyclones') await checkCyclones();
    },
  };
}

/**
 * Push-notification status — EXPLICITLY DEFERRED.
 * Toasts are the notification surface for this milestone; this function
 * documents the later milestone and never requests permission.
 */
export function getPushStatus() {
  let supported = false;
  let permission = 'unknown';
  try {
    supported = 'Notification' in globalThis;
    permission = supported ? globalThis.Notification.permission : 'unsupported';
  } catch {
    /* Best effort. */
  }
  return {
    supported,
    permission,
    status: 'deferred',
    note: 'Push notifications ship in a later milestone — toasts for now.',
  };
}

/** Never prompts today; resolves the deferred status for UI copy. */
export async function requestPushPermission() {
  return getPushStatus();
}
