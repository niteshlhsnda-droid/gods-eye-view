/**
 * Session-local TopoJSON import: a Topology becomes a GeoJSON
 * FeatureCollection.
 *
 * The gap: the geo file importer (`GEO_FILE_ACCEPT` in
 * `src/data/geoFileImport.js`) takes GeoJSON, KML/KMZ and GPX, but not
 * TopoJSON — yet TopoJSON is the compact interchange form that
 * `topojson-server`, Mapshaper, QGIS (via export) and D3 pipelines produce,
 * and the form in which shared-boundary datasets (counties, states,
 * constituencies) most often arrive: one arc shared by two polygons is
 * stored once instead of twice, so a boundary file is far smaller than the
 * equivalent GeoJSON. Cycle 1 closed the same gap for CSV
 * (`src/data/csvGeoImport.js`), Cycle 2 for WKT (`src/data/wktGeoImport.js`);
 * this closes it for TopoJSON.
 *
 * Evidence: the TopoJSON specification (github.com/topojson/topojson-specification):
 * a Topology carries `arcs` (delta-encoded, quantized when a `transform`
 * is present), `objects` (named geometries) and an optional `transform`
 * (`scale` / `translate`). An arc index `i >= 0` reads `arcs[i]` forward;
 * a negative index reads `arcs[~i]` reversed. Point / MultiPoint
 * coordinates are absolute (quantized, not delta-encoded); arc coordinates
 * are deltas that accumulate.
 *
 * Pure functions, no Cesium/DOM/network. Deliberate limits, in the
 * never-silently-assume posture of ruling #5:
 * - Coordinates are assumed WGS 84 degrees and range-checked
 *   (lon ±180, lat ±90 — the same bounds the upstream GeoJSON counter
 *   applies). Out-of-range input is refused, not re-labelled.
 * - TopoJSON positions are two-element `[x, y]` pairs. A three-element
 *   position is refused: TopoJSON has no altitude slot, so accepting one
 *   would silently drop (or invent) a third coordinate.
 * - Polygon rings must already be closed (first == last) with at least
 *   four positions; an unclosed or degenerate ring is refused rather
 *   than silently auto-closed.
 * - Arc references must be integers inside the arcs list; a dangling
 *   reference is refused.
 * - The same arc referenced many times expands on every reference, so a
 *   small file could decode into a huge geometry (arc-reference
 *   amplification). Emitted positions are counted against the position
 *   cap as they are emitted, and decoded arcs are cached so each arc is
 *   decoded once.
 * - A `null` geometry becomes a Feature with `geometry: null` (valid
 *   GeoJSON); `null` members inside a GeometryCollection are skipped,
 *   because a GeometryCollection cannot hold a null member.
 * - Object keys become feature names only when the geometry carries no
 *   name of its own; an embedded `properties.name` wins. Geometry `id`
 *   members are dropped, matching the importer's scrubbing.
 * - Files over the caps are refused, not truncated (same posture as the
 *   geo file importer's entity cap).
 * Wiring note: when the importer wires this in, it passes its
 * `MAX_IMPORT_ENTITIES` / `MAX_IMPORT_POSITIONS` as `maxFeatures` /
 * `maxPositions` so the two caps cannot drift apart.
 */

/** Most features (named objects) one TopoJSON input may carry (same as the importer's entity cap). */
export const MAX_TOPOJSON_FEATURES = 20_000;
/** Most coordinate tuples one TopoJSON input may decode (same as the importer's position cap). */
export const MAX_TOPOJSON_POSITIONS = 250_000;
/** Deepest GeometryCollection nesting — bounds adversarial nesting. */
export const MAX_TOPOJSON_DEPTH = 32;
/** Largest accepted longitude magnitude, mirroring the GeoJSON counter. */
export const MAX_TOPOJSON_LONGITUDE = 180;
/** Largest accepted latitude magnitude, mirroring the GeoJSON counter. */
export const MAX_TOPOJSON_LATITUDE = 90;

/** An error whose message is meant for the person who chose the file. */
export class TopoJsonImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TopoJsonImportError';
  }
}

/** Whether two decoded positions are the same point. */
function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

/** Whether the value is a `[number, number]` pair of finite numbers. */
function isFinitePair(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => Number.isFinite(item))
  );
}

/**
 * Parse the optional quantization transform, or null for absolute arcs.
 * @param {unknown} transform
 * @returns {{scale: number[], translate: number[]}|null}
 */
function parseTransform(transform) {
  if (transform == null) return null;
  if (
    !transform ||
    typeof transform !== 'object' ||
    Array.isArray(transform) ||
    !isFinitePair(transform.scale) ||
    !isFinitePair(transform.translate)
  )
    throw new TopoJsonImportError(
      'That TopoJSON file has an invalid transform.',
    );
  return { scale: transform.scale, translate: transform.translate };
}

/** Decodes arcs once, validates coordinates, and counts emitted positions. */
class ArcDecoder {
  constructor(arcs, transform, maxPositions) {
    this.arcs = arcs;
    this.transform = transform;
    this.maxPositions = maxPositions;
    this.positions = 0;
    this.cache = new Map();
  }

  /** Count one emitted position, refusing past the cap. */
  countPosition() {
    this.positions += 1;
    if (this.positions > this.maxPositions)
      throw new TopoJsonImportError(
        `That file has more than ${this.maxPositions.toLocaleString()} points (the limit).`,
      );
  }

  /** Range-check one decoded position. */
  checkRange([x, y]) {
    if (
      Math.abs(x) > MAX_TOPOJSON_LONGITUDE ||
      Math.abs(y) > MAX_TOPOJSON_LATITUDE
    )
      throw new TopoJsonImportError('That TopoJSON has invalid coordinates.');
  }

  /**
   * Decode one arc by reference (negative indices read the arc reversed).
   * The returned array must not be mutated by callers.
   * @param {number} raw
   * @returns {number[][]}
   */
  decodeArc(raw) {
    if (!Number.isInteger(raw))
      throw new TopoJsonImportError(
        'That TopoJSON file has an arc reference that is not an integer.',
      );
    const reversed = raw < 0;
    const index = reversed ? ~raw : raw;
    if (index < 0 || index >= this.arcs.length)
      throw new TopoJsonImportError(
        'That TopoJSON file references an arc that does not exist.',
      );
    let decoded = this.cache.get(index);
    if (!decoded) {
      const arc = this.arcs[index];
      if (!Array.isArray(arc) || arc.length < 2)
        throw new TopoJsonImportError(
          'That TopoJSON file has an arc with fewer than two points.',
        );
      decoded = [];
      let x = 0;
      let y = 0;
      for (const position of arc) {
        if (!isFinitePair(position))
          throw new TopoJsonImportError(
            'That TopoJSON has invalid coordinates.',
          );
        if (this.transform) {
          x += position[0];
          y += position[1];
          decoded.push([
            this.transform.translate[0] + this.transform.scale[0] * x,
            this.transform.translate[1] + this.transform.scale[1] * y,
          ]);
        } else {
          decoded.push([position[0], position[1]]);
        }
        this.checkRange(decoded[decoded.length - 1]);
      }
      this.cache.set(index, decoded);
    }
    return reversed ? [...decoded].reverse() : decoded;
  }

  /**
   * Join arc references into one coordinate list, dropping the duplicate
   * junction point where two arcs meet (the shared endpoint is stored in
   * both arcs by construction).
   * @param {unknown} indices
   * @returns {number[][]}
   */
  joinArcIndices(indices) {
    if (!Array.isArray(indices))
      throw new TopoJsonImportError(
        'That TopoJSON file has a geometry whose arcs are not a list.',
      );
    const coordinates = [];
    for (const raw of indices) {
      const arc = this.decodeArc(raw);
      for (let i = 0; i < arc.length; i++) {
        if (
          i === 0 &&
          coordinates.length &&
          samePoint(coordinates[coordinates.length - 1], arc[0])
        )
          continue;
        coordinates.push(arc[i]);
        this.countPosition();
      }
    }
    return coordinates;
  }

  /**
   * Decode one absolute (non-delta) point coordinate, e.g. a Point.
   * @param {unknown} position
   * @returns {number[]}
   */
  decodePoint(position) {
    if (!isFinitePair(position))
      throw new TopoJsonImportError('That TopoJSON has invalid coordinates.');
    const decoded = this.transform
      ? [
          this.transform.translate[0] + this.transform.scale[0] * position[0],
          this.transform.translate[1] + this.transform.scale[1] * position[1],
        ]
      : [position[0], position[1]];
    this.checkRange(decoded);
    this.countPosition();
    return decoded;
  }
}

/**
 * Convert one TopoJSON geometry object to a GeoJSON geometry.
 * @param {unknown} geometry
 * @param {ArcDecoder} decoder
 * @param {number} depth
 * @returns {object|null}
 */
function convertGeometry(geometry, decoder, depth) {
  if (geometry == null) return null;
  if (depth > MAX_TOPOJSON_DEPTH)
    throw new TopoJsonImportError('That TopoJSON file is nested too deeply.');
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry))
    throw new TopoJsonImportError(
      'That TopoJSON contains an unsupported geometry.',
    );
  switch (geometry.type) {
    case 'Point':
      return {
        type: 'Point',
        coordinates: decoder.decodePoint(geometry.coordinates),
      };
    case 'MultiPoint': {
      if (!Array.isArray(geometry.coordinates))
        throw new TopoJsonImportError('That TopoJSON has invalid coordinates.');
      return {
        type: 'MultiPoint',
        coordinates: geometry.coordinates.map((position) =>
          decoder.decodePoint(position),
        ),
      };
    }
    case 'LineString':
      return {
        type: 'LineString',
        coordinates: decoder.joinArcIndices(geometry.arcs),
      };
    case 'MultiLineString': {
      if (!Array.isArray(geometry.arcs))
        throw new TopoJsonImportError(
          'That TopoJSON file has a geometry whose arcs are not a list.',
        );
      return {
        type: 'MultiLineString',
        coordinates: geometry.arcs.map((line) => decoder.joinArcIndices(line)),
      };
    }
    case 'Polygon': {
      if (!Array.isArray(geometry.arcs) || !geometry.arcs.length)
        throw new TopoJsonImportError(
          'That TopoJSON file has a polygon with no rings.',
        );
      return {
        type: 'Polygon',
        coordinates: geometry.arcs.map((ring) => decodeRing(ring, decoder)),
      };
    }
    case 'MultiPolygon': {
      if (!Array.isArray(geometry.arcs))
        throw new TopoJsonImportError(
          'That TopoJSON file has a geometry whose arcs are not a list.',
        );
      return {
        type: 'MultiPolygon',
        coordinates: geometry.arcs.map((polygon) => {
          if (!Array.isArray(polygon) || !polygon.length)
            throw new TopoJsonImportError(
              'That TopoJSON file has a polygon with no rings.',
            );
          return polygon.map((ring) => decodeRing(ring, decoder));
        }),
      };
    }
    case 'GeometryCollection': {
      if (!Array.isArray(geometry.geometries))
        throw new TopoJsonImportError('That TopoJSON has invalid geometries.');
      const geometries = [];
      for (const member of geometry.geometries) {
        if (member == null) continue;
        geometries.push(convertGeometry(member, decoder, depth + 1));
      }
      return { type: 'GeometryCollection', geometries };
    }
    default:
      throw new TopoJsonImportError(
        'That TopoJSON contains an unsupported geometry.',
      );
  }
}

/**
 * Decode one polygon ring: arcs joined, then the closure check the
 * importer refuses to guess at.
 * @param {unknown} ring
 * @param {ArcDecoder} decoder
 * @returns {number[][]}
 */
function decodeRing(ring, decoder) {
  const coordinates = decoder.joinArcIndices(ring);
  if (!coordinates.length)
    throw new TopoJsonImportError(
      'That TopoJSON file has a polygon ring with no points.',
    );
  if (coordinates.length < 4)
    throw new TopoJsonImportError(
      'That TopoJSON file has a polygon ring with fewer than four points.',
    );
  if (!samePoint(coordinates[0], coordinates[coordinates.length - 1]))
    throw new TopoJsonImportError(
      'That TopoJSON file has a polygon ring that does not close.',
    );
  return coordinates;
}

/**
 * The feature properties for one named object: its own properties, with
 * the object key as the name only when it carries no name itself.
 * @param {unknown} geometry
 * @param {string} key
 * @returns {object}
 */
function featureProperties(geometry, key) {
  const raw =
    geometry && typeof geometry === 'object' ? geometry.properties : undefined;
  const properties =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  if (properties.name == null) properties.name = key;
  return properties;
}

/**
 * Convert a parsed TopoJSON Topology object to a GeoJSON
 * FeatureCollection — one Feature per named object.
 * @param {unknown} topology
 * @param {{maxFeatures?: number, maxPositions?: number}} [limits]
 * @returns {object}
 */
export function topoJsonToGeoJson(
  topology,
  {
    maxFeatures = MAX_TOPOJSON_FEATURES,
    maxPositions = MAX_TOPOJSON_POSITIONS,
  } = {},
) {
  if (
    !topology ||
    typeof topology !== 'object' ||
    Array.isArray(topology) ||
    topology.type !== 'Topology'
  )
    throw new TopoJsonImportError('That JSON file is not TopoJSON.');
  if (!Array.isArray(topology.arcs))
    throw new TopoJsonImportError('That TopoJSON file has no arcs list.');
  const objects = topology.objects;
  if (!objects || typeof objects !== 'object' || Array.isArray(objects))
    throw new TopoJsonImportError('That TopoJSON file has no objects.');
  const names = Object.keys(objects);
  if (!names.length)
    throw new TopoJsonImportError('That TopoJSON file has no objects.');
  if (names.length > maxFeatures)
    throw new TopoJsonImportError(
      `That file has more than ${maxFeatures.toLocaleString()} features (the limit).`,
    );
  const decoder = new ArcDecoder(
    topology.arcs,
    parseTransform(topology.transform),
    maxPositions,
  );
  const features = names.map((name) => ({
    type: 'Feature',
    properties: featureProperties(objects[name], name),
    geometry: convertGeometry(objects[name], decoder, 0),
  }));
  return { type: 'FeatureCollection', features };
}

/**
 * Parse TopoJSON text into a GeoJSON FeatureCollection. Throws
 * `TopoJsonImportError` for anything that is not a TopoJSON Topology.
 * @param {string} text
 * @param {{maxFeatures?: number, maxPositions?: number}} [limits]
 * @returns {object}
 */
export function parseTopoJsonText(text, limits = {}) {
  let value;
  try {
    value = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    throw new TopoJsonImportError('That file is not valid JSON.');
  }
  return topoJsonToGeoJson(value, limits);
}
