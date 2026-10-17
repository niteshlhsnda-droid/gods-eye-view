import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WGS84_A,
  WGS84_B,
  WGS84_E2,
  WGS84_F,
  WEB_MERCATOR_MAX,
  WEB_MERCATOR_MAX_LAT,
  WEB_MERCATOR_RADIUS,
  degToRad,
  ecefToEnu,
  ecefToGeodetic,
  enuToEcef,
  geodeticToEcef,
  lonLatToWebMercator,
  offsetGeodetic,
  radToDeg,
  webMercatorToLonLat,
} from './geoProjection.js';

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

test('WGS84 constants are self-consistent', () => {
  assert.equal(WGS84_F, 1 / 298.257223563);
  assertNear(WGS84_B, 6356752.314245179, 1e-6, 'semi-minor axis');
  assertNear(WGS84_E2, WGS84_F * (2 - WGS84_F), 1e-15, 'e^2');
  assert.equal(WEB_MERCATOR_RADIUS, WGS84_A);
  assertNear(WEB_MERCATOR_MAX, Math.PI * WGS84_A, 1e-6, 'mercator max');
});

test('deg/rad conversions round-trip', () => {
  assertNear(degToRad(180), Math.PI, 1e-15, 'degToRad(180)');
  assertNear(radToDeg(Math.PI), 180, 1e-12, 'radToDeg(pi)');
  assertNear(radToDeg(degToRad(-73.9857)), -73.9857, 1e-12, 'round-trip');
});

test('geodeticToEcef axis cases are exact', () => {
  assert.deepEqual(geodeticToEcef({ lat: 0, lon: 0, height: 0 }), {
    x: WGS84_A,
    y: 0,
    z: 0,
  });
  const east = geodeticToEcef({ lat: 0, lon: 90, height: 0 });
  assertNear(east.x, 0, 1e-6, 'equator lon 90 x');
  assertNear(east.y, WGS84_A, 1e-6, 'equator lon 90 y');
  assertNear(east.z, 0, 1e-9, 'equator lon 90 z');
  const northPole = geodeticToEcef({ lat: 90, lon: 0, height: 0 });
  assertNear(northPole.x, 0, 1e-6, 'north pole x');
  assertNear(northPole.y, 0, 1e-9, 'north pole y');
  assertNear(northPole.z, WGS84_B, 1e-6, 'north pole z');
  const southPole = geodeticToEcef({ lat: -90, lon: 0, height: 0 });
  assertNear(southPole.z, -WGS84_B, 1e-6, 'south pole z');
  const raised = geodeticToEcef({ lat: 0, lon: 0, height: 100 });
  assertNear(raised.x, WGS84_A + 100, 1e-6, 'height adds along normal');
  const defaultHeight = geodeticToEcef({ lat: 0, lon: 0 });
  assertNear(defaultHeight.x, WGS84_A, 1e-6, 'height defaults to 0');
});

test('geodetic <-> ECEF round-trips within 1mm / 1e-9 deg', () => {
  const points = [
    { lat: 25.5941, lon: 85.1376, height: 50 }, // Patna
    { lat: -33.8688, lon: 151.2093, height: 10 }, // Sydney
    { lat: 64.1466, lon: -21.9426, height: 100 }, // Reykjavik
    { lat: 89.999, lon: 45, height: 0 }, // near north pole
    { lat: -89.999, lon: -120, height: 0 }, // near south pole
    { lat: 0, lon: 179.9, height: 0 }, // near antimeridian
    { lat: 0, lon: -179.9, height: 0 },
    { lat: 51.5074, lon: -0.1278, height: -30 }, // below ellipsoid
    { lat: 0, lon: 0, height: 35786000 }, // GEO altitude
  ];
  for (const point of points) {
    const back = ecefToGeodetic(geodeticToEcef(point));
    assertNear(back.lat, point.lat, 1e-9, `lat ${JSON.stringify(point)}`);
    assertNear(back.lon, point.lon, 1e-9, `lon ${JSON.stringify(point)}`);
    assertNear(back.height, point.height, 1e-3, `h ${JSON.stringify(point)}`);
  }
});

test('ecefToGeodetic handles the polar axis and invalid input', () => {
  const north = ecefToGeodetic({ x: 0, y: 0, z: WGS84_B });
  assert.deepEqual(north, { lat: 90, lon: 0, height: 0 });
  const south = ecefToGeodetic({ x: 0, y: 0, z: -WGS84_B - 100 });
  assert.deepEqual(south, { lat: -90, lon: 0, height: 100 });
  assert.equal(ecefToGeodetic({ x: NaN, y: 0, z: 0 }), null);
  assert.equal(ecefToGeodetic(null), null);
  assert.equal(geodeticToEcef({ lat: 91, lon: 0 }), null);
  assert.equal(geodeticToEcef({ lat: 0, lon: Infinity }), null);
  assert.equal(geodeticToEcef({ lat: 0, lon: 0, height: NaN }), null);
  assert.equal(geodeticToEcef(null), null);
});

test('ECEF <-> ENU round-trips and axis directions', () => {
  const origin = { lat: 0, lon: 0, height: 0 };
  const eastPoint = geodeticToEcef({ lat: 0, lon: 0.001, height: 0 });
  const enu = ecefToEnu(eastPoint, origin);
  // 0.001 deg of longitude at the equator is ~111.32 m east, ~0 north/up
  // (up is slightly negative on a curved earth: the chord dips below the
  // tangent plane by d^2 / 2R ~= 0.001 m).
  assertNear(enu.east, 111.31949, 0.01, 'east displacement');
  assertNear(enu.north, 0, 1e-6, 'north displacement');
  assertNear(enu.up, -0.00097, 0.0001, 'chord dip');
  const back = enuToEcef(enu, origin);
  assertNear(back.x, eastPoint.x, 1e-3, 'ENU round-trip x');
  assertNear(back.y, eastPoint.y, 1e-3, 'ENU round-trip y');
  assertNear(back.z, eastPoint.z, 1e-3, 'ENU round-trip z');
  // A point 100 m straight above the origin is (0, 0, 100) in ENU.
  const above = geodeticToEcef({ lat: 0, lon: 0, height: 100 });
  const aboveEnu = ecefToEnu(above, origin);
  assertNear(aboveEnu.east, 0, 1e-6, 'above east');
  assertNear(aboveEnu.north, 0, 1e-6, 'above north');
  assertNear(aboveEnu.up, 100, 1e-6, 'above up');
});

test('ENU round-trips at a mid-latitude origin', () => {
  const origin = { lat: 25.5941, lon: 85.1376, height: 50 };
  const displacements = [
    { east: 1000, north: 0, up: 0 },
    { east: 0, north: 1000, up: 0 },
    { east: 0, north: 0, up: 1000 },
    { east: -500, north: 750, up: -250 },
  ];
  for (const displacement of displacements) {
    const ecef = enuToEcef(displacement, origin);
    const back = ecefToEnu(ecef, origin);
    assertNear(back.east, displacement.east, 1e-6, 'ENU east round-trip');
    assertNear(back.north, displacement.north, 1e-6, 'ENU north round-trip');
    assertNear(back.up, displacement.up, 1e-6, 'ENU up round-trip');
  }
  assert.equal(ecefToEnu({ x: 0, y: 0, z: 0 }, { lat: 91, lon: 0 }), null);
  assert.equal(enuToEcef({ east: NaN, north: 0, up: 0 }, origin), null);
  assert.equal(enuToEcef({ east: 0, north: 0, up: 0 }, null), null);
});

test('offsetGeodetic moves ~1 km in each cardinal direction', () => {
  const origin = { lat: 25.5941, lon: 85.1376, height: 50 };
  const east = offsetGeodetic(origin, { east: 1000, north: 0, up: 0 });
  // 1 km east at lat 25.6: dLon ~= 1000 / (N cos lat) rad ~= 0.00997 deg.
  assertNear(east.lon - origin.lon, 0.00997, 0.00005, 'east dLon');
  assertNear(east.lat, origin.lat, 1e-6, 'east dLat');
  // Moving along the tangent plane then re-projecting to the ellipsoid
  // lifts the height by d^2 / 2R ~= 0.078 m for a 1 km move.
  assertNear(east.height, origin.height + 0.078, 0.01, 'east height');
  const north = offsetGeodetic(origin, { east: 0, north: 1000, up: 0 });
  // 1 km north: dLat ~= 1000 / M rad ~= 0.00901 deg (M = meridional radius).
  assertNear(north.lat - origin.lat, 0.00901, 0.00005, 'north dLat');
  assertNear(north.lon, origin.lon, 1e-6, 'north dLon');
  const up = offsetGeodetic(origin, { east: 0, north: 0, up: 100 });
  assertNear(up.lat, origin.lat, 1e-9, 'up dLat');
  assertNear(up.lon, origin.lon, 1e-9, 'up dLon');
  assertNear(up.height, origin.height + 100, 1e-6, 'up height');
  assert.equal(offsetGeodetic(origin, { east: NaN, north: 0, up: 0 }), null);
});

test('Web Mercator origin, corners, and clamping', () => {
  const origin = lonLatToWebMercator({ lon: 0, lat: 0 });
  assertNear(origin.x, 0, 1e-6, 'origin x');
  assertNear(origin.y, 0, 1e-6, 'origin y');
  const eastEdge = lonLatToWebMercator({ lon: 180, lat: 0 });
  assertNear(eastEdge.x, WEB_MERCATOR_MAX, 1e-6, 'east edge x');
  assertNear(eastEdge.y, 0, 1e-6, 'east edge y');
  const northEdge = lonLatToWebMercator({ lon: 0, lat: WEB_MERCATOR_MAX_LAT });
  assertNear(northEdge.y, WEB_MERCATOR_MAX, 1, 'north edge y');
  // Beyond the limit clamps to the square instead of diverging.
  const pole = lonLatToWebMercator({ lon: 0, lat: 90 });
  assertNear(pole.y, WEB_MERCATOR_MAX, 1, 'pole clamps to square');
  const beyond = lonLatToWebMercator({ lon: 270, lat: 0 });
  assertNear(beyond.x, WEB_MERCATOR_MAX, 1e-6, 'lon beyond 180 clamps');
  assert.equal(lonLatToWebMercator({ lon: 0, lat: 91 }), null);
  assert.equal(lonLatToWebMercator({ lon: NaN, lat: 0 }), null);
  assert.equal(lonLatToWebMercator(null), null);
});

test('Web Mercator round-trips', () => {
  const points = [
    { lon: 0, lat: 0 },
    { lon: 85.1376, lat: 25.5941 },
    { lon: -122.4194, lat: 37.7749 },
    { lon: 179.9, lat: -45 },
    { lon: -179.9, lat: 80 },
    { lon: 13.405, lat: 52.52 },
  ];
  for (const point of points) {
    const back = webMercatorToLonLat(lonLatToWebMercator(point));
    assertNear(back.lon, point.lon, 1e-9, `mercator lon ${point.lon}`);
    assertNear(back.lat, point.lat, 1e-9, `mercator lat ${point.lat}`);
  }
  // Out-of-square input clamps to the corner.
  const corner = webMercatorToLonLat({
    x: WEB_MERCATOR_MAX * 2,
    y: WEB_MERCATOR_MAX * 2,
  });
  assertNear(corner.lon, 180, 1e-9, 'clamped corner lon');
  assertNear(corner.lat, WEB_MERCATOR_MAX_LAT, 1e-9, 'clamped corner lat');
  assert.equal(webMercatorToLonLat({ x: NaN, y: 0 }), null);
  assert.equal(webMercatorToLonLat(null), null);
});
