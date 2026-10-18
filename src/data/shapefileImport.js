/**
 * ESRI Shapefile (.shp) main-file import to GeoJSON.
 *
 * Pure parser: takes the raw bytes of a `.shp` file — a `Uint8Array` or
 * `ArrayBuffer` — and returns a GeoJSON FeatureCollection. No fetch, no
 * DOM, no `.dbf` join, no loader wiring: a future loader can route with
 * `isShapefileBytes` and call `parseShapefile` on the file bytes plus
 * the sidecar `.prj` text. A `.shp` alone carries no attributes, so
 * every feature gets `properties: {}`; a later cycle can join `.dbf`
 * rows by record order.
 *
 * Format (ESRI Shapefile Technical Description, July 1998):
 *   - 100-byte header, big-endian file code 9994, file length in
 *     16-bit words, little-endian version 1000, shape type, bounding
 *     box. Then records: an 8-byte big-endian header (record number,
 *     content length in 16-bit words) and a little-endian body.
 *   - Shape types: 0 Null, 1 Point, 3 PolyLine, 5 Polygon, 8
 *     MultiPoint, 11 PointZ, 13 PolyLineZ, 15 PolygonZ, 18
 *     MultiPointZ, 21 PointM, 23 PolyLineM, 25 PolygonM, 28
 *     MultiPointM, 31 MultiPatch.
 *
 * CRS posture: a `.shp` file itself carries no CRS — the CRS lives in
 * the sidecar `.prj`. The caller must supply that text as `prjText`,
 * and it must prove WGS 84 (a `GEOGCS` on the WGS_1984 datum, or the
 * literal `EPSG:4326`), or pass the explicit opt-in
 * `assumeWgs84: true` and take responsibility for the CRS. With
 * neither, the whole input is refused — the CRS is guessed nowhere.
 * A projected `.prj` (`PROJCS`) or any other datum (NAD83, ED50, …)
 * refuses the whole input.
 *
 * Polygon semantics follow the shapefile rule exactly: exterior rings
 * are clockwise, holes counter-clockwise (signed shoelace area in
 * lon/lat < 0 / > 0). A hole before any exterior, a zero-area ring,
 * or a hole not contained in its exterior refuses the whole input.
 * Rings are re-oriented on output to the GeoJSON right-hand rule
 * (exterior counter-clockwise, holes clockwise), which preserves the
 * point set. A ring ordered the GeoJSON way is therefore refused as a
 * hole-before-exterior rather than silently misconverted — never guess.
 *
 * Refusal posture, mirroring the importer: the whole input is refused
 * on a bad file code or version, a file-length / record-length /
 * record-number mismatch, a truncated record, trailing bytes, a
 * record shape type that disagrees with the header, a Null record, an
 * unsupported shape type (M-only types, MultiPatch, unknown codes),
 * an out-of-range or non-finite coordinate, a non-finite Z, a real
 * (non-sentinel) M value, an unclosed ring, a ring with fewer than
 * four positions, a zero-area ring, a one-point polyline part, an
 * empty MultiPoint, an empty file (no records), or a cap breach.
 * Caps mirror `geoFileImport.js` (`MAX_IMPORT_ENTITIES` /
 * `MAX_IMPORT_POSITIONS`); `maxFeatures` / `maxPositions` options
 * exist so embedders and tests can tighten them.
 *
 * Z ordinates are preserved for the Z shape types (PointZ,
 * PolyLineZ, PolygonZ, MultiPointZ) as GeoJSON third ordinates. M
 * (measure) values have no GeoJSON slot: an M of exactly 0 or NaN —
 * the no-measure sentinels writers emit when a measure is absent —
 * is dropped, and any other M refuses the whole input, because real
 * measure data would otherwise be silently lost.
 */

/** Most records one shapefile may carry. Mirrors `MAX_IMPORT_ENTITIES`. */
export const SHP_MAX_FEATURES = 20_000;
/** Most positions one shapefile may carry. Mirrors `MAX_IMPORT_POSITIONS`. */
export const SHP_MAX_POSITIONS = 250_000;

/** An error whose message is meant for the person who chose the file. */
export class ShapefileImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShapefileImportError';
  }
}

function fail(message) {
  throw new ShapefileImportError(message);
}

const SHAPE_NAMES = {
  0: 'Null',
  1: 'Point',
  3: 'PolyLine',
  5: 'Polygon',
  8: 'MultiPoint',
  11: 'PointZ',
  13: 'PolyLineZ',
  15: 'PolygonZ',
  18: 'MultiPointZ',
  21: 'PointM',
  23: 'PolyLineM',
  25: 'PolygonM',
  28: 'MultiPointM',
  31: 'MultiPatch',
};

const Z_TYPES = new Set([11, 13, 15, 18]);
const M_ONLY_TYPES = new Set([21, 23, 25, 28]);

function shapeName(type) {
  return SHAPE_NAMES[type] ?? `unknown shape type ${type}`;
}

/**
 * Whether `bytes` look like a shapefile: at least the 100-byte header,
 * big-endian file code 9994, little-endian version 1000. A sniff for
 * loader routing, not proof — the parser is the authority.
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {boolean}
 */
export function isShapefileBytes(bytes) {
  const view = toUint8(bytes);
  if (!view) return false;
  if (view.byteLength < 100) return false;
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);
  return data.getInt32(0, false) === 9994 && data.getInt32(28, true) === 1000;
}

function toUint8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return null;
}

/**
 * Whether `.prj` (WKT1) text proves WGS 84: a `GEOGCS` on the WGS_1984
 * datum, or the literal `EPSG:4326`. A `PROJCS`, another datum, or
 * anything unparseable as WGS 84 returns false — the caller refuses.
 * @param {string} prjText
 * @returns {boolean}
 */
export function isWgs84Prj(prjText) {
  if (typeof prjText !== 'string') return false;
  const text = prjText.trim();
  if (/^EPSG:4326$/i.test(text)) return true;
  if (!/^GEOGCS\b/i.test(text)) return false;
  // A projected system must never pass as geographic.
  if (/PROJCS/i.test(text)) return false;
  // Datum must be WGS_1984 (WKT1 writes DATUM["D_WGS_1984",...]).
  const datum = text.match(/DATUM\s*\[\s*"([^"]+)"/i);
  if (!datum) return false;
  const datumName = datum[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (datumName !== 'DWGS1984' && datumName !== 'WGS1984') return false;
  const spheroid = text.match(/SPHEROID\s*\[\s*"([^"]+)"/i);
  if (!spheroid) return false;
  const spheroidName = spheroid[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (spheroidName !== 'WGS1984') return false;
  // Angular unit must be degrees.
  if (!/UNIT\s*\[\s*"[^"]*degree[^"]*"/i.test(text)) return false;
  return true;
}

function checkLonLat(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    fail('Shapefile coordinate is not a finite number.');
  }
  if (x < -180 || x > 180 || y < -90 || y > 90) {
    fail(
      `Shapefile coordinate (${x}, ${y}) is outside WGS 84 longitude/latitude range.`,
    );
  }
}

function checkBbox(xmin, ymin, xmax, ymax, what) {
  for (const v of [xmin, ymin, xmax, ymax]) {
    if (!Number.isFinite(v))
      fail(`Shapefile ${what} bounding box is not finite.`);
  }
  if (xmin < -180 || xmax > 180 || ymin < -90 || ymax > 90) {
    fail(`Shapefile ${what} bounding box is outside WGS 84 range.`);
  }
  if (xmin > xmax || ymin > ymax) {
    fail(`Shapefile ${what} bounding box is inverted.`);
  }
}

/** Signed shoelace area in lon/lat: > 0 counter-clockwise, < 0 clockwise. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

function pointsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

/** Ray-casting point-in-ring; a point on the boundary counts as inside. */
function pointInRing(point, ring) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // On-segment test: collinear and within the segment's bounds.
    const cross = (px - xi) * (yj - yi) - (py - yi) * (xj - xi);
    if (
      cross === 0 &&
      px >= Math.min(xi, xj) &&
      px <= Math.max(xi, xj) &&
      py >= Math.min(yi, yj) &&
      py <= Math.max(yi, yj)
    ) {
      return true;
    }
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function reverseRing(ring) {
  return [...ring].reverse();
}

/**
 * Parse `.shp` bytes into a GeoJSON FeatureCollection.
 * @param {Uint8Array | ArrayBuffer} bytes Raw `.shp` file bytes.
 * @param {object} [options]
 * @param {string} [options.prjText] Contents of the sidecar `.prj` file.
 *   Must prove WGS 84 (see `isWgs84Prj`).
 * @param {boolean} [options.assumeWgs84] Explicit caller opt-in: the
 *   caller asserts the coordinates are WGS 84 lon/lat. Takes the
 *   place of `prjText`; never implied.
 * @param {number} [options.maxFeatures] Override for `SHP_MAX_FEATURES`.
 * @param {number} [options.maxPositions] Override for `SHP_MAX_POSITIONS`.
 * @returns {object} GeoJSON FeatureCollection.
 */
export function parseShapefile(bytes, options = {}) {
  const {
    prjText,
    assumeWgs84 = false,
    maxFeatures = SHP_MAX_FEATURES,
    maxPositions = SHP_MAX_POSITIONS,
  } = options ?? {};
  if (prjText !== undefined && !isWgs84Prj(prjText)) {
    fail(
      'Shapefile .prj is not WGS 84 (EPSG:4326). Only WGS 84 shapefiles are imported.',
    );
  }
  if (prjText === undefined && !assumeWgs84) {
    fail(
      'Shapefile CRS is unknown: pass the sidecar .prj contents as prjText, ' +
        'or pass assumeWgs84: true to assert WGS 84 coordinates.',
    );
  }

  const view = toUint8(bytes);
  if (!view) fail('Shapefile input must be a Uint8Array or ArrayBuffer.');
  if (view.byteLength < 100) {
    fail('Shapefile is shorter than the 100-byte header.');
  }
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);

  if (data.getInt32(0, false) !== 9994) {
    fail('Shapefile file code is not 9994.');
  }
  for (let i = 1; i <= 5; i += 1) {
    if (data.getInt32(i * 4, false) !== 0) {
      fail('Shapefile header has non-zero unused words.');
    }
  }
  const fileLengthWords = data.getInt32(24, false);
  if (fileLengthWords * 2 !== view.byteLength) {
    fail('Shapefile header file length does not match the actual byte length.');
  }
  if (data.getInt32(28, true) !== 1000) {
    fail('Shapefile version is not 1000.');
  }
  const headerType = data.getInt32(32, true);
  if (headerType === 0 || M_ONLY_TYPES.has(headerType) || headerType === 31) {
    fail(`Shapefile type ${shapeName(headerType)} is not imported.`);
  }
  if (!Z_TYPES.has(headerType) && ![1, 3, 5, 8].includes(headerType)) {
    fail(`Shapefile type ${shapeName(headerType)} is not imported.`);
  }
  const hasZ = Z_TYPES.has(headerType);
  checkBbox(
    data.getFloat64(36, true),
    data.getFloat64(44, true),
    data.getFloat64(52, true),
    data.getFloat64(60, true),
    'header',
  );
  const headerZmin = data.getFloat64(68, true);
  const headerZmax = data.getFloat64(76, true);
  if (
    Number.isFinite(headerZmin) &&
    Number.isFinite(headerZmax) &&
    headerZmin > headerZmax
  ) {
    fail('Shapefile header Z bounding box is inverted.');
  }

  const features = [];
  let totalPositions = 0;
  let offset = 100;
  let recordIndex = 0;
  while (offset < view.byteLength) {
    if (offset + 8 > view.byteLength) {
      fail('Shapefile ends with a truncated record header.');
    }
    const recordNumber = data.getInt32(offset, false);
    const contentWords = data.getInt32(offset + 4, false);
    recordIndex += 1;
    if (recordNumber !== recordIndex) {
      fail(
        `Shapefile record number ${recordNumber} is not the expected ${recordIndex}.`,
      );
    }
    if (contentWords < 2) {
      fail(`Shapefile record ${recordNumber} content is too short.`);
    }
    const contentBytes = contentWords * 2;
    const recordStart = offset + 8;
    const recordEnd = recordStart + contentBytes;
    if (recordEnd > view.byteLength) {
      fail(`Shapefile record ${recordNumber} is truncated.`);
    }
    const recordType = data.getInt32(recordStart, true);
    if (recordType !== headerType) {
      fail(
        `Shapefile record ${recordNumber} is ${shapeName(recordType)}, ` +
          `but the header declares ${shapeName(headerType)}.`,
      );
    }
    const reader = new RecordReader(data, recordStart, recordEnd, hasZ);
    const geometry = readGeometry(reader, headerType, recordNumber);
    if (reader.offset !== recordEnd) {
      fail(`Shapefile record ${recordNumber} has trailing bytes.`);
    }
    totalPositions += reader.positions;
    if (totalPositions > maxPositions) {
      fail(
        `Shapefile has more than ${maxPositions.toLocaleString()} points (the limit).`,
      );
    }
    features.push({ type: 'Feature', properties: {}, geometry });
    if (features.length > maxFeatures) {
      fail(
        `Shapefile has more than ${maxFeatures.toLocaleString()} features (the limit).`,
      );
    }
    offset = recordEnd;
  }
  if (features.length === 0) {
    fail('Shapefile has no records.');
  }
  return { type: 'FeatureCollection', features };
}

class RecordReader {
  constructor(data, start, end, hasZ) {
    this.data = data;
    this.offset = start + 4; // Skip the record's shape-type word.
    this.end = end;
    this.hasZ = hasZ;
    this.positions = 0;
  }

  need(bytes) {
    if (this.offset + bytes > this.end) {
      fail('Shapefile record ends before its geometry is complete.');
    }
  }

  int32() {
    this.need(4);
    const value = this.data.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  float64() {
    this.need(8);
    const value = this.data.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  /** One XY (or XYZ) position; validates lon/lat and finiteness. */
  point() {
    const x = this.float64();
    const y = this.float64();
    checkLonLat(x, y);
    let z;
    if (this.hasZ) {
      // Z values live in a separate array after all XY pairs for
      // PolyLineZ/PolygonZ/MultiPointZ; a PointZ carries its Z inline
      // here. The caller handles the array form; this reads inline Z.
      z = this.float64();
      if (!Number.isFinite(z)) fail('Shapefile Z coordinate is not finite.');
    }
    this.positions += 1;
    return z === undefined ? [x, y] : [x, y, z];
  }

  /**
   * The M value following a Z (or M-only) ordinate: 0 or NaN are the
   * no-measure sentinels and are dropped; any other value refuses.
   */
  measure() {
    const m = this.float64();
    if (Number.isNaN(m) || m === 0) return;
    fail(
      'Shapefile M (measure) values are not imported; refusing to drop them.',
    );
  }
}

function readBbox(reader, what) {
  const xmin = reader.float64();
  const ymin = reader.float64();
  const xmax = reader.float64();
  const ymax = reader.float64();
  checkBbox(xmin, ymin, xmax, ymax, what);
}

function readParts(reader, recordNumber) {
  const numParts = reader.int32();
  const numPoints = reader.int32();
  if (numParts < 0 || numPoints < 0) {
    fail(`Shapefile record ${recordNumber} has a negative part/point count.`);
  }
  if (numParts === 0 || numPoints === 0) {
    fail(`Shapefile record ${recordNumber} has no parts or points.`);
  }
  const parts = [];
  for (let i = 0; i < numParts; i += 1) parts.push(reader.int32());
  if (parts[0] !== 0) {
    fail(`Shapefile record ${recordNumber} first part does not start at 0.`);
  }
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i] <= parts[i - 1]) {
      fail(`Shapefile record ${recordNumber} part starts are not ascending.`);
    }
  }
  if (parts[parts.length - 1] >= numPoints) {
    fail(`Shapefile record ${recordNumber} part start is past its points.`);
  }
  return { parts, numPoints };
}

function readXyPoints(reader, count) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const x = reader.float64();
    const y = reader.float64();
    checkLonLat(x, y);
    points.push([x, y]);
  }
  reader.positions += count;
  return points;
}

function readZArray(reader, count) {
  const zs = [];
  for (let i = 0; i < count; i += 1) {
    const z = reader.float64();
    if (!Number.isFinite(z)) fail('Shapefile Z coordinate is not finite.');
    zs.push(z);
  }
  return zs;
}

function readMArray(reader, count) {
  for (let i = 0; i < count; i += 1) reader.measure();
}

function readZRange(reader) {
  const zmin = reader.float64();
  const zmax = reader.float64();
  if (Number.isFinite(zmin) && Number.isFinite(zmax) && zmin > zmax) {
    fail('Shapefile record Z range is inverted.');
  }
}

function splitParts(points, parts, numPoints, recordNumber, minPartPoints) {
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const start = parts[i];
    const end = i + 1 < parts.length ? parts[i + 1] : numPoints;
    const part = points.slice(start, end);
    if (part.length < minPartPoints) {
      fail(
        `Shapefile record ${recordNumber} part ${i} has ${part.length} ` +
          `positions (needs at least ${minPartPoints}).`,
      );
    }
    out.push(part);
  }
  return out;
}

function readGeometry(reader, type, recordNumber) {
  switch (type) {
    case 1: {
      // Point: X, Y inline.
      return { type: 'Point', coordinates: reader.point() };
    }
    case 11: {
      // PointZ: X, Y, Z, M inline.
      const [x, y, z] = reader.point();
      reader.measure();
      return { type: 'Point', coordinates: [x, y, z] };
    }
    case 3:
    case 13: {
      readBbox(reader, `record ${recordNumber}`);
      const { parts, numPoints } = readParts(reader, recordNumber);
      const points = readXyPoints(reader, numPoints);
      if (type === 13) {
        readZRange(reader);
        const zs = readZArray(reader, numPoints);
        readMArray(reader, numPoints);
        for (let i = 0; i < numPoints; i += 1) points[i].push(zs[i]);
      }
      const lines = splitParts(points, parts, numPoints, recordNumber, 2);
      if (lines.length === 1) {
        return { type: 'LineString', coordinates: lines[0] };
      }
      return { type: 'MultiLineString', coordinates: lines };
    }
    case 5:
    case 15: {
      readBbox(reader, `record ${recordNumber}`);
      const { parts, numPoints } = readParts(reader, recordNumber);
      const points = readXyPoints(reader, numPoints);
      if (type === 15) {
        readZRange(reader);
        const zs = readZArray(reader, numPoints);
        readMArray(reader, numPoints);
        for (let i = 0; i < numPoints; i += 1) points[i].push(zs[i]);
      }
      const rings = splitParts(points, parts, numPoints, recordNumber, 4);
      const polygons = assemblePolygons(rings, recordNumber);
      if (polygons.length === 1) {
        return { type: 'Polygon', coordinates: polygons[0] };
      }
      return { type: 'MultiPolygon', coordinates: polygons };
    }
    case 8:
    case 18: {
      readBbox(reader, `record ${recordNumber}`);
      const numPoints = reader.int32();
      if (numPoints <= 0) {
        fail(`Shapefile record ${recordNumber} MultiPoint is empty.`);
      }
      const points = readXyPoints(reader, numPoints);
      if (type === 18) {
        readZRange(reader);
        const zs = readZArray(reader, numPoints);
        readMArray(reader, numPoints);
        for (let i = 0; i < numPoints; i += 1) points[i].push(zs[i]);
      }
      return { type: 'MultiPoint', coordinates: points };
    }
    default:
      fail(`Shapefile type ${shapeName(type)} is not imported.`);
  }
}

/**
 * Assign rings to polygons: a clockwise ring (area < 0) starts a new
 * polygon; a counter-clockwise ring (area > 0) is a hole of the most
 * recent exterior and must lie inside it. Output follows the GeoJSON
 * right-hand rule. Returns an array of polygons, each an array of
 * rings.
 */
function assemblePolygons(rings, recordNumber) {
  const polygons = [];
  for (const ring of rings) {
    if (!pointsEqual(ring[0], ring[ring.length - 1])) {
      fail(`Shapefile record ${recordNumber} polygon ring is not closed.`);
    }
    const area = signedArea(ring);
    if (area === 0) {
      fail(`Shapefile record ${recordNumber} polygon ring has zero area.`);
    }
    if (area < 0) {
      // Clockwise: a new exterior. Re-orient to counter-clockwise.
      polygons.push([reverseRing(ring)]);
    } else {
      // Counter-clockwise: a hole of the most recent exterior.
      if (polygons.length === 0) {
        fail(
          `Shapefile record ${recordNumber} hole appears before any exterior ring.`,
        );
      }
      const exterior = polygons[polygons.length - 1][0];
      for (const vertex of ring) {
        if (!pointInRing(vertex, exterior)) {
          fail(
            `Shapefile record ${recordNumber} hole lies outside its exterior ring.`,
          );
        }
      }
      // Re-orient to clockwise for GeoJSON holes.
      polygons[polygons.length - 1].push(reverseRing(ring));
    }
  }
  if (polygons.length === 0) {
    fail(`Shapefile record ${recordNumber} polygon has no exterior ring.`);
  }
  return polygons;
}
