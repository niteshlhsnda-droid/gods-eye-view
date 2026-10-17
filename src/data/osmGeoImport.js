/** OpenStreetMap XML (`.osm`) → GeoJSON, with no network and no tags kept but names. */
import {
  MAX_IMPORT_ENTITIES,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';

/** An error whose message is meant for the person who chose the file. */
export class OsmGeoImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OsmGeoImportError';
  }
}

// A closed way is an area when it carries one of these tags and no linear
// tag — the OSM rule of thumb (a closed highway is a roundabout, not a
// polygon; a closed waterway is a river, not a lake). `area=yes` forces an
// area and `area=no` forces a line, whatever the other tags say.
const AREA_TAGS = new Set([
  'aeroway',
  'amenity',
  'building',
  'craft',
  'healthcare',
  'historic',
  'landuse',
  'leisure',
  'man_made',
  'military',
  'natural',
  'office',
  'place',
  'shop',
  'tourism',
]);
const LINEAR_TAGS = new Set([
  'barrier',
  'highway',
  'public_transport',
  'railway',
  'route',
  'waterway',
]);

const fail = (message) => {
  throw new OsmGeoImportError(message);
};

/** Child elements of `el` with this tag name. */
const childrenNamed = (el, name) => {
  const out = [];
  const kids = el?.childNodes || [];
  for (let i = 0; i < kids.length; i++)
    if (kids[i].nodeType === 1 && kids[i].localName === name) out.push(kids[i]);
  return out;
};

/** The `k`/`v` tags on a node, way or relation, as a Map. */
function readTags(el) {
  const tags = new Map();
  for (const tag of childrenNamed(el, 'tag')) {
    const key = tag.getAttribute('k');
    const value = tag.getAttribute('v');
    if (key !== null && value !== null) tags.set(key, value);
  }
  return tags;
}

function readId(el, what) {
  const raw = el.getAttribute('id');
  if (raw === null || !/^-?\d+$/.test(raw.trim()))
    fail(`That OSM file has a ${what} without a valid id.`);
  return raw.trim();
}

function readCoordinate(el) {
  const rawLat = el.getAttribute('lat');
  const rawLon = el.getAttribute('lon');
  if (rawLat === null || rawLon === null || !rawLat.trim() || !rawLon.trim())
    fail('That OSM file has a node without coordinates.');
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    fail('That OSM file has invalid coordinates.');
  return [lon, lat];
}

/** Ray-casting point-in-ring; a point on the boundary counts as inside. */
function ringContains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi === y && yj === y && x >= Math.min(xi, xj) && x <= Math.max(xi, xj))
      return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Absolute shoelace area of a ring, for picking the smallest containing outer. */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]) / 2;
  return Math.abs(sum);
}

/**
 * Parse a parsed OSM XML document into a GeoJSON FeatureCollection.
 * Takes a Document (like `gpxToGeoJson`) so the conversion stays
 * testable where there is no DOMParser; the caller parses the text.
 *
 * Tagged nodes become points; ways become lines, or polygons when closed
 * with an area tag (see AREA_TAGS); `type=multipolygon` relations become
 * polygons / multipolygons with their inner rings as holes. Only `name`
 * tags survive — every other tag is dropped, matching the importer's
 * scrubbing. `<bounds>` and other metadata are ignored. Anything
 * malformed — a non-`<osm>` root, a dangling node/way reference,
 * an unclosed multipolygon ring, a duplicate id, an out-of-range
 * coordinate — refuses the whole file rather than drawing a partial map.
 * @param {Document} doc
 * @param {{maxFeatures?: number, maxPositions?: number}} [limits]
 * @returns {object} A FeatureCollection.
 */
export function parseOsmToFeatureCollection(
  doc,
  {
    maxFeatures = MAX_IMPORT_ENTITIES,
    maxPositions = MAX_IMPORT_POSITIONS,
  } = {},
) {
  const root = doc?.documentElement;
  if (root?.localName !== 'osm') fail('That OSM file has no <osm> document.');

  const features = [];
  let positions = 0;
  const addPosition = () => {
    positions += 1;
    if (positions > maxPositions)
      fail(
        `That OSM file has more than ${maxPositions.toLocaleString()} points (the limit).`,
      );
  };
  const addFeature = (name, geometry) => {
    if (features.length >= maxFeatures)
      fail(
        `That OSM file has more than ${maxFeatures.toLocaleString()} features (the limit).`,
      );
    features.push({
      type: 'Feature',
      properties: name ? { name } : {},
      geometry,
    });
  };

  // Pass 1 — nodes. Untagged nodes are only way vertices and get no feature.
  const nodes = new Map();
  const nodeFeatures = [];
  for (const el of childrenNamed(root, 'node')) {
    const id = readId(el, 'node');
    if (nodes.has(id)) fail('That OSM file has a duplicate node id.');
    const at = readCoordinate(el);
    nodes.set(id, at);
    const tags = readTags(el);
    if (tags.size) nodeFeatures.push({ name: tags.get('name'), at });
  }

  // Pass 2 — ways. A way is stored with its coordinates and tags so a
  // multipolygon relation can consume it instead of it drawing twice.
  const ways = new Map();
  for (const el of childrenNamed(root, 'way')) {
    const id = readId(el, 'way');
    if (ways.has(id)) fail('That OSM file has a duplicate way id.');
    const tags = readTags(el);
    const coordinates = [];
    for (const nd of childrenNamed(el, 'nd')) {
      const ref = nd.getAttribute('ref');
      if (ref === null || !/^-?\d+$/.test(ref.trim()))
        fail('That OSM file has a way node without a valid reference.');
      const at = nodes.get(ref.trim());
      if (!at) fail('That OSM file has a way that references a missing node.');
      coordinates.push(at);
    }
    ways.set(id, { id, tags, coordinates });
  }

  // Pass 3 — multipolygon relations. Member ways are consumed: they draw
  // as part of the relation, never also as their own feature. Relations
  // of any other type are skipped and their member ways draw standalone.
  const consumedWays = new Set();
  const relations = [];
  for (const el of childrenNamed(root, 'relation')) {
    const tags = readTags(el);
    if (tags.get('type') !== 'multipolygon') continue;
    const outers = [];
    const inners = [];
    for (const member of childrenNamed(el, 'member')) {
      const role = member.getAttribute('role');
      if (role !== 'outer' && role !== 'inner')
        fail('That OSM file has a multipolygon member with an invalid role.');
      if (member.getAttribute('type') !== 'way')
        fail('That OSM file has a multipolygon member that is not a way.');
      const ref = member.getAttribute('ref');
      if (ref === null || !/^-?\d+$/.test(ref.trim()))
        fail(
          'That OSM file has a multipolygon member without a valid reference.',
        );
      const way = ways.get(ref.trim());
      if (!way)
        fail('That OSM file has a multipolygon that references a missing way.');
      const ring = way.coordinates;
      if (
        ring.length < 4 ||
        ring[0][0] !== ring[ring.length - 1][0] ||
        ring[0][1] !== ring[ring.length - 1][1]
      )
        fail('That OSM file has a multipolygon ring that is not closed.');
      if (consumedWays.has(ref.trim()))
        fail('That OSM file reuses a way in more than one multipolygon.');
      consumedWays.add(ref.trim());
      (role === 'outer' ? outers : inners).push(ring);
    }
    if (!outers.length)
      fail('That OSM file has a multipolygon without an outer ring.');
    relations.push({ name: tags.get('name'), outers, inners });
  }

  for (const { at, name } of nodeFeatures) {
    addPosition();
    addFeature(name, { type: 'Point', coordinates: at });
  }

  for (const { id, tags, coordinates } of ways.values()) {
    if (consumedWays.has(id)) continue;
    if (coordinates.length < 2) continue;
    const closed =
      coordinates.length >= 4 &&
      coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
      coordinates[0][1] === coordinates[coordinates.length - 1][1];
    const area = tags.get('area');
    const isArea =
      area === 'yes' ||
      (area !== 'no' &&
        closed &&
        [...tags.keys()].some((key) => AREA_TAGS.has(key)) &&
        ![...tags.keys()].some((key) => LINEAR_TAGS.has(key)));
    for (let i = 0; i < coordinates.length; i++) addPosition();
    addFeature(
      tags.get('name'),
      isArea
        ? { type: 'Polygon', coordinates: [coordinates] }
        : { type: 'LineString', coordinates },
    );
  }

  for (const { outers, inners, name } of relations) {
    const polygons = [];
    for (const outer of outers) {
      const holes = [];
      for (const inner of inners) {
        if (!ringContains(outer, inner[0])) continue;
        // An inner inside several outers belongs to the smallest one.
        const owners = outers.filter((candidate) =>
          ringContains(candidate, inner[0]),
        );
        const smallest = owners.reduce((best, candidate) =>
          ringArea(candidate) < ringArea(best) ? candidate : best,
        );
        if (smallest === outer) holes.push(inner);
      }
      polygons.push([outer, ...holes]);
    }
    const orphan = inners.some(
      (inner) => !outers.some((outer) => ringContains(outer, inner[0])),
    );
    if (orphan)
      fail(
        'That OSM file has a multipolygon inner ring outside its outer rings.',
      );
    for (const polygon of polygons)
      for (const ring of polygon)
        for (let i = 0; i < ring.length; i++) addPosition();
    addFeature(
      name,
      polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
    );
  }

  if (!features.length) fail('That OSM file has nothing to draw.');
  return { type: 'FeatureCollection', features };
}
