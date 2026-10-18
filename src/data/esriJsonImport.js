/**
 * Esri JSON (ArcGIS REST JSON) import to GeoJSON.
 *
 * Pure parser: takes a parsed value — or a JSON string, which it parses
 * itself — and returns a GeoJSON FeatureCollection. No fetch, no DOM, no
 * loader wiring: a future loader can route with `isEsriJsonText` /
 * `isEsriJsonValue` and call `esriJsonToGeoJson` on the parsed value.
 *
 * Format (ArcGIS REST API: "Using geometry objects" / "FeatureSet"):
 *   - Point:      { x, y, [z], [m], [spatialReference] }
 *   - Multipoint: { points: [[x, y[, z]]...], [spatialReference] }
 *   - Polyline:   { paths: [[[x, y[, z]]...]...], [spatialReference] }
 *   - Polygon:    { rings: [[[x, y[, z]]...]...], [spatialReference] }
 *   - Envelope:   { xmin, ymin, xmax, ymax, [zmin, zmax], [spatialReference] }
 *   - Feature:    { geometry, attributes }
 *   - FeatureSet: { geometryType, spatialReference, features: [Feature...],
 *                     [fields, objectIdFieldName, ...] }
 *
 * CRS posture: only WGS 84 is imported. A `spatialReference` whose
 * effective wkid is anything but 4326 refuses the whole input — including
 * Web Mercator (3857 / 102100), whose metres would otherwise sail past
 * the lon/lat range check. The effective wkid is `wkid`, else
 * `latestWkid`; a `spatialReference` with only a WKT definition refuses
 * (its meaning is guessed nowhere). A missing `spatialReference` is
 * assumed WGS 84 lon,lat, matching the GML parser. Geometry-level
 * `spatialReference` wins over the FeatureSet-level one.
 *
 * Polygon semantics follow the Esri ring rule exactly: exterior rings
 * are clockwise, holes counter-clockwise (signed shoelace area < 0 /
 * > 0). A hole before any exterior, a zero-area ring, or a hole lying
 * outside its exterior refuses the whole input. Rings are re-oriented
 * on output to the GeoJSON right-hand rule (exterior counter-clockwise,
 * holes clockwise), which preserves the point set. A ring ordered the
 * GeoJSON way is therefore refused as a hole-before-exterior rather
 * than silently misconverted — never guess.
 *
 * Refusal posture, mirroring the importer: the whole input is refused
 * on an out-of-range or non-finite coordinate, a non-numeric
 * coordinate, an unclosed ring, a ring with fewer than four positions,
 * a degenerate geometry (empty points/paths/rings, a zero-length path,
 * a collapsed envelope, a null geometry), a geometry whose kind
 * disagrees with the FeatureSet `geometryType`, an attribute value
 * that is not a JSON scalar, a truncated FeatureSet
 * (`exceededTransferLimit: true`), an ambiguous geometry (two geometry
 * kinds in one object), or a cap breach. Caps mirror
 * `geoFileImport.js` (`MAX_IMPORT_ENTITIES` / `MAX_IMPORT_POSITIONS`).
 * Altitude (a third ordinate, `zmin`/`zmax`) is dropped: the import
 * contract is WGS 84 ground footprints.
 */

/** Most features one Esri JSON input may carry. Mirrors `MAX_IMPORT_ENTITIES`. */
export const ESRI_MAX_FEATURES = 20_000;
/** Most positions one Esri JSON input may carry. Mirrors `MAX_IMPORT_POSITIONS`. */
export const ESRI_MAX_POSITIONS = 250_000;

/** An error whose message is meant for the person who chose the file. */
export class EsriJsonImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EsriJsonImportError';
  }
}

const ESRI_GEOMETRY_TYPES = new Set([
  'esriGeometryPoint',
  'esriGeometryMultipoint',
  'esriGeometryPolyline',
  'esriGeometryPolygon',
  'esriGeometryEnvelope',
]);

/** Esri geometryType -> the geometry kind this parser recognises. */
const GEOMETRY_TYPE_KINDS = {
  esriGeometryPoint: 'point',
  esriGeometryMultipoint: 'multipoint',
  esriGeometryPolyline: 'polyline',
  esriGeometryPolygon: 'polygon',
  esriGeometryEnvelope: 'envelope',
};

function fail(message) {
  throw new EsriJsonImportError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether `text` looks like Esri JSON: a JSON object whose head carries
 * an Esri-only key. A sniff for loader routing (the `isGmlText`
 * pattern), not proof — the parser is the authority, and a GeoJSON file
 * whose properties happen to contain an `attributes` key can false
 * positive here. GeoJSON itself carries none of these keys.
 * @param {string} text
 * @returns {boolean}
 */
export function isEsriJsonText(text) {
  if (typeof text !== 'string') return false;
  const head = text
    .replace(/^\uFEFF/, '')
    .trimStart()
    .slice(0, 4096);
  if (!head.startsWith('{')) return false;
  return (
    /"spatialReference"\s*:/.test(head) ||
    /"geometryType"\s*:\s*"esriGeometry/.test(head) ||
    /"objectIdFieldName"\s*:/.test(head) ||
    /"globalIdFieldName"\s*:/.test(head) ||
    /"attributes"\s*:/.test(head) ||
    /"paths"\s*:/.test(head) ||
    /"rings"\s*:/.test(head) ||
    /"xmin"\s*:/.test(head)
  );
}

/** Geometry keys that identify a bare Esri geometry object. */
function geometryKindOf(value) {
  if (!isPlainObject(value)) return [];
  const kinds = [];
  if ('x' in value || 'y' in value) kinds.push('point');
  if ('points' in value) kinds.push('multipoint');
  if ('paths' in value) kinds.push('polyline');
  if ('rings' in value) kinds.push('polygon');
  if ('xmin' in value || 'ymin' in value || 'xmax' in value || 'ymax' in value)
    kinds.push('envelope');
  return kinds;
}

/**
 * Whether a parsed value looks like Esri JSON (FeatureSet, Feature, or
 * bare geometry). A gate for loader routing, not proof.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEsriJsonValue(value) {
  if (!isPlainObject(value)) return false;
  if (
    typeof value.geometryType === 'string' &&
    value.geometryType.startsWith('esriGeometry')
  )
    return true;
  if (
    'spatialReference' in value ||
    'objectIdFieldName' in value ||
    'globalIdFieldName' in value
  )
    return true;
  if (Array.isArray(value.features)) {
    // A GeoJSON FeatureCollection also has `features`, but it carries
    // a `type` of FeatureCollection and no Esri markers (those return
    // true above) — never claim it.
    if (value.type === 'FeatureCollection') return false;
    if (value.features.length === 0) return true;
    const first = value.features[0];
    if (!isPlainObject(first)) return false;
    // A GeoJSON FeatureCollection also has `features`, but its features
    // carry `properties` + a `coordinates` geometry — never `attributes`
    // or Esri geometry keys.
    return (
      'attributes' in first ||
      geometryKindOf(first.geometry).length > 0 ||
      geometryKindOf(first).length > 0
    );
  }
  if ('attributes' in value) return true;
  if (geometryKindOf(value.geometry).length > 0) return true;
  return geometryKindOf(value).length > 0;
}

/**
 * The effective wkid of a `spatialReference` object, or `undefined`
 * when absent (caller assumes WGS 84).
 */
function spatialReferenceWkid(spatialReference, where) {
  if (spatialReference === undefined) return undefined;
  if (!isPlainObject(spatialReference))
    fail(`${where}: spatialReference must be an object`);
  if (spatialReference.wkid !== undefined) {
    if (!Number.isInteger(spatialReference.wkid))
      fail(`${where}: spatialReference.wkid must be an integer`);
    return spatialReference.wkid;
  }
  if (spatialReference.latestWkid !== undefined) {
    if (!Number.isInteger(spatialReference.latestWkid))
      fail(`${where}: spatialReference.latestWkid must be an integer`);
    return spatialReference.latestWkid;
  }
  if (spatialReference.wkt !== undefined)
    fail(
      `${where}: spatialReference with only a WKT definition is not supported; supply wkid 4326`,
    );
  fail(`${where}: spatialReference has no wkid or latestWkid`);
  return undefined;
}

function checkWkid(wkid, where) {
  if (wkid !== undefined && wkid !== 4326)
    fail(
      `${where}: only WGS 84 (wkid 4326) is supported, got wkid ${wkid}; reproject before importing`,
    );
}

/** Parse one [lon, lat] (or [lon, lat, z]) tuple; the z is dropped. */
function parsePosition(raw, where, state) {
  if (!Array.isArray(raw) || (raw.length !== 2 && raw.length !== 3))
    fail(`${where}: position must be [lon, lat] or [lon, lat, z]`);
  const [lon, lat] = raw;
  if (
    typeof lon !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat)
  )
    fail(`${where}: position coordinates must be finite numbers`);
  if (lon < -180 || lon > 180)
    fail(`${where}: longitude ${lon} is out of range [-180, 180]`);
  if (lat < -90 || lat > 90)
    fail(`${where}: latitude ${lat} is out of range [-90, 90]`);
  if (
    raw.length === 3 &&
    (typeof raw[2] !== 'number' || !Number.isFinite(raw[2]))
  )
    fail(`${where}: z ordinate must be a finite number`);
  state.positions += 1;
  if (state.positions > ESRI_MAX_POSITIONS)
    fail(
      `That file has more than ${ESRI_MAX_POSITIONS.toLocaleString()} points (the limit)`,
    );
  return [lon, lat];
}

function parsePositionArray(raw, where, state, { min }) {
  if (!Array.isArray(raw) || raw.length < min)
    fail(`${where}: expected at least ${min} position(s)`);
  return raw.map((position, index) =>
    parsePosition(position, `${where}[${index}]`, state),
  );
}

/** Signed shoelace area; > 0 is counter-clockwise, < 0 clockwise. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1)
    sum += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
  return -sum / 2;
}

function pointOnSegment(point, a, b) {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (cross !== 0) return false;
  return (
    px >= Math.min(ax, bx) &&
    px <= Math.max(ax, bx) &&
    py >= Math.min(ay, by) &&
    py <= Math.max(ay, by)
  );
}

/** Even-odd containment; a point on the boundary counts as inside. */
function pointInRing(point, ring) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (pointOnSegment(point, a, b)) return true;
    if (a[1] > py !== b[1] > py) {
      const x = a[0] + ((py - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (px < x) inside = !inside;
    }
  }
  return inside;
}

function convertPoint(geometry, where, state) {
  const { x, y } = geometry;
  if (x === undefined || y === undefined)
    fail(`${where}: a Point needs both x and y`);
  const [lon, lat] = parsePosition([x, y], where, state);
  return { type: 'Point', coordinates: [lon, lat] };
}

function convertMultipoint(geometry, where, state) {
  if (!Array.isArray(geometry.points) || geometry.points.length === 0)
    fail(`${where}: a Multipoint needs a non-empty points array`);
  return {
    type: 'MultiPoint',
    coordinates: parsePositionArray(geometry.points, where, state, {
      min: 1,
    }),
  };
}

function convertPolyline(geometry, where, state) {
  if (!Array.isArray(geometry.paths) || geometry.paths.length === 0)
    fail(`${where}: a Polyline needs a non-empty paths array`);
  const coordinates = geometry.paths.map((path, index) => {
    const line = parsePositionArray(path, `${where}.paths[${index}]`, state, {
      min: 2,
    });
    if (line.every(([lon, lat]) => lon === line[0][0] && lat === line[0][1]))
      fail(
        `${where}.paths[${index}]: a path of identical positions is degenerate`,
      );
    return line;
  });
  return coordinates.length === 1
    ? { type: 'LineString', coordinates: coordinates[0] }
    : { type: 'MultiLineString', coordinates };
}

function convertPolygon(geometry, where, state) {
  if (!Array.isArray(geometry.rings) || geometry.rings.length === 0)
    fail(`${where}: a Polygon needs a non-empty rings array`);
  const polygons = [];
  let current = null;
  geometry.rings.forEach((rawRing, ringIndex) => {
    const ringWhere = `${where}.rings[${ringIndex}]`;
    const ring = parsePositionArray(rawRing, ringWhere, state, { min: 4 });
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1])
      fail(
        `${ringWhere}: ring is not closed (first position != last position)`,
      );
    const area = signedArea(ring);
    if (area === 0) fail(`${ringWhere}: ring has zero area (degenerate)`);
    if (area < 0) {
      // Clockwise: an Esri exterior ring. Re-orient to GeoJSON
      // counter-clockwise (reverse keeps the closure intact).
      current = [[...ring].reverse()];
      polygons.push(current);
    } else {
      // Counter-clockwise: an Esri hole ring.
      if (current === null)
        fail(`${ringWhere}: hole ring appears before any exterior ring`);
      const exterior = current[0];
      if (!pointInRing(ring[0], exterior))
        fail(`${ringWhere}: hole ring lies outside its exterior ring`);
      current.push([...ring].reverse());
    }
  });
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function convertEnvelope(geometry, where, state) {
  const { xmin, ymin, xmax, ymax, zmin, zmax } = geometry;
  for (const [name, value] of [
    ['xmin', xmin],
    ['ymin', ymin],
    ['xmax', xmax],
    ['ymax', ymax],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      fail(`${where}: an Envelope needs a finite ${name}`);
  }
  for (const [name, value] of [
    ['zmin', zmin],
    ['zmax', zmax],
  ]) {
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value))
    )
      fail(`${where}: ${name} must be a finite number`);
  }
  if (xmin >= xmax || ymin >= ymax)
    fail(`${where}: an Envelope needs xmin < xmax and ymin < ymax`);
  const corners = [
    [xmin, ymin],
    [xmax, ymin],
    [xmax, ymax],
    [xmin, ymax],
    [xmin, ymin],
  ];
  const coordinates = corners.map((corner, index) =>
    parsePosition(corner, `${where}[${index}]`, state),
  );
  // Corners in this order are already counter-clockwise (GeoJSON rule).
  return { type: 'Polygon', coordinates: [coordinates] };
}

const GEOMETRY_CONVERTERS = {
  point: convertPoint,
  multipoint: convertMultipoint,
  polyline: convertPolyline,
  polygon: convertPolygon,
  envelope: convertEnvelope,
};

/**
 * Convert one Esri geometry object to a GeoJSON geometry.
 * @param {object} geometry
 * @param {string} where
 * @param {object} state position counter
 * @param {number|undefined} fallbackWkid FeatureSet-level wkid
 * @param {string|null} expectedKind kind required by geometryType, or null
 */
function convertGeometry(geometry, where, state, fallbackWkid, expectedKind) {
  if (!isPlainObject(geometry)) fail(`${where}: geometry must be an object`);
  const kinds = geometryKindOf(geometry);
  if (kinds.length === 0)
    fail(
      `${where}: unrecognised geometry (no x/y, points, paths, rings, or envelope keys)`,
    );
  if (kinds.length > 1)
    fail(
      `${where}: ambiguous geometry (keys for ${kinds.join(' and ')}) — one geometry kind per object`,
    );
  const kind = kinds[0];
  if (expectedKind !== null && kind !== expectedKind)
    fail(
      `${where}: geometry is a ${kind} but the FeatureSet geometryType requires ${expectedKind}`,
    );
  const wkid = spatialReferenceWkid(geometry.spatialReference, where);
  checkWkid(wkid ?? fallbackWkid, where);
  return GEOMETRY_CONVERTERS[kind](geometry, where, state);
}

function convertAttributes(attributes, where) {
  if (attributes === undefined) return {};
  if (!isPlainObject(attributes))
    fail(`${where}: attributes must be an object`);
  const properties = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      (typeof value !== 'number' || !Number.isFinite(value))
    )
      fail(
        `${where}: attribute "${key}" must be a JSON scalar (string, number, boolean, null)`,
      );
    properties[key] = value;
  }
  return properties;
}

function convertFeature(feature, where, state, fallbackWkid, expectedKind) {
  if (!isPlainObject(feature)) fail(`${where}: feature must be an object`);
  if (!('geometry' in feature)) fail(`${where}: feature has no geometry`);
  if (feature.geometry === null || feature.geometry === undefined)
    fail(`${where}: null geometry is not a map object`);
  const geometry = convertGeometry(
    feature.geometry,
    `${where}.geometry`,
    state,
    fallbackWkid,
    expectedKind,
  );
  return {
    type: 'Feature',
    geometry,
    properties: convertAttributes(feature.attributes, `${where}.attributes`),
  };
}

/**
 * Convert Esri JSON (FeatureSet, Feature, or bare geometry — as a
 * parsed value or a JSON string) to a GeoJSON FeatureCollection.
 * Refuses the whole input on any malformed, unsupported, or truncated
 * part; never truncates or guesses.
 * @param {unknown} input
 * @returns {{ type: 'FeatureCollection', features: Array<object> }}
 */
export function esriJsonToGeoJson(input) {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      fail('input is not valid JSON');
    }
  }
  if (!isPlainObject(value))
    fail(
      'Esri JSON input must be a JSON object (FeatureSet, Feature, or geometry)',
    );

  const state = { positions: 0 };

  if ('features' in value) {
    if (geometryKindOf(value).length > 0)
      fail('input mixes a FeatureSet (features) with bare geometry keys');
    if (!Array.isArray(value.features))
      fail('FeatureSet features must be an array');
    if (value.features.length === 0) fail('FeatureSet has no features');
    if (value.features.length > ESRI_MAX_FEATURES)
      fail(
        `That file creates more than ${ESRI_MAX_FEATURES.toLocaleString()} map objects (the limit)`,
      );
    if (
      value.exceededTransferLimit !== undefined &&
      typeof value.exceededTransferLimit !== 'boolean'
    )
      fail('FeatureSet exceededTransferLimit must be a boolean');
    if (value.exceededTransferLimit === true)
      fail(
        'FeatureSet exceededTransferLimit is true: the result is truncated — request fewer features, never import a partial set',
      );
    if (value.fields !== undefined && !Array.isArray(value.fields))
      fail('FeatureSet fields must be an array');
    let expectedKind = null;
    if (value.geometryType !== undefined) {
      if (
        typeof value.geometryType !== 'string' ||
        !ESRI_GEOMETRY_TYPES.has(value.geometryType)
      )
        fail(
          `unsupported FeatureSet geometryType ${JSON.stringify(value.geometryType)}`,
        );
      expectedKind = GEOMETRY_TYPE_KINDS[value.geometryType];
    }
    const fallbackWkid = spatialReferenceWkid(
      value.spatialReference,
      'FeatureSet',
    );
    checkWkid(fallbackWkid, 'FeatureSet');
    return {
      type: 'FeatureCollection',
      features: value.features.map((feature, index) =>
        convertFeature(
          feature,
          `features[${index}]`,
          state,
          fallbackWkid,
          expectedKind,
        ),
      ),
    };
  }

  if ('geometry' in value || 'attributes' in value) {
    return {
      type: 'FeatureCollection',
      features: [convertFeature(value, 'feature', state, undefined, null)],
    };
  }

  if (geometryKindOf(value).length > 0) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: convertGeometry(value, 'geometry', state, undefined, null),
          properties: {},
        },
      ],
    };
  }

  fail(
    'unrecognised Esri JSON: expected a FeatureSet (features), a Feature (geometry + attributes), or a bare geometry (x/y, points, paths, rings, or envelope)',
  );
  return undefined;
}
