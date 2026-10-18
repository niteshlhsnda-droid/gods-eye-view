/**
 * GML (Geography Markup Language) import to GeoJSON.
 *
 * Pure parser: takes a parsed XML document (the DOM surface the other
 * geo-import readers use — `documentElement`, `localName`, `childNodes`,
 * `nodeType`, `textContent`, `getAttribute`) and returns a GeoJSON
 * FeatureCollection. No DOMParser lives here: a future loader wiring can
 * reuse the `parseXml` helper in `geoFileImport.js`.
 *
 * Standards: OGC 04-094 / ISO 19136 (GML 3.x) plus the GML 2 forms still
 * emitted by WFS servers (`<coordinates>`, `<coord>` with `<X>`/`<Y>`,
 * `outerBoundaryIs` / `innerBoundaryIs`). Prefix-agnostic: only
 * `localName` is read, so `gml:Point`, `gml3:Point` and default-namespace
 * `<Point>` all parse.
 *
 * CRS posture (the GML footgun): a geometry's effective `srsName` is its
 * own `srsName`, else the nearest ancestor's. Only WGS 84 is imported —
 * any other `srsName` (EPSG:3857, EPSG:27700, ...) refuses the whole file,
 * the same strictness as the WKT parser's non-4326 SRID refusal. Axis
 * order follows the named CRS: CRS84 means the tuples are already
 * lon,lat; EPSG:4326 means they are lat,lon per the EPSG definition and
 * are swapped to GeoJSON lon,lat. A missing `srsName` is assumed lon,lat
 * WGS 84. Altitude (a third ordinate, or `srsDimension="3"`) is dropped:
 * the import contract is WGS 84 ground footprints.
 *
 * Refusal posture, mirroring the importer: the whole file is refused on
 * an out-of-range coordinate, a non-numeric coordinate, an unclosed
 * Polygon ring, a degenerate geometry, an unsupported geometry type
 * (`Curve`, `Surface`, `Ring`, ...), custom `<coordinates>` separators,
 * or a cap breach. Caps mirror `geoFileImport.js`
 * (`MAX_IMPORT_ENTITIES` / `MAX_IMPORT_POSITIONS`). `boundedBy` /
 * `Envelope` boxes are ignored — they are not features.
 */

/** Most features one GML file may carry. Mirrors `MAX_IMPORT_ENTITIES`. */
export const GML_MAX_FEATURES = 20_000;
/** Most positions one GML file may carry. Mirrors `MAX_IMPORT_POSITIONS`. */
export const GML_MAX_POSITIONS = 250_000;
/** Longest plain-text feature name kept. Mirrors `MAX_IMPORT_NAME_LENGTH`. */
const MAX_GML_NAME_LENGTH = 120;

/** An error whose message is meant for the person who chose the file. */
export class GmlImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GmlImportError';
  }
}

const GEOMETRY_TYPES = new Set([
  'Point',
  'LineString',
  'LinearRing',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
  'MultiSurface',
]);

// Geometry types the parser knows by name but deliberately does not
// import — a Curve is not a LineString, a Surface is not a Polygon.
const UNSUPPORTED_GEOMETRY_TYPES = new Set([
  'Curve',
  'Surface',
  'Ring',
  'Arc',
  'ArcString',
  'Circle',
  'CubicSpline',
  'BSpline',
  'MultiCurve',
  'OrientableCurve',
  'OrientableSurface',
  'CompositeCurve',
  'CompositeSurface',
  'Grid',
  'RectifiedGrid',
  'Tin',
  'TriangulatedSurface',
]);

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Element children of `el` (`nodeType === 1`), optionally by localName. */
function elementChildren(el, localName) {
  const out = [];
  for (const child of el?.childNodes || [])
    if (
      child.nodeType === 1 &&
      (localName === undefined || child.localName === localName)
    )
      out.push(child);
  return out;
}

function firstElementChild(el, localName) {
  return elementChildren(el, localName)[0];
}

function attribute(el, name) {
  return el.getAttribute?.(name) ?? null;
}

/**
 * Whether `text` looks like GML: a `gml:`-prefixed element, a `gml`
 * namespace declaration, or a GML namespace URI (which also catches
 * default-namespace documents and non-`gml` prefixes).
 * @param {string} text
 * @returns {boolean}
 */
export function isGmlText(text) {
  if (typeof text !== 'string') return false;
  const head = text.replace(/^﻿/, '').slice(0, 4096);
  return (
    /<gml:/.test(head) ||
    /xmlns:gml\s*=/.test(head) ||
    /http:\/\/www\.opengis\.net\/gml\//.test(head)
  );
}

/** `srsName` → `'lonlat'` (tuples already lon,lat) or `'latlon'` (swap). */
function classifySrs(srsName) {
  if (srsName == null || String(srsName).trim() === '') return 'lonlat';
  const srs = String(srsName).trim();
  if (
    /^(?:urn:ogc:def:crs:OGC:1\.3:CRS84|http:\/\/www\.opengis\.net\/def\/crs\/OGC\/1\.3\/CRS84|CRS84|OGC:CRS84)$/i.test(
      srs,
    )
  )
    return 'lonlat';
  if (
    /^(?:EPSG:4326|urn:ogc:def:crs:EPSG(?::[\d.]*){0,2}:4326|http:\/\/www\.opengis\.net\/gml\/srs\/epsg\.xml#4326)$/i.test(
      srs,
    )
  )
    return 'latlon';
  throw new GmlImportError(
    `That GML file uses an unsupported CRS "${srs}" — only WGS 84 ` +
      '(CRS84 / EPSG:4326) is imported.',
  );
}

/** `srsDimension` on `el`: 2, 3, or undefined when absent. */
function readDimension(el) {
  const raw = attribute(el, 'srsDimension');
  if (raw == null) return undefined;
  if (raw.trim() === '2') return 2;
  if (raw.trim() === '3') return 3;
  throw new GmlImportError(
    `That GML file uses an unsupported srsDimension "${raw}" — only 2 or 3.`,
  );
}

function parseNumber(token) {
  const text = String(token).trim();
  if (!NUMBER_PATTERN.test(text))
    throw new GmlImportError(
      `That GML file has a coordinate that is not a number: ` +
        `"${text.slice(0, 40)}".`,
    );
  return Number(text);
}

/** A feature name as short plain text, or undefined. */
function cleanName(value) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > MAX_GML_NAME_LENGTH
    ? `${text.slice(0, MAX_GML_NAME_LENGTH - 1)}…`
    : text;
}

/**
 * Turn parsed ordinates into a GeoJSON position: apply the CRS axis
 * order, drop any altitude, check the world bounds, charge the cap.
 */
function finishPosition(numbers, order, ctx) {
  const lon = order === 'latlon' ? numbers[1] : numbers[0];
  const lat = order === 'latlon' ? numbers[0] : numbers[1];
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 90
  )
    throw new GmlImportError(
      'That GML file has coordinates outside the world ' +
        '(longitude ±180, latitude ±90).',
    );
  ctx.positions += 1;
  if (ctx.positions > ctx.maxPositions)
    throw new GmlImportError(
      `That file has more than ${ctx.maxPositions.toLocaleString()} ` +
        'points (the limit).',
    );
  return [lon, lat];
}

function parsePos(el, order, ctx) {
  const numbers = el.textContent
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseNumber);
  if (numbers.length < 2 || numbers.length > 3)
    throw new GmlImportError('That GML <pos> must hold two or three numbers.');
  return finishPosition(numbers, order, ctx);
}

function parseCoord(el, order, ctx) {
  const x = firstElementChild(el, 'X');
  const y = firstElementChild(el, 'Y');
  if (!x || !y) throw new GmlImportError('That GML <coord> needs <X> and <Y>.');
  return finishPosition(
    [parseNumber(x.textContent), parseNumber(y.textContent)],
    order,
    ctx,
  );
}

function parseCoordinates(el, order, ctx) {
  const cs = attribute(el, 'cs') ?? ',';
  const ts = attribute(el, 'ts') ?? ' ';
  const decimal = attribute(el, 'decimal') ?? '.';
  if (cs !== ',' || ts !== ' ' || decimal !== '.')
    throw new GmlImportError(
      'That GML <coordinates> uses custom separators (cs/ts/decimal) — ' +
        'only the defaults ("," / whitespace / ".") are imported.',
    );
  const text = el.textContent.trim();
  if (!text)
    throw new GmlImportError('That GML <coordinates> has no coordinates.');
  return text.split(/\s+/).map((tuple) => {
    const parts = tuple.split(',');
    if (parts.length < 2 || parts.length > 3)
      throw new GmlImportError(
        'That GML <coordinates> tuple must hold two or three numbers.',
      );
    return finishPosition(parts.map(parseNumber), order, ctx);
  });
}

/**
 * Every position of a point/line/ring element, from whichever coordinate
 * form it uses. `posList` groups by `srsDimension` (its own, else the
 * element's, else 2); `pos` / `coordinates` / `coord` tuples are
 * self-delimiting, so a third ordinate there is simply dropped.
 */
function parsePositions(el, order, ctx) {
  const posList = firstElementChild(el, 'posList');
  if (posList) {
    const dim = readDimension(posList) ?? readDimension(el) ?? 2;
    const numbers = posList.textContent
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(parseNumber);
    if (!numbers.length)
      throw new GmlImportError('That GML <posList> has no coordinates.');
    if (numbers.length % dim !== 0)
      throw new GmlImportError(
        `That GML <posList> holds ${numbers.length} numbers, which is ` +
          `not a multiple of srsDimension ${dim}.`,
      );
    const positions = [];
    for (let i = 0; i < numbers.length; i += dim)
      positions.push(finishPosition(numbers.slice(i, i + dim), order, ctx));
    return positions;
  }
  const posEls = elementChildren(el, 'pos');
  if (posEls.length) return posEls.map((pos) => parsePos(pos, order, ctx));
  const coordinates = firstElementChild(el, 'coordinates');
  if (coordinates) return parseCoordinates(coordinates, order, ctx);
  const coordEls = elementChildren(el, 'coord');
  if (coordEls.length)
    return coordEls.map((coord) => parseCoord(coord, order, ctx));
  throw new GmlImportError(`That GML <${el.localName}> has no coordinates.`);
}

function parseLinearRing(el, order, ctx) {
  const positions = parsePositions(el, order, ctx);
  if (positions.length < 4)
    throw new GmlImportError(
      'That GML Polygon ring needs at least four positions.',
    );
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1])
    throw new GmlImportError('That GML Polygon ring is not closed.');
  return positions;
}

function parseRingWrapper(wrapper, order, ctx) {
  if (wrapper.localName === 'LinearRing')
    return parseLinearRing(wrapper, order, ctx);
  const ring = firstElementChild(wrapper, 'LinearRing');
  if (!ring)
    throw new GmlImportError(
      `That GML Polygon ring wrapper holds no <LinearRing>.`,
    );
  return parseLinearRing(ring, order, ctx);
}

function parsePolygon(el, order, ctx) {
  let outer = null;
  const holes = [];
  for (const child of elementChildren(el)) {
    if (
      child.localName === 'exteriorRing' ||
      child.localName === 'outerBoundaryIs' ||
      child.localName === 'exterior'
    )
      outer = parseRingWrapper(child, order, ctx);
    else if (
      child.localName === 'interiorRing' ||
      child.localName === 'innerBoundaryIs' ||
      child.localName === 'interior'
    )
      holes.push(parseRingWrapper(child, order, ctx));
  }
  if (!outer)
    throw new GmlImportError('That GML Polygon has no exterior ring.');
  return { type: 'Polygon', coordinates: [outer, ...holes] };
}

/**
 * A multi-geometry from its member wrappers (`pointMember`, ...) or
 * direct geometry children. Each member is parsed with the multi's
 * effective CRS unless it carries its own `srsName`.
 */
function parseMulti(el, ctx, order, memberNames, geometryType, outType) {
  const parts = [];
  for (const child of elementChildren(el)) {
    if (memberNames.includes(child.localName)) {
      for (const grand of elementChildren(child)) {
        if (grand.localName === geometryType)
          parts.push(parseGeometry(grand, ctx, order));
        else
          throw new GmlImportError(
            `That GML <${el.localName}> member holds an unsupported ` +
              `geometry "${grand.localName}".`,
          );
      }
    } else if (child.localName === geometryType) {
      parts.push(parseGeometry(child, ctx, order));
    }
  }
  if (!parts.length)
    throw new GmlImportError(
      `That GML <${el.localName}> holds no <${geometryType}>.`,
    );
  return { type: outType, coordinates: parts.map((part) => part.coordinates) };
}

/**
 * Parse one geometry element. `inheritedOrder` is the already-classified
 * axis order of the nearest ancestor carrying an `srsName`; the
 * geometry's own `srsName` overrides it. Callers pass the order rather
 * than the raw name so the classification (and its refusal) happens once
 * per geometry.
 */
function parseGeometry(el, ctx, inheritedOrder) {
  const own = attribute(el, 'srsName');
  const order = own == null ? (inheritedOrder ?? 'lonlat') : classifySrs(own);
  switch (el.localName) {
    case 'Point': {
      const positions = parsePositions(el, order, ctx);
      if (positions.length !== 1)
        throw new GmlImportError(
          'That GML Point must hold exactly one position.',
        );
      return { type: 'Point', coordinates: positions[0] };
    }
    case 'LineString': {
      const positions = parsePositions(el, order, ctx);
      if (positions.length < 2)
        throw new GmlImportError(
          'That GML LineString needs at least two positions.',
        );
      return { type: 'LineString', coordinates: positions };
    }
    case 'LinearRing':
      // A bare ring is not a standalone feature geometry, but it is a
      // closed line — read it as one rather than dropping it silently.
      return {
        type: 'LineString',
        coordinates: parseLinearRing(el, order, ctx),
      };
    case 'Polygon':
      return parsePolygon(el, order, ctx);
    case 'MultiPoint':
      return parseMulti(
        el,
        ctx,
        order,
        ['pointMember', 'pointMembers'],
        'Point',
        'MultiPoint',
      );
    case 'MultiLineString':
      return parseMulti(
        el,
        ctx,
        order,
        ['lineStringMember', 'lineStringMembers'],
        'LineString',
        'MultiLineString',
      );
    case 'MultiPolygon':
      return parseMulti(
        el,
        ctx,
        order,
        ['polygonMember', 'polygonMembers'],
        'Polygon',
        'MultiPolygon',
      );
    case 'MultiSurface':
      return parseMulti(
        el,
        ctx,
        order,
        ['surfaceMember', 'surfaceMembers'],
        'Polygon',
        'MultiPolygon',
      );
    default:
      throw new GmlImportError(
        `That GML file uses an unsupported geometry type ` +
          `"${el.localName}".`,
      );
  }
}

/** One feature element → one GeoJSON Feature. */
function parseFeature(el, ctx, inheritedOrder) {
  if (UNSUPPORTED_GEOMETRY_TYPES.has(el.localName))
    throw new GmlImportError(
      `That GML file uses an unsupported geometry type ` + `"${el.localName}".`,
    );
  const own = attribute(el, 'srsName');
  const order = own == null ? inheritedOrder : classifySrs(own);
  const name = cleanName(firstElementChild(el, 'name')?.textContent);
  const geometries = [];
  for (const child of elementChildren(el)) {
    if (GEOMETRY_TYPES.has(child.localName)) {
      geometries.push(parseGeometry(child, ctx, order));
    } else if (child.localName === 'boundedBy') {
      continue;
    } else if (UNSUPPORTED_GEOMETRY_TYPES.has(child.localName)) {
      throw new GmlImportError(
        `That GML file uses an unsupported geometry type ` +
          `"${child.localName}".`,
      );
    } else {
      // Property wrapper (e.g. <ms:geometry><gml:Point/>): the
      // geometry is a direct child, one level down.
      for (const grand of elementChildren(child)) {
        if (GEOMETRY_TYPES.has(grand.localName))
          geometries.push(parseGeometry(grand, ctx, order));
        else if (UNSUPPORTED_GEOMETRY_TYPES.has(grand.localName))
          throw new GmlImportError(
            `That GML file uses an unsupported geometry type ` +
              `"${grand.localName}".`,
          );
      }
    }
  }
  ctx.features += 1;
  if (ctx.features > ctx.maxFeatures)
    throw new GmlImportError(
      `That file has more than ${ctx.maxFeatures.toLocaleString()} ` +
        'features (the limit).',
    );
  return {
    type: 'Feature',
    properties: name ? { name } : {},
    geometry:
      geometries.length === 0
        ? null
        : geometries.length === 1
          ? geometries[0]
          : { type: 'GeometryCollection', geometries },
  };
}

function parseMember(member, ctx, inheritedOrder) {
  const features = [];
  for (const child of elementChildren(member)) {
    if (child.localName === 'FeatureCollection')
      features.push(...parseCollection(child, ctx, inheritedOrder));
    else features.push(parseFeature(child, ctx, inheritedOrder));
  }
  return features;
}

function parseCollection(el, ctx, inheritedOrder) {
  const own = attribute(el, 'srsName');
  const order = own == null ? inheritedOrder : classifySrs(own);
  const features = [];
  for (const child of elementChildren(el)) {
    if (child.localName === 'featureMember' || child.localName === 'member')
      features.push(...parseMember(child, ctx, order));
    else if (child.localName === 'featureMembers')
      for (const feature of elementChildren(child))
        features.push(parseFeature(feature, ctx, order));
    // boundedBy / Envelope / name / description are not features.
  }
  return features;
}

/**
 * Read a parsed GML document into GeoJSON. `doc` needs only the DOM
 * surface described in the header. A bare geometry becomes one
 * feature; a bare feature becomes one feature; a FeatureCollection
 * becomes one feature per member.
 * @param {Document} doc
 * @returns {object} A FeatureCollection.
 */
export function gmlToGeoJson(
  doc,
  { maxFeatures = GML_MAX_FEATURES, maxPositions = GML_MAX_POSITIONS } = {},
) {
  const root = doc?.documentElement;
  if (!root || root.nodeType !== 1)
    throw new GmlImportError('That file is not GML.');
  if (root.localName === 'Envelope' || root.localName === 'Box')
    throw new GmlImportError(
      'That GML file holds only a bounding box, with no features to draw.',
    );
  const ctx = { features: 0, positions: 0, maxFeatures, maxPositions };
  const rootOrder = classifySrs(attribute(root, 'srsName'));
  if (GEOMETRY_TYPES.has(root.localName)) {
    const geometry = parseGeometry(root, ctx, rootOrder);
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry }],
    };
  }
  if (root.localName === 'FeatureCollection')
    return {
      type: 'FeatureCollection',
      features: parseCollection(root, ctx, rootOrder),
    };
  if (root.localName === 'featureMember' || root.localName === 'member')
    return {
      type: 'FeatureCollection',
      features: parseMember(root, ctx, rootOrder),
    };
  // A bare root must look like a feature (at least one element child) —
  // an empty foreign root such as <kml/> is not a GML feature.
  if (!elementChildren(root).length)
    throw new GmlImportError('That file is not GML.');
  return {
    type: 'FeatureCollection',
    features: [parseFeature(root, ctx, rootOrder)],
  };
}
