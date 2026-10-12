import * as Cesium from 'cesium';
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';
import {
  DEBRIS_GROUPS,
  DEBRIS_PROPAGATE_MS,
  DEBRIS_POINT_PIXEL_SIZE,
  DEBRIS_POINT_ALPHA,
  DEBRIS_TLE_MAX_AGE_MS,
} from './policy.js';
import {
  normalizeDebrisCatalog,
  dedupeDebrisRecords,
  debrisFreshness,
} from './records.js';

export { createDebrisSource } from './source.js';
export {
  DEBRIS_GROUPS,
  DEBRIS_PROPAGATE_MS,
  DEBRIS_TLE_MAX_AGE_MS,
} from './policy.js';
export {
  normalizeDebrisCatalog,
  dedupeDebrisRecords,
  debrisFreshness,
} from './records.js';

/** Propagate one satrec to a geodetic position at `date`, or null on error. */
function propagateGeodetic(satrec, date) {
  try {
    const posVel = propagate(satrec, date);
    if (!posVel.position || typeof posVel.position === 'boolean') return null;
    const geo = eciToGeodetic(posVel.position, gstime(date));
    return {
      longitude: degreesLong(geo.longitude),
      latitude: degreesLat(geo.latitude),
      altitude: geo.height * 1000, // km -> m
    };
  } catch {
    return null;
  }
}

/** Own the orbital-debris point field and its TLE refresh lifecycle. */
export function createDebrisLayer({ source } = {}) {
  if (typeof source?.readGroup !== 'function')
    throw new TypeError('A debris source is required');

  let _viewer = null;
  let _pointCollection = null;
  let _satrecs = new Map(); // noradId -> { satrec, name, group }
  let _timer = null;
  let _request = null;
  let _enabled = false;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _freshness = null;

  function propagateAll(date = new Date()) {
    if (!_pointCollection) return;
    for (const entry of _entries) {
      const geo = propagateGeodetic(entry.satrec, date);
      if (!geo) continue;
      entry.point.position = Cesium.Cartesian3.fromDegrees(
        geo.longitude,
        geo.latitude,
        geo.altitude,
      );
    }
  }

  const _entries = []; // { noradId, satrec, point }

  const layer = {
    id: 'debris',
    name: 'Orbital Debris',
    icon: '☄️',
    source: 'CelesTrak',
    updateInterval: 30 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error('Debris layer is already initialized');
      _viewer = viewer;
      _pointCollection = new Cesium.PointPrimitiveCollection();
      _pointCollection.show = false;
      viewer.scene.primitives.add(_pointCollection);
      console.log('[Data:Debris] Initialized');
    },

    enable() {
      _enabled = true;
      if (_pointCollection) _pointCollection.show = true;
      if (!_timer) {
        _timer = setInterval(() => {
          if (_enabled) propagateAll();
        }, DEBRIS_PROPAGATE_MS);
      }
    },

    disable() {
      _enabled = false;
      if (_timer) {
        clearInterval(_timer);
        _timer = null;
      }
      _request?.abort();
      _request = null;
      if (_pointCollection) _pointCollection.show = false;
    },

    async update() {
      if (!_enabled || !_pointCollection) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const results = await Promise.all(
          DEBRIS_GROUPS.map(async (groupDef) => {
            try {
              const res = await source.readGroup(groupDef.path, {
                signal: request.signal,
              });
              if (!res.ok) return { ...groupDef, records: [], ok: false };
              const records = normalizeDebrisCatalog(res.text, {
                group: groupDef.tag,
              });
              request.signal.throwIfAborted();
              return { ...groupDef, records, ok: records.length > 0 };
            } catch (error) {
              if (request.signal.aborted || error?.name === 'AbortError')
                throw error;
              return { ...groupDef, records: [], ok: false };
            }
          }),
        );
        request.signal.throwIfAborted();

        const failed = results.filter((r) => !r.ok).map((r) => r.path);
        if (results.every((r) => !r.ok)) {
          _lastError = 'CelesTrak debris groups unreachable';
          console.warn(
            '[Data:Debris] All debris groups failed — keeping existing field',
          );
          return false;
        }
        _lastError = failed.length
          ? `${failed.length} debris group(s) unavailable`
          : null;

        const combined = dedupeDebrisRecords(results.flatMap((r) => r.records));
        const now = new Date();
        const color = Cesium.Color.fromBytes(
          255,
          140,
          60,
          Math.round(255 * DEBRIS_POINT_ALPHA),
        );

        _pointCollection.removeAll();
        _entries.length = 0;
        _satrecs = new Map();
        let kept = 0;
        for (const record of combined) {
          const satrec = twoline2satrec(record.line1, record.line2);
          if (!satrec || satrec.error !== 0) continue;
          const geo = propagateGeodetic(satrec, now);
          if (!geo) continue;
          const point = _pointCollection.add({
            position: Cesium.Cartesian3.fromDegrees(
              geo.longitude,
              geo.latitude,
              geo.altitude,
            ),
            pixelSize: DEBRIS_POINT_PIXEL_SIZE,
            color,
            id: record.noradId,
          });
          _entries.push({ noradId: record.noradId, satrec, point });
          _satrecs.set(record.noradId, {
            satrec,
            name: record.name,
            group: record.group,
          });
          kept += 1;
        }

        _freshness = debrisFreshness(combined, {
          maxAgeMs: DEBRIS_TLE_MAX_AGE_MS,
          nowMs: now.getTime(),
        });
        _count = kept;
        _lastUpdate = Date.now();
        console.log(
          `[Data:Debris] ${_count} debris objects tracked (${results.map((r) => `${r.tag}:${r.records.length}`).join(' ')})`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || e?.name === 'AbortError') return false;
        console.warn('[Data:Debris] Fetch error:', e);
        _lastError = e?.message || 'Debris source unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy() {
      _request?.abort();
      _request = null;
      if (_timer) {
        clearInterval(_timer);
        _timer = null;
      }
      _enabled = false;
      if (_pointCollection && _viewer) {
        _viewer.scene.primitives.remove(_pointCollection);
        _pointCollection = null;
      }
      _entries.length = 0;
      _satrecs = new Map();
      _viewer = null;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _freshness = null;
    },

    /** Plain-object debris records for the analyst query engine. */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || _satrecs.size === 0) return [];
      const now = new Date();
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const [noradId, { satrec, name, group }] of _satrecs) {
        if (result.length >= limit) break;
        const geo = propagateGeodetic(satrec, now);
        result.push({
          id: noradId,
          name,
          group,
          lat: geo ? geo.latitude : null,
          lon: geo ? geo.longitude : null,
          altKm: geo ? geo.altitude / 1000 : null,
        });
      }
      return result;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        freshness: _freshness,
      };
    },
  };
  return layer;
}
