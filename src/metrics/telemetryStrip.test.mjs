import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelemetryOption,
  createTelemetryStore,
  mountTelemetryStrip,
  attachTelemetryStripToHud,
  TELEMETRY_HISTORY_POINTS,
} from './telemetryStrip.js';

test('createTelemetryStore keeps a bounded per-target history', () => {
  const store = createTelemetryStore(12);
  for (let i = 0; i < 20; i += 1) {
    store.push({ id: 'UAL123', t: i, altitudeM: 1000 + i, speedKts: 400 });
  }
  store.push({ id: 'BAW9', t: 1, altitudeM: 9000, speedKts: 450 });
  assert.deepEqual(store.ids().sort(), ['BAW9', 'UAL123']);
  const series = store.series();
  assert.equal(series.UAL123.length, 12);
  assert.equal(series.UAL123[0].t, 8);
  assert.equal(series.BAW9.length, 1);
});

test('createTelemetryStore ignores malformed samples', () => {
  const store = createTelemetryStore();
  store.push(null);
  store.push({ id: '', altitudeM: 1 });
  store.push({ altitudeM: 1 });
  assert.deepEqual(store.ids(), []);
  store.clear();
  assert.deepEqual(store.series(), {});
});

test('buildTelemetryOption emits altitude+speed series per target', () => {
  const store = createTelemetryStore();
  store.push({ id: 'UAL123', t: 1000, altitudeM: 10668, speedKts: 452 });
  store.push({ id: 'UAL123', t: 2000, altitudeM: 10670, speedKts: 451 });
  const option = buildTelemetryOption(store, { UAL123: 'UAL123 · B738' });
  assert.equal(option.series.length, 2);
  assert.equal(option.series[0].name, 'UAL123 · B738 · ALT');
  assert.equal(option.series[0].yAxisIndex, 0);
  assert.equal(option.series[1].yAxisIndex, 1);
  assert.deepEqual(option.series[0].data[0], [1000, 10668]);
});

test('buildTelemetryOption caps at four targets to stay readable', () => {
  const store = createTelemetryStore();
  for (let i = 0; i < 6; i += 1) {
    store.push({ id: `T${i}`, t: 1, altitudeM: 1000, speedKts: 400 });
  }
  const option = buildTelemetryOption(store);
  assert.equal(option.series.length, 8);
});

test('default capacity constant is sane', () => {
  assert.ok(TELEMETRY_HISTORY_POINTS >= 30);
});

function makeFakeChart() {
  const calls = [];
  return {
    calls,
    init() {
      calls.push('init');
      return {
        setOption: () => calls.push('setOption'),
        dispose: () => calls.push('dispose'),
      };
    },
  };
}

function makeFakeDocument() {
  const created = [];
  return {
    created,
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: { cssText: '' },
        children: [],
        setAttribute: () => {},
        appendChild(child) {
          el.children.push(child);
          return child;
        },
        remove() {},
      };
      created.push(el);
      return el;
    },
  };
}

test('mountTelemetryStrip no-ops without a DOM host', async () => {
  const result = await mountTelemetryStrip({ host: null });
  assert.deepEqual(result, { ok: false, reason: 'no-dom' });
});

test('mountTelemetryStrip no-ops when echarts cannot load', async () => {
  const fakeDocument = makeFakeDocument();
  const host = {
    ownerDocument: fakeDocument,
    appendChild: () => {},
  };
  const result = await mountTelemetryStrip({
    host,
    chartLoader: () => Promise.reject(new Error('offline')),
  });
  assert.deepEqual(result, { ok: false, reason: 'echarts-unavailable' });
});

test('mountTelemetryStrip renders ticks with an injected chart library', async () => {
  const fakeChart = makeFakeChart();
  const fakeDocument = makeFakeDocument();
  let appended = null;
  const host = {
    ownerDocument: fakeDocument,
    appendChild: (child) => {
      appended = child;
    },
  };
  const result = await mountTelemetryStrip({
    host,
    getTargets: () => [
      { id: 'UAL123', label: 'UAL123', altitudeM: 10668, speedKts: 452 },
    ],
    chartLoader: () => Promise.resolve(fakeChart),
    updateMs: 60_000,
  });
  assert.equal(result.ok, true);
  assert.ok(appended, 'container appended to host');
  assert.ok(fakeChart.calls.includes('init'));
  assert.ok(fakeChart.calls.includes('setOption'));
  result.dispose();
  assert.ok(fakeChart.calls.includes('dispose'));
});

test('attachTelemetryStripToHud no-ops without a HUD root', async () => {
  assert.deepEqual(await attachTelemetryStripToHud(null), {
    ok: false,
    reason: 'no-hud',
  });
  assert.deepEqual(await attachTelemetryStripToHud({}), {
    ok: false,
    reason: 'no-hud',
  });
});
