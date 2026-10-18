/**
 * GeoRSS import to GeoJSON.
 *
 * Pure parser: takes a parsed XML document (the DOM surface the other
 * geo-import readers use — `documentElement`, `localName`, `childNodes`,
 * `nodeType`, `textContent`, `getAttribute`) and returns a GeoJSON
 * FeatureCollection. No DOMParser lives here: a future loader wiring can
 * reuse the `parseXml` helper in `geoFileImport.js` and route with
 * `isGeoRssText`.
 *
 * The gap: the geo file importer takes GeoJSON, KML/KMZ and GPX, and
 * earlier cycles added CSV, WKT/EWKT, TopoJSON, GeoJSONL, OSM XML, WKB /
 * EWKB, encoded polylines, GML, Esri JSON, MIF/MID and Shapefile — but not
 * GeoRSS, the feed form in which located news, quakes, fires and traffic
 * most often arrive (USGS / GDACS / news RSS with `<georss:point>`, Atom
 * entries with `<georss:where>`).
 *
 * Standards: OGC 07-092r1 (GeoRSS Simple + GeoRSS GML) and the W3C Basic
 * Geo vocabulary (`<geo:lat>` / `<geo:long>`). Prefix-agnostic: only
 * `localName` is read, so `georss:point`, `geo:point` and a
 * default-namespace `<point>` all parse — the element names do not collide
 * with RSS / Atom item children.
 *
 * Feed shapes: RSS 2.0 (`<rss><channel><item>`), Atom (`<feed><entry>`),
 * RSS 1.0 (`<RDF><item>`, channel title when present). One geometry per
 * item; items with no geometry are skipped (a news feed is mostly
 * non-geo items, and emitting them as null-geometry features would bury
 * the geo ones). A feed with no geo item at all is refused.
 *
 * Geometry encodings:
 *   - `<georss:point>` lat lon → Point.
 *   - `<georss:line>` lat lon … → LineString (at least 2 pairs).
 *   - `<georss:polygon>` lat lon … → Polygon (at least 4 pairs, closed;
 *     rings are re-oriented to the GeoJSON right-hand rule — GeoRSS does
 *     not mandate a ring order, so enforcing one would refuse valid
 *     feeds; the point set is preserved).
 *   - `<georss:box>` minLat minLon maxLat maxLon → Polygon (CCW box).
 *   - `<georss:where>` → GML Point / LineString / Polygon (+ holes) /
 *     Envelope / MultiPoint / MultiLineString / MultiPolygon /
 *     MultiSurface, in the `pos` / `posList` / `coordinates` / `coord`
 *     forms, GML 2 (`outerBoundaryIs`) and GML 3 (`exteriorRing`) ring
 *     wrappers alike.
 *   - `<geo:lat>` + `<geo:long>` → Point (the common `<geo:lon>`
 *     spelling is accepted as the same pair). A lone `<geo:lat>` without its
 *     pair refuses the whole input. A `georss:point` duplicated by an
 *     identical `geo:lat` / `geo:long` pair (the common double-tagged
 *     feed) parses as one Point; conflicting duplicates refuse.
 *   - `<georss:circle>` is refused: GeoJSON has no circle, and
 *     approximating one would invent vertices — never guess.
 *   - `<georss:elev>` (metres) becomes the Point's third ordinate. With a
 *     non-Point geometry it refuses the whole input, because the
 *     elevation would otherwise be silently dropped.
 *
 * CRS posture: GeoRSS is defined as WGS 84 (EPSG:4326) only. The simple
 * elements are always lat,lon; an `srsName` on one must be an EPSG:4326
 * spelling or the whole input is refused (a CRS84 tag on a
 * `<georss:point>` is contradictory — the spec says lat,lon — so it
 * refuses rather than being reinterpreted). Inside `<georss:where>`,
 * `srsName` follows the GML parser's rule exactly: CRS84 tuples are
 * already lon,lat, EPSG:4326 tuples are lat,lon and are swapped, a
 * missing `srsName` is assumed lon,lat, and any other CRS refuses the
 * whole input. A GML `<coordinates>` list is always lon,lat, per GML 2.
 * GML altitude (a third ordinate in `<pos>`) is dropped, mirroring the
 * GML parser: the import contract is WGS 84 ground footprints.
 *
 * Properties per feature: `title`, `link`, `description`, `id`,
 * `published`, `author`, `categories`, plus `featureName` /
 * `featureType` / `relationship` from the `georss:` extras, and
 * `feedTitle` from the channel / feed. Titles and GeoRSS extras are
 * truncated to 120 characters like the importer's name cap.
 *
 * Refusal posture, mirroring the importer: the whole input is refused
 * on a non-feed root, a missing RSS `<channel>`, a bad / non-numeric /
 * out-of-range coordinate, an incomplete Basic Geo pair, two different
 * geometries in one item, an unclosed or degenerate polygon, a
 * zero-area box, an unsupported geometry (`Circle`, GML `Curve` /
 * `Surface` / …), a non-WGS-84 CRS, a non-finite elevation, or a cap
 * breach. Caps mirror `geoFileImport.js`
 * (`MAX_IMPORT_ENTITIES` / `MAX_IMPORT_POSITIONS`).
 */

/** Most geo features one feed may carry. Mirrors `MAX_IMPORT_ENTITIES`. */
export const GEORSS_MAX_FEATURES = 20_000;
/** Most positions one feed may carry. Mirrors `MAX_IMPORT_POSITIONS`. */
export const GEORSS_MAX_POSITIONS = 250_000;
/** Longest plain-text title / GeoRSS extra kept. Mirrors `MAX_IMPORT_NAME_LENGTH`. */
const MAX_GEORSS_NAME_LENGTH = 120;

/** An error whose message is meant for the person who chose the file. */
export class GeoRssImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeoRssImportError';
  }
}

function fail(message) {
  throw new GeoRssImportError(message);
}

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Element children of `el` (`nodeType === 1`), optionally by localName. */
function elementChildren(el, localName) {
  const out = [];
  for (const child of el?.childNodes ?? []) {
    if (
      child.nodeType === 1 &&
      (localName === undefined || child.localName === localName)
    ) {
      out.push(child);
    }
  }
  return out;
}

function firstElementChild(el, localName) {
  return elementChildren(el, localName)[0];
}

function attribute(el, name) {
  const value = el?.getAttribute?.(name);
  return value == null ? null : String(value);
}

/** Plain-text child of `el` by localName, trimmed, or undefined. */
function childText(el, localName) {
  const child = firstElementChild(el, localName);
  if (!child) return undefined;
  const text = String(child.textContent ?? '').trim();
  return text === '' ? undefined : text;
}

/** Short plain-text value, control chars scrubbed, truncated at 120. */
function cleanName(value) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > MAX_GEORSS_NAME_LENGTH
    ? `${text.slice(0, MAX_GEORSS_NAME_LENGTH - 1)}…`
    : text;
}

/** Long-form text (a description): whitespace collapsed, not truncated. */
function cleanText(value) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? undefined : text;
}

/**
 * `srsName` → `'lonlat'` (tuples already lon,lat) or `'latlon'` (swap).
 * GML rule, mirroring the GML parser: a missing `srsName` is lon,lat.
 */
function classifyGmlSrs(srsName) {
  if (srsName == null || String(srsName).trim() === '') return 'lonlat';
  const srs = String(srsName).trim();
  if (
    /^(?:urn:ogc:def:crs:OGC:1\.3:CRS84|http:\/\/www\.opengis\.net\/def\/crs\/OGC\/1\.3\/CRS84|CRS84|OGC:CRS84)$/i.test(
      srs,
    )
  ) {
    return 'lonlat';
  }
  if (
    /^(?:EPSG:4326|urn:ogc:def:crs:EPSG(?::[\d.]*){0,2}:4326|http:\/\/www\.opengis\.net\/gml\/srs\/epsg\.xml#4326)$/i.test(
      srs,
    )
  ) {
    return 'latlon';
  }
  fail(
    `That GeoRSS feed uses an unsupported CRS "${srs}" — only WGS 84 ` +
      '(CRS84 / EPSG:4326) is imported.',
  );
}

/**
 * `srsName` on a GeoRSS simple element (`point` / `line` / `polygon` /
 * `box`): GeoRSS defines those as lat,lon in EPSG:4326, so only EPSG:4326
 * spellings (or no `srsName`) are accepted. A CRS84 tag here would
 * contradict the spec, so it refuses rather than being reinterpreted.
 */
function classifySimpleSrs(srsName) {
  if (srsName == null || String(srsName).trim() === '') return 'latlon';
  const srs = String(srsName).trim();
  if (
    /^(?:EPSG:4326|urn:ogc:def:crs:EPSG(?::[\d.]*){0,2}:4326|http:\/\/www\.opengis\.net\/gml\/srs\/epsg\.xml#4326)$/i.test(
      srs,
    )
  ) {
    return 'latlon';
  }
  fail(
    `That GeoRSS feed puts srsName "${srs}" on a GeoRSS simple element — ` +
      'only EPSG:4326 (lat,lon) is imported there.',
  );
}

function parseNumber(token) {
  const text = String(token).trim();
  if (!NUMBER_PATTERN.test(text)) {
    fail(
      `That GeoRSS feed has a coordinate that is not a number: ` +
        `"${text.slice(0, 40)}".`,
    );
  }
  return Number(text);
}

/**
 * Turn one (lat, lon) or (lon, lat) pair into a GeoJSON position, check
 * the world bounds, charge the position cap.
 */
function makePosition(first, second, order, ctx, z) {
  const lon = order === 'latlon' ? second : first;
  const lat = order === 'latlon' ? first : second;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    fail(`That GeoRSS feed has a latitude outside ±90: ${lat}.`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    fail(`That GeoRSS feed has a longitude outside ±180: ${lon}.`);
  }
  ctx.positions += 1;
  if (ctx.positions > ctx.maxPositions) {
    fail(
      `That GeoRSS feed has more than ${ctx.maxPositions.toLocaleString()} points (the limit).`,
    );
  }
  return z === undefined ? [lon, lat] : [lon, lat, z];
}

/** Whitespace-separated numbers → positions in the given tuple order. */
function parsePairList(text, order, ctx) {
  const tokens = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length % 2 !== 0) {
    fail(
      'That GeoRSS feed has an odd number of coordinates — coordinates come in pairs.',
    );
  }
  const positions = [];
  for (let i = 0; i < tokens.length; i += 2) {
    positions.push(
      makePosition(
        parseNumber(tokens[i]),
        parseNumber(tokens[i + 1]),
        order,
        ctx,
      ),
    );
  }
  return positions;
}

/** `lon,lat` comma tuples (GML 2 `<coordinates>`) → positions. */
function parseCoordinatesList(text, ctx) {
  const tuples = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter((tuple) => tuple !== '');
  const positions = [];
  for (const tuple of tuples) {
    const parts = tuple.split(',');
    if (parts.length !== 2) {
      fail(
        'That GeoRSS feed has a <coordinates> tuple that is not "lon,lat": ' +
          `"${tuple.slice(0, 40)}".`,
      );
    }
    positions.push(
      makePosition(parseNumber(parts[0]), parseNumber(parts[1]), 'lonlat', ctx),
    );
  }
  return positions;
}

function samePosition(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

/**
 * Re-orient a closed ring to the GeoJSON right-hand rule: exterior
 * counter-clockwise (positive shoelace area), holes clockwise. Reversing
 * a closed ring keeps it closed.
 */
function orientRing(ring, counterclockwise) {
  const area = signedArea(ring);
  if (area === 0) {
    fail('That GeoRSS feed has a zero-area ring — it encloses nothing.');
  }
  if (area > 0 !== counterclockwise) return [...ring].reverse();
  return ring;
}

function checkClosedRing(ring, what) {
  if (ring.length < 4) {
    fail(
      `That GeoRSS ${what} has ${ring.length} positions — a ring needs at least 4.`,
    );
  }
  if (!samePosition(ring[0], ring[ring.length - 1])) {
    fail(
      `That GeoRSS ${what} is not closed — its first and last positions differ.`,
    );
  }
}

function finishPolygon(ring, holes, what) {
  checkClosedRing(ring, what);
  const exterior = orientRing(ring, true);
  const orientedHoles = holes.map((hole) => {
    checkClosedRing(hole, what);
    return orientRing(hole, false);
  });
  return { type: 'Polygon', coordinates: [exterior, ...orientedHoles] };
}

/** One GML `<pos>` / `<coord>` element → a position (altitude dropped). */
function parseGmlPos(el, order, ctx) {
  if (el.localName === 'coord') {
    const x = childText(el, 'X');
    const y = childText(el, 'Y');
    if (x === undefined || y === undefined) {
      fail('That GeoRSS feed has a GML <coord> without <X> and <Y>.');
    }
    // <coord> is always X = lon, Y = lat, whatever the srsName says.
    return makePosition(parseNumber(x), parseNumber(y), 'lonlat', ctx);
  }
  const numbers = String(el.textContent ?? '')
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  if (numbers.length !== 2 && numbers.length !== 3) {
    fail(
      'That GeoRSS feed has a GML <pos> that is not 2 or 3 numbers: ' +
        `"${String(el.textContent ?? '')
          .trim()
          .slice(0, 40)}".`,
    );
  }
  return makePosition(
    parseNumber(numbers[0]),
    parseNumber(numbers[1]),
    order,
    ctx,
  );
}

/**
 * Positions from a GML container: a `<posList>`, `<coordinates>`, or a
 * run of `<pos>` / `<coord>` children.
 */
function parseGmlPositions(container, order, ctx) {
  const posList = firstElementChild(container, 'posList');
  if (posList) return parsePairList(posList.textContent, order, ctx);
  const coordinates = firstElementChild(container, 'coordinates');
  if (coordinates) return parseCoordinatesList(coordinates.textContent, ctx);
  const singles = elementChildren(container).filter(
    (child) => child.localName === 'pos' || child.localName === 'coord',
  );
  if (singles.length > 0) {
    return singles.map((single) => parseGmlPos(single, order, ctx));
  }
  fail(
    `That GeoRSS feed has a GML <${container.localName}> with no <pos>, <posList>, <coordinates> or <coord> positions.`,
  );
}

/** One GML ring wrapper (`LinearRing`, `exteriorRing`, …) → positions. */
function parseGmlRing(wrapper, order, ctx) {
  const ringEl =
    wrapper.localName === 'LinearRing'
      ? wrapper
      : firstElementChild(wrapper, 'LinearRing');
  if (!ringEl) {
    fail(
      `That GeoRSS feed has a GML <${wrapper.localName}> without a <LinearRing>.`,
    );
  }
  return parseGmlPositions(ringEl, order, ctx);
}

const GML_UNSUPPORTED = new Set([
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

/** One GML geometry element inside `<georss:where>` → GeoJSON geometry. */
function parseGmlGeometry(el, inheritedOrder, ctx) {
  const order =
    attribute(el, 'srsName') == null
      ? inheritedOrder
      : classifyGmlSrs(attribute(el, 'srsName'));
  switch (el.localName) {
    case 'Point': {
      const pos =
        firstElementChild(el, 'pos') ?? firstElementChild(el, 'coord');
      const coordinates = firstElementChild(el, 'coordinates');
      if (pos)
        return { type: 'Point', coordinates: parseGmlPos(pos, order, ctx) };
      if (coordinates) {
        const positions = parseCoordinatesList(coordinates.textContent, ctx);
        if (positions.length !== 1) {
          fail('That GeoRSS feed has a GML Point with more than one position.');
        }
        return { type: 'Point', coordinates: positions[0] };
      }
      fail('That GeoRSS feed has a GML <Point> with no position.');
      break;
    }
    case 'LineString': {
      const positions = parseGmlPositions(el, order, ctx);
      if (positions.length < 2) {
        fail(
          'That GeoRSS feed has a GML <LineString> with fewer than 2 positions.',
        );
      }
      return { type: 'LineString', coordinates: positions };
    }
    case 'Polygon': {
      const exteriorWrapper =
        firstElementChild(el, 'exteriorRing') ??
        firstElementChild(el, 'outerBoundaryIs');
      let exterior;
      if (exteriorWrapper) {
        exterior = parseGmlRing(exteriorWrapper, order, ctx);
      } else if (
        firstElementChild(el, 'posList') ??
        firstElementChild(el, 'coordinates')
      ) {
        exterior = parseGmlPositions(el, order, ctx);
      } else {
        fail('That GeoRSS feed has a GML <Polygon> with no exterior ring.');
      }
      const holes = [];
      for (const wrapper of elementChildren(el)) {
        if (
          wrapper.localName === 'interiorRing' ||
          wrapper.localName === 'innerBoundaryIs'
        ) {
          holes.push(parseGmlRing(wrapper, order, ctx));
        }
      }
      return finishPolygon(exterior, holes, 'GML Polygon');
    }
    case 'Envelope': {
      const lower = firstElementChild(el, 'lowerCorner');
      const upper = firstElementChild(el, 'upperCorner');
      if (!lower || !upper) {
        fail(
          'That GeoRSS feed has a GML <Envelope> without <lowerCorner> and <upperCorner>.',
        );
      }
      const min = parsePairList(lower.textContent, order, ctx);
      const max = parsePairList(upper.textContent, order, ctx);
      if (min.length !== 1 || max.length !== 1) {
        fail(
          'That GeoRSS feed has a GML <Envelope> corner that is not one pair.',
        );
      }
      return boxPolygon(min[0], max[0], 'GML Envelope');
    }
    case 'MultiPoint':
    case 'MultiLineString':
    case 'MultiPolygon':
    case 'MultiSurface': {
      const memberNames = {
        MultiPoint: ['pointMember', 'pointMembers'],
        MultiLineString: ['lineStringMember', 'lineStringMembers'],
        MultiPolygon: ['polygonMember', 'polygonMembers'],
        MultiSurface: ['surfaceMember', 'surfaceMembers'],
      }[el.localName];
      const partType = {
        MultiPoint: 'Point',
        MultiLineString: 'LineString',
        MultiPolygon: 'Polygon',
        MultiSurface: 'Polygon',
      }[el.localName];
      const outType = {
        MultiPoint: 'MultiPoint',
        MultiLineString: 'MultiLineString',
        MultiPolygon: 'MultiPolygon',
        MultiSurface: 'MultiPolygon',
      }[el.localName];
      const parts = [];
      for (const child of elementChildren(el)) {
        if (!memberNames.includes(child.localName)) continue;
        for (const grand of elementChildren(child)) {
          if (grand.localName !== partType) {
            fail(
              `That GeoRSS feed has a GML <${el.localName}> member holding ` +
                `<${grand.localName}> instead of <${partType}>.`,
            );
          }
          parts.push(parseGmlGeometry(grand, order, ctx));
        }
      }
      if (parts.length === 0) {
        fail(`That GeoRSS feed has an empty GML <${el.localName}>.`);
      }
      return {
        type: outType,
        coordinates: parts.map((part) => part.coordinates),
      };
    }
    default: {
      if (GML_UNSUPPORTED.has(el.localName)) {
        fail(
          `That GeoRSS feed uses GML <${el.localName}>, which is not imported — ` +
            'it has no GeoJSON equivalent.',
        );
      }
      fail(
        `That GeoRSS feed uses an unsupported GML geometry <${el.localName}>.`,
      );
    }
  }
}

/**
 * A (min, max) corner pair in GeoJSON lon,lat order → a CCW box Polygon.
 * Refuses a zero-area box.
 */
function boxPolygon(min, max, what) {
  const [minLon, minLat] = min;
  const [maxLon, maxLat] = max;
  if (minLat >= maxLat || minLon >= maxLon) {
    fail(
      `That GeoRSS ${what} is degenerate — its minimum corner is not below and left of its maximum corner.`,
    );
  }
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

const SIMPLE_GEOMETRY = new Set([
  'point',
  'line',
  'polygon',
  'box',
  'circle',
  'where',
]);

/** One GeoRSS simple element (`point` / `line` / `polygon` / `box`) → geometry. */
function parseSimpleGeometry(el, ctx) {
  const order = classifySimpleSrs(attribute(el, 'srsName'));
  switch (el.localName) {
    case 'point': {
      const positions = parsePairList(el.textContent, order, ctx);
      if (positions.length !== 1) {
        fail('That GeoRSS <point> must hold exactly one lat,lon pair.');
      }
      return { type: 'Point', coordinates: positions[0] };
    }
    case 'line': {
      const positions = parsePairList(el.textContent, order, ctx);
      if (positions.length < 2) {
        fail('That GeoRSS <line> needs at least 2 lat,lon pairs.');
      }
      return { type: 'LineString', coordinates: positions };
    }
    case 'polygon': {
      const positions = parsePairList(el.textContent, order, ctx);
      return finishPolygon(positions, [], 'polygon');
    }
    case 'box': {
      const corners = parsePairList(el.textContent, order, ctx);
      if (corners.length !== 2) {
        fail(
          'That GeoRSS <box> must hold exactly minLat minLon maxLat maxLon.',
        );
      }
      // Corners arrive as [lon, lat] pairs: first is the minimum, second
      // the maximum.
      return boxPolygon(corners[0], corners[1], 'box');
    }
    case 'circle': {
      fail(
        'That GeoRSS <circle> is not imported — GeoJSON has no circle, ' +
          'and approximating one would invent vertices.',
      );
      break;
    }
    default: {
      fail(`That GeoRSS feed uses an unsupported element <${el.localName}>.`);
    }
  }
}

/** The `<georss:where>` wrapper → its single GML geometry. */
function parseWhere(whereEl, ctx) {
  const inheritedOrder =
    attribute(whereEl, 'srsName') == null
      ? 'lonlat'
      : classifyGmlSrs(attribute(whereEl, 'srsName'));
  for (const child of elementChildren(whereEl)) {
    if (child.localName === 'boundedBy') continue;
    return parseGmlGeometry(child, inheritedOrder, ctx);
  }
  fail('That GeoRSS <where> holds no GML geometry.');
}

/**
 * One item / entry → a GeoJSON Feature, or null when the item carries no
 * geometry (callers skip those).
 */
function parseItem(item, feedTitle, ctx) {
  let geometry = null;
  let geometryCount = 0;

  const simpleEls = elementChildren(item).filter((child) =>
    SIMPLE_GEOMETRY.has(child.localName),
  );
  for (const el of simpleEls) {
    geometryCount += 1;
    if (el.localName === 'where') geometry = parseWhere(el, ctx);
    else geometry = parseSimpleGeometry(el, ctx);
  }

  const latEl = firstElementChild(item, 'lat');
  const longEl =
    firstElementChild(item, 'long') ?? firstElementChild(item, 'lon');
  if ((latEl == null) !== (longEl == null)) {
    fail(
      'That GeoRSS feed has an item with <geo:lat> but no <geo:long>, ' +
        'or the reverse — a Basic Geo pair needs both.',
    );
  }
  let basicPoint = null;
  if (latEl && longEl) {
    basicPoint = makePosition(
      parseNumber(latEl.textContent),
      parseNumber(longEl.textContent),
      'latlon',
      ctx,
    );
    geometryCount += 1;
  }

  if (geometryCount > 1) {
    // The one tolerated duplication: a georss:point restated by an
    // identical geo:lat / geo:long pair.
    if (
      geometryCount === 2 &&
      basicPoint &&
      geometry?.type === 'Point' &&
      samePosition(geometry.coordinates, basicPoint)
    ) {
      // Same point, stated twice — keep the one geometry.
    } else {
      fail(
        'That GeoRSS feed has an item with more than one geometry — ' +
          'one item carries one geometry.',
      );
    }
  }
  if (!geometry && basicPoint) {
    geometry = { type: 'Point', coordinates: basicPoint };
  }
  if (!geometry) return null;

  const elevEl = firstElementChild(item, 'elev');
  if (elevEl) {
    const elev = parseNumber(elevEl.textContent);
    if (geometry.type !== 'Point') {
      fail(
        'That GeoRSS feed puts <georss:elev> on a non-Point geometry — ' +
          'the elevation would otherwise be silently dropped.',
      );
    }
    geometry = {
      type: 'Point',
      coordinates: [...geometry.coordinates, elev],
    };
  }

  const properties = {};
  const title = cleanName(childText(item, 'title'));
  if (title !== undefined) properties.title = title;
  // RSS <link> is text; Atom <link> is href="…". Prefer rel="alternate".
  let link;
  const linkEls = elementChildren(item, 'link');
  if (linkEls.length > 0) {
    const alternate = linkEls.find(
      (linkEl) =>
        attribute(linkEl, 'rel') == null ||
        attribute(linkEl, 'rel') === 'alternate',
    );
    const chosen = alternate ?? linkEls[0];
    link =
      cleanText(attribute(chosen, 'href')) ?? cleanText(chosen.textContent);
  }
  if (link !== undefined) properties.link = link;
  const description = cleanText(
    childText(item, 'description') ??
      childText(item, 'summary') ??
      childText(item, 'content'),
  );
  if (description !== undefined) properties.description = description;
  const id = cleanText(childText(item, 'guid') ?? childText(item, 'id'));
  if (id !== undefined) properties.id = id;
  const published = cleanText(
    childText(item, 'pubDate') ??
      childText(item, 'date') ??
      childText(item, 'published') ??
      childText(item, 'updated'),
  );
  if (published !== undefined) properties.published = published;
  const authorEl = firstElementChild(item, 'author');
  const author = cleanName(
    authorEl
      ? (childText(authorEl, 'name') ?? authorEl.textContent)
      : childText(item, 'author'),
  );
  if (author !== undefined) properties.author = author;
  const categories = elementChildren(item, 'category')
    .map(
      (category) =>
        cleanName(attribute(category, 'term')) ??
        cleanName(category.textContent),
    )
    .filter((category) => category !== undefined);
  if (categories.length > 0) properties.categories = categories;
  const featureName = cleanName(childText(item, 'featurename'));
  if (featureName !== undefined) properties.featureName = featureName;
  const featureType = cleanName(childText(item, 'featuretypetag'));
  if (featureType !== undefined) properties.featureType = featureType;
  const relationship = cleanName(childText(item, 'relationshiptag'));
  if (relationship !== undefined) properties.relationship = relationship;
  if (feedTitle !== undefined) properties.feedTitle = feedTitle;

  return { type: 'Feature', geometry, properties };
}

/**
 * A parsed GeoRSS document → a GeoJSON FeatureCollection.
 * @param {{ documentElement: object }} doc Parsed XML document.
 * @param {{ maxFeatures?: number, maxPositions?: number }} [options]
 * @returns {{ type: 'FeatureCollection', features: Array<object> }}
 */
export function geoRssToGeoJson(
  doc,
  {
    maxFeatures = GEORSS_MAX_FEATURES,
    maxPositions = GEORSS_MAX_POSITIONS,
  } = {},
) {
  const root = doc?.documentElement;
  if (!root || root.nodeType !== 1) {
    fail('That file is not a GeoRSS feed — it has no document element.');
  }
  const ctx = { positions: 0, maxPositions };
  let items;
  let feedTitle;
  if (root.localName === 'rss') {
    const channel = firstElementChild(root, 'channel');
    if (!channel) {
      fail('That GeoRSS feed has an <rss> root but no <channel>.');
    }
    feedTitle = cleanName(childText(channel, 'title'));
    items = elementChildren(channel, 'item');
  } else if (root.localName === 'feed') {
    feedTitle = cleanName(childText(root, 'title'));
    items = elementChildren(root, 'entry');
  } else if (root.localName === 'RDF') {
    const channel = firstElementChild(root, 'channel');
    feedTitle = channel ? cleanName(childText(channel, 'title')) : undefined;
    items = elementChildren(root, 'item');
  } else {
    fail(
      `That file is not a GeoRSS feed — its root is <${root.localName}>, ` +
        'expected <rss>, <feed> or <RDF>.',
    );
  }

  const features = [];
  for (const item of items) {
    const feature = parseItem(item, feedTitle, ctx);
    if (!feature) continue;
    features.push(feature);
    if (features.length > maxFeatures) {
      fail(
        `That GeoRSS feed has more than ${maxFeatures.toLocaleString()} geo items (the limit).`,
      );
    }
  }
  if (features.length === 0) {
    fail('That GeoRSS feed has no item with GeoRSS geometry.');
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Sniff text for a GeoRSS feed: an RSS / Atom / RDF root plus a
 * GeoRSS (`georss:`) or Basic Geo (`geo:lat` / `geo:long`) marker. Plain
 * RSS / Atom without any geo marker is not GeoRSS.
 */
export function isGeoRssText(text) {
  if (typeof text !== 'string') return false;
  if (!/<(?:rss|feed|RDF)[\s>/]/i.test(text)) return false;
  return (
    /<georss:/i.test(text) ||
    /xmlns:georss/i.test(text) ||
    /<geo:(?:lat|long)\b/i.test(text) ||
    /xmlns:geo=/i.test(text)
  );
}
