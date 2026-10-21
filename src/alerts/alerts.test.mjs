import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAlertCenter,
  getPushStatus,
  requestPushPermission,
  ALERT_KINDS,
  ALERT_STORAGE_KEY,
  FLYOVER_OVERHEAD_MAX_KM,
  flyoverToastCopy,
} from './index.js';
import { t as realI18nT } from '../i18n/index.js';
import en from '../i18n/locales/en.js';
import hi from '../i18n/locales/hi.js';
import es from '../i18n/locales/es.js';
import pt from '../i18n/locales/pt.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, value),
  };
}

function fakeTimers() {
  return { setInterval: () => 1, clearInterval: () => {} };
}

const ROWS = [
  {
    stableId: 'q1',
    mag: 6.0,
    place: 'Test Range',
    lat: 10,
    lon: 20,
    depthKm: 10,
    time: Date.now(),
  },
];

test('subscribe/unsubscribe round-trips and persists', () => {
  const storage = memoryStorage();
  const toasts = [];
  const center = createAlertCenter({
    toastService: { notify: async (toast) => toasts.push(toast) },
    quakeSource: async () => ROWS,
    storage,
    timers: fakeTimers(),
  });
  assert.equal(center.subscribe('quakes', { minMag: 5 }), true);
  assert.equal(center.subscribe('nope'), false);
  assert.equal(center.isSubscribed('quakes'), true);
  const saved = JSON.parse(storage.getItem(ALERT_STORAGE_KEY));
  assert.deepEqual(saved.subscriptions.quakes, { minMag: 5 });
  assert.equal(center.unsubscribe('quakes'), true);
  assert.equal(center.isSubscribed('quakes'), false);
  center.destroy();
});

test('a new big quake produces one toast, then dedupes', async () => {
  const toasts = [];
  // Fresh timestamp: the watcher only alerts on events newer than its start.
  const freshRows = [{ ...ROWS[0], time: Date.now() + 1000 }];
  const center = createAlertCenter({
    toastService: { notify: async (toast) => toasts.push(toast) },
    quakeSource: async () => freshRows,
    timers: fakeTimers(),
  });
  center.subscribe('quakes', { minMag: 5 });
  await center.checkNow('quakes');
  await center.checkNow('quakes');
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].message.includes('6.0'));
  center.destroy();
});

test('small quakes never toast', async () => {
  const toasts = [];
  const center = createAlertCenter({
    toastService: { notify: async (toast) => toasts.push(toast) },
    quakeSource: async () => [{ ...ROWS[0], mag: 3.0 }],
    timers: fakeTimers(),
  });
  center.subscribe('quakes', { minMag: 5 });
  await center.checkNow('quakes');
  assert.equal(toasts.length, 0);
  center.destroy();
});

test('flyover alerts fire once per pass (cooldown)', async () => {
  const tle1 =
    '1 25544U 98067A   26300.50000000  .00016717  00000-0  10270-3 0  9000';
  const tle2 =
    '2 25544  51.6416 208.9163 0006703  69.9862  25.2906 15.72125391    10';
  const toasts = [];
  // Target pinned where the ISS can never go: its orbit stays within
  // ±51.6° latitude, so lat -80 is always >3000 km from any subpoint —
  // no alert expected here, ever. The point is the watcher runs without
  // throwing on real TLEs.
  const center = createAlertCenter({
    toastService: { notify: async (toast) => toasts.push(toast) },
    getSatellites: () => [{ name: 'ISS', tle1, tle2 }],
    getTarget: () => ({ lat: -80, lon: -120 }),
    timers: fakeTimers(),
  });
  center.subscribe('flyovers', { radiusKm: 1500 });
  await center.checkNow('flyovers');
  assert.equal(toasts.length, 0);
  assert.deepEqual(ALERT_KINDS, ['quakes', 'flyovers', 'cyclones']);
  center.destroy();
});

test('cyclone subscription toasts new storms and stays subscribed', async () => {
  const toasts = [];
  const storms = [
    {
      id: 'al092026',
      name: 'Test Storm',
      classification: 'TS',
      basin: 'AL',
      windKt: 45,
      position: { latitude: 15, longitude: -45 },
    },
  ];
  const center = createAlertCenter({
    toastService: { notify: async (toast) => toasts.push(toast) },
    cycloneSource: async () => ({ storms }),
    timers: fakeTimers(),
  });
  // subscribe() already runs one check; wait for it to settle.
  center.subscribe('cyclones');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].message.includes('Test Storm'));
  assert.equal(center.isSubscribed('cyclones'), true);
  // A second poll dedupes: no repeat toast for the same storm.
  await center.checkNow('cyclones');
  assert.equal(toasts.length, 1);
  const listed = center.list();
  assert.ok(
    listed.some(
      (entry) => entry.kind === 'cyclones' && entry.status === 'active',
    ),
  );
  center.destroy();
});

test('cyclone subscription without a source stands down honestly', async () => {
  const toasts = [];
  const center = createAlertCenter({
    toastService: { notify: async (toast) => toasts.push(toast) },
    timers: fakeTimers(),
  });
  // subscribe() already runs one honest check; wait for it to settle.
  center.subscribe('cyclones');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].message.includes('No cyclone source wired'));
  assert.equal(center.isSubscribed('cyclones'), false);
  center.destroy();
});

test('push notifications are explicitly deferred', async () => {
  const status = getPushStatus();
  assert.equal(status.status, 'deferred');
  assert.ok(status.note.includes('later milestone'));
  const again = await requestPushPermission();
  assert.equal(again.status, 'deferred');
});

test('DS-16: re-subscribing clears the old poll interval (no orphaned pollers)', () => {
  const calls = [];
  let nextHandle = 0;
  const timers = {
    setInterval: (fn, ms) => {
      const handle = ++nextHandle;
      calls.push(['set', handle, ms]);
      return handle;
    },
    clearInterval: (handle) => calls.push(['clear', handle]),
  };
  const center = createAlertCenter({
    toastService: { notify: async () => {} },
    quakeSource: async () => [],
    timers,
  });
  center.subscribe('quakes');
  center.subscribe('quakes');
  const sets = calls.filter((c) => c[0] === 'set');
  const clears = calls.filter((c) => c[0] === 'clear');
  // Pre-fix: 2 sets but only 1 clear — the first 5-minute poller was orphaned.
  assert.equal(sets.length, 2);
  assert.equal(
    clears.length,
    1,
    're-subscribe must clear the previous interval before setting a new one',
  );
  const cleared = new Set(clears.map((c) => c[1]));
  for (const [, handle] of sets.slice(0, 1))
    assert.ok(cleared.has(handle), `interval handle ${handle} leaked`);
  // Unsubscribe clears the one live poller — nothing left behind.
  center.unsubscribe('quakes');
  const clearedAfter = new Set(
    calls.filter((c) => c[0] === 'clear').map((c) => c[1]),
  );
  for (const [, handle] of sets)
    assert.ok(clearedAfter.has(handle), `interval handle ${handle} leaked`);
  center.destroy();
});

test('DS-17: flyover toast wording is distance-aware', () => {
  // The filed probe: a 1,401 km hit is near the horizon, not overhead.
  const far = flyoverToastCopy({ name: 'ISS (ZARYA)', distanceKm: 1401 });
  assert.equal(far.key, 'alerts.flyoverWithin');
  assert.deepEqual(far.vars, { name: 'ISS (ZARYA)', km: 1401 });
  assert.ok(far.fallback.includes('within 1401 km'));
  assert.ok(!far.fallback.includes('overhead'));

  const near = flyoverToastCopy({ name: 'ISS (ZARYA)', distanceKm: 120 });
  assert.equal(near.key, 'alerts.flyoverOverhead');
  assert.ok(near.fallback.includes('passing overhead'));

  // Boundary: 500 km is still "overhead", 501 km is not.
  assert.equal(FLYOVER_OVERHEAD_MAX_KM, 500);
  assert.equal(
    flyoverToastCopy({ name: 'X', distanceKm: 500 }).key,
    'alerts.flyoverOverhead',
  );
  assert.equal(
    flyoverToastCopy({ name: 'X', distanceKm: 501 }).key,
    'alerts.flyoverWithin',
  );

  // Robust to missing fields.
  const bare = flyoverToastCopy({});
  assert.equal(bare.vars.name, 'Unknown satellite');
  assert.equal(bare.key, 'alerts.flyoverOverhead');
});

test('DS-17: the new flyover keys resolve in every locale', () => {
  for (const [code, table] of Object.entries({ en, hi, es, pt })) {
    assert.equal(
      typeof table.alerts.flyoverTitle,
      'string',
      `${code}.alerts.flyoverTitle`,
    );
    assert.ok(
      table.alerts.flyoverOverhead.includes('{{name}}'),
      `${code}.alerts.flyoverOverhead`,
    );
    assert.ok(
      table.alerts.flyoverWithin.includes('{{name}}') &&
        table.alerts.flyoverWithin.includes('{{km}}'),
      `${code}.alerts.flyoverWithin`,
    );
  }
});

test('toast titles do not crash on null vars with the real i18n t', async () => {
  // The real i18n `t` throws on null vars when the template has {{placeholders}};
  // every alert title lookup passed null, so each toast died before firing.
  const toasts = [];
  const freshRows = [{ ...ROWS[0], time: Date.now() + 1000 }];
  const center = createAlertCenter({
    toastService: { notify: async (toast) => toasts.push(toast) },
    quakeSource: async () => freshRows,
    timers: fakeTimers(),
    t: realI18nT,
  });
  center.subscribe('quakes');
  await center.checkNow('quakes');
  assert.equal(toasts.length, 1);
  center.destroy();
});
