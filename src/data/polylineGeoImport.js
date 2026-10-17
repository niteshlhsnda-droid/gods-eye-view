/**
 * Session-local Google Encoded Polyline import: an encoded polyline (or
 * several) becomes a GeoJSON FeatureCollection.
 *
 * The gap: the geo file importer (`src/data/geoFileImport.js`) takes
 * GeoJSON, KML/KMZ and GPX, and earlier cycles added CSV, WKT/EWKT,
 * TopoJSON, GeoJSONL, OSM XML and WKB/EWKB — but not the encoded polyline,
 * the compact ASCII form in which routes most often arrive pasted from a
 * routing API (Google Directions / Roads, OSRM, Valhalla, Mapbox), a
 * database column, or a `.txt` export. A polyline is one line (or several
 * legs), not a file format with a header, so there is no magic to sniff —
 * wiring should route by extension / explicit paste, not content sniffing.
 *
 * Evidence: Google's "Encoded Polyline Algorithm" (5-bit chunks, +63,
 * zigzag deltas, default precision 5; precision 6 is the OSRM / Valhalla
 * variant). Coordinates are [lon, lat] in the GeoJSON output.
 *
 * Pure functions, no Cesium/DOM/network. Deliberate limits, in the
 * never-silently-assume posture of the other geo-import cycles:
 * - Precision must be an integer 0–10 (5 = Google, 6 = OSRM/Valhalla).
 *   Anything else is refused: the same string decodes to different
 *   coordinates at different precisions, so guessing would misplace the
 *   whole route.
 * - Every character must be in the 63–126 (`?`–`~`) alphabet. Any other
 *   character — including whitespace inside the string — refuses the
 *   whole input rather than being skipped.
 * - A truncated chunk (continuation bit set at end of input), an odd
 *   value count (a latitude with no longitude), or any point outside
 *   lon ±180 / lat ±90 refuses the whole input, not just the bad point.
 * - A LineString needs at least 2 points; a single-point polyline is
 *   refused by the GeoJSON conversion (decoding it alone still works).
 * - Inputs over the caps are refused, not truncated (same posture as the
 *   geo file importer's entity / position caps).
 * Wiring note: when the importer wires this in, it adds the route here
 * and unifies `MAX_POLYLINE_POINTS` / `MAX_POLYLINE_LINES` with its
 * `MAX_IMPORT_POSITIONS` / `MAX_IMPORT_ENTITIES` (same values) so the two
 * caps cannot drift apart.
 */

/** Most points in one polyline input (same as the importer's position cap). */
export const MAX_POLYLINE_POINTS = 250_000;
/** Most polylines in one array input (same as the importer's entity cap). */
export const MAX_POLYLINE_LINES = 20_000;
/** Default precision: Google's 5 decimal places (~1.1 m). */
export const DEFAULT_POLYLINE_PRECISION = 5;
/** Widest precision accepted (10 decimal places ≈ 0.01 mm). */
export const MAX_POLYLINE_PRECISION = 10;

export class PolylineGeoImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PolylineGeoImportError';
  }
}

function fail(message) {
  throw new PolylineGeoImportError(message);
}

function checkPrecision(precision) {
  if (
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > MAX_POLYLINE_PRECISION
  ) {
    fail(
      `Encoded polyline precision must be an integer 0–${MAX_POLYLINE_PRECISION}, got ${String(precision)}.`,
    );
  }
  return precision;
}

/**
 * Decode one encoded polyline into `[lon, lat]` pairs.
 * @param {string} encoded The encoded polyline.
 * @param {{ precision?: number }} [options]
 * @returns {Array<[number, number]>}
 */
export function decodeEncodedPolyline(
  encoded,
  { precision = DEFAULT_POLYLINE_PRECISION } = {},
) {
  checkPrecision(precision);
  if (typeof encoded !== 'string') {
    fail('Encoded polyline import needs text.');
  }
  const text = encoded.trim();
  if (!text) {
    fail('Encoded polyline import needs text.');
  }
  const factor = 10 ** precision;
  const points = [];
  let lat = 0;
  let lon = 0;
  let index = 0;
  while (index < text.length) {
    const values = [];
    for (let pair = 0; pair < 2; pair += 1) {
      let result = 0;
      let shift = 0;
      let chunks = 0;
      for (;;) {
        if (index >= text.length) {
          fail('That encoded polyline ends mid-value — it looks truncated.');
        }
        const code = text.charCodeAt(index);
        index += 1;
        chunks += 1;
        if (code < 63 || code > 126) {
          fail(
            `That encoded polyline has an invalid character at position ${index - 1} — only '?' (63) through '~' (126) are allowed.`,
          );
        }
        if (chunks > 12) {
          fail(
            'That encoded polyline has an overlong value — it looks corrupt.',
          );
        }
        const chunk = code - 63;
        // Arithmetic, not bitwise: deltas at high precision exceed 32 bits.
        result += (chunk & 0x1f) * 2 ** shift;
        shift += 5;
        if (chunk < 0x20) break;
      }
      const delta = result % 2 === 1 ? -(result + 1) / 2 : result / 2;
      values.push(delta);
    }
    lat += values[0];
    lon += values[1];
    const latitude = lat / factor;
    const longitude = lon / factor;
    if (latitude < -90 || latitude > 90) {
      fail(
        `That encoded polyline has a latitude ${latitude} outside ±90 — refusing it rather than re-labelling it.`,
      );
    }
    if (longitude < -180 || longitude > 180) {
      fail(
        `That encoded polyline has a longitude ${longitude} outside ±180 — refusing it rather than re-labelling it.`,
      );
    }
    points.push([longitude, latitude]);
    if (points.length > MAX_POLYLINE_POINTS) {
      fail(
        `That encoded polyline has more than ${MAX_POLYLINE_POINTS.toLocaleString()} points (the limit).`,
      );
    }
  }
  return points;
}

/**
 * Convert one encoded polyline (a string) or several legs (an array of
 * strings) into a GeoJSON FeatureCollection with a single LineString or
 * MultiLineString feature.
 * @param {string | string[]} input
 * @param {{ precision?: number, properties?: object }} [options]
 * @returns {object} GeoJSON FeatureCollection.
 */
export function encodedPolylineToGeoJson(
  input,
  { precision = DEFAULT_POLYLINE_PRECISION, properties } = {},
) {
  checkPrecision(precision);
  if (properties !== undefined) {
    if (
      typeof properties !== 'object' ||
      properties === null ||
      Array.isArray(properties)
    ) {
      fail('Encoded polyline properties must be a plain object.');
    }
  }
  const lines = Array.isArray(input) ? input : [input];
  if (lines.length === 0) {
    fail('Encoded polyline import needs at least one polyline.');
  }
  if (lines.length > MAX_POLYLINE_LINES) {
    fail(
      `That input has more than ${MAX_POLYLINE_LINES.toLocaleString()} polylines (the limit).`,
    );
  }
  const coordinates = lines.map((line) => {
    const points = decodeEncodedPolyline(line, { precision });
    if (points.length < 2) {
      fail(
        'An encoded polyline needs at least 2 points to make a line — a single point is refused.',
      );
    }
    return points;
  });
  const total = coordinates.reduce((sum, line) => sum + line.length, 0);
  if (total > MAX_POLYLINE_POINTS) {
    fail(
      `That input has more than ${MAX_POLYLINE_POINTS.toLocaleString()} points (the limit).`,
    );
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { ...(properties ?? {}) },
        geometry: Array.isArray(input)
          ? { type: 'MultiLineString', coordinates }
          : { type: 'LineString', coordinates: coordinates[0] },
      },
    ],
  };
}
