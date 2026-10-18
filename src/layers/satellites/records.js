import * as Cesium from 'cesium';
import { satelliteClassLabel } from '../../data/satelliteClass.js';
import { satellitePredictionLabel } from '../../sources/tle.js';
import { ISS_NORAD } from './policy.js';

/**
 * Map one CelesTrak catalog satellite to a JSON-safe analyst record
 * (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. `id` is the display name (same
 * convention as vessels); `noradId` is the track_entity key.
 * `tleLine1` (when supplied) feeds `positionLabel`: every satellite
 * position is an SGP4 prediction from that element set, never a live
 * observation, so the record always says so.
 * @param {Object|null|undefined} raw - {noradId, name, group, lat, lon, altitudeM, speedMps, tleLine1}.
 * @param {{nowMs?: number}} [options] - Clock for the prediction label.
 * @returns {{id: string, noradId: string|null, name: string|null,
 *   lat: number|null, lon: number|null, altitudeM: number|null,
 *   speedMps: number|null, satelliteClass: string|null, group: string|null,
 *   positionKind: string, positionLabel: string}}
 */
export function mapAnalystRecord(raw, { nowMs = Date.now() } = {}) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const noradNum =
    raw?.noradId == null || raw.noradId === '' ? NaN : Number(raw.noradId);
  const noradId = Number.isFinite(noradNum)
    ? String(Math.trunc(noradNum))
    : text(raw?.noradId);
  const name = text(raw?.name);
  const group = text(raw?.group);
  const isIss = noradNum === ISS_NORAD;
  return {
    id: name || (noradId ? `SAT-${noradId}` : 'SAT-00000'),
    noradId,
    name,
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    altitudeM: num(raw?.altitudeM),
    speedMps: num(raw?.speedMps),
    // Empty records stay class-less; the class table's fallback is VISUAL and
    // must not leak onto a row that has no satellite identity.
    satelliteClass:
      noradId || group ? satelliteClassLabel(group, { isIss }) : null,
    group,
    // Positions are SGP4 predictions, never live observations — the kind
    // is constant so consumers can filter on it, and the label carries
    // the TLE age the prediction was propagated from (unknown when the
    // element set was not supplied, e.g. a hand-built record).
    positionKind: 'predicted',
    positionLabel: satellitePredictionLabel(raw?.tleLine1, { nowMs }),
  };
}

/** Create on-demand analyst snapshots owned by one layer instance. */
export function createRecords({ state, parts }) {
  function analystGeo(noradId, sat, now) {
    const pos = sat?.satrec
      ? parts.orbits.propagatePosition(sat.satrec, now)
      : null;
    if (
      pos &&
      Number.isFinite(pos.latitude) &&
      Number.isFinite(pos.longitude)
    ) {
      return {
        lat: pos.latitude,
        lon: pos.longitude,
        altitudeM: pos.altitude,
        speedMps: Number.isFinite(pos.speedMps) ? pos.speedMps : null,
      };
    }
    const point = state._points.get(noradId);
    if (!point?.position) return null;
    const carto = Cesium.Cartographic.fromCartesian(point.position);
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      altitudeM: carto.height,
      speedMps: null,
    };
  }

  function getAnalystRecords(maxCount = 2000) {
    if (!state._enabled || !state._catalog.size) return [];
    const limit = Number.isFinite(maxCount)
      ? Math.max(1, Math.floor(maxCount))
      : 2000;
    const now = new Date();
    const result = [];
    const emit = (noradId, sat) => {
      if (result.length >= limit) return false;
      const pos = analystGeo(noradId, sat, now);
      if (!pos) return true;
      result.push(
        mapAnalystRecord(
          {
            noradId,
            name: sat?.name,
            group: sat?.group,
            lat: pos.lat,
            lon: pos.lon,
            altitudeM: pos.altitudeM,
            speedMps: pos.speedMps,
            tleLine1: sat?.line1,
          },
          { nowMs: now.getTime() },
        ),
      );
      return result.length < limit;
    };
    for (const [noradId, sat] of state._catalog) {
      if (sat?.group === 'dense') continue;
      if (!emit(noradId, sat)) break;
    }
    if (result.length < limit) {
      for (const [noradId, sat] of state._catalog) {
        if (sat?.group !== 'dense') continue;
        if (!emit(noradId, sat)) break;
      }
    }
    return result;
  }
  return { getAnalystRecords };
}
