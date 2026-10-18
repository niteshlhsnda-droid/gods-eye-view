/**
 * Session-local DXF import: a subset of the ASCII Drawing Interchange
 * Format becomes a GeoJSON FeatureCollection of points, lines and
 * polygons.
 *
 * The gap: the geo file importer (`feature/geo-import`,
 * `src/data/geoFileImport.js`) takes GeoJSON, KML/KMZ, GPX, TopoJSON and
 * WKT, and sibling lanes already cover CSV, Esri JSON, MapInfo MIF/MID,
 * Shapefile and friends — but nothing takes DXF, the interchange that
 * surveyors, civil plans and QGIS "Add Vector Layer" produce and that
 * every GIS desktop app imports.
 *
 * Pure functions, no Cesium/DOM/network. Deliberate limits, mirroring
 * the house contract:
 * - Only ASCII DXF is parsed. Binary DXF (`AutoCAD Binary DXF` magic)
 *   is refused outright — decoding it is a different parser.
 * - Only the ENTITIES section is imported (BLOCKS is read so INSERT can
 *   instantiate block definitions; TABLES/OBJECTS are ignored).
 * - A DXF file carries no CRS. Every coordinate is assumed WGS 84
 *   degrees; entities with out-of-range coordinates are skipped, and a
 *   file in which NO entity survives coordinate validation is refused
 *   with a message naming projected units as the likely cause (ruling
 *   #5's spirit: never silently assume a CRS).
 * - Rows over the caps are refused, not truncated (same posture as the
 *   geo file importer's entity cap): `MAX_DXF_ENTITIES`,
 *   `MAX_DXF_POSITIONS`, `MAX_DXF_ALTITUDE` are aliases of the
 *   importer's caps in `src/data/geoImportLimits.js`, so the numbers
 *   cannot drift apart.
 * - Structural breakage refuses the whole file: non-DXF input, no
 *   ENTITIES section, a truncated group pair, a non-numeric group code.
 *   Per-geometry problems (unsupported entity, bad coordinates, unknown
 *   block, rotated/scaled INSERT) skip that entity and are counted in
 *   `skipped`.
 * Wiring note: `geoFileImport.js` does not know this module on `main`;
 * when it wires this in, it adds `.dxf` to `GEO_FILE_ACCEPT`, routes
 * `.dxf` here, and the caps are already shared via `geoImportLimits.js`.
 */

import {
  MAX_IMPORT_ALTITUDE,
  MAX_IMPORT_ENTITIES,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';

/** Most entities one DXF file may carry (same as the geo importer's entity cap). */
export const MAX_DXF_ENTITIES = MAX_IMPORT_ENTITIES;
/** Most vertices (points of every line, ring and marker) in one file. */
export const MAX_DXF_POSITIONS = MAX_IMPORT_POSITIONS;
/** Largest accepted altitude, in metres. */
export const MAX_DXF_ALTITUDE = MAX_IMPORT_ALTITUDE;
/** Most group-code pairs one file may carry — bounds pathological files. */
export const MAX_DXF_PAIRS = 2_000_000;
/** Longest text kept from a TEXT/MTEXT entity (same value as the importer's name cap). */
export const MAX_DXF_NAME_LENGTH = 120;
/** Segments used to approximate a CIRCLE as a polygon ring. */
export const CIRCLE_SEGMENTS = 64;

/** An error whose message is meant for the person who chose the file. */
export class DxfGeoImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DxfGeoImportError';
  }
}

/** The binary DXF sentinel, as it appears at the head of a decoded file. */
const BINARY_DXF_MAGIC = 'AutoCAD Binary DXF\r\n\x1a\x00';

/**
 * Classify text as an ASCII DXF, a binary DXF, or neither.
 *
 * @param {string} text
 * @returns {'ascii'|'binary'|null}
 */
export function isDxfText(text) {
  if (typeof text !== 'string') return null;
  if (text.startsWith(BINARY_DXF_MAGIC)) return 'binary';
  const stripped = text.replace(/^\uFEFF/, '').replace(/^\s+/, '');
  const lines = stripped.split(/\r\n|\r|\n/);
  return lines.length >= 2 &&
    lines[0].trim() === '0' &&
    lines[1].trim().toUpperCase() === 'SECTION'
    ? 'ascii'
    : null;
}

/**
 * Parse ASCII DXF text into [group code, value] pairs.
 *
 * @param {string} text
 * @returns {Array<[number, string]>}
 * @throws {DxfGeoImportError} On non-text input, binary DXF, a truncated
 *   group (odd line count) or a non-numeric group code.
 */
export function parseDxfPairs(text) {
  if (typeof text !== 'string')
    throw new DxfGeoImportError('DXF import needs text');
  if (text.startsWith(BINARY_DXF_MAGIC))
    throw new DxfGeoImportError(
      'Binary DXF is not supported — export ASCII DXF and retry',
    );
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2 !== 0)
    throw new DxfGeoImportError('DXF has a truncated group (odd line count)');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code))
      throw new DxfGeoImportError(
        `DXF has a non-numeric group code: ${JSON.stringify(lines[i])}`,
      );
    pairs.push([code, lines[i + 1] ?? '']);
  }
  return pairs;
}

/**
 * Split group pairs into ENTITIES-section entities and BLOCKS-section
 * block definitions. VERTEX subentities of a POLYLINE are collected on
 * `entity.vertices`.
 *
 * @param {Array<[number, string]>} pairs
 * @returns {{entities: object[], blocks: Map<string, object[]>, hasEntitiesSection: boolean}}
 */
function extractDxf(pairs) {
  const blocks = new Map();
  const entities = [];
  let hasEntitiesSection = false;
  let section = null;
  let entity = null;
  let vertex = null;
  let blockName = null;
  let blockList = null;

  const flushEntity = () => {
    if (vertex && entity) {
      entity.vertices.push(vertex);
      vertex = null;
    }
    if (!entity) return;
    if (section === 'BLOCKS' && blockList) blockList.push(entity);
    else entities.push(entity);
    entity = null;
  };

  for (const [code, value] of pairs) {
    if (code === 0) {
      const marker = value.trim().toUpperCase();
      if (marker === 'SECTION') {
        flushEntity();
        section = 'PENDING';
        continue;
      }
      if (marker === 'ENDSEC') {
        flushEntity();
        section = null;
        blockList = null;
        blockName = null;
        continue;
      }
      if (marker === 'BLOCK') {
        // The BLOCK header record itself is not an entity.
        flushEntity();
        entity = null;
        if (section === 'BLOCKS') {
          blockList = [];
          blockName = null;
        }
        continue;
      }
      if (marker === 'ENDBLK') {
        flushEntity();
        entity = null;
        if (section === 'BLOCKS' && blockList && blockName)
          blocks.set(blockName.toUpperCase(), blockList);
        blockList = null;
        blockName = null;
        continue;
      }
      if (marker === 'VERTEX') {
        if (vertex && entity) entity.vertices.push(vertex);
        vertex = {};
        continue;
      }
      if (marker === 'SEQEND') {
        if (vertex && entity) entity.vertices.push(vertex);
        vertex = null;
        continue;
      }
      flushEntity();
      if (section === 'ENTITIES' || (section === 'BLOCKS' && blockList))
        entity = { type: marker, pairs: [], vertices: [] };
      continue;
    }
    if (section === 'PENDING' && code === 2) {
      section = value.trim().toUpperCase();
      if (section === 'ENTITIES') hasEntitiesSection = true;
      continue;
    }
    if (
      section === 'BLOCKS' &&
      blockList &&
      !entity &&
      blockName === null &&
      code === 2
    ) {
      blockName = value.trim();
      continue;
    }
    if (vertex) {
      if (code === 10) vertex.x = value;
      else if (code === 20) vertex.y = value;
      else if (code === 30) vertex.z = value;
      continue;
    }
    if (entity) entity.pairs.push([code, value]);
  }
  flushEntity();
  return { entities, blocks, hasEntitiesSection };
}

/** Last value seen for a group code, or undefined. */
function lastField(entity, code) {
  for (let i = entity.pairs.length - 1; i >= 0; i--) {
    if (entity.pairs[i][0] === code) return entity.pairs[i][1];
  }
  return undefined;
}

function toNumber(raw) {
  if (raw === undefined || raw === null) return NaN;
  return Number(String(raw).trim());
}

/**
 * A raw {x, y, z} vertex as a GeoJSON position, validated as WGS 84
 * degrees (altitude in metres).
 *
 * @returns {{ok: true, position: number[]}|{ok: false, reason: 'non-numeric'|'range'|'altitude'}}
 */
function toPosition(raw) {
  const x = toNumber(raw.x);
  const y = toNumber(raw.y);
  const zRaw =
    raw.z === undefined || raw.z === null ? '' : String(raw.z).trim();
  const z = zRaw === '' ? 0 : Number(zRaw);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
    return { ok: false, reason: 'non-numeric' };
  if (Math.abs(x) > 180 || Math.abs(y) > 90)
    return { ok: false, reason: 'range' };
  if (Math.abs(z) > MAX_DXF_ALTITUDE) return { ok: false, reason: 'altitude' };
  return { ok: true, position: z === 0 ? [x, y] : [x, y, z] };
}

/** Shared feature properties: layer (group 8) when present. */
function baseProperties(entity, extra = {}) {
  const layer = String(lastField(entity, 8) ?? '').trim();
  const properties = { ...extra };
  if (layer !== '') properties.layer = layer;
  return properties;
}

/** Group codes that carry coordinates, shifted by an INSERT translation. */
const SHIFT_X = new Set([10, 11, 12, 13]);
const SHIFT_Y = new Set([20, 21, 22, 23]);
const SHIFT_Z = new Set([30, 31, 32, 33]);

/** A translated copy of an entity (for INSERT block instantiation). */
function translateEntity(entity, dx, dy, dz) {
  const pairs = entity.pairs.map(([code, value]) => {
    if (SHIFT_X.has(code)) return [code, String(toNumber(value) + dx)];
    if (SHIFT_Y.has(code)) return [code, String(toNumber(value) + dy)];
    if (SHIFT_Z.has(code)) return [code, String(toNumber(value) + dz)];
    return [code, value];
  });
  const vertices = entity.vertices.map((v) => ({
    x: String(toNumber(v.x) + dx),
    y: String(toNumber(v.y) + dy),
    z: v.z === undefined ? undefined : String(toNumber(v.z) + dz),
  }));
  return { type: entity.type, pairs, vertices };
}

/** Scan an entity's ordered pairs for LWPOLYLINE-style (10/20[/30]) vertices. */
function scanInlineVertices(entity) {
  const vertices = [];
  for (const [code, value] of entity.pairs) {
    if (code === 10) vertices.push({ x: value });
    else if (code === 20 && vertices.length)
      vertices[vertices.length - 1].y = value;
    else if (code === 30 && vertices.length)
      vertices[vertices.length - 1].z = value;
  }
  return vertices;
}

/** Vertices as validated positions; null when any vertex is bad. */
function validatedPositions(rawVertices) {
  const positions = [];
  for (const raw of rawVertices) {
    const checked = toPosition(raw);
    if (!checked.ok) return null;
    positions.push(checked.position);
  }
  return positions;
}

function closeRing(positions) {
  const first = positions[0];
  const last = positions[positions.length - 1];
  const same =
    last.length === first.length && last.every((v, i) => v === first[i]);
  return same ? positions : [...positions, [...first]];
}

/**
 * Convert one entity into features. Returns null when the entity is
 * skipped; `ctx.coordRejected` counts coordinate-caused skips so a fully
 * projected file can be refused with a CRS-honest message.
 *
 * @returns {Array<{geometry: object, properties: object}>|null}
 */
function convertEntity(entity, ctx) {
  switch (entity.type) {
    case 'POINT': {
      const checked = toPosition({
        x: lastField(entity, 10),
        y: lastField(entity, 20),
        z: lastField(entity, 30),
      });
      if (!checked.ok) {
        if (checked.reason === 'range') ctx.coordRejected++;
        return null;
      }
      return [
        {
          geometry: { type: 'Point', coordinates: checked.position },
          properties: baseProperties(entity),
        },
      ];
    }
    case 'LINE': {
      const start = toPosition({
        x: lastField(entity, 10),
        y: lastField(entity, 20),
        z: lastField(entity, 30),
      });
      const end = toPosition({
        x: lastField(entity, 11),
        y: lastField(entity, 21),
        z: lastField(entity, 31),
      });
      if (!start.ok || !end.ok) {
        if (start.reason === 'range' || end.reason === 'range')
          ctx.coordRejected++;
        return null;
      }
      return [
        {
          geometry: {
            type: 'LineString',
            coordinates: [start.position, end.position],
          },
          properties: baseProperties(entity),
        },
      ];
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const raw =
        entity.type === 'LWPOLYLINE'
          ? scanInlineVertices(entity)
          : entity.vertices;
      if (raw.length < 2) return null;
      const positions = validatedPositions(raw);
      if (!positions) {
        ctx.coordRejected++;
        return null;
      }
      const closed = (toNumber(lastField(entity, 70)) & 1) === 1;
      if (closed && positions.length >= 3)
        return [
          {
            geometry: { type: 'Polygon', coordinates: [closeRing(positions)] },
            properties: baseProperties(entity),
          },
        ];
      return [
        {
          geometry: {
            type: 'LineString',
            coordinates: closed ? closeRing(positions) : positions,
          },
          properties: baseProperties(entity),
        },
      ];
    }
    case 'CIRCLE': {
      const center = toPosition({
        x: lastField(entity, 10),
        y: lastField(entity, 20),
      });
      if (!center.ok) {
        if (center.reason === 'range') ctx.coordRejected++;
        return null;
      }
      // A bad radius is a data problem, not a CRS problem: skip without
      // tripping the projected-units refusal.
      const ring = circleRing(
        center.position[0],
        center.position[1],
        toNumber(lastField(entity, 40)),
        0,
        360,
      );
      if (!ring) return null;
      return [
        {
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: baseProperties(entity),
        },
      ];
    }
    case 'ARC': {
      const center = toPosition({
        x: lastField(entity, 10),
        y: lastField(entity, 20),
      });
      if (!center.ok) {
        if (center.reason === 'range') ctx.coordRejected++;
        return null;
      }
      const ring = circleRing(
        center.position[0],
        center.position[1],
        toNumber(lastField(entity, 40)),
        toNumber(lastField(entity, 50)),
        toNumber(lastField(entity, 51)),
      );
      if (!ring) return null;
      return [
        {
          geometry: { type: 'LineString', coordinates: ring },
          properties: baseProperties(entity),
        },
      ];
    }
    case 'TEXT':
    case 'MTEXT': {
      const checked = toPosition({
        x: lastField(entity, 10),
        y: lastField(entity, 20),
        z: lastField(entity, 30),
      });
      const text = String(lastField(entity, 1) ?? '').trim();
      if (!checked.ok || text === '') {
        if (!checked.ok && checked.reason === 'range') ctx.coordRejected++;
        return null;
      }
      return [
        {
          geometry: { type: 'Point', coordinates: checked.position },
          properties: baseProperties(entity, {
            text: text.slice(0, MAX_DXF_NAME_LENGTH),
          }),
        },
      ];
    }
    case 'SOLID':
    case '3DFACE': {
      const corners = validatedPositions(
        [
          { x: lastField(entity, 10), y: lastField(entity, 20) },
          { x: lastField(entity, 11), y: lastField(entity, 21) },
          { x: lastField(entity, 12), y: lastField(entity, 22) },
          { x: lastField(entity, 13), y: lastField(entity, 23) },
        ].filter((c) => c.x !== undefined && c.y !== undefined),
      );
      if (!corners || corners.length < 3) {
        ctx.coordRejected++;
        return null;
      }
      return [
        {
          geometry: { type: 'Polygon', coordinates: [closeRing(corners)] },
          properties: baseProperties(entity),
        },
      ];
    }
    case 'INSERT': {
      const blockName = String(lastField(entity, 2) ?? '')
        .trim()
        .toUpperCase();
      const block = ctx.blocks.get(blockName);
      if (!block) return null;
      // Only plain translation is supported — rotated or scaled
      // inserts would silently misplace geometry.
      if (toNumber(lastField(entity, 50) ?? 0) !== 0) return null;
      for (const code of [41, 42, 43]) {
        const scale = lastField(entity, code);
        if (scale !== undefined && toNumber(scale) !== 1) return null;
      }
      const dx = toNumber(lastField(entity, 10));
      const dy = toNumber(lastField(entity, 20));
      const dz = toNumber(lastField(entity, 30) ?? 0);
      if (
        !Number.isFinite(dx) ||
        !Number.isFinite(dy) ||
        !Number.isFinite(dz)
      ) {
        ctx.coordRejected++;
        return null;
      }
      const features = [];
      for (const member of block) {
        if (member.type === 'INSERT') continue; // no nested inserts
        const moved = translateEntity(member, dx, dy, dz);
        const converted = convertEntity(moved, ctx);
        if (!converted) continue;
        for (const feature of converted) {
          features.push({
            geometry: feature.geometry,
            properties: {
              ...feature.properties,
              block: String(lastField(entity, 2) ?? '').trim(),
            },
          });
        }
      }
      return features.length ? features : null;
    }
    default:
      return null;
  }
}

/**
 * Points along a circle/arc centred at (cx, cy) with radius r (degrees),
 * from startDeg to endDeg. A full 360 sweep closes the ring. Returns
 * null when the centre or radius is bad.
 */
function circleRing(cx, cy, r, startDeg, endDeg) {
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(r) ||
    r <= 0 ||
    r > 90 ||
    Math.abs(cx) > 180 ||
    Math.abs(cy) > 90
  )
    return null;
  const full = startDeg === 0 && endDeg === 360;
  const sweep = full
    ? 360
    : (((toFinite(endDeg) - toFinite(startDeg)) % 360) + 360) % 360 || 360;
  const segments = Math.max(2, Math.ceil((sweep / 360) * CIRCLE_SEGMENTS));
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const angle = ((startDeg + (sweep * i) / segments) * Math.PI) / 180;
    const lon = cx + r * Math.cos(angle);
    const lat = cy + r * Math.sin(angle);
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    points.push([lon, lat]);
  }
  return points;
}

function toFinite(value) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Parse an ASCII DXF file into points, lines and polygons.
 *
 * @param {string} text DXF text.
 * @param {{maxEntities?: number, maxPositions?: number}} [options]
 * @returns {{type: 'FeatureCollection', features: object[], skipped: number}}
 * @throws {DxfGeoImportError} When the input is not ASCII DXF, has no
 *   ENTITIES section, is structurally truncated, exceeds a cap, or has
 *   no valid WGS 84 coordinates at all (likely projected units).
 */
export function parseDxfToFeatureCollection(
  text,
  { maxEntities = MAX_DXF_ENTITIES, maxPositions = MAX_DXF_POSITIONS } = {},
) {
  const kind = isDxfText(text);
  if (kind === 'binary')
    throw new DxfGeoImportError(
      'Binary DXF is not supported — export ASCII DXF and retry',
    );
  if (kind !== 'ascii')
    throw new DxfGeoImportError(
      'Not a DXF file: no SECTION/ENTITIES structure',
    );
  const pairs = parseDxfPairs(text);
  if (pairs.length > MAX_DXF_PAIRS)
    throw new DxfGeoImportError(
      `DXF has ${pairs.length} group pairs (max ${MAX_DXF_PAIRS})`,
    );
  const { entities, blocks, hasEntitiesSection } = extractDxf(pairs);
  if (!hasEntitiesSection)
    throw new DxfGeoImportError('DXF has no ENTITIES section');
  const blockEntityCount = [...blocks.values()].reduce(
    (total, list) => total + list.length,
    0,
  );
  if (entities.length + blockEntityCount > maxEntities)
    throw new DxfGeoImportError(
      `DXF has ${entities.length + blockEntityCount} entities (max ${maxEntities})`,
    );

  const features = [];
  let skipped = 0;
  let positions = 0;
  const ctx = { blocks, coordRejected: 0 };

  const countPositions = (geometry) => {
    switch (geometry.type) {
      case 'Point':
        return 1;
      case 'LineString':
        return geometry.coordinates.length;
      case 'Polygon':
        return geometry.coordinates.reduce(
          (total, ring) => total + ring.length,
          0,
        );
      default:
        return 0;
    }
  };

  for (const entity of entities) {
    const converted = convertEntity(entity, ctx);
    if (!converted) {
      skipped++;
      continue;
    }
    for (const { geometry, properties } of converted) {
      const needed = countPositions(geometry);
      if (positions + needed > maxPositions)
        throw new DxfGeoImportError(
          `DXF has more than ${maxPositions} positions`,
        );
      positions += needed;
      features.push({ type: 'Feature', geometry, properties });
    }
  }

  if (features.length === 0 && ctx.coordRejected > 0)
    throw new DxfGeoImportError(
      'DXF has no valid WGS 84 coordinates — the file may use projected units (metres), not degrees',
    );
  return { type: 'FeatureCollection', features, skipped };
}
