/**
 * Session-local WKT (Well-Known Text) import: one or more WKT / EWKT
 * geometries become a GeoJSON FeatureCollection.
 *
 * The gap: the geo file importer (`GEO_FILE_ACCEPT` in the upstream
 * original, `src/data/geoFileImport.js`) takes GeoJSON, KML/KMZ and GPX,
 * but not WKT — yet WKT is the interchange text that PostGIS
 * (`ST_AsText` / `ST_AsEWKT`), QGIS, Shapely and GDAL produce, and the
 * form in which coordinates most often arrive pasted from a database
 * console or a GIS export. Cycle 1 closed the same gap for CSV
 * (`src/data/csvGeoImport.js`); this closes it for WKT.
 *
 * Evidence: OGC Simple Features / ISO 19125 Well-Known Text
 * (POINT / LINESTRING / POLYGON / MULTI* / GEOMETRYCOLLECTION, with
 * `EMPTY`, `Z` qualifiers and the PostGIS `SRID=<n>;` EWKT prefix —
 * PostGIS docs, "OpenGIS WKB and WKT" / "PostGIS EWKB, EWKT and
 * Canonical Forms"). Upstream's importer accepts no `.wkt` and its
 * `GEO_FILE_ACCEPT` is `.geojson,.json,.kml,.kmz,.gpx`.
 *
 * Pure functions, no Cesium/DOM/network. Deliberate limits, in the
 * never-silently-assume posture of ruling #5:
 * - Coordinates are assumed WGS 84 degrees and range-checked
 *   (lon ±180, lat ±90, |z| ≤ 1,000,000 — the same bounds the upstream
 *   GeoJSON counter applies). Out-of-range input is refused, not
 *   re-labelled.
 * - An `SRID=<n>;` prefix is accepted only for 4326 (WGS 84). Any other
 *   SRID is refused: silently treating projected metres as degrees would
 *   put features on the wrong continent.
 * - `M` / `ZM` (measured) dimensions are refused: GeoJSON has no measure
 *   slot, so accepting them would silently drop the measure. A bare
 *   3-tuple is read as XYZ (the PostGIS EWKT canonical form drops the
 *   `Z` qualifier); a bare 4-tuple (XYZM) is refused.
 * - Polygon rings must already be closed (first == last); an unclosed
 *   ring is refused rather than silently auto-closed.
 * - `EMPTY` geometries become a Feature with `geometry: null` (valid
 *   GeoJSON); `EMPTY` members inside a GEOMETRYCOLLECTION are skipped,
 *   because a GeometryCollection cannot hold a null member.
 * - Files over the caps are refused, not truncated (same posture as the
 *   geo file importer's entity cap).
 * Wiring note: when the importer wires this in, it adds `.wkt` to
 * `GEO_FILE_ACCEPT`, routes `.wkt` here, and unifies `MAX_WKT_FEATURES`
 * / `MAX_WKT_POSITIONS` with its `MAX_IMPORT_ENTITIES` /
 * `MAX_IMPORT_POSITIONS` (same values) so the two caps cannot drift apart.
 */

/** Most geometries one WKT input may carry (same as the importer's entity cap). */
export const MAX_WKT_FEATURES = 20_000;
/** Most coordinate tuples in one WKT input (same as the importer's position cap). */
export const MAX_WKT_POSITIONS = 250_000;
/** Deepest GEOMETRYCOLLECTION nesting — bounds adversarial nesting. */
export const MAX_WKT_DEPTH = 32;
/** Largest accepted altitude, mirroring the upstream GeoJSON bound. */
export const MAX_WKT_ALTITUDE = 1_000_000;
/** The only SRID accepted: WGS 84. */
export const WKT_WGS84_SRID = 4326;

const GEOMETRY_TYPES = new Set([
  'POINT',
  'LINESTRING',
  'POLYGON',
  'MULTIPOINT',
  'MULTILINESTRING',
  'MULTIPOLYGON',
  'GEOMETRYCOLLECTION',
]);

/** An error whose message is meant for the person who chose the file. */
export class WktGeoImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WktGeoImportError';
  }
}

/**
 * Whether the text looks like WKT (optional `SRID=<n>;` prefix, then a
 * geometry keyword). Used for format detection; parsing still validates.
 * @param {unknown} text
 * @returns {boolean}
 */
export function isWktText(text) {
  if (typeof text !== 'string') return false;
  return /^\s*(?:SRID\s*=\s*\d+\s*;\s*)?(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i.test(
    text.replace(/^\uFEFF/, ''),
  );
}

class Parser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.positions = 0;
  }

  fail(message) {
    throw new WktGeoImportError(message);
  }

  skipWhitespace() {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) {
      this.pos += 1;
    }
  }

  peek() {
    return this.text[this.pos];
  }

  /** Consume one expected character, or fail. */
  expect(char) {
    this.skipWhitespace();
    if (this.text[this.pos] !== char) {
      this.fail(
        `WKT import expected "${char}" at character ${this.pos + 1} but found ${this.describe()}.`,
      );
    }
    this.pos += 1;
  }

  describe() {
    const rest = this.text.slice(this.pos, this.pos + 12);
    return rest ? `"${rest}"` : 'the end of the input';
  }

  /** Read one word of letters, or fail. */
  readWord() {
    this.skipWhitespace();
    const anchored = /^[A-Za-z]+/.exec(this.text.slice(this.pos));
    if (!anchored) {
      this.fail(
        `WKT import expected a geometry type at character ${this.pos + 1} but found ${this.describe()}.`,
      );
    }
    this.pos += anchored[0].length;
    return anchored[0].toUpperCase();
  }

  /** Read one number (decimal or scientific notation), or fail. */
  readNumber() {
    this.skipWhitespace();
    const anchored = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.pos),
    );
    if (!anchored) {
      this.fail(
        `WKT import expected a number at character ${this.pos + 1} but found ${this.describe()}.`,
      );
    }
    this.pos += anchored[0].length;
    const value = Number(anchored[0]);
    if (!Number.isFinite(value)) {
      this.fail(`WKT import found a non-finite number "${anchored[0]}".`);
    }
    return value;
  }

  /** Optional `SRID=<n>;` EWKT prefix. Only 4326 is accepted. */
  readSridPrefix() {
    this.skipWhitespace();
    const plain = /^SRID\s*=\s*(\d+)\s*;/.exec(this.text.slice(this.pos));
    if (!plain) return;
    const srid = Number(plain[1]);
    if (srid !== WKT_WGS84_SRID) {
      this.fail(
        `WKT import refuses SRID=${srid}: only SRID=4326 (WGS 84) is accepted, and other reference systems are never silently treated as degrees.`,
      );
    }
    this.pos += plain[0].length;
  }

  /**
   * Split a type word into its base type and dimension qualifier.
   * Accepts `POINT Z (...)`, `POINTZ(...)`, and bare `POINT(...)`.
   * @param {string} word
   * @returns {{type: string, qualifier: string}}
   */
  splitTypeWord(word) {
    for (const type of GEOMETRY_TYPES) {
      if (word === type) return { type, qualifier: '' };
      if (word.startsWith(type)) {
        const qualifier = word.slice(type.length);
        if (['Z', 'M', 'ZM'].includes(qualifier)) return { type, qualifier };
        this.fail(`WKT import does not recognise the geometry type "${word}".`);
      }
    }
    this.fail(`WKT import does not recognise the geometry type "${word}".`);
  }

  /**
   * Read the optional separate-word qualifier (`POINT Z (...)`).
   * @param {string} qualifier Qualifier already attached to the type word.
   * @returns {string}
   */
  readQualifier(qualifier) {
    if (qualifier) return qualifier;
    const saved = this.pos;
    this.skipWhitespace();
    const next = this.text.slice(this.pos);
    const anchored = /^(Z|M|ZM)(?![A-Za-z])/.exec(next);
    if (!anchored) {
      this.pos = saved;
      return '';
    }
    // Only a qualifier when `(` or `EMPTY` follows it.
    const after = next.slice(anchored[0].length);
    if (!/^\s*(\(|EMPTY\b)/i.test(after)) {
      this.pos = saved;
      return '';
    }
    this.pos += anchored[0].length;
    return anchored[0];
  }

  /** Reject measured dimensions: GeoJSON has no measure slot. */
  checkQualifier(qualifier) {
    if (qualifier === 'M' || qualifier === 'ZM') {
      this.fail(
        `WKT import refuses "${qualifier}" (measured) coordinates: GeoJSON has no measure slot, so the measure would be silently dropped.`,
      );
    }
  }

  /** One coordinate tuple. `hasZ` forces exactly 3 numbers. */
  readTuple(hasZ) {
    const values = [this.readNumber()];
    for (;;) {
      this.skipWhitespace();
      const char = this.peek();
      if (char === ',' || char === ')' || char === undefined) break;
      if (/[0-9+\-.]/.test(char)) {
        values.push(this.readNumber());
        continue;
      }
      this.fail(
        `WKT import expected a number, "," or ")" at character ${this.pos + 1} but found ${this.describe()}.`,
      );
    }
    if (hasZ && values.length !== 3) {
      this.fail(
        `WKT import expected exactly 3 numbers for a Z coordinate but found ${values.length}.`,
      );
    }
    if (!hasZ && values.length !== 2 && values.length !== 3) {
      this.fail(
        `WKT import refuses a ${values.length}-number coordinate: only 2 (XY) or 3 (XYZ) numbers are supported, never 4 (XYZM).`,
      );
    }
    const [lon, lat, z] = values;
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
      this.fail(
        `WKT import refuses longitude ${lon}: it must be within ±180 degrees (WGS 84).`,
      );
    }
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
      this.fail(
        `WKT import refuses latitude ${lat}: it must be within ±90 degrees (WGS 84).`,
      );
    }
    if (z !== undefined && Math.abs(z) > MAX_WKT_ALTITUDE) {
      this.fail(
        `WKT import refuses altitude ${z}: its magnitude must be at most ${MAX_WKT_ALTITUDE.toLocaleString()}.`,
      );
    }
    this.positions += 1;
    if (this.positions > MAX_WKT_POSITIONS) {
      this.fail(
        `That WKT creates more than ${MAX_WKT_POSITIONS.toLocaleString()} positions (the limit).`,
      );
    }
    return z === undefined ? [lon, lat] : [lon, lat, z];
  }

  /** A comma-separated list of tuples inside `( ... )`. */
  readTupleList(hasZ, { min = 0 } = {}) {
    this.expect('(');
    const list = [this.readTuple(hasZ)];
    for (;;) {
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.pos += 1;
        list.push(this.readTuple(hasZ));
        continue;
      }
      break;
    }
    this.expect(')');
    if (list.length < min) {
      this.fail(
        `WKT import expected at least ${min} positions but found ${list.length}.`,
      );
    }
    return list;
  }

  readRing(hasZ) {
    const ring = this.readTupleList(hasZ, { min: 4 });
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (
      first.length !== last.length ||
      first.some((value, index) => value !== last[index])
    ) {
      this.fail(
        'WKT import refuses an unclosed polygon ring: the first and last positions must be identical.',
      );
    }
    return ring;
  }

  readRingList(hasZ) {
    this.expect('(');
    const rings = [this.readRing(hasZ)];
    for (;;) {
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.pos += 1;
        rings.push(this.readRing(hasZ));
        continue;
      }
      break;
    }
    this.expect(')');
    return rings;
  }

  /**
   * Parse one geometry. Returns a GeoJSON geometry, or null for EMPTY.
   * @param {number} depth GEOMETRYCOLLECTION nesting depth.
   * @returns {object|null}
   */
  readGeometry(depth) {
    if (depth > MAX_WKT_DEPTH) {
      this.fail(
        `WKT import refuses GEOMETRYCOLLECTION nesting deeper than ${MAX_WKT_DEPTH}.`,
      );
    }
    const { type, qualifier: attached } = this.splitTypeWord(this.readWord());
    const qualifier = this.readQualifier(attached);
    this.checkQualifier(qualifier);
    const hasZ = qualifier === 'Z';

    this.skipWhitespace();
    // `EMPTY` — a bare keyword, no parentheses.
    if (this.text.slice(this.pos, this.pos + 5).toUpperCase() === 'EMPTY') {
      const after = this.text[this.pos + 5];
      if (after === undefined || /[\s,)]/.test(after)) {
        this.pos += 5;
        return null;
      }
    }

    switch (type) {
      case 'POINT': {
        this.expect('(');
        const coordinates = this.readTuple(hasZ);
        this.expect(')');
        return { type: 'Point', coordinates };
      }
      case 'LINESTRING': {
        const coordinates = this.readTupleList(hasZ, { min: 2 });
        return { type: 'LineString', coordinates };
      }
      case 'POLYGON': {
        const coordinates = this.readRingList(hasZ);
        return { type: 'Polygon', coordinates };
      }
      case 'MULTIPOINT': {
        this.expect('(');
        this.skipWhitespace();
        const parenthesised = this.peek() === '(';
        const coordinates = [];
        if (parenthesised) {
          for (;;) {
            this.expect('(');
            coordinates.push(this.readTuple(hasZ));
            this.expect(')');
            this.skipWhitespace();
            if (this.peek() === ',') {
              this.pos += 1;
              continue;
            }
            break;
          }
        } else {
          coordinates.push(this.readTuple(hasZ));
          for (;;) {
            this.skipWhitespace();
            if (this.peek() === ',') {
              this.pos += 1;
              coordinates.push(this.readTuple(hasZ));
              continue;
            }
            break;
          }
        }
        this.expect(')');
        return { type: 'MultiPoint', coordinates };
      }
      case 'MULTILINESTRING': {
        this.expect('(');
        const coordinates = [this.readTupleList(hasZ, { min: 2 })];
        for (;;) {
          this.skipWhitespace();
          if (this.peek() === ',') {
            this.pos += 1;
            coordinates.push(this.readTupleList(hasZ, { min: 2 }));
            continue;
          }
          break;
        }
        this.expect(')');
        return { type: 'MultiLineString', coordinates };
      }
      case 'MULTIPOLYGON': {
        this.expect('(');
        const coordinates = [this.readRingList(hasZ)];
        for (;;) {
          this.skipWhitespace();
          if (this.peek() === ',') {
            this.pos += 1;
            coordinates.push(this.readRingList(hasZ));
            continue;
          }
          break;
        }
        this.expect(')');
        return { type: 'MultiPolygon', coordinates };
      }
      case 'GEOMETRYCOLLECTION': {
        this.expect('(');
        const geometries = [];
        this.skipWhitespace();
        // `GEOMETRYCOLLECTION()` is not valid WKT, but tolerate it as
        // empty rather than failing a file over a trailing comma rule.
        if (this.peek() !== ')') {
          for (;;) {
            const member = this.readGeometry(depth + 1);
            if (member !== null) geometries.push(member);
            this.skipWhitespace();
            if (this.peek() === ',') {
              this.pos += 1;
              continue;
            }
            break;
          }
        }
        this.expect(')');
        return { type: 'GeometryCollection', geometries };
      }
      default:
        this.fail(`WKT import does not recognise the geometry type "${type}".`);
    }
  }
}

/**
 * Parse one WKT / EWKT geometry into a GeoJSON geometry
 * (null for `EMPTY`). Throws `WktGeoImportError` on invalid input.
 * @param {string} text
 * @returns {object|null}
 */
export function parseWkt(text) {
  if (typeof text !== 'string') {
    throw new WktGeoImportError('WKT import needs text');
  }
  const parser = new Parser(text.replace(/^\uFEFF/, ''));
  parser.readSridPrefix();
  const geometry = parser.readGeometry(0);
  parser.skipWhitespace();
  if (parser.pos !== parser.text.length) {
    parser.fail(
      `WKT import found trailing characters after the geometry: ${parser.describe()}.`,
    );
  }
  return geometry;
}

/**
 * Parse WKT text holding one geometry per entry (a single geometry, or
 * several geometries separated by whitespace — one per line in the usual
 * dump layout, or pretty-printed across lines) into a GeoJSON
 * FeatureCollection with one Feature per geometry and empty
 * `properties`. Throws `WktGeoImportError` on invalid input.
 * @param {string} text
 * @returns {object}
 */
export function parseWktToFeatureCollection(text) {
  if (typeof text !== 'string') {
    throw new WktGeoImportError('WKT import needs text');
  }
  const parser = new Parser(text.replace(/^\uFEFF/, ''));
  const features = [];
  for (;;) {
    parser.skipWhitespace();
    if (parser.pos >= parser.text.length) break;
    parser.readSridPrefix();
    parser.skipWhitespace();
    if (parser.pos >= parser.text.length) break;
    const geometry = parser.readGeometry(0);
    features.push({ type: 'Feature', geometry, properties: {} });
    if (features.length > MAX_WKT_FEATURES) {
      parser.fail(
        `That WKT creates more than ${MAX_WKT_FEATURES.toLocaleString()} features (the limit).`,
      );
    }
  }
  if (features.length === 0) {
    throw new WktGeoImportError(
      'WKT import found no geometries: the input is empty.',
    );
  }
  return { type: 'FeatureCollection', features };
}
