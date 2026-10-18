import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GeoRssImportError,
  geoRssToGeoJson,
  isGeoRssText,
} from './georssImport.js';

/* Minimal DOM surface: localName / childNodes / nodeType / textContent /
   getAttribute — the same surface the parser reads. */
function el(localName, attrs = {}, kids = []) {
  const node = {
    nodeType: 1,
    localName,
    childNodes: [],
    getAttribute: (name) => (name in attrs ? String(attrs[name]) : null),
    get textContent() {
      return typeof kids === 'string'
        ? kids
        : node.childNodes.map((c) => c.textContent).join('');
    },
  };
  for (const kid of typeof kids === 'string' ? [] : kids) {
    kid.parentNode = node;
    node.childNodes.push(kid);
  }
  return node;
}
const doc = (root) => ({ documentElement: root });
const parse = (root, options) => geoRssToGeoJson(doc(root), options);
const rss = (items, channelKids = []) =>
  el('rss', {}, [el('channel', {}, [...channelKids, ...items])]);
const item = (kids) => el('item', {}, kids);

function assertRefuses(root, pattern, options) {
  assert.throws(
    () => parse(root, options),
    (error) =>
      error instanceof GeoRssImportError &&
      (pattern === undefined || pattern.test(error.message)),
  );
}

test('isGeoRssText sniffs GeoRSS feeds and rejects the neighbours', () => {
  assert.equal(
    isGeoRssText(
      '<rss><channel><item><georss:point>1 2</georss:point></item></channel></rss>',
    ),
    true,
  );
  assert.equal(
    isGeoRssText(
      '<feed><entry><geo:lat>1</geo:lat><geo:long>2</geo:long></entry></feed>',
    ),
    true,
  );
  assert.equal(
    isGeoRssText('<RDF xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#"></RDF>'),
    true,
  );
  assert.equal(
    isGeoRssText('<rss><channel><item><title>no geo</title></item></channel></rss>'),
    false,
  );
  assert.equal(
    isGeoRssText('<kml xmlns="http://www.opengis.net/kml/2.2"></kml>'),
    false,
  );
  assert.equal(isGeoRssText('<gpx></gpx>'), false);
  assert.equal(isGeoRssText('{"type":"FeatureCollection"}'), false);
  assert.equal(isGeoRssText(''), false);
  assert.equal(isGeoRssText(null), false);
});

test('RSS point maps lat,lon to GeoJSON lon,lat with item properties', () => {
  const fc = parse(
    rss([
      item([
        el('title', {}, 'Quake off Patna'),
        el('link', {}, 'https://example.test/quake-1'),
        el('description', {}, 'A tremor was felt.'),
        el('guid', {}, 'quake-1'),
        el('pubDate', {}, 'Sun, 18 Oct 2026 04:00:00 GMT'),
        el('author', {}, 'usgs@example.test'),
        el('category', {}, 'earthquake'),
        el('category', {}, 'asia'),
        el('point', {}, '25.6 85.1'),
      ]),
    ]),
  );
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Point',
    coordinates: [85.1, 25.6],
  });
  assert.deepEqual(fc.features[0].properties, {
    title: 'Quake off Patna',
    link: 'https://example.test/quake-1',
    description: 'A tremor was felt.',
    id: 'quake-1',
    published: 'Sun, 18 Oct 2026 04:00:00 GMT',
    author: 'usgs@example.test',
    categories: ['earthquake', 'asia'],
  });
});

test('RSS channel title becomes feedTitle on every feature', () => {
  const fc = parse(
    rss([item([el('point', {}, '10 20')])], [el('title', {}, 'Quake Feed')]),
  );
  assert.equal(fc.features[0].properties.feedTitle, 'Quake Feed');
});

test('Atom entry reads href link, summary, id, updated, author name', () => {
  const fc = parse(
    el('feed', {}, [
      el('title', {}, 'News Feed'),
      el('entry', {}, [
        el('title', {}, 'Flood alert'),
        el('link', { href: 'https://example.test/flood', rel: 'alternate' }),
        el('link', { href: 'https://example.test/flood-self', rel: 'self' }),
        el('summary', {}, 'River rising.'),
        el('id', {}, 'urn:example:flood-1'),
        el('updated', {}, '2026-10-18T04:00:00Z'),
        el('author', {}, [el('name', {}, 'Desk Editor')]),
        el('category', { term: 'flood' }),
        el('point', {}, '25.6 85.1'),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6]);
  assert.deepEqual(fc.features[0].properties, {
    title: 'Flood alert',
    link: 'https://example.test/flood',
    description: 'River rising.',
    id: 'urn:example:flood-1',
    published: '2026-10-18T04:00:00Z',
    author: 'Desk Editor',
    categories: ['flood'],
    feedTitle: 'News Feed',
  });
});

test('Atom content is the description fallback when summary is absent', () => {
  const fc = parse(
    el('feed', {}, [
      el('entry', {}, [
        el('content', {}, 'Full story here.'),
        el('published', {}, '2026-10-18T05:00:00Z'),
        el('point', {}, '1 2'),
      ]),
    ]),
  );
  assert.equal(fc.features[0].properties.description, 'Full story here.');
  assert.equal(fc.features[0].properties.published, '2026-10-18T05:00:00Z');
});

test('RSS 1.0 RDF items parse', () => {
  const fc = parse(
    el('RDF', {}, [
      el('channel', {}, [el('title', {}, 'RDF Feed')]),
      item([el('title', {}, 'Old item'), el('point', {}, '10 20')]),
    ]),
  );
  assert.equal(fc.features[0].properties.title, 'Old item');
  assert.equal(fc.features[0].properties.feedTitle, 'RDF Feed');
});

test('georss:line becomes a LineString', () => {
  const fc = parse(
    rss([item([el('line', {}, '25.6 85.1 25.7 85.2 25.8 85.3')])]),
  );
  assert.deepEqual(fc.features[0].geometry, {
    type: 'LineString',
    coordinates: [
      [85.1, 25.6],
      [85.2, 25.7],
      [85.3, 25.8],
    ],
  });
});

test('georss:polygon is re-oriented to the GeoJSON right-hand rule', () => {
  // Clockwise in lon,lat: (0,0) → (0,1) → (1,1) → (1,0) → close.
  const fc = parse(
    rss([item([el('polygon', {}, '0 0 1 0 1 1 0 1 0 0')])]),
  );
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  });
});

test('georss:box becomes a CCW box polygon', () => {
  const fc = parse(rss([item([el('box', {}, '10 20 12 22')])]));
  assert.deepEqual(fc.features[0].geometry, {
    type: 'Polygon',
    coordinates: [
      [
        [20, 10],
        [22, 10],
        [22, 12],
        [20, 12],
        [20, 10],
      ],
    ],
  });
});

test('georss:where with a GML Point in EPSG:4326 swaps lat,lon', () => {
  const fc = parse(
    rss([
      item([
        el('where', {}, [
          el('Point', { srsName: 'EPSG:4326' }, [el('pos', {}, '25.6 85.1')]),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6]);
});

test('georss:where with GML CRS84 pos reads lon,lat as-is', () => {
  const fc = parse(
    rss([
      item([
        el('where', {}, [
          el('Point', { srsName: 'urn:ogc:def:crs:OGC:1.3:CRS84' }, [
            el('pos', {}, '85.1 25.6'),
          ]),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6]);
});

test('georss:where with no srsName assumes lon,lat like the GML parser', () => {
  const fc = parse(
    rss([
      item([
        el('where', {}, [el('Point', {}, [el('pos', {}, '85.1 25.6')])]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6]);
});

test('georss:where reads GML <coordinates> as lon,lat', () => {
  const fc = parse(
    rss([
      item([
        el('where', {}, [
          el('Point', {}, [el('coordinates', {}, '85.1,25.6')]),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6]);
});

test('georss:where Polygon with a hole keeps the hole clockwise', () => {
  const fc = parse(
    rss([
      item([
        el('where', {}, [
          el('Polygon', {}, [
            el('exteriorRing', {}, [
              el('LinearRing', {}, [
                el('posList', {}, '0 0 10 0 10 10 0 10 0 0'),
              ]),
            ]),
            el('interiorRing', {}, [
              el('LinearRing', {}, [
                el('posList', {}, '2 2 8 2 8 8 2 8 2 2'),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  );
  assert.equal(fc.features[0].geometry.type, 'Polygon');
  // Exterior CCW, hole CW (negative shoelace area).
  assert.deepEqual(fc.features[0].geometry.coordinates[0], [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ]);
  assert.deepEqual(fc.features[0].geometry.coordinates[1], [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
    [2, 2],
  ]);
});

test('georss:where Envelope becomes a box polygon', () => {
  const fc = parse(
    rss([
      item([
        el('where', {}, [
          el('Envelope', { srsName: 'EPSG:4326' }, [
            el('lowerCorner', {}, '10 20'),
            el('upperCorner', {}, '12 22'),
          ]),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates[0], [
    [20, 10],
    [22, 10],
    [22, 12],
    [20, 12],
    [20, 10],
  ]);
});

test('georss:where MultiPoint parses pointMember parts', () => {
  const fc = parse(
    rss([
      item([
        el('where', {}, [
          el('MultiPoint', {}, [
            el('pointMember', {}, [
              el('Point', {}, [el('pos', {}, '1 2')]),
            ]),
            el('pointMember', {}, [
              el('Point', {}, [el('pos', {}, '3 4')]),
            ]),
          ]),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(fc.features[0].geometry, {
    type: 'MultiPoint',
    coordinates: [
      [1, 2],
      [3, 4],
    ],
  });
});

test('W3C Basic Geo lat/long pair becomes a Point', () => {
  const fc = parse(
    rss([item([el('lat', {}, '25.6'), el('long', {}, '85.1')])]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6]);
});

test('identical georss:point + geo:lat/long duplication parses once', () => {
  const fc = parse(
    rss([
      item([
        el('point', {}, '25.6 85.1'),
        el('lat', {}, '25.6'),
        el('long', {}, '85.1'),
      ]),
    ]),
  );
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6]);
});

test('conflicting georss:point + geo:lat/long refuses the whole feed', () => {
  assertRefuses(
    rss([
      item([
        el('point', {}, '25.6 85.1'),
        el('lat', {}, '26.0'),
        el('long', {}, '85.1'),
      ]),
    ]),
    /more than one geometry/,
  );
});

test('a lone geo:lat without geo:long refuses the whole feed', () => {
  assertRefuses(
    rss([item([el('lat', {}, '25.6'), el('point', {}, '1 2')])]),
    /Basic Geo pair/,
  );
});

test('two GeoRSS geometries in one item refuse the whole feed', () => {
  assertRefuses(
    rss([item([el('point', {}, '1 2'), el('line', {}, '1 2 3 4')])]),
    /more than one geometry/,
  );
});

test('georss:circle refuses — GeoJSON has no circle', () => {
  assertRefuses(
    rss([item([el('circle', {}, '25.6 85.1 5000')])]),
    /circle/,
  );
});

test('georss:elev becomes the Point third ordinate', () => {
  const fc = parse(
    rss([item([el('point', {}, '25.6 85.1'), el('elev', {}, '120')])]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6, 120]);
});

test('georss:elev on a LineString refuses — it would be dropped', () => {
  assertRefuses(
    rss([item([el('line', {}, '1 2 3 4'), el('elev', {}, '120')])]),
    /elev/,
  );
});

test('GeoRSS extras land in properties', () => {
  const fc = parse(
    rss([
      item([
        el('point', {}, '1 2'),
        el('featurename', {}, 'Patna Junction'),
        el('featuretypetag', {}, 'station'),
        el('relationshiptag', {}, 'near'),
      ]),
    ]),
  );
  assert.equal(fc.features[0].properties.featureName, 'Patna Junction');
  assert.equal(fc.features[0].properties.featureType, 'station');
  assert.equal(fc.features[0].properties.relationship, 'near');
});

test('items without geometry are skipped, not null-geometry features', () => {
  const fc = parse(
    rss([
      item([el('title', {}, 'No geo here')]),
      item([el('point', {}, '1 2')]),
      item([el('title', {}, 'Also no geo')]),
    ]),
  );
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry.coordinates, [2, 1]);
});

test('a feed with no geo item at all is refused', () => {
  assertRefuses(
    rss([item([el('title', {}, 'No geo')])]),
    /no item with GeoRSS geometry/,
  );
});

test('an out-of-range latitude refuses the whole feed', () => {
  assertRefuses(rss([item([el('point', {}, '91 0')])]), /latitude/);
});

test('a non-numeric coordinate refuses the whole feed', () => {
  assertRefuses(rss([item([el('point', {}, 'north 0')])]), /not a number/);
});

test('an odd coordinate count refuses the whole feed', () => {
  assertRefuses(rss([item([el('line', {}, '1 2 3')])]), /pairs/);
});

test('an unclosed GeoRSS polygon refuses the whole feed', () => {
  assertRefuses(
    rss([item([el('polygon', {}, '0 0 1 0 1 1 0 1')])]),
    /not closed/,
  );
});

test('a degenerate box (min not below max) refuses the whole feed', () => {
  assertRefuses(rss([item([el('box', {}, '12 22 10 20')])]), /degenerate/);
});

test('a non-WGS-84 srsName on a simple element refuses the whole feed', () => {
  assertRefuses(
    rss([
      item([el('point', { srsName: 'EPSG:3857' }, '25.6 85.1')]),
    ]),
    /unsupported CRS|srsName/,
  );
});

test('a non-WGS-84 srsName inside where refuses the whole feed', () => {
  assertRefuses(
    rss([
      item([
        el('where', {}, [
          el('Point', { srsName: 'EPSG:3857' }, [el('pos', {}, '1 2')]),
        ]),
      ]),
    ]),
    /unsupported CRS/,
  );
});

test('a CRS84 tag on a simple element refuses — simple GeoRSS is lat,lon', () => {
  assertRefuses(
    rss([item([el('point', { srsName: 'CRS84' }, '25.6 85.1')])]),
    /srsName/,
  );
});

test('an EPSG:4326 tag on a simple element is accepted as lat,lon', () => {
  const fc = parse(
    rss([item([el('point', { srsName: 'EPSG:4326' }, '25.6 85.1')])]),
  );
  assert.deepEqual(fc.features[0].geometry.coordinates, [85.1, 25.6]);
});

test('a GML Curve inside where refuses — it is not a GeoJSON type', () => {
  assertRefuses(
    rss([
      item([
        el('where', {}, [
          el('Curve', {}, [el('posList', {}, '1 2 3 4')]),
        ]),
      ]),
    ]),
    /Curve/,
  );
});

test('a non-feed root is refused', () => {
  assertRefuses(el('kml', {}, []), /not a GeoRSS feed/);
});

test('an RSS root without a channel is refused', () => {
  assertRefuses(el('rss', {}, []), /no <channel>/);
});

test('caps are enforced: maxFeatures and maxPositions refuse', () => {
  assertRefuses(
    rss([
      item([el('point', {}, '1 2')]),
      item([el('point', {}, '3 4')]),
    ]),
    /more than 1 geo items/,
    { maxFeatures: 1 },
  );
  assertRefuses(
    rss([item([el('line', {}, '1 2 3 4 5 6')])]),
    /more than 2 points/,
    { maxPositions: 2 },
  );
});
