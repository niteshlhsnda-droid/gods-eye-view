/**
 * Alert providers — pure detection logic for Alert Me.
 *
 * Quakes poll the same USGS feed the earthquakes layer uses; flyovers
 * propagate the satellites layer's TLE catalog with satellite.js. Cyclone
 * landfalls are a documented scaffold: there is no cyclone layer or feed in
 * the app yet, so the provider reports `not-configured` instead of faking
 * data. Push notifications are explicitly deferred (see index.js).
 */
import {
  twoline2satrec,
  propagate,
  eciToGeodetic,
  gstime,
  degreesLat,
  degreesLong,
} from 'satellite.js';

/** Default magnitude floor for quake alerts. */
export const DEFAULT_QUAKE_MIN_MAG = 5.0;
/** Default ground radius for "overhead" flyover alerts. */
export const DEFAULT_FLYOVER_RADIUS_KM = 1500;
/** Per-satellite cooldown between flyover alerts (one pass, one toast). */
export const FLYOVER_COOLDOWN_MS = 90 * 60 * 1000;

/**
 * Parse a 3-line TLE catalog (name / line1 / line2 triples, e.g. the
 * `/api/celestrak/stations` proxy response) into { name, tle1, tle2 } entries.
 * Incomplete or malformed triples are skipped rather than guessed.
 * @param {string} text
 * @returns {Array<{name: string, tle1: string, tle2: string}>}
 */
export function parseTleCatalog(text) {
  if (typeof text !== 'string') return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const entries = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (name.startsWith('1 ') || name.startsWith('2 ')) continue;
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
    entries.push({ name, tle1: line1, tle2: line2 });
  }
  return entries;
}

/**
 * Filter a USGS snapshot down to new, alert-worthy quakes.
 * @param {Array} rows Normalized quake rows ({ stableId, mag, place, lat, lon, depthKm, time }).
 * @param {object} [input]
 * @param {number} [input.minMag]
 * @param {Set<string>} [input.seenIds] Already-alerted stable ids.
 * @param {number} [input.sinceMs] Ignore events older than this epoch-ms.
 * @returns {{alerts: Array, seenIds: Set<string>}}
 */
export function filterNewQuakes(
  rows,
  { minMag = DEFAULT_QUAKE_MIN_MAG, seenIds = new Set(), sinceMs = 0 } = {},
) {
  const alerts = [];
  const nextSeen = new Set(seenIds);
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.stableId;
    if (typeof id !== 'string' || !id) continue;
    const mag = Number(row.mag);
    if (!Number.isFinite(mag) || mag < minMag) continue;
    const time = Number(row.time);
    if (Number.isFinite(time) && time < sinceMs) continue;
    if (nextSeen.has(id)) continue;
    nextSeen.add(id);
    alerts.push({
      id,
      mag,
      place: typeof row.place === 'string' ? row.place : 'unknown location',
      lat: row.lat,
      lon: row.lon,
      depthKm: row.depthKm ?? null,
      time: Number.isFinite(time) ? time : null,
    });
  }
  // Loudest first — the toast that matters most is on top.
  alerts.sort((a, b) => b.mag - a.mag);
  return { alerts, seenIds: nextSeen };
}

/**
 * Sub-satellite point for a TLE pair at a date. Null when propagation fails.
 * @returns {{lat: number, lon: number}|null}
 */
export function satelliteSubpoint(tle1, tle2, date = new Date()) {
  try {
    if (typeof tle1 !== 'string' || typeof tle2 !== 'string') return null;
    const satrec = twoline2satrec(tle1, tle2);
    const positionVelocity = propagate(satrec, date);
    if (!positionVelocity?.position) return null;
    const geodetic = eciToGeodetic(positionVelocity.position, gstime(date));
    const lat = degreesLat(geodetic.latitude);
    const lon = degreesLong(geodetic.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

/** Great-circle distance in kilometres. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * Which catalog satellites are currently within radiusKm of the target.
 * @param {object} input
 * @param {Array<{name: string, tle1: string, tle2: string}>} input.satellites
 * @param {{lat: number, lon: number}} input.target
 * @param {number} [input.radiusKm]
 * @param {Date} [input.date]
 * @returns {Array<{name: string, lat: number, lon: number, distanceKm: number}>}
 */
export function findFlyovers({
  satellites,
  target,
  radiusKm = DEFAULT_FLYOVER_RADIUS_KM,
  date = new Date(),
}) {
  const results = [];
  if (
    !Array.isArray(satellites) ||
    !Number.isFinite(target?.lat) ||
    !Number.isFinite(target?.lon)
  )
    return results;
  for (const satellite of satellites) {
    const subpoint = satelliteSubpoint(satellite.tle1, satellite.tle2, date);
    if (!subpoint) continue;
    const distanceKm = haversineKm(
      target.lat,
      target.lon,
      subpoint.lat,
      subpoint.lon,
    );
    if (distanceKm <= radiusKm) {
      results.push({
        name: String(satellite.name ?? 'Unknown satellite'),
        lat: subpoint.lat,
        lon: subpoint.lon,
        distanceKm: Math.round(distanceKm),
      });
    }
  }
  results.sort((a, b) => a.distanceKm - b.distanceKm);
  return results;
}

/**
 * Filter a cyclone snapshot down to newly-appeared active storms.
 * @param {Array} storms Validated storm rows from the cyclones layer source.
 * @param {object} [input]
 * @param {Set<string>} [input.seenIds] Already-alerted storm ids.
 * @returns {{alerts: Array, seenIds: Set<string>}}
 */
export function filterNewStorms(storms, { seenIds = new Set() } = {}) {
  const alerts = [];
  const nextSeen = new Set(seenIds);
  for (const storm of Array.isArray(storms) ? storms : []) {
    const id = storm?.id;
    // A storm needs a stable id AND a human name to alert on; anything else
    // is a malformed row, skipped rather than toasted as garbage.
    if (typeof id !== 'string' || !id || nextSeen.has(id)) continue;
    if (typeof storm.name !== 'string' || !storm.name.trim()) continue;
    nextSeen.add(id);
    alerts.push({
      id,
      name: storm.name,
      classification:
        typeof storm.classification === 'string'
          ? storm.classification
          : 'storm',
      basin: typeof storm.basin === 'string' ? storm.basin : null,
      windKt: Number.isFinite(storm.windKt) ? storm.windKt : null,
      lat: storm.position?.latitude ?? null,
      lon: storm.position?.longitude ?? null,
    });
  }
  return { alerts, seenIds: nextSeen };
}

/**
 * Cyclone-landfall provider, backed by the app's real cyclone layer source
 * (NHC active-storms via the same-origin /api/cyclones proxy). Alerts when a
 * NEW active storm appears — the earliest actionable landfall signal.
 * @param {object} [input]
 * @param {() => Promise<{storms: Array}>} [input.cycloneSource]
 */
export function createCycloneProvider({ cycloneSource = null } = {}) {
  return {
    kind: 'cyclones',
    status: typeof cycloneSource === 'function' ? 'active' : 'not-configured',
    reason:
      typeof cycloneSource === 'function'
        ? null
        : 'No cyclone source wired — pass the cyclones layer snapshot.',
    async check() {
      if (typeof cycloneSource !== 'function')
        return { alerts: [], note: 'cyclone provider not configured' };
      let snapshot;
      try {
        snapshot = await cycloneSource();
      } catch {
        return { alerts: [], note: 'cyclone feed unreachable' };
      }
      return { alerts: snapshot?.storms ?? [] };
    },
  };
}
