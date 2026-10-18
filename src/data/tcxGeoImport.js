/**
 * Session-local TCX import: a Garmin Training Center Database file becomes
 * a GeoJSON FeatureCollection of activity tracks and course tracks.
 *
 * The gap: the geo file importer (`feature/geo-import`,
 * `src/data/geoFileImport.js`) takes GeoJSON, KML/KMZ, GPX, TopoJSON, WKT,
 * CSV, GeoJSONL, OSM XML and friends — and sibling lanes already cover
 * DXF, GML, WKB, encoded polylines, Esri JSON, MIF/MID and Shapefile — but
 * nothing takes TCX, the workout/activity export that Garmin devices,
 * Garmin Connect and Strava produce. TCX is XML (TrainingCenterDatabase
 * v2), a documented public schema, and a genuine hole in the lane's
 * format coverage.
 *
 * Pure functions, no Cesium/DOM/network. Deliberate limits, mirroring
 * the house contract:
 * - A tiny hand-rolled XML scanner parses the file; there is no
 *   DOMParser in the Node test runtime and no XML dependency is added.
 *   Structural breakage (unclosed/mismatched tags, bad attributes,
 *   truncated comments or CDATA) refuses the whole file.
 * - No CRS assumption is needed and none is made (ruling #5): the
 *   TrainingCenterDatabase v2 schema defines LatitudeDegrees and
 *   LongitudeDegrees as WGS-84 degrees, so the format is WGS-84 by
 *   construction, not by guess.
 * - Trackpoints with missing or blank coordinates are skipped and
 *   counted in `skipped`; non-numeric or out-of-range coordinates, and
 *   non-numeric or over-cap altitudes, refuse the whole file (the same
 *   posture as the GPX importer). Non-numeric auxiliary sensor fields
 *   (cadence, heart rate, distance) degrade to null, not refusal.
 * - Rows over the caps are refused, not truncated (same posture as the
 *   geo file importer's entity cap): `MAX_TCX_ENTITIES`,
 *   `MAX_TCX_POSITIONS`, `MAX_TCX_ALTITUDE` are aliases of the
 *   importer's caps in `src/data/geoImportLimits.js`, so the numbers
 *   cannot drift apart. A Trackpoint counts as a position; the counter
 *   trips during scanning so a hostile file fails fast.
 * - `<Workouts>`, `<History>`, `<Creator>`, `<Extensions>` (TPX speed /
 *   watts), course-folder wrappers and plan blocks are read past, not
 *   imported — they carry no geometry.
 * Wiring note: `geoFileImport.js` does not know this module on `main`;
 * when it wires this in, it adds `.tcx` to `GEO_FILE_ACCEPT`, routes
 * `.tcx` (and sniffed TrainingCenterDatabase text) here, and the caps
 * are already shared via `geoImportLimits.js`.
 */

import {
  MAX_IMPORT_ALTITUDE,
  MAX_IMPORT_ENTITIES,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';

/** Most tracks (one LineString/Point per Activity lap-track or course track). */
export const MAX_TCX_ENTITIES = MAX_IMPORT_ENTITIES;
/** Most trackpoints (each counts as one position) in one file. */
export const MAX_TCX_POSITIONS = MAX_IMPORT_POSITIONS;
/** Largest accepted altitude, in metres. */
export const MAX_TCX_ALTITUDE = MAX_IMPORT_ALTITUDE;
/** Longest course name kept (same value as the importer's name cap). */
export const MAX_TCX_NAME_LENGTH = 120;

/** An error whose message is meant for the person who chose the file. */
export class TcxGeoImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TcxGeoImportError';
  }
}

const fail = (message) => {
  throw new TcxGeoImportError(message);
};

/** Element local name: the part after the last namespace prefix. */
const localName = (raw) => raw.split(':').pop();

const ENTITY_REPLACEMENTS = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/** Decode the five predefined XML entities in text/attribute values. */
function decodeEntities(value) {
  return value.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (match) => ENTITY_REPLACEMENTS[match] ?? match,
  );
}

const TAG_NAME_RE = /^[A-Za-z_][\w:.-]*$/;

/**
 * Parse one tag's inner text (between `<` and `>`) into a local name and
 * attribute map. Attribute names keep their raw spelling; TCX uses
 * unprefixed `Sport` / `StartTime`.
 *
 * @param {string} inner
 * @returns {{ name: string, attrs: Record<string, string> }}
 */
function parseTag(inner) {
  const nameMatch = /^\s*([A-Za-z_][\w:.-]*)/.exec(inner);
  if (!nameMatch) fail('TCX has a malformed tag');
  const rawName = nameMatch[1];
  const attrs = {};
  let rest = inner.slice(nameMatch[0].length);
  for (;;) {
    const ws = /^\s+/.exec(rest);
    if (ws) rest = rest.slice(ws[0].length);
    if (rest === '') break;
    const attrMatch = /^([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/.exec(rest);
    if (!attrMatch)
      fail(`TCX has a malformed attribute near ${rest.slice(0, 32)}`);
    attrs[attrMatch[1]] = decodeEntities(attrMatch[2].slice(1, -1));
    rest = rest.slice(attrMatch[0].length);
  }
  return { name: localName(rawName), attrs };
}

/**
 * Scan TCX text into a minimal element tree. Names are namespace-local,
 * attributes are decoded, comments / processing instructions / DOCTYPE
 * are skipped, CDATA becomes text. Anything structurally wrong refuses
 * the whole file. A Trackpoint counts as a position against the cap and
 * trips it during the scan, so a hostile file fails fast.
 *
 * @param {string} text
 * @returns {{ name: string, attrs: object, children: Array, text: string }}
 */
function scanTcxXml(text) {
  let trackpointCount = 0;
  const root = { name: null, attrs: {}, children: [], text: '' };
  const stack = [root];
  const current = () => stack[stack.length - 1];
  let i = 0;
  const n = text.length;

  const scanTo = (closer, start, what) => {
    const end = text.indexOf(closer, start);
    if (end === -1) fail(`TCX has an unterminated ${what}`);
    return end;
  };

  while (i < n) {
    if (text.startsWith('<!--', i)) {
      i = scanTo('-->', i + 4, 'comment') + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = scanTo(']]>', i + 9, 'CDATA section');
      current().text += text.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', i)) {
      i = scanTo('?>', i + 2, 'processing instruction') + 2;
      continue;
    }
    if (text.startsWith('<!', i)) {
      // DOCTYPE or other declarations: quote- and bracket-aware to `>`.
      let j = i + 2;
      let quote = null;
      let depth = 0;
      while (j < n) {
        const ch = text[j];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '[') {
          depth += 1;
        } else if (ch === ']') {
          depth = Math.max(0, depth - 1);
        } else if (ch === '>' && depth === 0) {
          break;
        }
        j += 1;
      }
      if (j >= n) fail('TCX has an unterminated declaration');
      i = j + 1;
      continue;
    }
    if (text.startsWith('</', i)) {
      const end = scanTo('>', i + 2, 'closing tag');
      const rawName = text.slice(i + 2, end).trim();
      if (!TAG_NAME_RE.test(rawName)) fail('TCX has a malformed closing tag');
      const name = localName(rawName);
      if (stack.length === 1)
        fail('TCX has a closing tag with no open element');
      const open = stack.pop();
      if (open.name !== name)
        fail(`TCX has mismatched tags: <${open.name}> closed by </${name}>`);
      i = end + 1;
      continue;
    }
    if (text[i] === '<') {
      // Open or self-closing tag: quote-aware scan to the closing `>`.
      let j = i + 1;
      let quote = null;
      while (j < n) {
        const ch = text[j];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '>') {
          break;
        }
        j += 1;
      }
      if (j >= n) fail('TCX has an unterminated tag');
      let inner = text.slice(i + 1, j);
      const selfClosing = /\/\s*$/.test(inner);
      if (selfClosing) inner = inner.replace(/\/\s*$/, '');
      const { name, attrs } = parseTag(inner);
      const el = { name, attrs, children: [], text: '' };
      current().children.push(el);
      if (name === 'Trackpoint') {
        trackpointCount += 1;
        if (trackpointCount > MAX_TCX_POSITIONS)
          fail(`TCX has more than ${MAX_TCX_POSITIONS} trackpoints`);
      }
      if (!selfClosing) stack.push(el);
      i = j + 1;
      continue;
    }
    const next = text.indexOf('<', i);
    const end = next === -1 ? n : next;
    current().text += text.slice(i, end);
    i = end;
  }
  if (stack.length !== 1)
    fail('TCX is truncated — an element was never closed');
  if (root.children.length !== 1)
    fail('TCX must contain exactly one root element');
  return root.children[0];
}

/**
 * Classify text as a Training Center Database file or not. The optional
 * XML declaration is skipped; the first element must be
 * `TrainingCenterDatabase`, with or without a namespace prefix.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isTcxText(text) {
  if (typeof text !== 'string') return false;
  let s = text.replace(/^\uFEFF/, '').replace(/^\s+/, '');
  if (s.startsWith('<?')) {
    const end = s.indexOf('?>');
    if (end === -1) return false;
    s = s.slice(end + 2).replace(/^\s+/, '');
  }
  return /^<([A-Za-z_][\w:.-]*:)?TrainingCenterDatabase(?=[\s/>])/.test(s);
}

/** Child elements of `el` with this local name. */
const kids = (el, name) => el.children.filter((c) => c.name === name);

/** First child element of `el` with this local name, or null. */
const firstKid = (el, name) => kids(el, name)[0] ?? null;

/** Trimmed, entity-decoded text of the first child named `name`. */
const textOf = (el, name) => {
  const child = firstKid(el, name);
  return child ? decodeEntities(child.text).trim() : '';
};

/** All descendant elements of `el` with this local name. */
function descendants(el, name, out = []) {
  for (const child of el.children) {
    if (child.name === name) out.push(child);
    descendants(child, name, out);
  }
  return out;
}

function readNumber(raw, what) {
  const num = Number(raw);
  if (!Number.isFinite(num)) fail(`TCX has an invalid ${what}: ${raw}`);
  return num;
}

/**
 * Read one activity/course trackpoint. Returns null when the point has
 * no usable position (skipped, not refused); refuses the whole file on
 * malformed or out-of-range coordinates or altitudes.
 */
function readTrackpoint(tp) {
  const time = textOf(tp, 'Time') || null;
  const pos = firstKid(tp, 'Position');
  if (!pos) return null;
  const latRaw = textOf(pos, 'LatitudeDegrees');
  const lonRaw = textOf(pos, 'LongitudeDegrees');
  if (!latRaw || !lonRaw) return null;
  const lat = readNumber(latRaw, 'latitude');
  const lon = readNumber(lonRaw, 'longitude');
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180)
    fail(`TCX has out-of-range coordinates: ${latRaw}, ${lonRaw}`);
  const altRaw = textOf(tp, 'AltitudeMeters');
  let alt = null;
  if (altRaw !== '') {
    alt = readNumber(altRaw, 'altitude');
    if (Math.abs(alt) > MAX_TCX_ALTITUDE)
      fail(`TCX has an altitude over ${MAX_TCX_ALTITUDE} m: ${altRaw}`);
  }
  const softNumber = (raw) => {
    if (raw === '') return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  };
  const hrEl = firstKid(tp, 'HeartRateBpm');
  const heartRate = hrEl ? softNumber(textOf(hrEl, 'Value')) : null;
  return {
    lon,
    lat,
    alt,
    time,
    distance: softNumber(textOf(tp, 'DistanceMeters')),
    heartRate,
    cadence: softNumber(textOf(tp, 'Cadence')),
  };
}

/**
 * Turn one `<Track>` element into a feature (LineString for 2+ points,
 * Point for a lone point, nothing for an empty track).
 *
 * @returns {{ feature: object|null, skipped: number }}
 */
function readTrack(trackEl, baseProps, emit) {
  const points = [];
  let skipped = 0;
  for (const tp of kids(trackEl, 'Trackpoint')) {
    const point = readTrackpoint(tp);
    if (!point) {
      skipped += 1;
      continue;
    }
    points.push(point);
  }
  if (points.length === 0) return { feature: null, skipped };
  const coordinates = points.map((p) =>
    p.alt === null ? [p.lon, p.lat] : [p.lon, p.lat, p.alt],
  );
  const feature = {
    type: 'Feature',
    geometry: {
      type: points.length === 1 ? 'Point' : 'LineString',
      coordinates: points.length === 1 ? coordinates[0] : coordinates,
    },
    properties: {
      ...baseProps,
      startTime: points[0].time,
      endTime: points[points.length - 1].time,
      times: points.map((p) => p.time),
      elevations: points.map((p) => p.alt),
      distances: points.map((p) => p.distance),
      heartRates: points.map((p) => p.heartRate),
      cadences: points.map((p) => p.cadence),
    },
  };
  emit(feature);
  return { feature, skipped };
}

/**
 * Parse TCX (Training Center Database) text into a GeoJSON
 * FeatureCollection. One feature per Activity lap `<Track>` and per
 * Course `<Track>`; per-point time/elevation/distance/heart-rate/cadence
 * ride in parallel arrays, null where the source had no value.
 *
 * @param {string} text
 * @returns {{ type: 'FeatureCollection', features: Array, skipped: number }}
 * @throws {TcxGeoImportError} On non-text input, non-TCX text, malformed
 *   XML, bad coordinates/altitudes, or cap breaches.
 */
export function parseTcxToFeatureCollection(text) {
  if (typeof text !== 'string')
    throw new TcxGeoImportError('TCX import needs text');
  if (!isTcxText(text))
    throw new TcxGeoImportError(
      'That file is not a Training Center Database (.tcx) file',
    );
  const root = scanTcxXml(text);
  if (root.name !== 'TrainingCenterDatabase')
    fail('TCX must have a TrainingCenterDatabase root element');

  const features = [];
  let skipped = 0;
  let featureCount = 0;
  const emit = (feature) => {
    featureCount += 1;
    if (featureCount > MAX_TCX_ENTITIES)
      fail(`TCX has more than ${MAX_TCX_ENTITIES} tracks`);
    features.push(feature);
  };

  const activities = firstKid(root, 'Activities');
  if (activities) {
    // Activities may nest inside <History>; walk all descendant Activity
    // elements so real Garmin exports still parse.
    for (const activity of descendants(activities, 'Activity')) {
      const sport = activity.attrs.Sport || 'Other';
      const activityId = textOf(activity, 'Id') || null;
      let lapIndex = 0;
      for (const lap of kids(activity, 'Lap')) {
        const lapStartTime = lap.attrs.StartTime || null;
        let trackIndex = 0;
        for (const track of kids(lap, 'Track')) {
          const result = readTrack(
            track,
            {
              kind: 'activity',
              sport,
              activityId,
              lapIndex,
              lapStartTime,
              trackIndex,
            },
            emit,
          );
          skipped += result.skipped;
          trackIndex += 1;
        }
        lapIndex += 1;
      }
    }
  }

  const courses = firstKid(root, 'Courses');
  if (courses) {
    // Courses may nest inside <CourseFolder> wrappers.
    for (const course of descendants(courses, 'Course')) {
      const courseName =
        textOf(course, 'Name').slice(0, MAX_TCX_NAME_LENGTH) || null;
      let trackIndex = 0;
      for (const track of kids(course, 'Track')) {
        const result = readTrack(
          track,
          { kind: 'course', courseName, trackIndex },
          emit,
        );
        skipped += result.skipped;
        trackIndex += 1;
      }
    }
  }

  return { type: 'FeatureCollection', features, skipped };
}
