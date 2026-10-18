/**
 * Session-local WKB / EWKB (Well-Known Binary) import: one WKB geometry
 * becomes a GeoJSON FeatureCollection.
 *
 * The gap: the geo file importer (`src/data/geoFileImport.js`) takes
 * GeoJSON, KML/KMZ and GPX, but not WKB — yet WKB is the binary
 * interchange PostGIS (`ST_AsBinary` / `ST_AsEWKB`), QGIS, Shapely and
 * GDAL produce, and the form in which coordinates most often arrive as
 * database BLOBs or compact binary exports. Cycle 2 closed the same gap
 * for the text form, WKT (`src/data/wktGeoImport.js`); this closes it
 * for the binary form.
 *
 * Evidence: OGC Simple Features / ISO 19125 Well-Known Binary
 * (POINT / LINESTRING / POLYGON / MULTI* / GEOMETRYCOLLECTION, each
 * geometry carrying its own byte-order byte and type word) plus the
 * PostGIS EWKB extension (SRID / Z / M flags in the top bits of the
 * type word, SRID value following the type word). Upstream's importer
 * accepts no `.wkb` and its `GEO_FILE_ACCEPT` is
 * `.geojson,.json,.kml,.kmz,.gpx`.
 *
 * Pure functions, no Cesium/DOM/network. Deliberate limits, in the
 * never-silently-assume posture of ruling #5:
 * - Coordinates are assumed WGS 84 degrees and range-checked
 *   (lon ±180, lat ±90, |z| ≤ 1,000,000 — the same bounds the upstream
 *   GeoJSON counter applies). Out-of-range input is refused, not
 *   re-labelled.
 * - An EWKB SRID is accepted only for 4326 (WGS 84). Any other SRID is
 *   refused: silently treating projected metres as degrees would put
 *   features on the wrong continent.
 * - `M` / `ZM` (measured) dimensions are refused, in both the ISO
 *   (+2000 / +3000) and EWKB-flag encodings: GeoJSON has no measure
 *   slot, so accepting them would silently drop the measure.
 * - Polygon rings must already be closed (first == last, exact double
 *   equality); an unclosed ring is refused rather than silently
 *   auto-closed. A ring with fewer than 4 positions is refused: a
 *   closed ring needs at least 4.
 * - `EMPTY` geometries become a Feature with `geometry: null` (valid
 *   GeoJSON); `EMPTY` members inside a collection are skipped,
 *   because a GeometryCollection cannot hold a null member. An empty
 *   Point is the PostGIS / ISO NaN,NaN encoding; a Point with exactly
 *   one NaN ordinate is refused.
 * - Trailing bytes after the one geometry are refused: a WKB buffer
 *   holds exactly one geometry, so extra bytes are corruption, not
 *   a second geometry.
 * - Buffers over the caps are refused, not truncated (same posture as
 *   the geo file importer's entity cap).
 * Wiring note: when the importer wires this in, it adds `.wkb` /
 * `.ewkb` to `GEO_FILE_ACCEPT`, routes those extensions here, and
 * unifies `MAX_WKB_FEATURES` / `MAX_WKB_POSITIONS` with its
 * `MAX_IMPORT_ENTITIES` / `MAX_IMPORT_POSITIONS` (same values) so the
 * two caps cannot drift apart.
 */

/** Most geometries one WKB input may carry (same as the importer's entity cap). */
export const MAX_WKB_FEATURES = 20_000;
/** Most coordinate tuples in one WKB input (same as the importer's position cap). */
export const MAX_WKB_POSITIONS = 250_000;
/** Deepest GEOMETRYCOLLECTION nesting — bounds adversarial nesting. */
export const MAX_WKB_DEPTH = 32;
/** Largest accepted altitude, mirroring the upstream GeoJSON bound. */
export const MAX_WKB_ALTITUDE = 1_000_000;
/** The only SRID accepted: WGS 84. */
export const WKB_WGS84_SRID = 4326;

// OGC / ISO base geometry types.
const POINT = 1;
const LINESTRING = 2;
const POLYGON = 3;
const MULTIPOINT = 4;
const MULTILINESTRING = 5;
const MULTIPOLYGON = 6;
const GEOMETRYCOLLECTION = 7;

// PostGIS EWKB flags in the top bits of the type word.
const EWKB_Z_FLAG = 0x80000000;
const EWKB_M_FLAG = 0x40000000;
const EWKB_SRID_FLAG = 0x20000000;
// ISO WKB dimension offsets added to the base type.
const ISO_Z_OFFSET = 1000;
const ISO_M_OFFSET = 2000;
const ISO_ZM_OFFSET = 3000;

/** An error whose message is meant for the person who chose the file. */
export class WkbGeoImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WkbGeoImportError';
  }
}

/**
 * Whether the bytes look like WKB (a byte-order byte, then a plausible
 * type word). Conservative sniff for format detection; parsing still
 * validates. Never throws.
 * @param {unknown} bytes
 * @returns {boolean}
 */
export function isWkbBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5) return false;
  const byteOrder = bytes[0];
  if (byteOrder !== 0 && byteOrder !== 1) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawType = view.getUint32(1, byteOrder === 1);
  const base = decodeBaseType(rawType);
  return base !== null;
}

/** Strip EWKB flags / ISO offsets to the base type, or null if unknown. */
function decodeBaseType(rawType) {
  if (
    rawType & (EWKB_Z_FLAG | EWKB_M_FLAG | EWKB_SRID_FLAG) ||
    rawType >= ISO_Z_OFFSET
  ) {
    // EWKB-flagged or ISO-offset type: only the low bits / offset band
    // may carry the base type; anything else is not a known geometry.
    if (rawType & (EWKB_Z_FLAG | EWKB_M_FLAG | EWKB_SRID_FLAG)) {
      const base = rawType & ~(EWKB_Z_FLAG | EWKB_M_FLAG | EWKB_SRID_FLAG);
      return base >= POINT && base <= GEOMETRYCOLLECTION ? base : null;
    }
    if (rawType >= ISO_Z_OFFSET && rawType < ISO_Z_OFFSET + 100) {
      const base = rawType - ISO_Z_OFFSET;
      return base >= POINT && base <= GEOMETRYCOLLECTION ? base : null;
    }
    if (rawType >= ISO_M_OFFSET && rawType < ISO_M_OFFSET + 100) {
      const base = rawType - ISO_M_OFFSET;
      return base >= POINT && base <= GEOMETRYCOLLECTION ? base : null;
    }
    if (rawType >= ISO_ZM_OFFSET && rawType < ISO_ZM_OFFSET + 100) {
      const base = rawType - ISO_ZM_OFFSET;
      return base >= POINT && base <= GEOMETRYCOLLECTION ? base : null;
    }
    return null;
  }
  return rawType >= POINT && rawType <= GEOMETRYCOLLECTION ? rawType : null;
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
    this.positions = 0;
    this.geometries = 0;
  }

  fail(message) {
    throw new WkbGeoImportError(message);
  }

  need(count) {
    if (this.pos + count > this.bytes.length) {
      this.fail(
        `WKB import hit a truncated buffer at byte ${this.pos + 1} ` +
          `of ${this.bytes.length}.`,
      );
    }
  }

  readUint8() {
    this.need(1);
    const value = this.bytes[this.pos];
    this.pos += 1;
    return value;
  }

  readUint32(littleEndian) {
    this.need(4);
    const value = this.view.getUint32(this.pos, littleEndian);
    this.pos += 4;
    return value;
  }

  readFloat64(littleEndian) {
    this.need(8);
    const value = this.view.getFloat64(this.pos, littleEndian);
    this.pos += 8;
    return value;
  }

  countPosition() {
    this.positions += 1;
    if (this.positions > MAX_WKB_POSITIONS) {
      this.fail(
        `WKB import has more than ${MAX_WKB_POSITIONS.toLocaleString()} ` +
          `points (the limit).`,
      );
    }
  }

  countGeometry() {
    this.geometries += 1;
    if (this.geometries > MAX_WKB_FEATURES) {
      this.fail(
        `WKB import has more than ${MAX_WKB_FEATURES.toLocaleString()} ` +
          `geometries (the limit).`,
      );
    }
  }
}

/**
 * Decode one geometry's type word into its base type, dimensionality
 * and SRID. Refuses M/ZM dimensions and non-4326 SRIDs.
 */
function decodeType(reader, littleEndian) {
  const rawType = reader.readUint32(littleEndian);
  let base;
  let hasZ = false;
  let hasM = false;
  let hasSrid = false;
  if (rawType & (EWKB_Z_FLAG | EWKB_M_FLAG | EWKB_SRID_FLAG)) {
    base = rawType & ~(EWKB_Z_FLAG | EWKB_M_FLAG | EWKB_SRID_FLAG);
    hasZ = Boolean(rawType & EWKB_Z_FLAG);
    hasM = Boolean(rawType & EWKB_M_FLAG);
    hasSrid = Boolean(rawType & EWKB_SRID_FLAG);
  } else if (rawType >= ISO_ZM_OFFSET && rawType < ISO_ZM_OFFSET + 100) {
    base = rawType - ISO_ZM_OFFSET;
    hasZ = true;
    hasM = true;
  } else if (rawType >= ISO_M_OFFSET && rawType < ISO_M_OFFSET + 100) {
    base = rawType - ISO_M_OFFSET;
    hasM = true;
  } else if (rawType >= ISO_Z_OFFSET && rawType < ISO_Z_OFFSET + 100) {
    base = rawType - ISO_Z_OFFSET;
    hasZ = true;
  } else {
    base = rawType;
  }
  if (base < POINT || base > GEOMETRYCOLLECTION) {
    reader.fail(`WKB import found unknown geometry type ${rawType}.`);
  }
  if (hasM) {
    reader.fail(
      'WKB import refuses measured (M / ZM) geometries: GeoJSON has ' +
        'no measure slot, so the measure would be silently dropped.',
    );
  }
  let srid = null;
  if (hasSrid) {
    srid = reader.readUint32(littleEndian);
    if (srid !== WKB_WGS84_SRID) {
      reader.fail(
        `WKB import refuses SRID ${srid}: only SRID ${WKB_WGS84_SRID} ` +
          '(WGS 84) is accepted, so projected metres are never silently ' +
          're-labelled as degrees.',
      );
    }
  }
  return { base, hasZ };
}

function checkCoordinate(reader, x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    reader.fail('WKB import found a non-finite coordinate.');
  }
  if (x < -180 || x > 180) {
    reader.fail(
      `WKB import refuses longitude ${x}: it is outside ±180 degrees.`,
    );
  }
  if (y < -90 || y > 90) {
    reader.fail(`WKB import refuses latitude ${y}: it is outside ±90 degrees.`);
  }
  if (z !== undefined) {
    if (!Number.isFinite(z)) {
      reader.fail('WKB import found a non-finite altitude.');
    }
    if (Math.abs(z) > MAX_WKB_ALTITUDE) {
      reader.fail(
        `WKB import refuses altitude ${z}: it is outside ±${MAX_WKB_ALTITUDE.toLocaleString()}.`,
      );
    }
  }
}

/** Read one coordinate tuple (2 or 3 ordinates). */
function readCoordinate(reader, littleEndian, hasZ) {
  const x = reader.readFloat64(littleEndian);
  const y = reader.readFloat64(littleEndian);
  const z = hasZ ? reader.readFloat64(littleEndian) : undefined;
  reader.countPosition();
  return z === undefined ? [x, y] : [x, y, z];
}

function sameCoordinate(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function parsePoint(reader, littleEndian, hasZ) {
  const x = reader.readFloat64(littleEndian);
  const y = reader.readFloat64(littleEndian);
  const z = hasZ ? reader.readFloat64(littleEndian) : undefined;
  reader.countPosition();
  const xNaN = Number.isNaN(x);
  const yNaN = Number.isNaN(y);
  if (xNaN && yNaN) return null; // EMPTY point (PostGIS / ISO encoding).
  if (xNaN || yNaN) {
    reader.fail(
      'WKB import found a Point with exactly one NaN ordinate: ' +
        'an empty Point is NaN,NaN.',
    );
  }
  checkCoordinate(reader, x, y, z);
  return { type: 'Point', coordinates: z === undefined ? [x, y] : [x, y, z] };
}

function parseLineString(reader, littleEndian, hasZ) {
  const count = reader.readUint32(littleEndian);
  if (count === 0) return null; // EMPTY.
  if (count === 1) {
    reader.fail(
      'WKB import refuses a LineString with one point: a LineString ' +
        'needs at least two positions.',
    );
  }
  const coordinates = [];
  for (let i = 0; i < count; i += 1) {
    const coord = readCoordinate(reader, littleEndian, hasZ);
    checkCoordinate(reader, coord[0], coord[1], coord[2]);
    coordinates.push(coord);
  }
  return { type: 'LineString', coordinates };
}

function parsePolygon(reader, littleEndian, hasZ) {
  const ringCount = reader.readUint32(littleEndian);
  if (ringCount === 0) return null; // EMPTY.
  const coordinates = [];
  for (let r = 0; r < ringCount; r += 1) {
    const count = reader.readUint32(littleEndian);
    if (count === 0) {
      reader.fail('WKB import found a Polygon ring with no points.');
    }
    if (count < 4) {
      reader.fail(
        `WKB import refuses a Polygon ring with ${count} points: a ` +
          'closed ring needs at least 4.',
      );
    }
    const ring = [];
    for (let i = 0; i < count; i += 1) {
      const coord = readCoordinate(reader, littleEndian, hasZ);
      checkCoordinate(reader, coord[0], coord[1], coord[2]);
      ring.push(coord);
    }
    if (!sameCoordinate(ring[0], ring[ring.length - 1])) {
      reader.fail(
        'WKB import refuses a Polygon ring that is not closed ' +
          '(first point != last point) rather than silently auto-closing it.',
      );
    }
    coordinates.push(ring);
  }
  return { type: 'Polygon', coordinates };
}

/**
 * Parse one geometry (plus its nested members) at the given depth.
 * Returns a GeoJSON geometry, or null for EMPTY.
 */
function parseGeometry(reader, depth) {
  if (depth > MAX_WKB_DEPTH) {
    reader.fail(
      `WKB import refuses nesting deeper than ${MAX_WKB_DEPTH} levels.`,
    );
  }
  reader.countGeometry();
  const byteOrder = reader.readUint8();
  if (byteOrder !== 0 && byteOrder !== 1) {
    reader.fail(
      `WKB import found byte-order ${byteOrder}: expected 0 (big-endian) ` +
        'or 1 (little-endian).',
    );
  }
  const littleEndian = byteOrder === 1;
  const { base, hasZ } = decodeType(reader, littleEndian);

  switch (base) {
    case POINT:
      return parsePoint(reader, littleEndian, hasZ);
    case LINESTRING:
      return parseLineString(reader, littleEndian, hasZ);
    case POLYGON:
      return parsePolygon(reader, littleEndian, hasZ);
    case MULTIPOINT:
    case MULTILINESTRING:
    case MULTIPOLYGON:
    case GEOMETRYCOLLECTION: {
      const count = reader.readUint32(littleEndian);
      if (count === 0) return null; // EMPTY.
      const members = [];
      for (let i = 0; i < count; i += 1) {
        const member = parseGeometry(reader, depth + 1);
        if (member === null) continue; // EMPTY member: skipped.
        if (base !== GEOMETRYCOLLECTION) {
          const expected =
            base === MULTIPOINT
              ? 'Point'
              : base === MULTILINESTRING
                ? 'LineString'
                : 'Polygon';
          if (member.type !== expected) {
            reader.fail(
              `WKB import found a ${member.type} inside a ` +
                `${expected === 'Point' ? 'MultiPoint' : expected === 'LineString' ? 'MultiLineString' : 'MultiPolygon'}: members must all be ${expected}.`,
            );
          }
        }
        members.push(member);
      }
      if (members.length === 0) return null; // All members EMPTY.
      if (base === MULTIPOINT) {
        return {
          type: 'MultiPoint',
          coordinates: members.map((m) => m.coordinates),
        };
      }
      if (base === MULTILINESTRING) {
        return {
          type: 'MultiLineString',
          coordinates: members.map((m) => m.coordinates),
        };
      }
      if (base === MULTIPOLYGON) {
        return {
          type: 'MultiPolygon',
          coordinates: members.map((m) => m.coordinates),
        };
      }
      return { type: 'GeometryCollection', geometries: members };
    }
    default:
      return reader.fail(`WKB import found unknown geometry type ${base}.`);
  }
}

/**
 * Parse one WKB / EWKB geometry into a GeoJSON FeatureCollection with
 * a single Feature (geometry null for EMPTY). Refuses malformed input
 * rather than guessing.
 * @param {Uint8Array} bytes
 * @returns {{type: 'FeatureCollection', features: Array<{type: 'Feature', properties: {}, geometry: object|null}>}}
 */
export function parseWkbToGeoJson(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new WkbGeoImportError(
      'WKB import expected a Uint8Array of binary geometry bytes.',
    );
  }
  if (bytes.length === 0) {
    throw new WkbGeoImportError('WKB import refuses an empty buffer.');
  }
  const reader = new Reader(bytes);
  const geometry = parseGeometry(reader, 0);
  if (reader.pos !== bytes.length) {
    throw new WkbGeoImportError(
      `WKB import refuses ${bytes.length - reader.pos} trailing byte(s) ` +
        'after the geometry: a WKB buffer holds exactly one geometry.',
    );
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry }],
  };
}
