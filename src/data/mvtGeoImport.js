/**
 * Mapbox Vector Tile (MVT, `.mvt` / `.pbf`) → GeoJSON, with no network and
 * no dependencies.
 *
 * The gap: the geo file importer (`src/data/geoFileImport.js`) takes
 * GeoJSON, KML/KMZ and GPX, and the parser shelf beside it covers the
 * text and OGC binary forms (WKT/EWKT, WKB, TopoJSON, Shapefile, GML,
 * Esri JSON, GeoRSS, OSM XML, GeoJSONL, encoded polyline, ASCII DXF,
 * MIF/MID, TCX, IGC, NMEA 0183) — but not the protobuf tile format that
 * web maps actually ship vector data in. MVT is the wire format behind
 * Mapbox, MapLibre and self-hosted tile servers (`.mvt` files, `/{z}/{x}/{y}`
 * endpoints, MBTiles extracts), so a tile saved from any of those is
 * currently unimportable. This closes that gap: one tile buffer becomes
 * a GeoJSON FeatureCollection.
 *
 * Evidence: Mapbox Vector Tile Specification v2.1
 * (https://github.com/mapbox/vector-tile-spec) — the Tile / Layer /
 * Feature / Value message layout, the geometry command stream
 * (`(id & 0x7) | (count << 3)` with MoveTo = 1, LineTo = 2, ClosePath = 7),
 * zigzag + delta parameter encoding, and the Web Mercator tile grid the
 * local coordinates live on. Command-decode details cross-checked against
 * the TomTom vector-tile structure reference
 * (https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/v2/vector/content).
 *
 * Pure functions, no Cesium/DOM/network, no `node:` imports. Null on any
 * invalid input — this parser never throws. Deliberate limits, in the
 * never-silently-assume posture of the other import parsers:
 * - Tile coordinates are required: pass `{ z, x, y }`, or a file `name`
 *   they can be sniffed from (`14/8801/5371.mvt`, `14-8801-5371.pbf`).
 *   Without them a tile is just integers in a 4096-grid, so the input
 *   is refused instead of being placed at a guessed location.
 * - Coordinates are WGS 84 lon/lat derived from the Web Mercator tile
 *   grid (EPSG:3857 tiling). No `crs` member is emitted — WGS 84 assumed,
 *   per the geo-import convention (`CRS_IGNORED_WARNING`).
 * - Buffer overhang past the world edge is clamped to ±180 / ±90 rather
 *   than refused: clipped tiles legitimately carry it.
 * - MVT rings close implicitly via ClosePath; GeoJSON linear rings need
 *   first == last, so the closing position is written out explicitly.
 *   In tile space (y down) a positive shoelace area is clockwise, which
 *   the spec assigns to exterior rings; holes attach to the most recent
 *   exterior ring. A hole before any exterior ring is refused. Zero-area
 *   (degenerate) rings are dropped; a polygon left with none becomes a
 *   Feature with `geometry: null`, like WKB EMPTY.
 * - The y-down → north-up conversion preserves the visual layout (the
 *   tile's top edge is north), so ring winding is preserved from the
 *   tile: exteriors come out clockwise in lon/lat. RFC 7946's
 *   right-hand rule is a SHOULD, and rewinding would silently reorder
 *   coordinates, so — like the reference decoders — winding is kept.
 * - `UNKNOWN`-typed features are skipped: there is no GeoJSON for them.
 * - int64 / uint64 / sint64 values beyond 2^53 - 1 become strings —
 *   silently rounding a 64-bit id would corrupt joins.
 * - A Value message keeps its first recognized value field; an empty
 *   one decodes to null.
 * - Caps: 50 MB input, 20,000 features and 250,000 positions (the
 *   entity/position caps are the shared `geoImportLimits.js` ones, so
 *   they cannot drift from the file importer).
 * Wiring note (Cycle 22): wired into `geoFileImport.js` — `.mvt` and
 * `.pbf` are in `GEO_FILE_ACCEPT`, `detectGeoFileFormat` routes both
 * extensions here (no other importer on the shelf claims `.pbf`;
 * non-MVT protobuf bytes are refused by `isMvtBytes`), the loader passes
 * the file name for tile-coordinate sniffing and refuses coord-less
 * tiles outright, and caps needed no unification: they already come
 * from `geoImportLimits.js`.
 */

import {
  MAX_IMPORT_ENTITIES,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';

/** Most features one tile may decode (shared with the file importer). */
export const MAX_MVT_FEATURES = MAX_IMPORT_ENTITIES;
/** Most decoded positions one tile may carry (shared with the importer). */
export const MAX_MVT_POSITIONS = MAX_IMPORT_POSITIONS;
/** Largest tile buffer accepted — mirrors the importer's file cap. */
export const MAX_MVT_BYTES = 50 * 1024 * 1024;
/** Deepest zoom the tile grid addresses. */
export const MAX_MVT_ZOOM = 30;
/** Default layer extent when the layer omits it (spec default). */
export const MVT_DEFAULT_EXTENT = 4096;

// Protobuf wire types. Groups (3/4) never appear in MVT — refused.
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

// MVT geometry commands: low 3 bits of the command integer.
const CMD_MOVE_TO = 1;
const CMD_LINE_TO = 2;
const CMD_CLOSE_PATH = 7;

// MVT geometry types (Tile.GeomType).
const GEOM_UNKNOWN = 0;
const GEOM_POINT = 1;
const GEOM_LINESTRING = 2;
const GEOM_POLYGON = 3;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const INT64_MIN = -(1n << 63n);
const INT64_MOD = 1n << 64n;

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Read an unsigned varint at `pos`.
 * @returns {{ value: bigint, next: number } | null} Null when truncated
 *   or longer than the 10 bytes a 64-bit varint may take.
 */
function readVarint(bytes, pos) {
  let value = 0n;
  let shift = 0n;
  let at = pos;
  for (let i = 0; i < 10; i++) {
    if (at >= bytes.length) return null;
    const b = bytes[at++];
    value |= BigInt(b & 0x7f) << shift;
    if (b < 0x80) return { value, next: at };
    shift += 7n;
  }
  return null;
}

/**
 * Read one protobuf field (tag + payload) at `pos`.
 * @returns {{ field: number, wire: number, varint?: bigint,
 *   start?: number, end?: number, next: number } | null}
 */
function readField(bytes, pos) {
  const tag = readVarint(bytes, pos);
  if (!tag || tag.value > 0xffffffffn) return null;
  const n = Number(tag.value);
  const field = n >>> 3;
  const wire = n & 7;
  let at = tag.next;
  if (wire === WIRE_VARINT) {
    const v = readVarint(bytes, at);
    if (!v) return null;
    return { field, wire, varint: v.value, next: v.next };
  }
  if (wire === WIRE_LENGTH_DELIMITED) {
    const len = readVarint(bytes, at);
    if (!len || len.value > BigInt(bytes.length)) return null;
    const start = len.next;
    const end = start + Number(len.value);
    if (end > bytes.length) return null;
    return { field, wire, start, end, next: end };
  }
  if (wire === WIRE_FIXED64) {
    if (at + 8 > bytes.length) return null;
    return { field, wire, start: at, end: at + 8, next: at + 8 };
  }
  if (wire === WIRE_FIXED32) {
    if (at + 4 > bytes.length) return null;
    return { field, wire, start: at, end: at + 4, next: at + 4 };
  }
  return null;
}

/** Skip every field in `[start, end)`; null when any field is malformed. */
function skipFields(bytes, start, end) {
  let at = start;
  while (at < end) {
    const f = readField(bytes, at);
    if (!f) return null;
    at = f.next;
  }
  return at === end;
}

function readUtf8(bytes, start, end) {
  try {
    return utf8Decoder.decode(bytes.subarray(start, end));
  } catch {
    return null;
  }
}

function readFloat32(bytes, start) {
  return new DataView(bytes.buffer, bytes.byteOffset + start, 4).getFloat32(
    0,
    true,
  );
}

function readFloat64(bytes, start) {
  return new DataView(bytes.buffer, bytes.byteOffset + start, 8).getFloat64(
    0,
    true,
  );
}

/** A 64-bit protobuf integer as a Number when exact, else a string. */
function int64ToJson(value) {
  let signed = value;
  if (signed >= 1n << 63n) signed -= INT64_MOD;
  if (signed >= INT64_MIN && signed <= MAX_SAFE && signed >= -MAX_SAFE)
    return Number(signed);
  return String(signed);
}

/** Unsigned 64-bit varint as a Number when exact, else a string. */
function uint64ToJson(value) {
  if (value <= MAX_SAFE) return Number(value);
  return String(value);
}

function zigzagToJson(value) {
  return int64ToJson((value >> 1n) ^ -(value & 1n));
}

/**
 * Decode a Tile.Value message to a JSON value. First recognized value
 * field wins; an empty message decodes to null.
 */
function parseValue(bytes, start, end) {
  let at = start;
  let seen = false;
  let value = null;
  while (at < end) {
    const f = readField(bytes, at);
    if (!f) return null;
    at = f.next;
    if (seen) continue;
    if (f.field === 1 && f.wire === WIRE_LENGTH_DELIMITED) {
      const s = readUtf8(bytes, f.start, f.end);
      if (s === null) return null;
      value = s;
      seen = true;
    } else if (f.field === 2 && f.wire === WIRE_FIXED32) {
      value = readFloat32(bytes, f.start);
      seen = true;
    } else if (f.field === 3 && f.wire === WIRE_FIXED64) {
      value = readFloat64(bytes, f.start);
      seen = true;
    } else if (f.field === 4 && f.wire === WIRE_VARINT) {
      value = int64ToJson(f.varint);
      seen = true;
    } else if (f.field === 5 && f.wire === WIRE_VARINT) {
      value = uint64ToJson(f.varint);
      seen = true;
    } else if (f.field === 6 && f.wire === WIRE_VARINT) {
      value = zigzagToJson(f.varint);
      seen = true;
    } else if (f.field === 7 && f.wire === WIRE_VARINT) {
      value = f.varint !== 0n;
      seen = true;
    }
    // Unknown fields are skipped: forward-compatible value kinds.
  }
  return at === end ? { value } : null;
}

/**
 * Read a packed (or single) uint32 array field into `out`.
 * @returns {boolean} False when a word exceeds 32 bits or the payload
 *   is truncated.
 */
function readPackedUint32(bytes, f, out) {
  if (f.wire === WIRE_VARINT) {
    if (f.varint > 0xffffffffn) return false;
    out.push(Number(f.varint));
    return true;
  }
  if (f.wire !== WIRE_LENGTH_DELIMITED) return false;
  let at = f.start;
  while (at < f.end) {
    const v = readVarint(bytes, at);
    if (!v || v.value > 0xffffffffn) return false;
    out.push(Number(v.value));
    at = v.next;
  }
  return at === f.end;
}

function zigzagDecode(n) {
  return (n >>> 1) ^ -(n & 1);
}

/**
 * Decode one feature's geometry command stream into tile-space parts.
 *
 * @param {number[]} words The packed geometry uint32s.
 * @param {number} type GEOM_POINT / GEOM_LINESTRING / GEOM_POLYGON.
 * @param {{ count: number }} budget Shared position budget; null when spent.
 * @returns {{ kind: string, parts: number[][][] } | null}
 */
function decodeGeometry(words, type, budget) {
  const kind =
    type === GEOM_POINT
      ? 'point'
      : type === GEOM_LINESTRING
        ? 'line'
        : 'polygon';
  const parts = [];
  let current = null;
  let ringOpen = false;
  let cx = 0;
  let cy = 0;
  const takePoint = (dx, dy) => {
    cx += dx;
    cy += dy;
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) return null;
    budget.count++;
    if (budget.count > MAX_MVT_POSITIONS) return null;
    return [cx, cy];
  };
  const flushPart = () => {
    if (kind === 'line') {
      if (current.length < 2) return false;
      parts.push(current);
    } else if (kind === 'polygon') {
      parts.push(current);
    }
    current = null;
    ringOpen = false;
    return true;
  };

  let i = 0;
  while (i < words.length) {
    const command = words[i++];
    const id = command & 7;
    const count = command >>> 3;
    if (count === 0) return null;
    if (id === CMD_MOVE_TO) {
      if (kind !== 'point' && count !== 1) return null;
      if (i + 2 * count > words.length) return null;
      if (kind === 'point') {
        for (let k = 0; k < count; k++) {
          const p = takePoint(
            zigzagDecode(words[i]),
            zigzagDecode(words[i + 1]),
          );
          if (!p) return null;
          parts.push([p]);
          i += 2;
        }
      } else {
        if (current) {
          // A polygon ring left open (no ClosePath) is malformed; a
          // finished line just needs its length check.
          if (ringOpen) return null;
          if (!flushPart()) return null;
        }
        const p = takePoint(zigzagDecode(words[i]), zigzagDecode(words[i + 1]));
        if (!p) return null;
        current = [p];
        ringOpen = kind === 'polygon';
        i += 2;
      }
    } else if (id === CMD_LINE_TO) {
      if (kind === 'point' || !current) return null;
      if (i + 2 * count > words.length) return null;
      for (let k = 0; k < count; k++) {
        const p = takePoint(zigzagDecode(words[i]), zigzagDecode(words[i + 1]));
        if (!p) return null;
        current.push(p);
        i += 2;
      }
    } else if (id === CMD_CLOSE_PATH) {
      if (kind !== 'polygon' || !ringOpen) return null;
      if (current.length < 3) return null;
      for (let k = 0; k < count; k++) {
        if (!ringOpen) return null;
        if (!flushPart()) return null;
      }
    } else {
      return null;
    }
  }
  if (kind === 'polygon') {
    if (ringOpen) return null;
  } else if (current && !flushPart()) {
    return null;
  }
  return { kind, parts };
}

/** Shoelace area in tile space (y down): > 0 means visually clockwise. */
function signedRingArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/**
 * Group polygon rings into [exterior, ...holes] polygons. Positive area
 * (clockwise in tile space) starts a new polygon; negative-area rings
 * attach as holes to the most recent one.
 * @returns {number[][][][] | null} Null when a hole precedes any exterior.
 */
function assemblePolygons(rings) {
  const polygons = [];
  let current = null;
  for (const ring of rings) {
    const area = signedRingArea(ring);
    if (area === 0) continue;
    if (area > 0) {
      current = [ring];
      polygons.push(current);
    } else {
      if (!current) return null;
      current.push(ring);
    }
  }
  return polygons;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round7 = (v) => Math.round(v * 1e7) / 1e7;

/**
 * Tile-local (px, py) at `extent` on tile (z, x, y) → WGS 84 [lon, lat].
 * The standard Web Mercator tile inversion; overhang past the world
 * edge is clamped to valid WGS 84.
 */
function tileToLonLat(px, py, extent, z, x, y) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const s = Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n));
  const lat = (Math.atan(s) * 180) / Math.PI;
  return [round7(clamp(lon, -180, 180)), round7(clamp(lat, -90, 90))];
}

/** Decode a Tile.Feature message. Returns null when malformed. */
function parseFeature(bytes, start, end) {
  let id = null;
  let idSeen = false;
  const tags = [];
  let type = GEOM_UNKNOWN;
  let typeSeen = false;
  const geometry = [];
  let at = start;
  while (at < end) {
    const f = readField(bytes, at);
    if (!f) return null;
    at = f.next;
    if (f.field === 1) {
      if (f.wire !== WIRE_VARINT) return null;
      id = uint64ToJson(f.varint);
      idSeen = true;
    } else if (f.field === 2) {
      if (!readPackedUint32(bytes, f, tags)) return null;
    } else if (f.field === 3) {
      if (f.wire !== WIRE_VARINT || f.varint > 3n) return null;
      type = Number(f.varint);
      typeSeen = true;
    } else if (f.field === 4) {
      if (!readPackedUint32(bytes, f, geometry)) return null;
    }
    // Unknown fields skipped: forward-compatible features.
  }
  if (at !== end) return null;
  if (!typeSeen) return null;
  if (tags.length % 2 !== 0) return null;
  return { id: idSeen ? id : null, tags, type, geometry };
}

/** Decode a Tile.Layer message. Returns null when malformed. */
function parseLayer(bytes, start, end) {
  let version = 1;
  let name = null;
  let extent = MVT_DEFAULT_EXTENT;
  const keys = [];
  const values = [];
  const features = [];
  let at = start;
  while (at < end) {
    const f = readField(bytes, at);
    if (!f) return null;
    at = f.next;
    if (f.field === 15) {
      if (f.wire !== WIRE_VARINT || (f.varint !== 1n && f.varint !== 2n))
        return null;
      version = Number(f.varint);
    } else if (f.field === 1) {
      if (f.wire !== WIRE_LENGTH_DELIMITED) return null;
      const s = readUtf8(bytes, f.start, f.end);
      if (s === null) return null;
      name = s;
    } else if (f.field === 2) {
      if (f.wire !== WIRE_LENGTH_DELIMITED) return null;
      const feat = parseFeature(bytes, f.start, f.end);
      if (!feat) return null;
      features.push(feat);
      if (features.length > MAX_MVT_FEATURES) return null;
    } else if (f.field === 3) {
      if (f.wire !== WIRE_LENGTH_DELIMITED) return null;
      const s = readUtf8(bytes, f.start, f.end);
      if (s === null) return null;
      keys.push(s);
    } else if (f.field === 4) {
      if (f.wire !== WIRE_LENGTH_DELIMITED) return null;
      const v = parseValue(bytes, f.start, f.end);
      if (!v) return null;
      values.push(v.value);
    } else if (f.field === 5) {
      if (f.wire !== WIRE_VARINT || f.varint <= 0n || f.varint > 0x7fffffffn)
        return null;
      extent = Number(f.varint);
    }
    // Unknown fields skipped: forward-compatible layers.
  }
  if (at !== end || name === null || name === '') return null;
  return { version, name, extent, keys, values, features };
}

/** Decode the top-level Tile message. Returns null when malformed. */
function parseTile(bytes) {
  const layers = [];
  let at = 0;
  while (at < bytes.length) {
    const f = readField(bytes, at);
    if (!f) return null;
    at = f.next;
    if (f.field === 3) {
      if (f.wire !== WIRE_LENGTH_DELIMITED) return null;
      const layer = parseLayer(bytes, f.start, f.end);
      if (!layer) return null;
      layers.push(layer);
    }
    // Unknown top-level fields skipped: forward-compatible tiles.
  }
  return at === bytes.length ? { layers } : null;
}

function validTileCoords(z, x, y) {
  return (
    Number.isInteger(z) &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    z >= 0 &&
    z <= MAX_MVT_ZOOM &&
    x >= 0 &&
    y >= 0 &&
    x < 2 ** z &&
    y < 2 ** z
  );
}

/**
 * Sniff tile coordinates from a file name or path: `14/8801/5371.mvt`
 * or `14-8801-5371.pbf` (z/x/y). Returns null when the name carries no
 * valid tile address.
 *
 * @param {string} name File name or path.
 * @returns {{ z: number, x: number, y: number } | null}
 */
export function detectMvtTileCoords(name) {
  const s = String(name || '');
  const m =
    /(\d{1,2})\/(\d{1,10})\/(\d{1,10})\.(?:mvt|pbf)$/i.exec(s) ||
    /(?:^|[\\/])(\d{1,2})[-_.](\d{1,10})[-_.](\d{1,10})\.(?:mvt|pbf)$/i.exec(s);
  if (!m) return null;
  const z = Number(m[1]);
  const x = Number(m[2]);
  const y = Number(m[3]);
  return validTileCoords(z, x, y) ? { z, x, y } : null;
}

/**
 * True when `bytes` parses as a Mapbox Vector Tile holding at least one
 * layer. Conservative: an empty (zero-layer) tile is valid MVT but does
 * not sniff as one.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isMvtBytes(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length === 0 ||
    bytes.length > MAX_MVT_BYTES
  )
    return false;
  const tile = parseTile(bytes);
  return tile !== null && tile.layers.length > 0;
}

function featureProperties(feat, layer) {
  const properties = {};
  for (let t = 0; t < feat.tags.length; t += 2) {
    const ki = feat.tags[t];
    const vi = feat.tags[t + 1];
    if (ki >= layer.keys.length || vi >= layer.values.length) return null;
    properties[layer.keys[ki]] = layer.values[vi];
  }
  return properties;
}

/**
 * Parse one Mapbox Vector Tile into a GeoJSON FeatureCollection.
 *
 * @param {Uint8Array} bytes The raw tile (`.mvt` / `.pbf`) bytes.
 * @param {object} [options]
 * @param {number} [options.z] Tile zoom.
 * @param {number} [options.x] Tile column.
 * @param {number} [options.y] Tile row.
 * @param {string} [options.name] File name/path; tile coordinates are
 *   sniffed from it when z/x/y are not given.
 * @param {string} [options.layer] Decode only this named layer; by
 *   default every layer's features are included.
 * @returns {object | null} A GeoJSON FeatureCollection, or null for any
 *   invalid input. Never throws.
 */
export function parseMvtTileToGeoJson(bytes, options = {}) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length === 0 ||
    bytes.length > MAX_MVT_BYTES
  )
    return null;
  const opts = options || {};
  let coords = null;
  if (opts.z !== undefined || opts.x !== undefined || opts.y !== undefined) {
    if (!validTileCoords(opts.z, opts.x, opts.y)) return null;
    coords = { z: opts.z, x: opts.x, y: opts.y };
  } else {
    coords = detectMvtTileCoords(opts.name);
    if (!coords) return null;
  }
  const tile = parseTile(bytes);
  if (!tile) return null;
  const wantLayer = opts.layer;
  const budget = { count: 0 };
  const features = [];
  for (const layer of tile.layers) {
    if (wantLayer !== undefined && layer.name !== wantLayer) continue;
    for (const feat of layer.features) {
      if (features.length >= MAX_MVT_FEATURES) return null;
      if (feat.type === GEOM_UNKNOWN) continue;
      const properties = featureProperties(feat, layer);
      if (!properties) return null;
      const decoded = decodeGeometry(feat.geometry, feat.type, budget);
      if (!decoded) return null;
      const toLonLat = (p) =>
        tileToLonLat(p[0], p[1], layer.extent, coords.z, coords.x, coords.y);
      let geometry = null;
      if (decoded.kind === 'point') {
        const pts = decoded.parts.map(([p]) => toLonLat(p));
        geometry =
          pts.length === 1
            ? { type: 'Point', coordinates: pts[0] }
            : pts.length > 1
              ? { type: 'MultiPoint', coordinates: pts }
              : null;
      } else if (decoded.kind === 'line') {
        const lines = decoded.parts.map((line) => line.map(toLonLat));
        geometry =
          lines.length === 1
            ? { type: 'LineString', coordinates: lines[0] }
            : lines.length > 1
              ? { type: 'MultiLineString', coordinates: lines }
              : null;
      } else {
        // Classify rings in tile space (y down), where a positive
        // shoelace area marks an exterior ring; only then convert.
        const tilePolygons = assemblePolygons(decoded.parts);
        if (!tilePolygons) return null;
        const polygons = tilePolygons.map((polygon) =>
          polygon.map((ring) => {
            const closed =
              ring[0][0] === ring[ring.length - 1][0] &&
              ring[0][1] === ring[ring.length - 1][1]
                ? ring
                : [...ring, [ring[0][0], ring[0][1]]];
            return closed.map(toLonLat);
          }),
        );
        geometry =
          polygons.length === 1
            ? { type: 'Polygon', coordinates: polygons[0] }
            : polygons.length > 1
              ? { type: 'MultiPolygon', coordinates: polygons }
              : null;
      }
      const feature = { type: 'Feature', properties, geometry };
      if (feat.id !== null) feature.id = feat.id;
      features.push(feature);
    }
  }
  return { type: 'FeatureCollection', features };
}
