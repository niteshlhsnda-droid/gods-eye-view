/**
 * NHC direct acquisition for static hosting.
 *
 * The desktop path goes through the same-origin `/api/cyclones` proxy. On
 * static hosting there is no proxy, so this module talks to the National
 * Hurricane Center's keyless, CORS-open storm-graphics products directly:
 *
 *   https://www.nhc.noaa.gov/storm_graphics/api/{ID}_TRACK_latest.kmz
 *   https://www.nhc.noaa.gov/storm_graphics/api/{ID}_CONE_latest.kmz
 *
 * Discovery is 200-vs-404 probing over {AL,EP,CP}{01..30}{year} (<=90 probes
 * per refresh, concurrency <=6). KMZ files are unzipped with fflate and the
 * KML inside is parsed for forecast points (tau/wind/gust), the track
 * LineString, the cone Polygon ring, and the advisory timestamp.
 *
 * MANDATORY staleness guard: a "_latest" product can 200 for a months-dead
 * storm, so advisories older than ~30h are discarded, never presented.
 *
 * Coverage honesty: NHC covers the Atlantic + eastern/central North Pacific
 * only. The Bay of Bengal / Arabian Sea cannot be covered without a proxy:
 * IMD (North Indian Ocean) publishes no machine-readable products. The
 * snapshot's coverage copy states this plainly.
 *
 * This module builds the schemaVersion:1 snapshot; the caller runs
 * validateCycloneSnapshot on the output before returning it. If the KML
 * lacks reliable per-point wind/gust, the storm is marked pending — never
 * fabricated.
 */

import { unzipSync } from 'fflate';

export const NHC_KMZ_BASE_URL = 'https://www.nhc.noaa.gov/storm_graphics/api';
export const NHC_BASINS = Object.freeze(['AL', 'EP', 'CP']);
export const NHC_MAX_STORM_NUMBER = 30;
export const NHC_PROBE_CONCURRENCY = 6;
/** Discovery needs headroom for up to 90 probes; the single-request 15s budget does not apply. */
export const NHC_DIRECT_TIMEOUT_MS = 60_000;
/** A "_latest" product older than this is a dead storm still returning 200: discard it. */
export const NHC_STALE_ADVISORY_MS = 30 * 3600 * 1000;
/** Sanity cap per KMZ download (real products are 8-35 KB). */
export const NHC_KMZ_MAX_BYTES = 2 * 1024 * 1024;

export const NHC_ATTRIBUTION = 'National Hurricane Center / NOAA';
export const NHC_COVERAGE =
  'Atlantic and eastern/central North Pacific only; Bay of Bengal / Arabian Sea unavailable on static hosting (IMD publishes no machine-readable products).';

const OUTLOOK_BASIN = Object.freeze({ AL: 'atlc', EP: 'epac', CP: 'cpac' });

/** NHC advisory "Valid at" timezone abbreviations -> minutes east of UTC. */
const TZ_OFFSET_MINUTES = Object.freeze({
  AST: -240,
  ADT: -180,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
  AKST: -540,
  AKDT: -480,
  HST: -600,
  HDT: -540,
  UTC: 0,
  GMT: 0,
});

const MONTHS = Object.freeze({
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
});

/** NHC title-case classification words -> snapshot classification codes. */
const CLASSIFICATION_CODES = Object.freeze({
  'tropical depression': 'TD',
  'tropical storm': 'TS',
  hurricane: 'HU',
  'subtropical depression': 'SD',
  'subtropical storm': 'SS',
  'potential tropical cyclone': 'PTC',
  'post-tropical cyclone': 'POST',
  extratropical: 'EX',
  'remnants of': 'REM',
  'tropical disturbance': 'DB',
});

const finite = (value) => (Number.isFinite(value) ? value : null);

function stormId(basin, number, year) {
  return `${basin}${String(number).padStart(2, '0')}${year}`;
}

function trackUrl(id) {
  return `${NHC_KMZ_BASE_URL}/${id}_TRACK_latest.kmz`;
}

function coneUrl(id) {
  return `${NHC_KMZ_BASE_URL}/${id}_CONE_latest.kmz`;
}

/**
 * Parse "9:00 PM CST October 13, 2026" -> epoch ms, or null when the
 * template does not match. Unknown timezone abbreviations fail closed.
 */
export function parseNhcValidAt(text) {
  const match =
    /(\d{1,2}):(\d{2})\s*(AM|PM)\s*([A-Z]{2,4})\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(
      String(text ?? ''),
    );
  if (!match) return null;
  const [, hour, minute, meridiem, tz, monthName, day, year] = match;
  const offsetMinutes = TZ_OFFSET_MINUTES[tz];
  const month = MONTHS[monthName.toLowerCase()];
  if (offsetMinutes === undefined || month === undefined) return null;
  let hours = Number(hour) % 12;
  if (meridiem === 'PM') hours += 12;
  const ms = Date.UTC(Number(year), month, Number(day), hours, Number(minute));
  if (!Number.isFinite(ms)) return null;
  return ms - offsetMinutes * 60 * 1000;
}

/** "27A" stays "27A"; "027a" normalizes to "27A". Null when not parseable. */
export function normalizeAdvisoryNumber(text) {
  const match = /#\s*0*(\d{1,3})\s*([A-Za-z])?/.exec(String(text ?? ''));
  if (!match) return null;
  const [, digits, letter] = match;
  if (digits === '0' || digits.length > 3) return null;
  return digits + (letter ? letter.toUpperCase() : '');
}

function firstGroup(pattern, text) {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

/** Document <name> before the first Placemark: "EP212026 (Advisory #3) - Forecast Track". */
function documentName(kml) {
  const head = kml.split(/<Placemark\s*>/)[0];
  const name = firstGroup(/<name>([\s\S]*?)<\/name>/, head);
  return name ? name.trim() : null;
}

function documentDateCreated(kml) {
  const head = kml.split(/<Placemark\s*>/)[0];
  return firstGroup(/Date Created:<\/B>\s*(\d{2}-\d{2}-\d{4})/, head);
}

function placemarks(kml) {
  const blocks = [];
  const pattern = /<Placemark\s*>([\s\S]*?)<\/Placemark\s*>/g;
  let match;
  while ((match = pattern.exec(kml)) !== null) blocks.push(match[1]);
  return blocks;
}

function placemarkDescription(block) {
  return firstGroup(
    /<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/,
    block,
  );
}

function placemarkCoordinates(block, kind) {
  const section = firstGroup(
    new RegExp(
      `<${kind}>\\s*<coordinates>\\s*([\\s\\S]*?)\\s*<\\/coordinates>`,
    ),
    block,
  );
  if (!section) return null;
  const points = [];
  for (const token of section.trim().split(/\s+/)) {
    const parts = token.split(',');
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    points.push([lon, lat]);
  }
  return points;
}

/**
 * Parse one forecast-point placemark description into a structured point.
 * Returns null when the placemark is not a forecast point or the template
 * does not match (fail closed: the storm is skipped, never fabricated).
 */
function parseForecastPoint(block) {
  const description = placemarkDescription(block);
  if (!description) return null;
  const title = firstGroup(/<b>([^<]*)<\/b>/, description);
  if (!title) return null;
  const idMatch = /\(([A-Za-z]{2}\d{6})\)\s*$/.exec(title.trim());
  if (!idMatch) return null;
  const withoutId = title.trim().slice(0, idMatch.index).trim();
  const nameWord = withoutId.split(/\s+/).pop();
  const classWords = withoutId
    .slice(0, withoutId.length - nameWord.length)
    .trim();
  let tauHours = null;
  if (/Advisory Information/.test(description)) tauHours = 0;
  else {
    const tau = /(\d+)\s*hr Forecast/.exec(description);
    if (!tau) return null;
    tauHours = Number(tau[1]);
  }
  const validAt = parseNhcValidAt(
    firstGroup(/Valid at:\s*([^<]+)</, description),
  );
  const location =
    /Location:\s*([\d.]+)\s*([NS])\s*,\s*(-?[\d.]+)\s*([WE])/.exec(description);
  const wind = /Maximum Wind:\s*(\d+)\s*knots/.exec(description);
  const gust = /Wind Gusts:\s*(\d+)\s*knots/.exec(description);
  const coords = placemarkCoordinates(block, 'Point');
  let longitude = null;
  let latitude = null;
  if (location) {
    // The Location row already carries a sign ("-97.0 W"); normalize via the
    // hemisphere letter so a double negation can never flip the position.
    latitude = Math.abs(Number(location[1])) * (location[2] === 'S' ? -1 : 1);
    longitude = Math.abs(Number(location[3])) * (location[4] === 'W' ? -1 : 1);
  }
  if (coords && coords.length) {
    // The Point element is authoritative; the Location row must agree with it.
    if (
      longitude !== null &&
      (Math.abs(coords[0][0] - longitude) > 0.05 ||
        Math.abs(coords[0][1] - latitude) > 0.05)
    )
      return null;
    [longitude, latitude] = coords[0];
  }
  if (
    longitude === null ||
    latitude === null ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  )
    return null;
  return {
    stormRef: idMatch[1].toUpperCase(),
    name: nameWord,
    classificationWords: classWords,
    advisoryTag: firstGroup(/Advisory\s*#\s*([0-9]+[A-Za-z]?)/, description),
    tauHours,
    validAtMs: validAt,
    position: { longitude, latitude },
    windKt: wind ? Number(wind[1]) : null,
    gustKt: gust ? Number(gust[1]) : null,
  };
}

/** Longest forecast-track LineString across the track placemarks. */
function parseTrackLine(blocks) {
  let best = null;
  for (const block of blocks) {
    const description = placemarkDescription(block);
    if (!description || !/Hour Forecast Track/.test(description)) continue;
    const hours = Number(
      firstGroup(/(\d+)\s*Hour Forecast Track/, description),
    );
    const coordinates = placemarkCoordinates(block, 'LineString');
    if (!coordinates || coordinates.length < 2) continue;
    if (!best || hours > best.hours) best = { hours, coordinates };
  }
  return best;
}

/** Cone polygon ring from a CONE KML document. Null when not parseable. */
export function parseConeRing(kml) {
  const blocks = placemarks(kml);
  for (const block of blocks) {
    const coordinates = firstGroup(
      /<Polygon>\s*<outerBoundaryIs>\s*<LinearRing>\s*<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/,
      block,
    );
    if (!coordinates) continue;
    const ring = [];
    for (const token of coordinates.trim().split(/\s+/)) {
      const parts = token.split(',');
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        Math.abs(lon) > 180 ||
        Math.abs(lat) > 90
      )
        return null;
      ring.push([lon, lat]);
    }
    if (ring.length < 4) return null;
    // Closed ring required downstream; normalize defensively.
    const [first] = ring;
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    return ring;
  }
  return null;
}

function classificationCode(words) {
  const code = CLASSIFICATION_CODES[String(words ?? '').toLowerCase()];
  return code ?? 'UNK';
}

/** Unzip a KMZ download and return the decoded KML text, or null. */
function kmzToKml(buffer) {
  try {
    const entries = unzipSync(new Uint8Array(buffer));
    for (const [name, data] of Object.entries(entries)) {
      if (name.toLowerCase().endsWith('.kml')) {
        const text = new TextDecoder().decode(data);
        if (text.includes('<kml')) return text;
      }
    }
  } catch {
    /* corrupt zip: caller skips the storm */
  }
  return null;
}

/**
 * Build one snapshot storm from a TRACK KML document plus an optional CONE
 * ring. Returns null when the storm must be skipped (stale advisory,
 * template mismatch, or any unparseable required field).
 */
export function buildStormFromKml({ trackKml, coneRing, nowMs }) {
  const name = documentName(trackKml);
  const advisoryNumber = normalizeAdvisoryNumber(name);
  if (!advisoryNumber) return null;

  const blocks = placemarks(trackKml);
  const points = [];
  for (const block of blocks) {
    const point = parseForecastPoint(block);
    if (point) points.push(point);
  }
  if (!points.length) return null;
  const stormRef = points[0].stormRef;
  if (!/^(?:AL|EP|CP)\d{6}$/.test(stormRef)) return null;
  if (!points.every((point) => point.stormRef === stormRef)) return null;
  // Every point placemark must belong to the same advisory as the document.
  if (
    !points.every(
      (point) =>
        point.advisoryTag !== null &&
        normalizeAdvisoryNumber(`#${point.advisoryTag}`) === advisoryNumber,
    )
  )
    return null;

  const initial = points.find((point) => point.tauHours === 0);
  if (!initial || initial.validAtMs === null) return null;
  // MANDATORY staleness guard: "_latest" 200s for months-dead storms.
  if (nowMs - initial.validAtMs > NHC_STALE_ADVISORY_MS) return null;
  // "Date Created" cross-check: the advisory valid time must be within two
  // days of the product creation date, or the template is not what we think.
  const dateCreated = documentDateCreated(trackKml);
  if (dateCreated) {
    const [month, day, year] = dateCreated.split('-').map(Number);
    const createdMs = Date.UTC(year, month - 1, day);
    if (Math.abs(initial.validAtMs - createdMs) > 2 * 86400 * 1000) return null;
  }
  if (initial.windKt === null || initial.gustKt === null) return null;

  const seen = new Set();
  const forecastPoints = [];
  let geometryComplete = true;
  for (const point of [...points].sort((a, b) => a.tauHours - b.tauHours)) {
    if (point.tauHours === null || seen.has(point.tauHours)) {
      geometryComplete = false;
      continue;
    }
    seen.add(point.tauHours);
    if (point.windKt === null || point.gustKt === null)
      geometryComplete = false;
    forecastPoints.push({
      position: point.position,
      tauHours: point.tauHours,
      windKt: point.windKt,
      gustKt: point.gustKt,
    });
  }

  const track = parseTrackLine(blocks);
  const hasGeometry =
    geometryComplete &&
    track !== null &&
    coneRing !== null &&
    forecastPoints.length > 0;
  const geometryStatus = hasGeometry ? 'current' : 'pending';

  const id = stormRef.toLowerCase();
  const issuedAt = new Date(initial.validAtMs).toISOString();
  return {
    id,
    name: initial.name,
    classification: classificationCode(initial.classificationWords),
    basin: stormRef.slice(0, 2),
    position: initial.position,
    positionAt: issuedAt,
    advisoryNumber,
    issuedAt,
    windKt: initial.windKt,
    pressureHpa: null,
    movement: { directionDegrees: null, speedKt: null },
    advisoryUrl: null,
    outlookUrl: `https://www.nhc.noaa.gov/gtwo.php?basin=${OUTLOOK_BASIN[stormRef.slice(0, 2)]}&fdays=7`,
    geometryStatus,
    geometryAdvisoryNumber: hasGeometry ? advisoryNumber : null,
    forecastPoints: hasGeometry ? forecastPoints : [],
    track: hasGeometry
      ? { type: 'LineString', coordinates: track.coordinates }
      : null,
    cone: hasGeometry ? { type: 'Polygon', coordinates: [coneRing] } : null,
  };
}

function emptySnapshot(fetchedAt, overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'nhc-direct',
    attribution: NHC_ATTRIBUTION,
    coverage: NHC_COVERAGE,
    fetchedAt,
    stale: false,
    unavailable: false,
    reason: null,
    storms: [],
    ...overrides,
  };
}

async function readKmzBytes(response, signal) {
  const buffer = await response.arrayBuffer();
  signal?.throwIfAborted();
  if (buffer.byteLength > NHC_KMZ_MAX_BYTES)
    throw new Error('NHC KMZ exceeds size cap');
  return buffer;
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    /* already closed */
  }
}

/** Bounded worker pool: at most `limit` probes in flight. */
async function mapLimit(items, limit, worker, signal) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  async function run() {
    while (next < items.length) {
      signal?.throwIfAborted();
      if (failed) return;
      const index = next;
      next += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    run(),
  );
  await Promise.all(runners);
  return results;
}

/**
 * Discover active NHC storms and build the snapshot. Only called on static
 * hosting; the desktop path keeps using /api/cyclones.
 */
export async function fetchNhcDirectSnapshot({
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
  timeoutMs = NHC_DIRECT_TIMEOUT_MS,
  year = new Date().getUTCFullYear(),
  nowMs = Date.now(),
} = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('NHC direct request timed out')),
    timeoutMs,
  );
  const probeSignal = controller.signal;
  try {
    signal?.throwIfAborted();
    const ids = [];
    for (const basin of NHC_BASINS)
      for (let number = 1; number <= NHC_MAX_STORM_NUMBER; number++)
        ids.push(stormId(basin, number, year));

    let responded = false;
    const storms = [];
    await mapLimit(
      ids,
      NHC_PROBE_CONCURRENCY,
      async (id) => {
        probeSignal.throwIfAborted();
        let response;
        try {
          response = await fetchImpl(trackUrl(id), {
            signal: probeSignal,
            cache: 'no-store',
            redirect: 'error',
          });
        } catch (error) {
          // Network-level failure for one probe: skip the id, keep going.
          // Only a total blackout (no probe answered at all) is "unavailable".
          if (probeSignal.aborted) throw error;
          return;
        }
        responded = true;
        if (response.status === 404) {
          await cancelBody(response);
          return;
        }
        if (!response.ok) {
          await cancelBody(response);
          return;
        }
        let trackKml = null;
        try {
          trackKml = kmzToKml(await readKmzBytes(response, probeSignal));
        } catch {
          return;
        }
        if (!trackKml) return;
        // Cone only for storms whose track parsed fresh: saves requests and
        // keeps stale advisories from ever reaching the snapshot.
        let coneRing = null;
        try {
          const coneResponse = await fetchImpl(coneUrl(id), {
            signal: probeSignal,
            cache: 'no-store',
            redirect: 'error',
          });
          if (coneResponse.ok) {
            const coneKml = kmzToKml(
              await readKmzBytes(coneResponse, probeSignal),
            );
            if (coneKml) coneRing = parseConeRing(coneKml);
          } else {
            await cancelBody(coneResponse);
          }
        } catch (error) {
          if (probeSignal.aborted) throw error;
        }
        const storm = buildStormFromKml({ trackKml, coneRing, nowMs });
        if (storm) storms.push(storm);
      },
      probeSignal,
    );
    probeSignal.throwIfAborted();
    if (!responded) {
      return emptySnapshot(nowMs, {
        unavailable: true,
        reason: 'NHC storm graphics unreachable',
      });
    }
    storms.sort((a, b) => a.id.localeCompare(b.id));
    return { ...emptySnapshot(nowMs), storms };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
