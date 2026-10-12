/**
 * Time-rewind history source: USGS event-history snapshots.
 *
 * Uses the public USGS FDSN Event Web Service to fetch the recent significant
 * earthquake history (default: last 30 days, M5+) and normalizes it with the
 * existing earthquake layer's snapshot validator — the same rows the live
 * layer renders, now over a historical window.
 */

import { normalizeEarthquakeSnapshot } from '../layers/earthquakes/records.js';

const FDSN_ENDPOINT = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const DAY_MS = 86_400_000;
export const HISTORY_DEFAULT_DAYS = 30;
export const HISTORY_DEFAULT_MIN_MAGNITUDE = 5;

/** Build the USGS FDSN query URL for a historical window. Pure. */
export function buildUsgsHistoryUrl({
  startTime,
  endTime = new Date(),
  minMagnitude = HISTORY_DEFAULT_MIN_MAGNITUDE,
} = {}) {
  if (!startTime) throw new Error('startTime is required');
  const toIso = (value) => new Date(value).toISOString().slice(0, 19);
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: toIso(startTime),
    endtime: toIso(endTime),
    minmagnitude: String(minMagnitude),
    orderby: 'time',
  });
  return `${FDSN_ENDPOINT}?${params.toString()}`;
}

/**
 * Fetch and validate a historical earthquake snapshot.
 * @param {{fetchImpl?: function, days?: number, minMagnitude?: number, endTime?: Date}} options
 */
export function createUsgsHistorySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getHistory({
      days = HISTORY_DEFAULT_DAYS,
      minMagnitude = HISTORY_DEFAULT_MIN_MAGNITUDE,
      endTime = new Date(),
      signal,
    } = {}) {
      const clampedDays = Math.min(
        365,
        Math.max(1, Number(days) || HISTORY_DEFAULT_DAYS),
      );
      const end = new Date(endTime).getTime();
      const start = end - clampedDays * DAY_MS;
      const url = buildUsgsHistoryUrl({
        startTime: new Date(start),
        endTime: new Date(end),
        minMagnitude,
      });
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`USGS history HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const rows = normalizeEarthquakeSnapshot(payload);
      if (!rows) throw new Error('Malformed USGS history response');
      return rows
        .filter((row) => row.time != null)
        .sort((a, b) => a.time - b.time);
    },
  };
}
