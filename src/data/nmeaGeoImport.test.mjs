import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMPORT_ALTITUDE,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';
import {
  MAX_NMEA_ALTITUDE,
  MAX_NMEA_POSITIONS,
  isNmeaText,
  parseNmeaText,
} from './nmeaGeoImport.js';

/** Append a correct `*HH` checksum trailer to a `$`-less sentence body. */
function withChecksum(body) {
  let xor = 0;
  for (const ch of body) xor ^= ch.codePointAt(0);
  return `$${body}*${xor.toString(16).toUpperCase().padStart(2, '0')}`;
}

// Real receiver sentences: a Tripmate 850 log from Leixlip, Ireland,
// published with the NMEA 0183 message-structure reference. Checksums
// *76 / *43 are the logger's own, verified against the XOR rule.
const REAL_GGA =
  '$GPGGA,092750.000,5321.6802,N,00630.3372,W,1,8,1.03,61.7,M,55.2,M,,*76';
const REAL_RMC =
  '$GPRMC,092750.000,A,5321.6802,N,00630.3372,W,0.02,31.66,280511,,,A*43';

// Crafted fixtures; checksums computed with the same XOR rule and
// verified before hardcoding.
const SOUTH_EAST_RMC =
  '$GPRMC,013032.00,A,3352.1234,S,15112.5678,E,5.5,90.0,180126,,,A*7C';
const SOUTH_WEST_GGA =
  '$GPGGA,013033.00,2254.7000,S,04312.4000,W,1,08,0.9,12.5,M,0.0,M,,*60';
const VOID_RMC =
  '$GPRMC,013034.00,V,3352.1234,S,15112.5678,E,5.5,90.0,180126,,,A*6D';
const NOFIX_GGA =
  '$GPGGA,013035.00,3352.1234,S,15112.5678,E,0,08,0.9,12.5,M,0.0,M,,*7A';

function featureOf(result) {
  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 1);
  return result.features[0];
}

test('a real GGA/RMC pair merges into one 3D fix with exact coordinates', () => {
  const feature = featureOf(parseNmeaText(`${REAL_GGA}\r\n${REAL_RMC}\r\n`));
  assert.equal(feature.geometry.type, 'LineString');
  assert.equal(feature.geometry.coordinates.length, 1);
  const [lon, lat, alt] = feature.geometry.coordinates[0];
  // 53°21.6802′N 6°30.3372′W → 53.3613367 / -6.50562 (reference's own
  // translation); tolerance, not the parser's formula, is the oracle.
  assert.ok(Math.abs(lat - 53.36133666666666) < 1e-9, `lat ${lat}`);
  assert.ok(Math.abs(lon - -6.50562) < 1e-9, `lon ${lon}`);
  assert.equal(alt, 61.7);
  // The GGA had time but no date; the RMC's date fills the merged fix.
  assert.deepEqual(feature.properties.timestamps, ['2011-05-28T09:27:50.000Z']);
  assert.equal(feature.properties.nmea.fixes, 1);
  assert.equal(feature.properties.nmea.merged, 1);
});

test('sentences with bad or missing checksums are skipped and counted', () => {
  const corrupted = REAL_RMC.slice(0, -2) + 'FF'; // valid shape, wrong XOR
  const missing = REAL_GGA.split('*')[0]; // no checksum trailer at all
  const result = parseNmeaText(`${REAL_GGA}\n${corrupted}\n${missing}\n`);
  const feature = featureOf(result);
  assert.equal(feature.properties.nmea.fixes, 1);
  assert.equal(feature.properties.nmea.skipped.badChecksum, 2);
});

test('void RMC status and GGA quality 0 are skipped, never plotted', () => {
  const result = parseNmeaText(
    `${VOID_RMC}\n${NOFIX_GGA}\n${SOUTH_EAST_RMC}\n`,
  );
  const feature = featureOf(result);
  assert.equal(feature.geometry.coordinates.length, 1);
  assert.equal(feature.properties.nmea.skipped.void, 2);
});

test('southern and western hemispheres come out negative', () => {
  const feature = featureOf(
    parseNmeaText(`${SOUTH_EAST_RMC}\n${SOUTH_WEST_GGA}\n`),
  );
  const [se, sw] = feature.geometry.coordinates;
  // 33°52.1234′S 151°12.5678′E ; 22°54.7000′S 43°12.4000′W
  assert.ok(Math.abs(se[1] - -33.86872333333333) < 1e-9, `lat ${se[1]}`);
  assert.ok(Math.abs(se[0] - 151.20946333333332) < 1e-9, `lon ${se[0]}`);
  assert.ok(Math.abs(sw[1] - -22.911666666666665) < 1e-9, `lat ${sw[1]}`);
  assert.ok(Math.abs(sw[0] - -43.20666666666667) < 1e-9, `lon ${sw[0]}`);
  assert.deepEqual(feature.properties.timestamps, [
    '2026-01-18T01:30:32.000Z',
    '2026-01-18T01:30:33.000Z', // GGA borrows the RMC date seen above it
  ]);
});

test('GGA altitude is kept only for metres within the cap', () => {
  const feet = withChecksum(
    'GPGGA,013033.00,2254.7000,S,04312.4000,W,1,08,0.9,12.5,f,0.0,M,,',
  );
  const huge = withChecksum(
    'GPGGA,013033.00,2254.7000,S,04312.4000,W,1,08,0.9,2500000,M,0.0,M,,',
  );
  const feetFix = featureOf(parseNmeaText(`${feet}\n`));
  const hugeFix = featureOf(parseNmeaText(`${huge}\n`));
  assert.equal(feetFix.geometry.coordinates[0].length, 2);
  assert.equal(hugeFix.geometry.coordinates[0].length, 2);
});

test('a GGA before any RMC date keeps a null timestamp, never a guess', () => {
  const gga = withChecksum(
    'GPGGA,013031.00,3353.0000,S,15113.0000,E,1,08,0.9,12.5,M,0.0,M,,',
  );
  const feature = featureOf(parseNmeaText(`${gga}\n${SOUTH_EAST_RMC}\n`));
  assert.equal(feature.geometry.coordinates.length, 2);
  assert.deepEqual(feature.properties.timestamps, [
    null,
    '2026-01-18T01:30:32.000Z',
  ]);
});

test('other sentence types are ignored without counting as skips', () => {
  const gsv = withChecksum(
    'GPGSV,3,1,11,10,63,137,17,07,61,098,15,05,59,290,20,08,54,157,30',
  );
  const result = parseNmeaText(`${gsv}\n${REAL_GGA}\n`);
  const feature = featureOf(result);
  assert.equal(feature.properties.nmea.fixes, 1);
  assert.deepEqual(feature.properties.nmea.skipped, {
    badChecksum: 0,
    void: 0,
    malformed: 0,
  });
});

test('invalid input returns null and never throws', () => {
  for (const bad of [null, undefined, 42, '', '   ', 'no sentences here']) {
    assert.equal(parseNmeaText(bad), null);
  }
  // A log of only void sentences has no usable fix.
  assert.equal(parseNmeaText(`${VOID_RMC}\n${NOFIX_GGA}\n`), null);
  assert.equal(isNmeaText(null), false);
  assert.equal(isNmeaText('just words'), false);
  assert.equal(isNmeaText(REAL_GGA), true);
});

test('caps are the shared geo-import caps, not a second copy', () => {
  assert.equal(MAX_NMEA_POSITIONS, MAX_IMPORT_POSITIONS);
  assert.equal(MAX_NMEA_ALTITUDE, MAX_IMPORT_ALTITUDE);
});

test('over-cap input is refused outright, never truncated', () => {
  const lines = [];
  for (let i = 0; i <= MAX_NMEA_POSITIONS; i++) {
    // Unique coordinates per line so nothing merges away the count.
    const minutes = (21 + i / 10000).toFixed(4).padStart(7, '0');
    lines.push(
      withChecksum(
        `GPGGA,092750.000,53${minutes},N,00630.3372,W,1,8,1.03,61.7,M,55.2,M,,`,
      ),
    );
  }
  assert.equal(parseNmeaText(lines.join('\n')), null);
});
