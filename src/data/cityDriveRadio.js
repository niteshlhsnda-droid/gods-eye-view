/**
 * Live local radio for City Drives, via the radio-browser.info community directory.
 *
 * No API key needed. Queries the public mirrors in order and picks the first
 * playable direct stream for the city — plain <audio>-tag playable streams only
 * (.mp3 / .aac / .ogg). HLS playlists (.m3u8) are skipped because a bare <audio>
 * element cannot play them reliably cross-browser.
 *
 * fetchImpl is injectable so tests can run without the network; in the browser
 * pass globalThis.fetch.
 */

const RADIO_BROWSER_MIRRORS = Object.freeze([
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
]);

const PLAYABLE_HINT = /\.(mp3|aac|ogg|opus|flac)(\?|#|$)/i;

function isDirectStream(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  if (/\.m3u8(\?|#|$)/i.test(url)) return false;
  if (/\.pls(\?|#|$)/i.test(url)) return false;
  return true;
}

/**
 * Prefer stations whose resolved URL looks like a direct audio file; fall back to
 * any non-playlist http(s) URL (some stations serve streams from extensionless
 * endpoints).
 */
function pickPlayableStation(stations) {
  if (!Array.isArray(stations)) return null;
  const direct = stations.filter(
    (station) => station && isDirectStream(station.url_resolved || station.url),
  );
  if (direct.length === 0) return null;
  const hinted = direct.find((station) =>
    PLAYABLE_HINT.test(station.url_resolved || station.url),
  );
  return hinted ?? direct[0];
}

async function queryMirror(mirror, cityName, fetchImpl) {
  const url =
    `${mirror}/json/stations/byname/${encodeURIComponent(cityName)}` +
    '?limit=15&hidebroken=true';
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'gods-eye-view-city-drives/1.0' },
  });
  if (!response || response.ok !== true) return null;
  const stations = await response.json();
  return pickPlayableStation(stations);
}

/**
 * Resolve a live radio stream for a city name.
 * @returns {Promise<{stationName: string, streamUrl: string} | null>}
 */
export async function resolveCityStream(cityName, fetchImpl) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (!cityName || typeof fetchFn !== 'function') return null;
  for (const mirror of RADIO_BROWSER_MIRRORS) {
    try {
      const station = await queryMirror(mirror, cityName, fetchFn);
      if (station) {
        return {
          stationName: station.name || cityName,
          streamUrl: station.url_resolved || station.url,
        };
      }
    } catch {
      // Mirror unreachable or malformed — try the next one.
    }
  }
  return null;
}

/** Mirror list, exported for tests and diagnostics. */
export const CITY_DRIVE_RADIO_MIRRORS = RADIO_BROWSER_MIRRORS;
