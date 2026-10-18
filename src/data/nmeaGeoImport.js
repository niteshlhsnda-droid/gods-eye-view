/**
 * Session-local NMEA 0183 import: GPS receiver log sentences (GGA/RMC)
 * become a GeoJSON FeatureCollection holding one 3D track LineString.
 *
 * The gap: the geo file importer (`src/data/geoFileImport.js`) takes
 * GeoJSON, KML/KMZ and GPX, but GPS receivers log NMEA 0183 sentences —
 * the ASCII serial protocol every handheld, marine and survey receiver
 * speaks. A GGA sentence carries time plus a 3D fix (lat/lon/altitude);
 * an RMC sentence carries time plus date plus a 2D fix plus status.
 * Together they describe a timestamped track, which is what this parser
 * turns into GeoJSON. GEO-IMPORT lane, Cycle 19: parser only, loader
 * wiring left for the importer.
 *
 * Evidence: field layouts from the canonical public sentence reference
 * "NMEA Revealed" (gpsd project, https://gpsd.gitlab.io/gpsd/NMEA.html —
 * itself redacted from public sources; the official NMEA 0183 standard
 * is proprietary and was not consulted):
 * - GGA `$--GGA,hhmmss.ss,ddmm.mm,a,ddmm.mm,a,x,xx,x.x,x.x,M,x.x,M,x.x,
 *   xxxx*hh`: fields 2–5 lat/lon with N/S/E/W hemispheres, field 6
 *   quality indicator (0 = no fix, 1 = GPS, 2 = DGPS, 3–8 higher modes),
 *   field 9 antenna altitude above/below mean-sea-level with field 10
 *   units in metres.
 * - RMC `$--RMC,hhmmss.ss,A,ddmm.mm,a,dddmm.mm,a,x.x,x.x,xxxx,x.x,a,m
 *   [,s]*hh`: field 2 status A = valid / V = warning (void), fields 3–6
 *   lat/lon, field 9 date as ddmmyy.
 * - Checksum: 8-bit XOR of every character between `$` and `*`,
 *   exclusive, sent as two hex digits.
 * - Positions are ddmm.mmmm: the two digits left of the decimal point
 *   are whole minutes, the rest whole degrees — converted as
 *   degrees + minutes/60, negated for S/W hemispheres.
 * - NMEA devices report date and time in UTC.
 *
 * Pure functions, no Cesium/DOM/network/fs. Deliberate limits, in the
 * never-silently-assume posture of ruling #5:
 * - Coordinates are WGS 84 by specification (NMEA 0183 positions are
 *   defined on the WGS 84 datum), so per RFC 7946 section 4 no CRS
 *   member is emitted and no CRS warning is needed. This is documented,
 *   not assumed: only GGA/RMC sentences are read, so a DTM sentence
 *   shifting the datum elsewhere in the log cannot move these fixes.
 * - Sentences whose checksum fails (or is missing) are skipped and
 *   counted — a corrupted line is never trusted.
 * - RMC status `V` (void) and GGA quality `0` (no fix) yield no fix:
 *   their coordinates may be stale or zero-filled.
 * - GGA altitude is kept only when its unit field is `M` (metres) or
 *   empty and |altitude| is within the shared altitude cap; otherwise
 *   the fix stays 2D rather than carrying a number whose unit we
 *   cannot name.
 * - A fix with no usable timestamp keeps a null timestamp slot instead
 *   of inheriting a guess. GGA carries time but no date, so its date
 *   comes from the most recent valid RMC date seen earlier in the
 *   file; fixes before the first RMC date stay null.
 * - Consecutive fixes with identical coordinates (the usual GGA/RMC
 *   pair for one fix epoch) are merged into one point: the later
 *   sentence fills in whichever of timestamp/altitude the earlier one
 *   lacked. The merge is counted, never silent.
 * - RMC dates are ddmmyy: years 80–99 map to 19xx, 00–79 to 20xx (the
 *   GPS-week-era convention). A receiver logging the wrong century
 *   gets the wrong century; the parser does not rewind time.
 * - More fixes than the shared position cap are refused (null), never
 *   truncated — the same posture as the geo file importer's caps.
 * - Invalid input (null, non-string, no NMEA sentences, zero usable
 *   fixes) returns null. This parser never throws.
 */

import {
  MAX_IMPORT_ALTITUDE,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';

/** Most fixes one NMEA input may contribute (the importer's position cap). */
export const MAX_NMEA_POSITIONS = MAX_IMPORT_POSITIONS;
/** Largest accepted altitude, mirroring the upstream GeoJSON bound. */
export const MAX_NMEA_ALTITUDE = MAX_IMPORT_ALTITUDE;

/** `$` + two-letter talker id + GGA/RMC, then the comma-delimited fields. */
const SENTENCE_RE = /^\$([A-Z]{2})(GGA|RMC),/;
const COORD_RE = /^\d+(?:\.\d+)?$/;
const SIGNED_RE = /^-?\d+(?:\.\d+)?$/;
const TIME_RE = /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/;
const DATE_RE = /^(\d{2})(\d{2})(\d{2})$/;
const HEX_RE = /^[0-9A-Fa-f]{2}$/;

/**
 * True when the text holds at least one GGA or RMC sentence line. A
 * cheap sniff for the importer; never throws.
 */
export function isNmeaText(text) {
  if (typeof text !== 'string') return false;
  return text.split(/\r?\n/).some((line) => SENTENCE_RE.test(line.trim()));
}

/** XOR of every character between `$` and `*` matches the `*HH` trailer. */
function checksumOk(line) {
  const star = line.indexOf('*');
  if (star < 0) return false;
  const hex = line.slice(star + 1, star + 3);
  if (!HEX_RE.test(hex)) return false;
  let xor = 0;
  for (let i = 1; i < star; i++) xor ^= line.charCodeAt(i);
  return xor === parseInt(hex, 16);
}

/**
 * ddmm.mmmm with hemisphere letters → decimal degrees, or null when the
 * value is not numeric, minutes are ≥ 60, the hemisphere is unknown, or
 * the result is out of range. Never silently clamps.
 */
function nmeaCoord(value, hemi, posHemi, negHemi, limit) {
  if (!COORD_RE.test(value) || (hemi !== posHemi && hemi !== negHemi))
    return null;
  const num = Number(value);
  const degrees = Math.floor(num / 100);
  const minutes = num - degrees * 100;
  if (minutes >= 60) return null;
  const decimal = degrees + minutes / 60;
  if (decimal > limit) return null;
  return hemi === negHemi ? -decimal : decimal;
}

/** hhmmss[.ss] → time parts, or null. */
function nmeaTime(value) {
  const m = TIME_RE.exec(value || '');
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  if (hh > 23 || mm > 59 || ss >= 61) return null;
  const whole = Math.floor(ss);
  return { hh, mm, ss: whole, ms: Math.round((ss - whole) * 1000) };
}

/** ddmmyy → date parts, or null. Years 80–99 are 19xx, 00–79 are 20xx. */
function nmeaDate(value) {
  const m = DATE_RE.exec(value || '');
  if (!m) return null;
  const dd = Number(m[1]);
  const mo = Number(m[2]);
  const yy = Number(m[3]);
  if (dd < 1 || dd > 31 || mo < 1 || mo > 12) return null;
  return { dd, mo, yy: yy >= 80 ? 1900 + yy : 2000 + yy };
}

function toIso(date, time) {
  return new Date(
    Date.UTC(date.yy, date.mo - 1, date.dd, time.hh, time.mm, time.ss, time.ms),
  ).toISOString();
}

/** GGA fields: 1 time, 2 lat, 3 N/S, 4 lon, 5 E/W, 6 quality, 9 alt, 10 unit. */
function ggaFix(fields) {
  if (fields.length < 7) return { kind: 'skip', reason: 'malformed' };
  const quality = fields[6];
  if (quality === '0') return { kind: 'skip', reason: 'void' };
  if (!quality) return { kind: 'skip', reason: 'malformed' };
  const lat = nmeaCoord(fields[2], fields[3], 'N', 'S', 90);
  const lon = nmeaCoord(fields[4], fields[5], 'E', 'W', 180);
  if (lat === null || lon === null)
    return { kind: 'skip', reason: 'malformed' };
  let alt = null;
  const rawAlt = fields[9] || '';
  const unit = fields[10] === undefined ? null : fields[10];
  if (rawAlt && (unit === 'M' || unit === '') && SIGNED_RE.test(rawAlt)) {
    const metres = Number(rawAlt);
    if (Math.abs(metres) <= MAX_NMEA_ALTITUDE) alt = metres;
    // Over-cap or non-numeric altitude: the fix stays 2D.
  }
  return { kind: 'fix', lat, lon, alt, timeText: fields[1], dateText: null };
}

/** RMC fields: 1 time, 2 status, 3 lat, 4 N/S, 5 lon, 6 E/W, 9 date. */
function rmcFix(fields) {
  if (fields.length < 10) return { kind: 'skip', reason: 'malformed' };
  const status = fields[2];
  if (status === 'V') return { kind: 'skip', reason: 'void' };
  if (status !== 'A') return { kind: 'skip', reason: 'malformed' };
  const lat = nmeaCoord(fields[3], fields[4], 'N', 'S', 90);
  const lon = nmeaCoord(fields[5], fields[6], 'E', 'W', 180);
  if (lat === null || lon === null)
    return { kind: 'skip', reason: 'malformed' };
  return {
    kind: 'fix',
    lat,
    lon,
    alt: null,
    timeText: fields[1],
    dateText: fields[9],
  };
}

/**
 * NMEA 0183 GGA/RMC text → GeoJSON FeatureCollection with one track
 * LineString, or null when the input is invalid, holds no usable fix,
 * or exceeds the shared position cap. Never throws.
 *
 * `properties.timestamps` parallels the LineString coordinates: one ISO
 * 8601 UTC string per fix, null where the sentence gave no usable date.
 * `properties.nmea` reports fix/merge counts and per-reason skip counts.
 */
export function parseNmeaText(text) {
  if (typeof text !== 'string' || !isNmeaText(text)) return null;
  const coordinates = [];
  const timestamps = [];
  const skipped = { badChecksum: 0, void: 0, malformed: 0 };
  let merged = 0;
  let lastDate = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const dollar = rawLine.indexOf('$');
    if (dollar < 0) continue;
    const line = rawLine.slice(dollar);
    const tag = SENTENCE_RE.exec(line);
    if (!tag) continue;
    if (!checksumOk(line)) {
      skipped.badChecksum++;
      continue;
    }
    const fields = line.slice(1, line.indexOf('*')).split(',');
    const type = tag[2];
    const parsed = type === 'GGA' ? ggaFix(fields) : rmcFix(fields);
    if (parsed.kind === 'skip') {
      skipped[parsed.reason]++;
      continue;
    }

    // RMC is the only sentence carrying a date; GGA borrows the most
    // recent one seen so far. A bad RMC date never kills the fix.
    let fixDate = lastDate;
    if (type === 'RMC' && parsed.dateText) {
      const d = nmeaDate(parsed.dateText);
      if (d) {
        lastDate = d;
        fixDate = d;
      }
    }
    const time = nmeaTime(parsed.timeText);
    const iso = time && fixDate ? toIso(fixDate, time) : null;

    // The usual GGA/RMC pair for one fix epoch shares coordinates: fold
    // the later sentence's timestamp/altitude into the earlier point.
    const prev = coordinates[coordinates.length - 1];
    if (prev && prev[0] === parsed.lon && prev[1] === parsed.lat) {
      if (timestamps[timestamps.length - 1] === null && iso !== null)
        timestamps[timestamps.length - 1] = iso;
      if (prev.length === 2 && parsed.alt !== null) prev.push(parsed.alt);
      merged++;
      continue;
    }

    // Refuse over-cap input outright; never silently truncate a track.
    if (coordinates.length >= MAX_NMEA_POSITIONS) return null;
    coordinates.push(
      parsed.alt === null
        ? [parsed.lon, parsed.lat]
        : [parsed.lon, parsed.lat, parsed.alt],
    );
    timestamps.push(iso);
  }

  if (coordinates.length === 0) return null;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          timestamps,
          nmea: {
            fixes: coordinates.length,
            merged,
            skipped,
          },
        },
        geometry: { type: 'LineString', coordinates },
      },
    ],
  };
}
