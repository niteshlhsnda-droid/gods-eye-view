/**
 * Multi-globe comparison view — Cesium/DOM wiring for a comparison spec.
 *
 * Two presentation modes:
 * - 'split': one viewer, BEFORE imagery layer pinned to the LEFT of the
 *   divider and AFTER imagery pinned to the RIGHT, with the repo's existing
 *   `createImagerySplit` divider driving `scene.splitPosition`.
 * - 'side-by-side': two synced viewer instances in a flex row; cameras mirror
 *   each other on every `camera.changed` event.
 *
 * Everything Cesium/DOM is injected so the pure model stays testable; the app
 * passes the real `cesium` namespace, its viewer, the imagery-layer factory
 * and the split-control builder.
 */
import { createImagerySplit } from '../ui/imagerySplit.js';
import {
  createComparisonSpec,
  computeAreaDelta,
  comparisonHud,
  clampSplitPosition,
} from './compareModel.js';

export {
  createComparisonSpec,
  computeAreaDelta,
  comparisonHud,
  clampSplitPosition,
  COMPARE_MODES,
} from './compareModel.js';

const LEFT = 'LEFT';
const RIGHT = 'RIGHT';
const NONE = 'NONE';

/**
 * Start a comparison session.
 *
 * @param {Object} options
 * @param {Object} options.spec Comparison descriptor from createComparisonSpec.
 * @param {Object} options.Cesium Cesium namespace (SplitDirection, ImageryLayer...).
 * @param {Object} options.viewer Primary Cesium viewer.
 * @param {function({product:string|null, day:string|null}):Promise|Object} options.layerFactory Creates an imagery layer for a pane.
 * @param {function} [options.createSplit=createImagerySplit] Split-divider builder.
 * @param {function} [options.createViewer] Factory `(container) => viewer` for side-by-side mode.
 * @param {Object} [options.turf] Turf module (injected; @turf/turf once installed).
 * @param {Object} [options.dom=document] DOM host for the session HUD.
 * @returns {Promise<{spec:Object, hud:Object, destroy:function, setMode:function}>}
 */
export async function createComparisonSession({
  spec,
  Cesium,
  viewer,
  layerFactory,
  createSplit = createImagerySplit,
  createViewer,
  turf,
  dom = globalThis.document,
} = {}) {
  if (!spec) throw new Error('spec is required');
  if (!Cesium) throw new Error('Cesium is required');
  if (!viewer) throw new Error('viewer is required');
  if (typeof layerFactory !== 'function')
    throw new Error('layerFactory is required');

  const state = {
    spec,
    mode: spec.mode,
    layers: [],
    split: null,
    second: null,
    syncDisposers: [],
    hudElement: null,
    destroyed: false,
  };

  const splitFor = (side) =>
    side === 'left'
      ? (Cesium.SplitDirection?.[LEFT] ?? 1)
      : side === 'right'
        ? (Cesium.SplitDirection?.[RIGHT] ?? 2)
        : (Cesium.SplitDirection?.[NONE] ?? 0);

  const addPaneLayer = async (pane, side) => {
    const layer = await layerFactory({ product: pane.product, day: pane.day });
    if (layer) {
      layer.splitDirection = splitFor(side);
      viewer.imageryLayers?.add(layer);
      state.layers.push(layer);
    }
    return layer;
  };

  const buildHud = () => {
    const delta = computeAreaDelta(
      turf,
      spec.before.geometry,
      spec.after.geometry,
    );
    return comparisonHud(spec, delta);
  };

  const paintHud = (host) => {
    if (!dom || !dom.createElement) return null;
    const el = dom.createElement('div');
    el.className = 'gev-compare-hud';
    const hud = buildHud();
    el.textContent = `${hud.title} — ${hud.deltaText}`;
    host.appendChild(el);
    return el;
  };

  async function applyMode(mode) {
    await teardownLayers();
    state.mode = mode;
    state.spec = { ...state.spec, mode };
    if (mode === 'split') {
      await addPaneLayer(state.spec.before, 'left');
      await addPaneLayer(state.spec.after, 'right');
      state.split = createSplit({
        scene: viewer.scene,
        beforeLabel: state.spec.before.label,
        afterLabel: state.spec.after.label,
        initialValue: 0.5,
        onChange: () => paintDelta(),
      });
    } else {
      await addPaneLayer(state.spec.before, 'none');
      if (typeof createViewer !== 'function')
        throw new Error('createViewer is required for side-by-side mode');
      const host = dom?.createElement('div');
      host.className = 'gev-compare-second';
      state.secondHost = host;
      const afterViewer = createViewer(host);
      state.second = afterViewer;
      await addPaneLayerTo(state.spec.after, afterViewer, 'none');
      state.syncDisposers.push(syncCameras(viewer, afterViewer));
    }
    paintDelta();
  }

  const addPaneLayerTo = async (pane, targetViewer, side) => {
    const layer = await layerFactory({ product: pane.product, day: pane.day });
    if (layer) {
      layer.splitDirection = splitFor(side);
      targetViewer.imageryLayers?.add(layer);
      state.layers.push(layer);
    }
  };

  const paintDelta = () => {
    const hud = buildHud();
    if (state.hudElement)
      state.hudElement.textContent = `${hud.title} — ${hud.deltaText}`;
    return hud;
  };

  async function teardownLayers() {
    for (const layer of state.layers) viewer.imageryLayers?.remove(layer, true);
    for (const layer of state.layers)
      if (state.second) state.second.imageryLayers?.remove(layer, true);
    state.layers = [];
    state.split?.destroy?.();
    state.split = null;
    for (const dispose of state.syncDisposers) dispose();
    state.syncDisposers = [];
    if (state.second?.destroy) state.second.destroy();
    state.second = null;
    state.secondHost?.remove?.();
    state.secondHost = null;
  }

  const session = {
    get spec() {
      return state.spec;
    },
    get mode() {
      return state.mode;
    },
    async setMode(mode) {
      if (!['split', 'side-by-side'].includes(mode))
        throw new Error(`unsupported compare mode: ${mode}`);
      if (mode !== state.mode) await applyMode(mode);
      return state.mode;
    },
    delta() {
      return computeAreaDelta(
        turf,
        state.spec.before.geometry,
        state.spec.after.geometry,
      );
    },
    hud() {
      return buildHud();
    },
    async mountHud(host) {
      state.hudElement = paintHud(host);
      return state.hudElement;
    },
    async destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      await teardownLayers();
      state.hudElement?.remove?.();
      state.hudElement = null;
    },
  };

  await applyMode(state.mode);
  return session;
}

/** Mirror camera pose between two viewers; returns a dispose function. */
export function syncCameras(a, b) {
  const copy = (from, to) => {
    const src = from.camera;
    const dst = to.camera;
    if (!src || !dst) return;
    if (src.position && dst.position)
      dst.position = src.position.clone?.() ?? src.position;
    if (src.heading != null) dst.heading = src.heading;
    if (src.pitch != null) dst.pitch = src.pitch;
    if (src.roll != null) dst.roll = src.roll;
    to.scene?.requestRender?.();
  };
  const aToB = () => copy(a, b);
  const bToA = () => copy(b, a);
  const offA = a.camera?.changed?.addEventListener?.(aToB);
  const offB = b.camera?.changed?.addEventListener?.(bToA);
  return () => {
    a.camera?.changed?.removeEventListener?.(aToB, offA);
    b.camera?.changed?.removeEventListener?.(bToA, offB);
  };
}
