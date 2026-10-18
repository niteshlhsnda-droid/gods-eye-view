/**
 * Session-local CSV point import: a delimited-text table with latitude /
 * longitude columns becomes a GeoJSON FeatureCollection of points.
 *
 * The gap: `GEO_FILE_ACCEPT` (geo file import, `feature/geo-import`) takes
 * GeoJSON, KML/KMZ and GPX, but not CSV — yet CSV is the interchange
 * GPS loggers, spreadsheet exports and QGIS "Add Delimited Text Layer"
 * produce. The fork already parses one CSV dialect (`src/data/firmsCsv.js`,
 * NASA FIRMS), but that parser splits naively on commas, so a place name
 * like "Patna, Bihar" breaks it. This module parses RFC 4180 properly:
 * quoted fields, embedded commas, quotes and newlines, CRLF, BOM.
 *
 * Pure functions, no Cesium/DOM/network. Two deliberate limits:
 * - Only explicit latitude/longitude column names count. Bare `x` / `y`
 *   are NOT accepted: they may be projected metres, and this importer
 *   assumes WGS 84 degrees — silently re-labelling a projected grid as
 *   degrees would put points on the wrong continent (ruling #5's spirit:
 *   never silently assume a CRS).
 * - Rows over the cap are refused, not truncated (same posture as the geo
 *   file importer's entity cap).
 * Wiring note: `feature/geo-import`'s `geoFileImport.js` does not exist on
 * `main`; when it wires this in, it adds `.csv` to `GEO_FILE_ACCEPT`,
 * routes `.csv` here, and unifies `MAX_CSV_ROWS` with its
 * `MAX_IMPORT_ENTITIES` (both 20,000) so the two caps cannot drift apart.
 */

/** Most data rows one CSV file may carry (same as the geo importer's entity cap). */
export const MAX_CSV_ROWS = 20_000;
/** Most columns one CSV file may carry — bounds header explosion. */
export const MAX_CSV_COLUMNS = 200;

/** Latitude column names (case-insensitive, trimmed). */
const LAT_NAMES = new Set(['latitude', 'lat', 'lat_dd', 'lat_deg']);
/** Longitude column names (case-insensitive, trimmed). */
const LON_NAMES = new Set([
  'longitude',
  'lon',
  'lng',
  'long',
  'lon_dd',
  'lon_deg',
]);

/** An error whose message is meant for the person who chose the file. */
export class CsvGeoImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CsvGeoImportError';
  }
}

/**
 * Parse CSV text into rows of cell strings (RFC 4180: double-quote escaping,
 * quoted commas/quotes/newlines, CRLF, BOM). Throws `CsvGeoImportError` on
 * an unterminated quoted field.
 *
 * @param {string} text
 * @returns {string[][]} Rows; blank lines are dropped, the header is rows[0].
 */
export function parseCsv(text) {
  if (typeof text !== 'string')
    throw new CsvGeoImportError('CSV import needs text');
  const input = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '' && !quoted) {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      quoted = false;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      quoted = false;
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (inQuotes)
    throw new CsvGeoImportError('CSV has an unterminated quoted field');
  if (field !== '' || quoted || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/**
 * Locate the latitude / longitude columns of a header row.
 *
 * @param {string[]} header
 * @returns {{latIndex: number, lonIndex: number}|null} Null when no
 *   latitude + longitude pair is present.
 */
export function detectCsvGeoColumns(header) {
  if (!Array.isArray(header)) return null;
  let latIndex = -1;
  let lonIndex = -1;
  header.forEach((cell, index) => {
    const name = String(cell ?? '')
      .trim()
      .toLowerCase();
    if (latIndex === -1 && LAT_NAMES.has(name)) latIndex = index;
    if (lonIndex === -1 && LON_NAMES.has(name)) lonIndex = index;
  });
  return latIndex === -1 || lonIndex === -1 ? null : { latIndex, lonIndex };
}

/** A cell as a number when it parses cleanly, else its raw string. */
function cellValue(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return '';
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : String(raw ?? '');
}

/**
 * Parse a CSV table with latitude/longitude columns into points.
 *
 * Rows with missing, non-numeric or out-of-range coordinates are skipped
 * and counted in `skipped`; rows with more cells than the header are
 * malformed and skipped too. Extra columns become feature properties.
 * A (0, 0) row is kept: it is a real place (Gulf of Guinea), and dropping
 * it would silently delete data.
 *
 * @param {string} text CSV text; the first non-blank row is the header.
 * @param {{maxRows?: number}} [options]
 * @returns {{type: 'FeatureCollection', features: object[], skipped: number, columns: string[]}}
 * @throws {CsvGeoImportError} When no lat/lon columns exist, or the row cap is exceeded.
 */
export function parseCsvGeo(text, { maxRows = MAX_CSV_ROWS } = {}) {
  const rows = parseCsv(text);
  if (!rows.length) throw new CsvGeoImportError('CSV file is empty');
  const columns = rows[0].map((cell) => String(cell ?? '').trim());
  if (columns.length > MAX_CSV_COLUMNS)
    throw new CsvGeoImportError(
      `CSV has ${columns.length} columns (max ${MAX_CSV_COLUMNS})`,
    );
  const found = detectCsvGeoColumns(columns);
  if (!found)
    throw new CsvGeoImportError(
      `CSV has no latitude/longitude columns (found: ${columns.join(', ') || '(none)'})`,
    );
  const data = rows.slice(1);
  if (data.length > maxRows)
    throw new CsvGeoImportError(`CSV has ${data.length} rows (max ${maxRows})`);
  const features = [];
  let skipped = 0;
  for (const row of data) {
    if (row.length > columns.length) {
      skipped++;
      continue;
    }
    const latRaw = String(row[found.latIndex] ?? '').trim();
    const lonRaw = String(row[found.lonIndex] ?? '').trim();
    // An empty cell is missing data, not 0: Number('') is 0, which would
    // silently place the row at Null Island.
    if (latRaw === '' || lonRaw === '') {
      skipped++;
      continue;
    }
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      skipped++;
      continue;
    }
    const properties = {};
    columns.forEach((name, index) => {
      if (index === found.latIndex || index === found.lonIndex) return;
      if (name === '') return;
      properties[name] = cellValue(row[index]);
    });
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties,
    });
  }
  return { type: 'FeatureCollection', features, skipped, columns };
}
