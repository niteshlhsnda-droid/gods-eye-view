/**
 * Live Now globe markers — the top-5 ranked events as pulsing markers.
 *
 * Marker registration follows the pattern the wired layers use (the
 * earthquakes layer's Cesium `CustomDataSource`): one data source owned by
 * this module, pulsing ellipse entities whose radius breathes on a
 * `CallbackProperty`. Severity is shown as color + an `S1..S5` text chip
 * (never color alone) — the chip is a `label`-variant entry on the shared
 * world-overlay host, never a Cesium entity label graphic
 * (see `src/noCesiumLabels.test.mjs`).
 *
 * The sprint's deck.gl/H3 GPU layer (`src/layers/deckgl`) is not wired into
 * the application yet, so there is no live deck.gl host to register with.
 * `eventToDeckDatum` / `liveNowScatterProps` map Live Now events into the
 * sprint's deck.gl entity-bridge shape (`entityToDatum` /
 * `entityScatterProps` convention in `src/layers/deckgl/entities.js`) so the
 * markers drop into that GPU layer unchanged once it is wired; the visible
 * rendering path today is the Cesium entity layer below plus the overlay
 * host. Cesium itself is injected (`{ viewer, Cesium }`) — never statically
 * imported — so this module stays unit-testable in Node and free of
 * platform singletons.
 */

import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

export const LIVENOW_MARKER_SOURCE_ID = 'livenow';
export const LIVENOW_MARKER_LIMIT = 5;

/** Severity accent colors (paired with an S1..S5 text label, never color alone). */
export const SEVERITY_COLORS = Object.freeze({
  1: '#38bdf8',
  2: '#a3e635',
  3: '#facc15',
  4: '#fb923c',
  5: '#f87171',
});

export const MARKER_PULSE_PERIOD_SEC = 2.4;

export function severityColor(severity) {
  return SEVERITY_COLORS[severity] ?? SEVERITY_COLORS[1];
}

/** Overlay source id: the chips share the marker layer's source id. */
export const LIVENOW_OVERLAY_SOURCE_ID = LIVENOW_MARKER_SOURCE_ID;

const LIVENOW_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * One severity chip for the shared world-overlay host: the `S1..S5` text
 * that used to be a Cesium entity label graphic, drawn by the host above
 * the pulsing ellipse. `position` is the same Cartesian3 anchor as the
 * entity, so chip and pulse stay co-located.
 * @param {object} event LiveEvent with id, lat, lon, severity, title.
 * @param {{position:object}} options Cartesian3 anchor from the caller.
 * @returns {?object} Overlay entry, or null for bad coordinates/anchor.
 */
export function liveNowOverlayEntry(event, { position } = {}) {
  if (!validCoords(event) || !position) return null;
  const severity = Number(event.severity) || 1;
  return {
    id: `livenow:${event.id}`,
    position,
    variant: 'label',
    title: `S${severity}`,
    details: [],
    accent: severityColor(severity),
    priority: severity,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
    accessibilityLabel: `Live Now event, severity ${severity}: ${event.title ?? ''}`,
  };
}

function validCoords(event) {
  return (
    Number.isFinite(event?.lat) &&
    Math.abs(event.lat) <= 90 &&
    Number.isFinite(event?.lon) &&
    Math.abs(event.lon) <= 180
  );
}

function scoreOf(event) {
  return Number.isFinite(event?.score) ? event.score : 0;
}

/**
 * Top-N marker candidates: ranked by score desc, stable id tiebreak,
 * malformed coordinates dropped.
 */
export function selectTopMarkers(events, limit = LIVENOW_MARKER_LIMIT) {
  const n = Math.max(0, Math.floor(Number(limit) || 0));
  if (!Array.isArray(events) || n === 0) return [];
  return events
    .filter(validCoords)
    .slice()
    .sort(
      (a, b) =>
        scoreOf(b) - scoreOf(a) || String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, n);
}

function hexToRgba(hex) {
  const clean = String(hex).replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return [200, 200, 200, 230];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 230];
}

/**
 * Map a LiveEvent to a deck.gl entity-bridge datum (the
 * `src/layers/deckgl/entities.js` shape: `{id, kind, position, fillColor}`),
 * so Live Now markers are drop-in data for the sprint's GPU scatter layer.
 */
export function eventToDeckDatum(event) {
  if (!validCoords(event)) return null;
  return {
    id: `livenow:${event.id}`,
    kind: 'livenow',
    position: [event.lon, event.lat, 0],
    fillColor: hexToRgba(severityColor(event.severity)),
    severity: event.severity,
    title: event.title ?? '',
  };
}

/**
 * deck.gl ScatterplotLayer props for Live Now markers, following the
 * `entityScatterProps` convention. Radius breathes with each datum's
 * `pulsePhase` (updated by the animation driver); severity scales the base.
 */
export function liveNowScatterProps(data, { id = 'livenow-markers' } = {}) {
  const safe = Array.isArray(data) ? data : [];
  return {
    id,
    data: safe,
    pickable: true,
    getPosition: (d) => d.position,
    getFillColor: (d) => d.fillColor,
    getRadius: (d) => {
      const base = 60000 + (Number(d?.severity) || 1) * 25000;
      const phase = Number(d?.pulsePhase) || 0;
      return base * (1 + 0.35 * (0.5 + 0.5 * Math.sin(phase)));
    },
    radiusUnits: 'meters',
    radiusMinPixels: 4,
    radiusMaxPixels: 48,
    stroked: true,
    filled: true,
    parameters: { depthTest: false },
  };
}

/** Pulse radius in meters for a severity at animation time t (seconds). */
export function pulseRadiusMeters(severity, tSec, phase = 0) {
  const base = 60000 + (Number(severity) || 1) * 25000;
  const wave =
    0.5 +
    0.5 * Math.sin(phase + (tSec * 2 * Math.PI) / MARKER_PULSE_PERIOD_SEC);
  return base * (1 + 0.35 * wave);
}

/**
 * Own the Live Now marker layer on a Cesium viewer, plus its severity
 * chips on the shared world-overlay host.
 *
 * @param {Object} options
 * @param {Object} options.viewer Cesium Viewer (only `dataSources` is used).
 * @param {Object} options.Cesium The Cesium namespace (injected).
 * @param {(event:Object)=>void} [options.onActivate] Card-open hook for clicks.
 * @param {Object} [options.host] Overlay host
 *   (`{ setEntries, setVisible, clearSource }`); defaults to the real
 *   world-overlay host. Injectable so unit tests never touch the DOM.
 */
export function createLiveNowMarkers({
  viewer,
  Cesium,
  onActivate = () => {},
  host = LIVENOW_OVERLAY_HOST,
} = {}) {
  if (!viewer?.dataSources)
    throw new TypeError('LiveNowMarkers requires a viewer with dataSources');
  if (!Cesium)
    throw new TypeError('LiveNowMarkers requires the Cesium namespace');

  const dataSource = new Cesium.CustomDataSource(LIVENOW_MARKER_SOURCE_ID);
  viewer.dataSources.add(dataSource);
  let _visible = true;
  let _count = 0;

  function update(events) {
    dataSource.entities.removeAll();
    const selected = selectTopMarkers(events, LIVENOW_MARKER_LIMIT);
    const entries = [];
    selected.forEach((event, index) => {
      const color = severityColor(event.severity);
      const phase = (index / Math.max(1, selected.length)) * 2 * Math.PI;
      const position = Cesium.Cartesian3.fromDegrees(event.lon, event.lat, 0);
      dataSource.entities.add({
        id: `livenow:${event.id}`,
        name: event.title,
        position,
        ellipse: {
          semiMinorAxis: new Cesium.CallbackProperty(
            (time) =>
              pulseRadiusMeters(
                event.severity,
                Cesium.JulianDate.toDate(time).getTime() / 1000,
                phase,
              ),
            false,
          ),
          semiMajorAxis: new Cesium.CallbackProperty(
            (time) =>
              pulseRadiusMeters(
                event.severity,
                Cesium.JulianDate.toDate(time).getTime() / 1000,
                phase,
              ),
            false,
          ),
          material: Cesium.Color.fromCssColorString(color).withAlpha(0.45),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.95),
          outlineWidth: 2,
          height: 0,
        },
      });
      const entry = liveNowOverlayEntry(event, { position });
      if (entry) entries.push(entry);
    });
    _count = selected.length;
    dataSource.show = _visible;
    host.setVisible(LIVENOW_OVERLAY_SOURCE_ID, _visible);
    host.setEntries(LIVENOW_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: LIVENOW_MARKER_LIMIT,
      collisionCapacity: LIVENOW_MARKER_LIMIT,
      moving: false,
    });
    return _count;
  }

  // Click-through: the shell wires viewer.selectedEntityChanged if desired.
  // Kept minimal here; the panel carousel is the primary interaction surface.
  void onActivate;

  return {
    update,
    setVisible(visible) {
      _visible = Boolean(visible);
      dataSource.show = _visible;
      host.setVisible(LIVENOW_OVERLAY_SOURCE_ID, _visible);
    },
    clear() {
      dataSource.entities.removeAll();
      host.clearSource(LIVENOW_OVERLAY_SOURCE_ID);
      host.setVisible(LIVENOW_OVERLAY_SOURCE_ID, false);
      _count = 0;
    },
    get count() {
      return _count;
    },
    get sourceId() {
      return LIVENOW_MARKER_SOURCE_ID;
    },
    dispose() {
      dataSource.entities.removeAll();
      host.clearSource(LIVENOW_OVERLAY_SOURCE_ID);
      host.setVisible(LIVENOW_OVERLAY_SOURCE_ID, false);
      viewer.dataSources.remove(dataSource);
      _count = 0;
    },
  };
}
