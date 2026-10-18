// Routing tests for the geo-import loader (Cycle 21: loader-routing wiring).
//
// Every pure parser the repo ships must resolve to the right parser in
// `detectGeoFileFormat` (extension first, magic sniffing second) and in
// `loadGeoFile`'s dispatch. XML formats (GML, GeoRSS) run through a
// minimal DOMParser stub built on the repo's own `xmldoc` dependency — the
// parsers are written against a tiny DOM surface (`documentElement`,
// `localName`, `childNodes`, `nodeType`, `textContent`, `getAttribute`)
// precisely so they work without a browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { XmlDocument } from 'xmldoc';
import {
  GEO_FILE_ACCEPT,
  GeoImportError,
  detectGeoFileFormat,
  loadGeoFile,
} from './geoFileImport.js';

const textBytes = (text) => new TextEncoder().encode(text);

// --- Minimal DOM surface over xmldoc -------------------------------------

const adaptNode = (node) => ({
  nodeType: 1,
  get localName() {
    return node.name.includes(':') ? node.name.split(':').pop() : node.name;
  },
  get textContent() {
    return node.val;
  },
  getAttribute: (name) => node.attr[name] ?? null,
  get childNodes() {
    return (node.children || [])
      .filter((child) => child.type === 'element')
      .map(adaptNode);
  },
});

function stubDomParser() {
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(text) {
      let documentElement;
      try {
        documentElement = adaptNode(new XmlDocument(text));
      } catch {
        return {
          getElementsByTagName: (name) => (name === 'parsererror' ? [{}] : []),
        };
      }
      return { documentElement, getElementsByTagName: () => [] };
    }
  };
  return () => {
    if (previous === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previous;
  };
}

// --- Viewer mock (mirrors geoFileImport.test.mjs) -------------------------

const viewer = () => ({
  scene: {
    frameState: { mode: Cesium.SceneMode.SCENE3D },
    primitives: new Cesium.PrimitiveCollection(),
    globe: { getHeight: () => 1234 },
  },
});

function patchPinBuilder() {
  const previous = Cesium.PinBuilder.prototype.fromColor;
  Cesium.PinBuilder.prototype.fromColor = () => ({
    toDataURL: () => 'data:image/png;base64,local',
    tagName: 'CANVAS',
  });
  return () => {
    Cesium.PinBuilder.prototype.fromColor = previous;
  };
}

const restoreDomParser = stubDomParser();
const restorePinBuilder = patchPinBuilder();
after(() => {
  restoreDomParser();
  restorePinBuilder();
});

async function loadFormat(name, body) {
  const loaded = await loadGeoFile(new File([body], name), {
    viewer: viewer(),
  });
  try {
    return loaded;
  } finally {
    loaded.revoke();
  }
}

// --- Fixtures ------------------------------------------------------------

const wkbPoint = () => {
  const bytes = new Uint8Array(21);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1; // little-endian
  view.setUint32(1, 1, true); // Point
  view.setFloat64(5, 1, true);
  view.setFloat64(13, 2, true);
  return bytes;
};

const esriJsonPoint = () =>
  JSON.stringify({
    geometryType: 'esriGeometryPoint',
    spatialReference: { wkid: 4326 },
    features: [{ attributes: { name: 'esri' }, geometry: { x: 1, y: 2 } }],
  });

const shapefilePoint = () => {
  const bytes = new Uint8Array(128);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false); // file code, big-endian
  view.setInt32(24, 64, false); // file length in 16-bit words
  view.setInt32(28, 1000, true); // version
  view.setInt32(32, 1, true); // shape type: Point
  view.setInt32(100, 1, false); // record number
  view.setInt32(104, 10, false); // content length in words
  view.setInt32(108, 1, true); // shape type: Point
  view.setFloat64(112, 1, true);
  view.setFloat64(120, 2, true);
  return bytes;
};

const gmlPoint = () =>
  '<gml:FeatureCollection xmlns:gml="http://www.opengis.net/gml/3.2">' +
  '<gml:featureMember><feature>' +
  '<gml:Point srsName="EPSG:4326"><gml:pos>41.9 12.5</gml:pos></gml:Point>' +
  '</feature></gml:featureMember></gml:FeatureCollection>';

const georssPoint = () =>
  '<rss><channel><item>' +
  '<georss:point xmlns:georss="http://www.georss.org/georss">1 2</georss:point>' +
  '</item></channel></rss>';

const dxfPoint = () =>
  [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'POINT',
    '8',
    '0',
    '10',
    '1.0',
    '20',
    '2.0',
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');

const mifPoint = () =>
  'Version 300\nCharset "Neutral"\nCoordSys Earth Projection 1, 104\n' +
  'Columns 0\nData\nPoint 10.5 -20.25\n';

const tcxTrack = () => {
  const trackpoint = (lat, lon, time) =>
    `<Trackpoint><Time>${time}</Time>` +
    `<Position><LatitudeDegrees>${lat}</LatitudeDegrees>` +
    `<LongitudeDegrees>${lon}</LongitudeDegrees></Position>` +
    '<AltitudeMeters>10</AltitudeMeters></Trackpoint>';
  return (
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">' +
    '<Activities><Activity Sport="Running"><Id>2026-10-18T06:00:00Z</Id>' +
    '<Lap StartTime="2026-10-18T06:00:00Z"><Track>' +
    trackpoint(1, 2, '2026-10-18T06:00:00Z') +
    trackpoint(1.1, 2.1, '2026-10-18T06:01:00Z') +
    '</Track></Lap></Activity></Activities></TrainingCenterDatabase>'
  );
};

const igcTrack = () =>
  'AXXX001\nHFDTE181026\n' +
  'B1000001000000N10000000EA0020000200\n' +
  'B1001001000100N10001000EA0020000200\n';

const nmeaChecksum = (body) => {
  let xor = 0;
  for (const char of body.slice(1)) xor ^= char.charCodeAt(0);
  return xor.toString(16).toUpperCase().padStart(2, '0');
};

const nmeaTrack = () => {
  const line = (time, lat, lon) => {
    const body = `$GPGGA,${time},${lat},N,${lon},E,1,08,0.9,10.0,M,0.0,M,,`;
    return `${body}*${nmeaChecksum(body)}`;
  };
  return `${line('100000', '1000.00', '10000.00')}\n${line('100100', '1001.00', '10001.00')}\n`;
};

const csvPoints = () => 'lat,lon,name\n1,2,home\n';

const polylineTrack = () => '_p~iF~ps|U_ulLnnqC_mqNvxq`@\n';

// --- Extension routing ---------------------------------------------------

test('newly wired formats route by extension', () => {
  const cases = [
    ['track.wkb', 'wkb'],
    ['export.esrijson', 'esrijson'],
    ['parcels.shp', 'shapefile'],
    ['layer.gml', 'gml'],
    ['feed.rss', 'georss'],
    ['feed.atom', 'georss'],
    ['plan.dxf', 'dxf'],
    ['survey.mif', 'mif'],
    ['ride.tcx', 'tcx'],
    ['flight.igc', 'igc'],
    ['log.nmea', 'nmea'],
    ['places.csv', 'csv'],
    ['route.polyline', 'polyline'],
  ];
  for (const [name, format] of cases)
    assert.equal(detectGeoFileFormat(name), format, name);
});

// --- Magic-byte sniffing -------------------------------------------------

test('shapefile and WKB route by binary magic', () => {
  assert.equal(detectGeoFileFormat('data.bin', shapefilePoint()), 'shapefile');
  assert.equal(detectGeoFileFormat('data.bin', wkbPoint()), 'wkb');
});

// --- Text sniffing --------------------------------------------------------

test('text formats route by content sniffing without a known extension', () => {
  assert.equal(detectGeoFileFormat('track.txt', textBytes(dxfPoint())), 'dxf');
  assert.equal(detectGeoFileFormat('noext', textBytes(mifPoint())), 'mif');
  assert.equal(detectGeoFileFormat('x.xml', textBytes(tcxTrack())), 'tcx');
  assert.equal(detectGeoFileFormat('x.xml', textBytes(gmlPoint())), 'gml');
  assert.equal(
    detectGeoFileFormat('feed.xml', textBytes(georssPoint())),
    'georss',
  );
  assert.equal(detectGeoFileFormat('log.txt', textBytes(nmeaTrack())), 'nmea');
  assert.equal(detectGeoFileFormat('flight.txt', textBytes(igcTrack())), 'igc');
});

test('.json Esri content sniffs to esrijson; GeoJSON stays geojson', () => {
  assert.equal(
    detectGeoFileFormat('data.json', textBytes(esriJsonPoint())),
    'esrijson',
  );
  // A GeoJSON properties bag that merely carries an "attributes" key must
  // NOT route to the Esri parser.
  const geojson = JSON.stringify({
    type: 'Feature',
    properties: { attributes: { a: 1 } },
    geometry: { type: 'Point', coordinates: [1, 2] },
  });
  assert.equal(detectGeoFileFormat('data.json', textBytes(geojson)), 'geojson');
});

test('CSV and encoded polyline have no sniffable magic: extension only', () => {
  assert.equal(detectGeoFileFormat('notes.txt', textBytes(csvPoints())), null);
  assert.equal(
    detectGeoFileFormat('notes.txt', textBytes(polylineTrack())),
    null,
  );
  // Extension alone is enough when there is no head at all.
  assert.equal(detectGeoFileFormat('places.csv'), 'csv');
  assert.equal(detectGeoFileFormat('route.polyline'), 'polyline');
});

test('GEO_FILE_ACCEPT offers every wired format', () => {
  for (const ext of [
    '.wkb',
    '.esrijson',
    '.shp',
    '.gml',
    '.rss',
    '.atom',
    '.dxf',
    '.mif',
    '.tcx',
    '.igc',
    '.nmea',
    '.csv',
    '.polyline',
  ])
    assert.ok(GEO_FILE_ACCEPT.includes(ext), ext);
});

// --- loadGeoFile dispatch -------------------------------------------------

test('loadGeoFile resolves each newly wired format to its parser', async () => {
  const cases = [
    ['pt.wkb', wkbPoint(), 'wkb', true],
    ['export.esrijson', esriJsonPoint(), 'esrijson', true],
    ['parcels.shp', shapefilePoint(), 'shapefile', true],
    ['layer.gml', gmlPoint(), 'gml', true],
    ['feed.rss', georssPoint(), 'georss', true],
    ['plan.dxf', dxfPoint(), 'dxf', true],
    ['survey.mif', mifPoint(), 'mif', false],
    ['ride.tcx', tcxTrack(), 'tcx', false],
    ['flight.igc', igcTrack(), 'igc', false],
    ['log.nmea', nmeaTrack(), 'nmea', false],
    ['places.csv', csvPoints(), 'csv', true],
    ['route.polyline', polylineTrack(), 'polyline', true],
  ];
  for (const [name, body, format, crsIgnored] of cases) {
    const loaded = await loadFormat(name, body);
    assert.equal(loaded.format, format, name);
    assert.equal(loaded.crsIgnored, crsIgnored, `${name}: crsIgnored`);
    assert.ok(loaded.entityCount >= 1, `${name}: entityCount`);
  }
});

test('parser refusals keep their wording through the loader', async () => {
  await assert.rejects(
    () => loadFormat('places.csv', 'a,b,c\n1,2,3\n'),
    (error) =>
      error instanceof GeoImportError &&
      /no latitude\/longitude columns/.test(error.message),
  );
  await assert.rejects(
    () => loadFormat('plan.dxf', 'AutoCAD Binary DXF\r\n\x1a\x00rest'),
    (error) =>
      error instanceof GeoImportError &&
      /Binary DXF is not supported/.test(error.message),
  );
  await assert.rejects(
    () => loadFormat('flight.igc', 'AXXX001\nHFDTE181026\n'),
    (error) =>
      error instanceof GeoImportError &&
      /no B-record fixes/.test(error.message),
  );
});
