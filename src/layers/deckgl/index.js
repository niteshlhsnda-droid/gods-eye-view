import * as Cesium from 'cesium';
import { createOverlayCanvas, deckViewStateFromCamera } from './overlay.js';
import { recordsToDeckData, entityScatterProps } from './entities.js';
import {
  aggregateToH3,
  h3HexagonProps,
  resolutionForAltitude,
} from './h3density.js';

export { createOverlayCanvas, deckViewStateFromCamera } from './overlay.js';
export {
  recordsToDeckData,
  entityToDatum,
  entityScatterProps,
} from './entities.js';
export {
  aggregateToH3,
  h3HexagonProps,
  resolutionForAltitude,
} from './h3density.js';

/** Read plain camera values out of a Cesium viewer for the deck.gl sync. */
function readCameraState(viewer) {
  const camera = viewer.camera;
  const ray = new Cesium.Ray(camera.positionWC, camera.directionWC);
  const hit = Cesium.IntersectionTests.rayEllipsoid(
    ray,
    viewer.scene.globe.ellipsoid,
  );
  const target = hit ? Cesium.Ray.getPoint(ray, hit.start) : camera.positionWC;
  const targetCarto = Cesium.Cartographic.fromCartesian(target);
  const cameraCarto = Cesium.Cartographic.fromCartesian(camera.positionWC);
  return {
    lonDeg: Cesium.Math.toDegrees(targetCarto.longitude),
    latDeg: Cesium.Math.toDegrees(targetCarto.latitude),
    heightM: Math.max(1, cameraCarto.height),
    headingRad: camera.heading,
    pitchRad: camera.pitch,
    viewportHeightPx: viewer.canvas.clientHeight || 600,
  };
}

/**
 * deck.gl entity overlay layer.
 *
 * Renders live entity records (aircraft, vessels, …) as one GPU-instanced
 * deck.gl ScatterplotLayer over the Cesium globe, with an optional H3
 * hex-density aggregation toggle. deck.gl and h3-js are imported lazily so
 * the layer degrades to a logged warning when the dependencies are not
 * installed yet (see DEPS.md).
 */
export function createDeckGlLayer() {
  let _viewer = null;
  let _canvas = null;
  let _deck = null;
  let _deckApi = null; // { Deck, ScatterplotLayer, H3HexagonLayer, GlobeView }
  let _h3 = null;
  let _enabled = false;
  let _h3Mode = false;
  let _data = [];
  let _preRenderRemove = null;
  let _ready = false;
  let _loadError = null;
  let _syncCounter = 0;

  async function ensureDeck() {
    if (_deckApi) return _deckApi;
    const [deckModule, h3Module] = await Promise.all([
      import('deck.gl'),
      import('h3-js'),
    ]);
    // GlobeView is experimental in deck.gl 9.x and exported as _GlobeView in
    // @deck.gl/core; the deck.gl bundle may also re-export it as GlobeView.
    const GlobeView = deckModule.GlobeView ?? deckModule._GlobeView;
    if (!GlobeView) throw new Error('deck.gl GlobeView is unavailable');
    _h3 = h3Module;
    _deckApi = {
      Deck: deckModule.Deck,
      ScatterplotLayer: deckModule.ScatterplotLayer,
      H3HexagonLayer: deckModule.H3HexagonLayer,
      GlobeView,
    };
    return _deckApi;
  }

  function rebuildLayers() {
    if (!_deck || !_deckApi) return;
    const layers = [new _deckApi.ScatterplotLayer(entityScatterProps(_data))];
    if (_h3Mode && _h3 && _data.length > 0) {
      const camera = _viewer ? readCameraState(_viewer) : null;
      const resolution = resolutionForAltitude(camera?.heightM ?? 5e6);
      const cells = aggregateToH3(_data, _h3, resolution);
      layers.push(new _deckApi.H3HexagonLayer(h3HexagonProps(cells)));
    }
    _deck.setProps({ layers });
  }

  function syncFrame() {
    if (!_deck || !_viewer || !_enabled) return;
    // Camera sync every frame is a single setProps; deck.gl diffs viewState
    // cheaply. H3 re-aggregation is throttled: resolution only changes with
    // altitude bands, so re-aggregate at most every 30 frames in H3 mode.
    _deck.setProps({
      viewState: deckViewStateFromCamera(readCameraState(_viewer)),
    });
    _syncCounter += 1;
    if (_h3Mode && _syncCounter % 30 === 0) rebuildLayers();
  }

  const layer = {
    id: 'deckgl',
    name: 'deck.gl Entity Overlay',
    icon: '🧊',
    source: 'deck.gl + H3',

    async init(viewer) {
      if (_viewer) throw new Error('deck.gl layer is already initialized');
      _viewer = viewer;
      try {
        await ensureDeck();
        _canvas = createOverlayCanvas(viewer.canvas.parentElement);
        _deck = new _deckApi.Deck({
          canvas: _canvas,
          views: [new _deckApi.GlobeView({ id: 'globe', controller: false })],
          initialViewState: deckViewStateFromCamera(readCameraState(viewer)),
          layers: [],
          controller: false,
          parameters: { clearColor: [0, 0, 0, 0] },
          getTooltip: ({ object }) =>
            object && {
              text: `${object.kind ?? 'entity'} · ${object.id ?? ''}`,
            },
        });
        _preRenderRemove = viewer.scene.preRender.addEventListener(syncFrame);
        _ready = true;
        console.log('[Data:deck.gl] Overlay ready (GlobeView + camera sync)');
      } catch (error) {
        _loadError = error?.message || String(error);
        console.warn('[Data:deck.gl] Overlay unavailable:', _loadError);
      }
    },

    enable() {
      _enabled = true;
      if (_canvas) _canvas.style.display = '';
    },

    disable() {
      _enabled = false;
      if (_canvas) _canvas.style.display = 'none';
    },

    /** Feed live entity records; rebuilt into one scatter layer. */
    setEntities(records) {
      _data = recordsToDeckData(records);
      rebuildLayers();
    },

    /** Toggle the H3 hex-density aggregation overlay. */
    setH3Mode(enabled) {
      _h3Mode = Boolean(enabled);
      rebuildLayers();
    },

    get h3Mode() {
      return _h3Mode;
    },

    destroy() {
      _enabled = false;
      if (_preRenderRemove) {
        _preRenderRemove();
        _preRenderRemove = null;
      }
      if (_deck) {
        _deck.finalize();
        _deck = null;
      }
      if (_canvas?.parentElement) _canvas.parentElement.removeChild(_canvas);
      _canvas = null;
      _viewer = null;
      _data = [];
      _ready = false;
    },

    getStats() {
      return {
        ready: _ready,
        enabled: _enabled,
        h3Mode: _h3Mode,
        entityCount: _data.length,
        loadError: _loadError,
      };
    },
  };
  return layer;
}
