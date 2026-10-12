import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraHeightToDeckZoom,
  cesiumPitchToDeckPitch,
  cesiumHeadingToDeckBearing,
  deckViewStateFromCamera,
  syncDeckView,
} from './overlay.js';
import {
  entityToDatum,
  recordsToDeckData,
  entityScatterProps,
  ENTITY_COLORS,
} from './entities.js';
import {
  resolutionForAltitude,
  clampResolution,
  aggregateToH3,
  densityFillColor,
  h3HexagonProps,
} from './h3density.js';

describe('overlay camera math', () => {
  it('derives zoom from height: higher camera -> lower zoom', () => {
    const near = cameraHeightToDeckZoom(100_000, 900);
    const far = cameraHeightToDeckZoom(20_000_000, 900);
    assert.ok(near > far, `near=${near} far=${far}`);
    assert.ok(near >= 0 && near <= 20 && far >= 0 && far <= 20);
  });

  it('maps Cesium pitch -90deg (nadir) to deck pitch 0', () => {
    assert.equal(cesiumPitchToDeckPitch(-Math.PI / 2), 0);
    assert.equal(cesiumPitchToDeckPitch(0), 60); // horizon clamps to GlobeView maxPitch
    assert.equal(cesiumPitchToDeckPitch(-Math.PI / 4), 45);
  });

  it('normalizes heading to a 0-360 bearing', () => {
    assert.equal(cesiumHeadingToDeckBearing(Math.PI), 180);
    assert.equal(cesiumHeadingToDeckBearing(-Math.PI / 2), 270);
    assert.equal(cesiumHeadingToDeckBearing(3 * Math.PI), 180);
  });

  it('builds a complete viewState and pushes it into Deck', () => {
    const calls = [];
    const deck = { setProps: (p) => calls.push(p) };
    const ok = syncDeckView(deck, {
      lonDeg: 85.1,
      latDeg: 25.6,
      heightM: 2_000_000,
      headingRad: 0,
      pitchRad: -Math.PI / 3,
      viewportHeightPx: 900,
    });
    assert.equal(ok, true);
    const vs = calls[0].viewState;
    assert.equal(vs.longitude, 85.1);
    assert.equal(vs.latitude, 25.6);
    assert.equal(vs.bearing, 0);
    assert.ok(Math.abs(vs.pitch - 30) < 1e-9, `pitch=${vs.pitch}`);
    assert.ok(Number.isFinite(vs.zoom));
    assert.equal(syncDeckView(null, {}), false);
  });

  it('deckViewStateFromCamera is pure', () => {
    const a = deckViewStateFromCamera({
      lonDeg: 0,
      latDeg: 0,
      heightM: 1e6,
      headingRad: 1,
      pitchRad: -1,
      viewportHeightPx: 800,
    });
    const b = deckViewStateFromCamera({
      lonDeg: 0,
      latDeg: 0,
      heightM: 1e6,
      headingRad: 1,
      pitchRad: -1,
      viewportHeightPx: 800,
    });
    assert.deepEqual(a, b);
  });
});

describe('entity mapping', () => {
  it('maps records to deck data with per-kind colors', () => {
    const data = recordsToDeckData([
      { id: 'a1', kind: 'aircraft', lat: 25.6, lon: 85.1, altM: 10000 },
      { id: 'v1', kind: 'vessel', lat: 20, lon: 80, altitude: 0 },
      { id: 'bad', kind: 'aircraft', lat: NaN, lon: 80 },
      null,
    ]);
    assert.equal(data.length, 2);
    assert.deepEqual(data[0].position, [85.1, 25.6, 10000]);
    assert.deepEqual(data[0].fillColor, ENTITY_COLORS.aircraft);
    assert.deepEqual(data[1].fillColor, ENTITY_COLORS.vessel);
  });

  it('falls back to the default color for unknown kinds', () => {
    const d = entityToDatum({ lat: 0, lon: 0, kind: 'ufo' });
    assert.deepEqual(d.fillColor, ENTITY_COLORS.default);
  });

  it('builds scatter props', () => {
    const props = entityScatterProps([{ position: [0, 0, 0] }]);
    assert.equal(props.radiusUnits, 'meters');
    assert.equal(typeof props.getPosition, 'function');
  });
});

describe('H3 aggregation', () => {
  // Minimal h3-js stub: deterministic cell keys from rounded coords.
  const stubH3 = {
    latLngToCell: (lat, lon, res) => `cell:${res}:${lat.toFixed(1)}:${lon.toFixed(1)}`,
    cellToBoundary: (cell) => {
      const [, , lat, lon] = cell.split(':');
      const la = Number(lat);
      const lo = Number(lon);
      return [
        [la - 0.05, lo - 0.05],
        [la - 0.05, lo + 0.05],
        [la + 0.05, lo + 0.05],
        [la + 0.05, lo - 0.05],
      ];
    },
  };

  it('resolves resolution from altitude bands', () => {
    assert.equal(resolutionForAltitude(20_000_000), 2);
    assert.equal(resolutionForAltitude(6_000_000), 3);
    assert.equal(resolutionForAltitude(2_000_000), 4);
    assert.equal(resolutionForAltitude(500_000), 5);
    assert.equal(resolutionForAltitude(10_000), 6);
    assert.equal(resolutionForAltitude(NaN), 3);
  });

  it('clamps resolutions into 2..6', () => {
    assert.equal(clampResolution(0), 2);
    assert.equal(clampResolution(15), 6);
    assert.equal(clampResolution('nope'), 3);
  });

  it('aggregates data into counted cells with deck polygons', () => {
    const data = recordsToDeckData([
      { lat: 25.61, lon: 85.11 },
      { lat: 25.62, lon: 85.12 },
      { lat: 40.0, lon: -74.0 },
    ]);
    const cells = aggregateToH3(data, stubH3, 4);
    assert.equal(cells.length, 2);
    assert.equal(cells[0].count, 2);
    assert.equal(cells[1].count, 1);
    // polygon rings are [lng, lat] closed rings
    const ring = cells[0].polygon[0];
    assert.equal(ring.length, 5);
    assert.deepEqual(ring[0], ring[4]);
    assert.ok(Math.abs(ring[0][0] - 85.1) < 0.2);
  });

  it('throws without an h3 API', () => {
    assert.throws(() => aggregateToH3([], null, 4), TypeError);
  });

  it('ramps density colors with count', () => {
    const low = densityFillColor(1, 100);
    const high = densityFillColor(100, 100);
    assert.ok(high[0] > low[0]);
    assert.ok(high[3] >= low[3]);
    const props = h3HexagonProps([
      { hex: 'a', count: 2, polygon: [] },
      { hex: 'b', count: 5, polygon: [] },
    ]);
    assert.equal(props.getHexagon({ hex: 'a' }), 'a');
    assert.equal(props.data.length, 2);
  });
});
