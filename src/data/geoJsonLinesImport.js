/**
 * Parse newline-delimited GeoJSON (GeoJSONL): one GeoJSON object per line.
 *
 * GeoJSONL is the line-oriented sibling of GeoJSON — each non-blank line
 * is one complete GeoJSON object (usually a Feature, sometimes a bare
 * geometry). It is what `ogr2ogr -f GeoJSONSeq`, tippecanoe, BigQuery
 * exports and streaming pipelines emit, and it stays parseable line by
 * line, so a broken line can be reported by number instead of rejecting
 * a whole multi-megabyte file as "not valid JSON".
 *
 * Pure module: no imports, no DOM. The parser is faithful — properties,
 * ids and foreign members pass through untouched — and it only validates
 * geometry coordinates, with the same bounds the file loader applies
 * (longitude ±180, latitude ±90, altitude ±1,000,000, two or three
 * numbers per position). A FeatureCollection on one line is flattened
 * into the result; a bare geometry is wrapped in a Feature with empty
 * properties; a Feature with a null geometry is kept as-is.
 *
 * @module data/geoJsonLinesImport
 */

/** An error whose message names the offending line (1-based). */
export class GeoJsonLinesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeoJsonLinesError';
  }
}

/** Most features one GeoJSONL document may hold (matches the loader cap). */
export const MAX_GEOJSONL_FEATURES = 20_000;
/** Most positions one GeoJSONL document may hold (matches the loader cap). */
export const MAX_GEOJSONL_POSITIONS = 250_000;

const GEOJSON_TYPES = new Set([
  'FeatureCollection',
  'Feature',
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

// Nesting depth of the coordinate arrays for each geometry type: a
// position is an array whose first item is a number, reached after
// `depth` descents into `coordinates`.
const GEOMETRY_DEPTH = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

/** Whether `value` is a GeoJSON position inside the loader's bounds. */
function isValidPosition(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 3 &&
    value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90 &&
    (value.length === 2 || Math.abs(value[2]) <= 1_000_000)
  );
}

/**
 * Validate one geometry's coordinates iteratively (deep nesting must not
 * overflow the stack), counting positions against the limit.
 * @param {object} geometry
 * @param {number} line 1-based line number, for errors.
 * @param {{positions: number, maxPositions: number}} state
 */
function validateGeometry(geometry, line, state) {
  const stack = [geometry];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || Array.isArray(node))
      throw new GeoJsonLinesError(`line ${line}: invalid geometry.`);
    if (node.type === 'GeometryCollection') {
      const list = node.geometries;
      if (!Array.isArray(list))
        throw new GeoJsonLinesError(`line ${line}: invalid geometries.`);
      for (let i = 0; i < list.length; i++) {
        const child = list[i];
        if (
          !child ||
          typeof child !== 'object' ||
          Array.isArray(child) ||
          !GEOJSON_TYPES.has(child.type) ||
          child.type === 'Feature' ||
          child.type === 'FeatureCollection'
        )
          throw new GeoJsonLinesError(
            `line ${line}: unsupported geometry in collection.`,
          );
        stack.push(child);
      }
      continue;
    }
    const depth = GEOMETRY_DEPTH[node.type];
    if (depth === undefined)
      throw new GeoJsonLinesError(
        `line ${line}: unsupported geometry type "${node.type}".`,
      );
    if (!Array.isArray(node.coordinates))
      throw new GeoJsonLinesError(`line ${line}: invalid coordinates.`);
    const coords = [[node.coordinates, depth]];
    while (coords.length) {
      const [current, remaining] = coords.pop();
      if (!Array.isArray(current))
        throw new GeoJsonLinesError(`line ${line}: invalid coordinates.`);
      if (remaining === 0) {
        if (!isValidPosition(current))
          throw new GeoJsonLinesError(`line ${line}: invalid coordinates.`);
        state.positions += 1;
        if (state.positions > state.maxPositions)
          throw new GeoJsonLinesError(
            `line ${line}: more than ${state.maxPositions.toLocaleString()} points (the limit).`,
          );
      } else {
        for (let i = 0; i < current.length; i++)
          coords.push([current[i], remaining - 1]);
      }
    }
  }
}

/**
 * Parse GeoJSONL text into a FeatureCollection.
 * @param {string} text One GeoJSON object per line; blank lines skipped.
 * @param {{maxFeatures?: number, maxPositions?: number}} [limits]
 * @returns {{type: 'FeatureCollection', features: object[]}}
 */
export function parseGeoJsonLines(
  text,
  {
    maxFeatures = MAX_GEOJSONL_FEATURES,
    maxPositions = MAX_GEOJSONL_POSITIONS,
  } = {},
) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const features = [];
  const state = { positions: 0, maxPositions };
  const addFeature = (feature, line) => {
    if (features.length >= maxFeatures)
      throw new GeoJsonLinesError(
        `line ${line}: more than ${maxFeatures.toLocaleString()} features (the limit).`,
      );
    features.push(feature);
  };
  // A literal carriage return cannot appear inside a JSON string, so
  // splitting on every line ending is safe. Line numbers stay 1-based
  // and count blank lines, so the number in an error is the file's line.
  const lines = String(text)
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    const raw = lines[index];
    if (!raw.trim()) continue;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new GeoJsonLinesError(`line ${line}: not valid JSON.`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new GeoJsonLinesError(`line ${line}: not a GeoJSON object.`);
    if (!GEOJSON_TYPES.has(value.type))
      throw new GeoJsonLinesError(
        `line ${line}: type "${value.type}" is not GeoJSON.`,
      );
    if (value.type === 'FeatureCollection') {
      if (!Array.isArray(value.features))
        throw new GeoJsonLinesError(
          `line ${line}: that FeatureCollection has no features list.`,
        );
      for (let i = 0; i < value.features.length; i++) {
        const feature = value.features[i];
        if (!feature || feature.type !== 'Feature')
          throw new GeoJsonLinesError(
            `line ${line}: every feature must have type Feature.`,
          );
        if (feature.geometry != null)
          validateGeometry(feature.geometry, line, state);
        addFeature(feature, line);
      }
      continue;
    }
    if (value.type === 'Feature') {
      if (value.geometry != null) validateGeometry(value.geometry, line, state);
      addFeature(value, line);
      continue;
    }
    // A bare geometry (including a GeometryCollection) becomes one
    // Feature with empty properties.
    validateGeometry(value, line, state);
    addFeature({ type: 'Feature', properties: {}, geometry: value }, line);
  }
  if (!features.length)
    throw new GeoJsonLinesError(
      'No GeoJSON features found (every line was blank).',
    );
  return { type: 'FeatureCollection', features };
}

/**
 * Sniff whether text looks like GeoJSONL, for the loader's format
 * detection: at least two non-blank lines, with the first parsing as a
 * GeoJSON object. A pretty-printed multi-line GeoJSON file fails the
 * sniff because its first line (`{`) is not complete JSON; a single
 * one-line GeoJSON object fails it for having only one line.
 * @param {string} text
 * @returns {boolean}
 */
export function isGeoJsonLinesText(text) {
  if (typeof text !== 'string') return false;
  const lines = String(text)
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return false;
  try {
    const first = JSON.parse(lines[0]);
    return (
      Boolean(first) &&
      typeof first === 'object' &&
      !Array.isArray(first) &&
      GEOJSON_TYPES.has(first.type)
    );
  } catch {
    return false;
  }
}
