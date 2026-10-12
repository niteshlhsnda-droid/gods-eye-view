/**
 * @module metrics/telemetryStrip
 * @description Apache ECharts telemetry strip for tracked targets.
 *
 * Renders a live altitude/speed chart (with history sparklines) for the
 * targets the user is currently tracking. ECharts is loaded lazily via
 * dynamic `import('echarts')`; when it is unavailable (not installed, offline
 * CDN, SSR) every mount path no-ops gracefully and reports
 * `{ ok: false, reason: 'echarts-unavailable' }` — the app keeps working.
 *
 * Data flow: the caller supplies `getTargets()` returning the current
 * tracked targets as plain objects:
 *
 * ```js
 * getTargets() // → [{ id: 'UAL123', label: 'UAL123 · B738', altitudeM: 10668, speedKts: 452 }]
 * ```
 *
 * The strip keeps a ring buffer of samples per target id and repaints the
 * chart on a timer. Nothing in this module reaches into Cesium or the HUD
 * directly; see `attachTelemetryStripToHud` for the IntelHUD wiring.
 */

/** Samples kept per tracked target. */
export const TELEMETRY_HISTORY_POINTS = 60;

/** Default repaint cadence. */
export const TELEMETRY_UPDATE_MS = 1000;

/** HUD-tinted ECharts palette. */
export const TELEMETRY_CHART_THEME = Object.freeze({
  background: 'transparent',
  text: 'rgba(0, 255, 255, 0.75)',
  grid: 'rgba(0, 255, 255, 0.12)',
  altitude: '#33ff66',
  speed: '#ffb347',
});

/**
 * Create a bounded ring buffer of telemetry samples per target id.
 * Pure logic — safe to unit test in Node.
 * @param {number} [capacity=TELEMETRY_HISTORY_POINTS]
 * @returns {{push(sample: object): void, series(): object, ids(): string[], clear(): void}}
 */
export function createTelemetryStore(capacity = TELEMETRY_HISTORY_POINTS) {
  const cap = Math.max(8, Math.floor(capacity) || TELEMETRY_HISTORY_POINTS);
  const buffers = new Map();
  return {
    push(sample) {
      if (!sample || typeof sample.id !== 'string' || !sample.id) return;
      let buffer = buffers.get(sample.id);
      if (!buffer) {
        buffer = [];
        buffers.set(sample.id, buffer);
      }
      buffer.push({
        t: typeof sample.t === 'number' ? sample.t : Date.now(),
        altitudeM:
          typeof sample.altitudeM === 'number' ? sample.altitudeM : null,
        speedKts: typeof sample.speedKts === 'number' ? sample.speedKts : null,
      });
      if (buffer.length > cap) buffer.splice(0, buffer.length - cap);
    },
    series() {
      const out = {};
      for (const [id, buffer] of buffers) {
        out[id] = buffer.map((point) => ({ ...point }));
      }
      return out;
    },
    ids() {
      return [...buffers.keys()];
    },
    clear() {
      buffers.clear();
    },
  };
}

/**
 * Build the ECharts option for the current store contents.
 * @param {object} store Telemetry store from {@link createTelemetryStore}.
 * @param {object} labels Map of target id → display label.
 * @returns {object} ECharts option object.
 */
export function buildTelemetryOption(store, labels = {}) {
  const theme = TELEMETRY_CHART_THEME;
  const allSeries = store.series();
  const ids = Object.keys(allSeries).slice(0, 4);
  const series = [];
  for (const id of ids) {
    const points = allSeries[id];
    const label = labels[id] || id;
    series.push({
      name: `${label} · ALT`,
      type: 'line',
      showSymbol: false,
      smooth: true,
      yAxisIndex: 0,
      data: points.map((point) => [point.t, point.altitudeM]),
      lineStyle: { color: theme.altitude, width: 1.5 },
      emphasis: { disabled: true },
    });
    series.push({
      name: `${label} · SPD`,
      type: 'line',
      showSymbol: false,
      smooth: true,
      yAxisIndex: 1,
      data: points.map((point) => [point.t, point.speedKts]),
      lineStyle: { color: theme.speed, width: 1, type: 'dashed' },
      emphasis: { disabled: true },
    });
  }
  return {
    backgroundColor: theme.background,
    animation: false,
    grid: { left: 8, right: 8, top: 18, bottom: 4, containLabel: true },
    legend: {
      show: true,
      top: 0,
      textStyle: { color: theme.text, fontSize: 9 },
      itemWidth: 12,
      itemHeight: 6,
    },
    xAxis: {
      type: 'time',
      axisLabel: { color: theme.text, fontSize: 8, hideOverlap: true },
      axisLine: { lineStyle: { color: theme.grid } },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'ALT m',
        nameTextStyle: { color: theme.text, fontSize: 8 },
        axisLabel: { color: theme.text, fontSize: 8 },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      {
        type: 'value',
        name: 'KT',
        nameTextStyle: { color: theme.text, fontSize: 8 },
        axisLabel: { color: theme.text, fontSize: 8 },
        splitLine: { show: false },
      },
    ],
    series,
  };
}

/**
 * Default ECharts loader. Kept as a separate seam so tests can inject a
 * fake chart library and the module stays honest about the dependency.
 * @returns {Promise<object>} The `echarts` module namespace.
 */
export function loadEcharts() {
  return import('echarts');
}

/**
 * Mount the telemetry strip into a host element.
 * @param {object} options
 * @param {HTMLElement|null} [options.host] Container to render into.
 * @param {() => Array<object>} [options.getTargets] Target reader.
 * @param {() => Promise<object>} [options.chartLoader=loadEcharts]
 * @param {number} [options.maxTargets=3]
 * @param {number} [options.updateMs=TELEMETRY_UPDATE_MS]
 * @returns {Promise<{ok: boolean, reason?: string, dispose?: () => void}>}
 */
export async function mountTelemetryStrip({
  host = null,
  getTargets = () => [],
  chartLoader = loadEcharts,
  maxTargets = 3,
  updateMs = TELEMETRY_UPDATE_MS,
} = {}) {
  if (!host || typeof host.appendChild !== 'function') {
    return { ok: false, reason: 'no-dom' };
  }
  let echarts;
  try {
    echarts = await chartLoader();
  } catch {
    return { ok: false, reason: 'echarts-unavailable' };
  }
  if (!echarts || typeof echarts.init !== 'function') {
    return { ok: false, reason: 'echarts-unavailable' };
  }

  const container = host.ownerDocument
    ? host.ownerDocument.createElement('div')
    : null;
  if (!container) return { ok: false, reason: 'no-dom' };
  container.className = 'hud-telemetry-strip';
  container.setAttribute('role', 'img');
  container.setAttribute(
    'aria-label',
    'Live telemetry: altitude and speed history of tracked targets',
  );
  container.style.cssText =
    'width:100%;height:96px;pointer-events:none;opacity:0.92;';
  host.appendChild(container);

  const chart = echarts.init(container, null, { renderer: 'canvas' });
  const store = createTelemetryStore();
  const labels = {};
  let disposed = false;
  let timer = null;

  const tick = () => {
    if (disposed) return;
    let targets = [];
    try {
      targets = getTargets() || [];
    } catch {
      targets = [];
    }
    const now = Date.now();
    for (const target of targets.slice(0, Math.max(1, maxTargets))) {
      if (!target || typeof target.id !== 'string') continue;
      labels[target.id] = target.label || target.id;
      store.push({
        id: target.id,
        t: now,
        altitudeM: target.altitudeM,
        speedKts: target.speedKts,
      });
    }
    try {
      chart.setOption(buildTelemetryOption(store, labels), {
        notMerge: false,
        lazyUpdate: true,
      });
    } catch {
      // A chart failure must never take the HUD down.
    }
  };
  tick();
  timer = setInterval(tick, Math.max(250, updateMs));

  const dispose = () => {
    disposed = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    try {
      chart.dispose();
    } catch {
      // ignore
    }
    try {
      container.remove();
    } catch {
      // ignore
    }
  };
  return { ok: true, dispose };
}

/**
 * Attach the telemetry strip to an IntelHUD instance.
 * @param {object} hud IntelHUD instance (must expose `_el`).
 * @param {object} [options] Passed through to {@link mountTelemetryStrip},
 * plus `getTargets`.
 * @returns {Promise<{ok: boolean, reason?: string, dispose?: () => void}>}
 */
export function attachTelemetryStripToHud(hud, options = {}) {
  const root = hud && hud._el ? hud._el : null;
  if (!root) return Promise.resolve({ ok: false, reason: 'no-hud' });
  let stripHost = null;
  try {
    stripHost = root.querySelector('.hud-telemetry-strip-host');
    if (!stripHost && root.ownerDocument) {
      stripHost = root.ownerDocument.createElement('div');
      stripHost.className = 'hud-telemetry-strip-host';
      root.appendChild(stripHost);
    }
  } catch {
    return Promise.resolve({ ok: false, reason: 'no-dom' });
  }
  return mountTelemetryStrip({ host: stripHost, ...options });
}
