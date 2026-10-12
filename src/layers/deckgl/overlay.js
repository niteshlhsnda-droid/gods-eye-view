/**
 * deck.gl <-> Cesium overlay bridge.
 *
 * There is NO official deck.gl Cesium package (verified 2026-10-12: npm has
 * no `@deck.gl/cesium`; deck.gl's DeckRenderer lives in `@deck.gl/arcgis`).
 * The supported integration is a transparent deck.gl canvas layered over the
 * Cesium canvas, with a deck.gl GlobeView whose camera is synced from the
 * Cesium camera every frame. deck.gl renders data only — the Cesium globe
 * remains the basemap.
 */

export const DECK_FOV_DEG = 50;
// deck.gl default field of view, used to derive zoom from camera height.

export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export function clampDeckPitch(pitchDeg) {
  return Math.max(0, Math.min(60, pitchDeg));
}

/**
 * Approximate deck.gl zoom from camera height above the ellipsoid.
 * Derivation: deck.gl Web-Mercator scale gives pixels-per-meter =
 * 256 * 2^zoom / C at the equator; visible vertical meters at the camera
 * target ~= 2 * height * tan(fov/2). Solving for zoom matches the deck.gl
 * globe's apparent scale to the Cesium globe at the viewport center.
 * Approximation only — GlobeView is spherical while Cesium is ellipsoidal.
 */
export function cameraHeightToDeckZoom(
  heightM,
  viewportHeightPx,
  fovDeg = DECK_FOV_DEG,
) {
  const h = Math.max(1, Number(heightM));
  const px = Math.max(1, Number(viewportHeightPx));
  const visibleM = 2 * h * Math.tan((Number(fovDeg) * Math.PI) / 180 / 2);
  const pixelsPerMeter = px / visibleM;
  const zoom = Math.log2((pixelsPerMeter * EARTH_CIRCUMFERENCE_M) / 256);
  return Math.max(0, Math.min(20, zoom));
}

/** Cesium camera pitch (rad, -90deg = nadir) -> deck.gl pitch (0 = nadir). */
export function cesiumPitchToDeckPitch(pitchRad) {
  const deg = (Number(pitchRad) * 180) / Math.PI;
  return clampDeckPitch(90 + deg);
}

/** Cesium camera heading (rad, clockwise from north) -> deck.gl bearing (deg). */
export function cesiumHeadingToDeckBearing(headingRad) {
  const deg = (Number(headingRad) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/**
 * Build the deck.gl viewState from plain camera values.
 * @param {object} camera - { lonDeg, latDeg, heightM, headingRad, pitchRad, viewportHeightPx }
 */
export function deckViewStateFromCamera(camera) {
  return {
    longitude: camera.lonDeg,
    latitude: camera.latDeg,
    zoom: cameraHeightToDeckZoom(camera.heightM, camera.viewportHeightPx),
    bearing: cesiumHeadingToDeckBearing(camera.headingRad),
    pitch: cesiumPitchToDeckPitch(camera.pitchRad),
  };
}

/** Push a synced viewState into a Deck instance. */
export function syncDeckView(deck, camera) {
  if (!deck || typeof deck.setProps !== 'function') return false;
  deck.setProps({ viewState: deckViewStateFromCamera(camera) });
  return true;
}

/**
 * Create the transparent overlay canvas deck.gl renders into. The canvas is
 * absolutely positioned over the Cesium container and ignores pointer events
 * so Cesium keeps all input; picking is forwarded via deck.pickObject on
 * explicit clicks only (wired by the layer).
 */
export function createOverlayCanvas(container) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-deckgl-overlay', 'true');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '5';
  container.appendChild(canvas);
  return canvas;
}
