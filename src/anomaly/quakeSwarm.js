/**
 * Clean-room earthquake swarm detector.
 *
 * Clusters quake events that are close together in space AND time. A lone
 * quake — even a large one — is not a swarm; the signal is density: several
 * events within a radius and a time window. Greedy seed clustering: the first
 * (earliest) unclaimed event seeds a cluster, every event within `radiusKm`
 * of the seed and within `windowHrs` of it joins, then the seed's whole
 * cluster is claimed so each event belongs to exactly one reported swarm.
 *
 * Input quake contract (matches the app's normalized earthquake rows):
 *   { id?, mag, timeMs, lat, lon, depthKm?, place? }
 */

import { haversineDistanceM } from '../data/geoMath.js';

function formatPoint(lat, lon) {
  return (
    `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ` +
    `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`
  );
}

function validQuake(record) {
  return (
    record &&
    typeof record === 'object' &&
    Number.isFinite(record.lat) &&
    Number.isFinite(record.lon) &&
    // Range-check: haversineDistanceM throws on out-of-range coords, and
    // this detector must never throw on malformed input.
    record.lat >= -90 &&
    record.lat <= 90 &&
    record.lon >= -180 &&
    record.lon <= 180 &&
    Number.isFinite(record.mag) &&
    Number.isFinite(record.timeMs)
  );
}

/**
 * @param {Array<object>} quakes Quake records (see module contract).
 * @param {object} [options]
 * @param {number} [options.now] Detection timestamp (defaults to Date.now()).
 * @param {number} [options.radiusKm] Cluster radius (default 50 km).
 * @param {number} [options.windowHrs] Cluster time window (default 24 h).
 * @param {number} [options.minEvents] Minimum events to call it a swarm (default 6).
 * @returns {Array<object>} Anomaly events.
 */
export function detectQuakeSwarms(
  quakes = [],
  { now = Date.now(), radiusKm = 50, windowHrs = 24, minEvents = 6 } = {},
) {
  const rows = (quakes || [])
    .filter(validQuake)
    .sort((a, b) => a.timeMs - b.timeMs);
  const claimed = new Set();
  const events = [];
  const windowMs = windowHrs * 3600000;
  rows.forEach((seed, seedIndex) => {
    if (claimed.has(seedIndex)) return;
    const cluster = [seedIndex];
    rows.forEach((other, otherIndex) => {
      if (otherIndex === seedIndex || claimed.has(otherIndex)) return;
      if (
        Math.abs(other.timeMs - seed.timeMs) <= windowMs &&
        haversineDistanceM(seed.lat, seed.lon, other.lat, other.lon) / 1000 <=
          radiusKm
      ) {
        cluster.push(otherIndex);
      }
    });
    if (cluster.length < minEvents) return;
    for (const index of cluster) claimed.add(index);
    const members = cluster.map((index) => rows[index]);
    const maxMag = Math.max(...members.map((m) => m.mag));
    const centroidLat = members.reduce((n, m) => n + m.lat, 0) / members.length;
    const centroidLon = members.reduce((n, m) => n + m.lon, 0) / members.length;
    const place = String(seed.place || '').trim();
    const severity =
      maxMag >= 6.5 ? 'critical' : maxMag >= 5.5 ? 'high' : 'medium';
    events.push({
      id: `quake-swarm-${Math.round(centroidLat * 100)}-${Math.round(centroidLon * 100)}-${seed.timeMs}`,
      type: 'quake-swarm',
      severity,
      title: `Quake swarm — ${members.length} events near ${place || formatPoint(centroidLat, centroidLon)}`,
      detail:
        `${members.length} earthquakes within ${radiusKm} km over ` +
        `${windowHrs} hours, largest M${maxMag.toFixed(1)}. ` +
        `Centroid ${formatPoint(centroidLat, centroidLon)}.`,
      detectedAtMs: now,
      ref: {
        count: members.length,
        maxMag,
        centroidLat,
        centroidLon,
        memberIds: members.map((m) => m.id ?? null),
      },
    });
  });
  return events;
}
