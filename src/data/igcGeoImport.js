/**
 * Session-local FAI/IGC flight-log import: a glider/paraglider tracklog
 * (`.igc`) becomes a GeoJSON FeatureCollection.
 *
 * The gap: the geo file importer (`src/data/geoFileImport.js`) takes
 * GeoJSON, KML/KMZ, GPX, CSV, WKT/EWKT, TopoJSON, GeoJSONL, OSM XML,
 * WKB/EWKB and encoded polylines — but not IGC, the FAI-mandated format
 * every soaring logger (LX Nav, XC Tracer, Oudie, SeeYou exports) writes.
 * IGC is the one tracklog format a gliding user will actually have, and
 * its fixed-width B records have no overlap with GPX/XML parsers.
 *
 * Evidence: the FAI "IGC GNSS FR Technical Specification" (B record:
 * `B HHMMSS DDMMmmmN/S DDDMMmmmE/W V PPPPP GGGGG` plus optional
 * extension bytes; coordinates are WGS 84 by definition — see the
 * `DTM100GPSDATUM` header, "always based on WGS84"), and the IGC format
 * authors' plea to readers: ignore records and fields you do not care
 * about, and never crash because a B record is longer than expected.
 *
 * Pure functions, no Cesium/DOM/network. Deliberate limits, in the
 * never-silently-assume posture of the other geo-import cycles:
 * - Coordinates are WGS 84 by specification — there is no datum field
 *   to conflict, so nothing is refused on CRS grounds (unlike EWKT,
 *   IGC cannot express any other reference system).
 * - A malformed B record (short line, bad characters, out-of-range
 *   coordinate or time, non-numeric altitude) refuses the whole input,
 *   not just the bad fix.
 * - `V` (invalid / no-GPS) fixes are skipped — loggers write them while
 *   acquiring satellites, and refusing a whole flight for a cold start
 *   would be noise. If no fix is valid, the input is refused.
 * - B-record extension bytes (FXA, SIU, ENL, …) are ignored, as the
 *   spec's own reader guidance requests.
 * - Trackpoints over the caps are refused, not truncated.
 * - Timestamps are only emitted when the `HFDTE` header names a valid
 *   date; a corrupt or missing date omits `times` rather than guessing.
 * - A fix earlier than the previous one is taken as crossing midnight
 *   (+1 day), the normal case for a flight logged across 00:00 UTC.
 * Wiring note: when the importer wires this in, `GEO_FILE_ACCEPT` gains
 * `.igc` and detection routes by extension — B records have no magic
 * bytes to sniff, only the leading `A`/`H`/`B` record letters.
 */

import {
  MAX_IMPORT_ALTITUDE,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';

/** Longest plain-text header value kept in properties. */
export const MAX_IGC_PROPERTY_LENGTH = 120;

/** Record letters the IGC spec defines; anything else is not IGC. */
const KNOWN_RECORDS = new Set([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
]);

export class IgcGeoImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IgcGeoImportError';
  }
}

function fail(message) {
  throw new IgcGeoImportError(message);
}

// B + HHMMSS(6) + DD(2)MM(2)mmm(3)[NS] + DDD(3)MM(2)mmm(3)[EW] +
// validity(1) + PPPPP(5) + GGGGG(5) = 35 mandatory bytes.
const B_RECORD =
  /^B(\d{6})(\d{2})(\d{2})(\d{3})([NS])(\d{3})(\d{2})(\d{3})([EW])([AV])(.{5})(.{5})/;

/** HHMMSS → seconds since midnight. SS 60 is a leap second. */
function parseFixTime(raw) {
  const hh = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(2, 4));
  const ss = Number(raw.slice(4, 6));
  if (hh > 23 || mm > 59 || ss > 60) {
    fail(`That IGC file has a B record with an invalid time ${raw}.`);
  }
  return { hh, mm, ss, seconds: hh * 3600 + mm * 60 + ss };
}

/** DDMMmmmN/S → decimal degrees. */
function parseLatitude(dd, mm, mmm, hemi) {
  const deg = Number(dd);
  const min = Number(mm) + Number(mmm) / 1000;
  if (deg > 90 || Number(mm) > 59) {
    fail(
      `That IGC file has a B record with an invalid latitude ${dd}${mm}.${mmm}${hemi}.`,
    );
  }
  const decimal = deg + min / 60;
  if (decimal > 90) {
    fail(
      `That IGC file has a latitude beyond ±90 — refusing it rather than re-labelling it.`,
    );
  }
  return hemi === 'S' ? -decimal : decimal;
}

/** DDDMMmmmE/W → decimal degrees. */
function parseLongitude(ddd, mm, mmm, hemi) {
  const deg = Number(ddd);
  const min = Number(mm) + Number(mmm) / 1000;
  if (deg > 180 || Number(mm) > 59) {
    fail(
      `That IGC file has a B record with an invalid longitude ${ddd}${mm}.${mmm}${hemi}.`,
    );
  }
  const decimal = deg + min / 60;
  if (decimal > 180) {
    fail(
      `That IGC file has a longitude beyond ±180 — refusing it rather than re-labelling it.`,
    );
  }
  return hemi === 'W' ? -decimal : decimal;
}

/** 5-byte IGC altitude field → metres. The GNSS altitude is WGS 84. */
function parseAltitude(raw, what) {
  if (!/^[-0-9]{5}$/.test(raw)) {
    fail(
      `That IGC file has a B record with a non-numeric ${what} altitude "${raw}".`,
    );
  }
  const metres = Number.parseInt(raw, 10);
  if (!Number.isFinite(metres)) {
    fail(
      `That IGC file has a B record with a non-numeric ${what} altitude "${raw}".`,
    );
  }
  if (Math.abs(metres) > MAX_IMPORT_ALTITUDE) {
    fail(
      `That IGC file has an altitude ${metres} m beyond ±${MAX_IMPORT_ALTITUDE.toLocaleString()} m.`,
    );
  }
  return metres;
}

/**
 * One B record → a fix, or null when the fix is invalid (`V`) and should
 * be skipped.
 */
function parseFix(line) {
  if (line.length < 35) {
    fail(
      'That IGC file has a B record shorter than the 35 mandatory bytes — it looks truncated.',
    );
  }
  const match = B_RECORD.exec(line);
  if (!match) {
    fail(
      'That IGC file has a B record whose mandatory fields do not match the IGC layout.',
    );
  }
  const [
    ,
    rawTime,
    latD,
    latM,
    latFrac,
    latHemi,
    lonD,
    lonM,
    lonFrac,
    lonHemi,
    validity,
    rawPress,
    rawGps,
  ] = match;
  const time = parseFixTime(rawTime);
  const lat = parseLatitude(latD, latM, latFrac, latHemi);
  const lon = parseLongitude(lonD, lonM, lonFrac, lonHemi);
  const pressureAlt = parseAltitude(rawPress, 'pressure');
  const gpsAlt = parseAltitude(rawGps, 'GNSS');
  if (validity === 'V') return null;
  return { time, lat, lon, pressureAlt, gpsAlt };
}

/**
 * `HFDTE` / `HFDTEDATE:` → `{ date, midnightUtcMs }`, or null when absent.
 * `midnightUtcMs` is the UTC epoch of 00:00 on the flight date, so fixes
 * past midnight roll into the next day (and month) correctly.
 */
function parseHeaderDate(lines) {
  for (const line of lines) {
    const match = /^H(?:FDTEDATE:|FDTE)(\d{6})/.exec(line);
    if (!match) continue;
    const raw = match[1];
    const day = Number(raw.slice(0, 2));
    const month = Number(raw.slice(2, 4));
    const year = Number(raw.slice(4, 6));
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      fail(`That IGC file has a corrupt flight-date header "${raw}".`);
    }
    const fullYear = year < 70 ? 2000 + year : 1900 + year;
    const midnightUtcMs = Date.UTC(fullYear, month - 1, day);
    const date = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { date, midnightUtcMs };
  }
  return null;
}

/**
 * One `HF…` header value, trimmed and capped. The spec's form is
 * `HF` + 3-char mnemonic + descriptive tail + `:` + value (e.g.
 * `HFPLTPILOTINCHARGE:Bloggs Bill`), so the value is whatever follows
 * the first colon; a colon-less tail is a best-effort fallback.
 */
function headerValue(lines, codes) {
  for (const line of lines) {
    const match = /^H[FP]([A-Z]{3})(.*)$/.exec(line);
    if (!match || !codes.includes(match[1])) continue;
    const rest = match[2];
    const colon = rest.indexOf(':');
    const value = (
      colon >= 0 ? rest.slice(colon + 1) : rest.replace(/^[A-Z]+/, '')
    ).trim();
    if (!value) continue;
    return value.slice(0, MAX_IGC_PROPERTY_LENGTH);
  }
  return null;
}

/**
 * Parse IGC flight-log text into a GeoJSON FeatureCollection with a
 * single 3D LineString (the B-record tracklog) and header metadata in
 * properties.
 * @param {string} text The `.igc` file text.
 * @param {{ maxFixes?: number }} [options] Mostly for tests; the wiring
 *   layer uses the real `MAX_IMPORT_POSITIONS`.
 * @returns {object} GeoJSON FeatureCollection.
 */
export function igcToGeoJson(text, { maxFixes = MAX_IMPORT_POSITIONS } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    fail('IGC import needs the .igc file text.');
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line.length > 0);
  if (!nonEmpty.length) {
    fail('IGC import needs the .igc file text.');
  }
  for (const line of nonEmpty) {
    if (!KNOWN_RECORDS.has(line[0])) {
      fail(
        `That file has a record starting with "${line[0]}" — IGC records are A–L.`,
      );
    }
  }

  const fixes = [];
  for (const line of nonEmpty) {
    if (line[0] !== 'B') continue;
    const fix = parseFix(line);
    if (!fix) continue;
    if (fixes.length >= maxFixes) {
      fail(
        `That IGC file has more than ${maxFixes.toLocaleString()} fixes (the limit).`,
      );
    }
    fixes.push(fix);
  }
  if (!nonEmpty.some((line) => line[0] === 'B')) {
    fail('That IGC file has no B-record fixes to draw.');
  }
  if (fixes.length === 0) {
    fail(
      'That IGC file has no valid (A) fixes — every fix is marked invalid (V).',
    );
  }
  if (fixes.length < 2) {
    fail('That IGC file has only one valid fix — a tracklog needs at least 2.');
  }

  const header = parseHeaderDate(nonEmpty);
  const properties = { fixCount: fixes.length };
  if (header) properties.date = header.date;
  const pilot = headerValue(nonEmpty, ['PLT']);
  if (pilot) properties.pilot = pilot;
  const gliderType = headerValue(nonEmpty, ['GTY']);
  if (gliderType) properties.gliderType = gliderType;
  const gliderId = headerValue(nonEmpty, ['GID']);
  if (gliderId) properties.gliderId = gliderId;

  const coordinates = [];
  const times = [];
  let dayOffset = 0;
  let lastSeconds = -1;
  for (const fix of fixes) {
    if (fix.time.seconds < lastSeconds) dayOffset += 1;
    lastSeconds = fix.time.seconds;
    coordinates.push([fix.lon, fix.lat, fix.gpsAlt]);
    if (header) {
      const stamp =
        header.midnightUtcMs + dayOffset * 86_400_000 + fix.time.seconds * 1000;
      times.push(new Date(stamp).toISOString().slice(0, 19) + 'Z');
    }
  }
  if (header) properties.times = times;

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties,
        geometry: { type: 'LineString', coordinates },
      },
    ],
  };
}
