import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLiveNowMarkers,
  selectTopMarkers,
  eventToDeckDatum,
  liveNowScatterProps,
  liveNowOverlayEntry,
  pulseRadiusMeters,
  severityColor,
  LIVENOW_MARKER_LIMIT,
  LIVENOW_OVERLAY_SOURCE_ID,
  MARKER_PULSE_PERIOD_SEC,
} from './markers.js';

function event(id, overrides = {}) {
  return {
    id,
    type: 'quake',
    title: `Event ${id}`,
    lat: 10 + Number(id.slice(1)) || 10,
    lon: 20,
    severity: 3,
    confidence: 'verified',
    score: 50,
    ...overrides,
  };
}

/** Fake Cesium namespace: only what the marker layer touches. */
function fakeCesium() {
  const added = [];
  const removedAll = { count: 0 };
  const entities = {
    add: (entity) => {
      added.push(entity);
      return entity;
    },
    removeAll: () => {
      removedAll.count += 1;
      added.length = 0;
    },
  };
  class CustomDataSource {
    constructor(name) {
      this.name = name;
      this.entities = entities;
      this.show = true;
    }
  }
  class CallbackProperty {
    constructor(fn) {
      this._fn = fn;
    }
    getValue(time) {
      return this._fn(time);
    }
  }
  const toDate = (time) => new Date(time.epochMs);
  return {
    added,
    removedAll,
    CustomDataSource,
    CallbackProperty,
    Cartesian3: { fromDegrees: (lon, lat) => ({ lon, lat, x: lon, y: lat, z: 0 }) },
    JulianDate: { toDate },
    Color: {
      fromCssColorString: () => ({
        withAlpha: (a) => ({ css: 'color', alpha: a }),
      }),
    },
  };
}

/** Fake world-overlay host: records published chips and visibility. */
function fakeHost() {
  return {
    entries: [],
    visible: new Map(),
    cleared: [],
    setEntries(sourceId, entries) {
      assert.equal(sourceId, LIVENOW_OVERLAY_SOURCE_ID);
      this.entries = entries;
    },
    setVisible(sourceId, visible) {
      assert.equal(sourceId, LIVENOW_OVERLAY_SOURCE_ID);
      this.visible.set(sourceId, visible);
    },
    clearSource(sourceId) {
      assert.equal(sourceId, LIVENOW_OVERLAY_SOURCE_ID);
      this.cleared.push(sourceId);
      this.entries = [];
    },
  };
}

function fakeViewer() {
  const sources = [];
  return {
    dataSources: {
      add: (ds) => sources.push(ds),
      remove: (ds) => {
        const i = sources.indexOf(ds);
        if (i >= 0) sources.splice(i, 1);
      },
      get length() {
        return sources.length;
      },
    },
  };
}

test('selectTopMarkers: top-5 by score, bad coordinates dropped', () => {
  const events = [
    event('e1', { score: 10 }),
    event('e2', { score: 90 }),
    event('e3', { score: 50, lat: 999 }), // bad lat
    event('e4', { score: 80 }),
    event('e5', { score: 70 }),
    event('e6', { score: 60 }),
    event('e7', { score: 40 }),
    event('e8', { score: 95, lon: 999 }), // bad lon
  ];
  const top = selectTopMarkers(events);
  assert.equal(top.length, LIVENOW_MARKER_LIMIT);
  assert.deepEqual(
    top.map((e) => e.id),
    ['e2', 'e4', 'e5', 'e6', 'e7'],
  );
  assert.equal(selectTopMarkers([], 5).length, 0);
  assert.equal(selectTopMarkers(null).length, 0);
});

test('severityColor pairs every severity with a color', () => {
  for (const sev of [1, 2, 3, 4, 5]) {
    assert.match(severityColor(sev), /^#[0-9a-f]{6}$/);
  }
  assert.equal(severityColor(99), severityColor(1), 'unknown falls back');
});

test('eventToDeckDatum matches the sprint entity-bridge shape', () => {
  const datum = eventToDeckDatum(event('e1', { severity: 5 }));
  assert.equal(datum.id, 'livenow:e1');
  assert.equal(datum.kind, 'livenow');
  assert.deepEqual(datum.position.slice(0, 2), [20, datum.position[1]]);
  assert.equal(datum.fillColor.length, 4, 'RGBA array');
  assert.equal(eventToDeckDatum(event('bad', { lat: 999 })), null);
});

test('liveNowScatterProps follows the entityScatterProps convention', () => {
  const data = [eventToDeckDatum(event('e1', { severity: 5 }))];
  const props = liveNowScatterProps(data);
  assert.equal(props.id, 'livenow-markers');
  assert.equal(typeof props.getPosition, 'function');
  assert.equal(typeof props.getFillColor, 'function');
  assert.equal(typeof props.getRadius, 'function');
  assert.equal(props.radiusUnits, 'meters');
  const datum = { ...data[0], pulsePhase: 0 };
  const r1 = props.getRadius(datum);
  datum.pulsePhase = Math.PI / 2;
  const r2 = props.getRadius(datum);
  assert.notEqual(r1, r2, 'radius breathes with phase');
});

test('pulseRadiusMeters breathes over the pulse period', () => {
  const min = pulseRadiusMeters(5, 0);
  const mid = pulseRadiusMeters(5, MARKER_PULSE_PERIOD_SEC / 4);
  const end = pulseRadiusMeters(5, MARKER_PULSE_PERIOD_SEC);
  assert.ok(mid > min, 'radius grows mid-period');
  assert.ok(Math.abs(end - min) < 1e-6, 'period closes the loop');
  assert.ok(
    pulseRadiusMeters(5, 0) > pulseRadiusMeters(1, 0),
    'severity scales the base radius',
  );
});

test('liveNowOverlayEntry: severity chip on the overlay host, never color alone', () => {
  const entry = liveNowOverlayEntry(event('e1', { severity: 5 }), {
    position: { x: 20, y: 11, z: 0 },
  });
  assert.equal(entry.id, 'livenow:e1');
  assert.equal(entry.variant, 'label');
  assert.equal(entry.title, 'S5', 'severity text chip (not color alone)');
  assert.equal(entry.accent, severityColor(5));
  assert.match(entry.accessibilityLabel, /Event e1/);
  assert.equal(
    liveNowOverlayEntry(event('bad', { lat: 999 }), {
      position: { x: 0, y: 0, z: 0 },
    }),
    null,
  );
  assert.equal(liveNowOverlayEntry(event('e1')), null, 'anchor required');
});

test('createLiveNowMarkers updates, pulses, chips, and disposes', () => {
  const Cesium = fakeCesium();
  const viewer = fakeViewer();
  const host = fakeHost();
  const markers = createLiveNowMarkers({ viewer, Cesium, host });
  assert.equal(viewer.dataSources.length, 1);

  const events = [];
  for (let i = 0; i < 8; i++) events.push(event(`e${i}`, { score: 90 - i }));
  const count = markers.update(events);
  assert.equal(count, 5);
  assert.equal(markers.count, 5);
  assert.equal(Cesium.added.length, 5);

  // Entities carry the pulsing ellipse only — no Cesium label graphics.
  const first = Cesium.added[0];
  assert.equal(first.label, undefined);
  const r0 = first.ellipse.semiMajorAxis.getValue({ epochMs: 0 });
  const r1 = first.ellipse.semiMajorAxis.getValue({
    epochMs: (MARKER_PULSE_PERIOD_SEC / 4) * 1000,
  });
  assert.ok(r1 > r0, 'marker pulses');

  // Severity chips live on the world-overlay host, same anchor as the entity.
  assert.equal(host.entries.length, 5);
  assert.equal(host.entries[0].title, 'S3', 'severity text chip');
  assert.equal(host.entries[0].position, first.position);
  assert.equal(host.visible.get(LIVENOW_OVERLAY_SOURCE_ID), true);

  markers.setVisible(false);
  assert.equal(
    viewer.dataSources.length,
    1,
    'data source retained while hidden',
  );
  assert.equal(host.visible.get(LIVENOW_OVERLAY_SOURCE_ID), false);
  markers.clear();
  assert.equal(markers.count, 0);
  assert.deepEqual(host.entries, []);
  assert.deepEqual(host.cleared, [LIVENOW_OVERLAY_SOURCE_ID]);
  markers.dispose();
  assert.equal(viewer.dataSources.length, 0);
});

test('createLiveNowMarkers validates its inputs', () => {
  const Cesium = fakeCesium();
  assert.throws(() => createLiveNowMarkers({ viewer: null, Cesium }), /viewer/);
  assert.throws(
    () => createLiveNowMarkers({ viewer: fakeViewer(), Cesium: null }),
    /Cesium/,
  );
});
