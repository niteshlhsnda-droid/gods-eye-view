import test from 'node:test';
import assert from 'node:assert/strict';
import { IgcGeoImportError, igcToGeoJson } from './igcGeoImport.js';

// Real-world-shaped IGC (fields from the FAI spec's own example values):
// B110135 = 11:01:35, 52°06.343'N, 000°06.198'W, fix A, press 587 m, GNSS 558 m.
const B1 = 'B1101355206343N00006198WA0058700558';
const B2 = 'B1101455206259N00006295WA0059300556';
const B3 = 'B1101555206300N00006061WA0060300576';

const HEADERS = [
  'ALXV6',
  'HFDTE181026',
  'HFPLTPILOTINCHARGE:Nitesh Kumar',
  'HFGTYGLIDERTYPE:Discus 2',
  'HFGIDGLIDERID:VT-GLD',
];

const closeTo = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

test('a real-world IGC file becomes a 3D LineString with header properties', () => {
  const out = igcToGeoJson([...HEADERS, B1, B2, B3].join('\n'));
  assert.equal(out.type, 'FeatureCollection');
  assert.equal(out.features.length, 1);
  const [feature] = out.features;
  assert.equal(feature.geometry.type, 'LineString');
  assert.equal(feature.geometry.coordinates.length, 3);
  // 52°06.343'N → 52.1057166…, 000°06.198'W → −0.1033, GNSS alt 558 m.
  closeTo(feature.geometry.coordinates[0][0], -(6.198 / 60));
  closeTo(feature.geometry.coordinates[0][1], 52 + 6.343 / 60);
  assert.equal(feature.geometry.coordinates[0][2], 558);
  // Third fix carries the pressure/GNSS altitudes of its own record.
  assert.equal(feature.geometry.coordinates[2][2], 576);
  assert.deepEqual(feature.properties, {
    fixCount: 3,
    date: '2026-10-18',
    pilot: 'Nitesh Kumar',
    gliderType: 'Discus 2',
    gliderId: 'VT-GLD',
    times: [
      '2026-10-18T11:01:35Z',
      '2026-10-18T11:01:45Z',
      '2026-10-18T11:01:55Z',
    ],
  });
});

test('southern and western hemispheres get negative coordinates', () => {
  const b = 'B1200003355123S05823456WA0010000100';
  const out = igcToGeoJson(
    [b, 'B1200103355200S05823500WA0010000100'].join('\n'),
  );
  closeTo(out.features[0].geometry.coordinates[0][0], -(58 + 23.456 / 60));
  closeTo(out.features[0].geometry.coordinates[0][1], -(33 + 55.123 / 60));
});

test('invalid (V) fixes are skipped, not refused', () => {
  const vFix = 'B1101405206300N00006100WV0059000550';
  const out = igcToGeoJson([B1, vFix, B2].join('\n'));
  assert.equal(out.features[0].geometry.coordinates.length, 2);
  assert.equal(out.features[0].properties.fixCount, 2);
});

test('a tracklog of only invalid fixes is refused', () => {
  assert.throws(
    () => igcToGeoJson(['B1101355206343N00006198WV0058700558'].join('\n')),
    (err) =>
      err instanceof IgcGeoImportError && /no valid.*fixes/i.test(err.message),
  );
});

test('a single valid fix cannot make a line', () => {
  assert.throws(
    () => igcToGeoJson([B1].join('\n')),
    (err) => err instanceof IgcGeoImportError && /at least 2/.test(err.message),
  );
});

test('no B records at all is refused', () => {
  assert.throws(
    () => igcToGeoJson(HEADERS.join('\n')),
    (err) =>
      err instanceof IgcGeoImportError && /no B-record fixes/.test(err.message),
  );
});

test('unknown record letters are refused, not skipped', () => {
  assert.throws(
    () => igcToGeoJson([B1, 'Z999', B2].join('\n')),
    (err) => err instanceof IgcGeoImportError && /"Z"/.test(err.message),
  );
});

test('a truncated B record refuses the whole file', () => {
  assert.throws(
    () => igcToGeoJson([B1, 'B1101455206259N'].join('\n')),
    (err) => err instanceof IgcGeoImportError && /truncated/.test(err.message),
  );
});

test('a B record with an impossible time refuses the whole file', () => {
  const bad = 'B2570005206343N00006198WA0058700558';
  assert.throws(
    () => igcToGeoJson([B1, bad].join('\n')),
    (err) =>
      err instanceof IgcGeoImportError && /invalid time/.test(err.message),
  );
});

test('a leap second (SS=60) is accepted, per the spec', () => {
  const out = igcToGeoJson(
    [
      'HFDTE181026',
      'B1159595206343N00006198WA0058700558',
      'B1159605206343N00006198WA0058700558',
      'B1200015206343N00006198WA0058700558',
    ].join('\n'),
  );
  assert.deepEqual(out.features[0].properties.times, [
    '2026-10-18T11:59:59Z',
    '2026-10-18T12:00:00Z',
    '2026-10-18T12:00:01Z',
  ]);
});

test('out-of-range latitude refuses the whole file', () => {
  const bad = 'B1101359106343N00006198WA0058700558';
  assert.throws(
    () => igcToGeoJson([B1, bad].join('\n')),
    (err) => err instanceof IgcGeoImportError && /latitude/.test(err.message),
  );
});

test('non-numeric altitude refuses the whole file', () => {
  const bad = 'B1101355206343N00006198WA00ABC00558';
  assert.throws(
    () => igcToGeoJson([B1, bad].join('\n')),
    (err) => err instanceof IgcGeoImportError && /altitude/.test(err.message),
  );
});

test('negative altitudes parse with their sign', () => {
  const b = 'B1101355206343N00006198WA-0010-0005';
  const out = igcToGeoJson([b, B2].join('\n'));
  assert.equal(out.features[0].geometry.coordinates[0][2], -5);
});

test('B-record extension bytes after byte 35 are ignored', () => {
  const extended = `${B1}03602`;
  const out = igcToGeoJson([extended, B2].join('\n'));
  assert.equal(out.features[0].geometry.coordinates.length, 2);
  assert.equal(out.features[0].geometry.coordinates[0][2], 558);
});

test('fixes past midnight roll the timestamp into the next day', () => {
  const out = igcToGeoJson(
    [
      'HFDTE181026',
      'B2359595206343N00006198WA0058700558',
      'B0000055206343N00006198WA0058700558',
    ].join('\n'),
  );
  assert.deepEqual(out.features[0].properties.times, [
    '2026-10-18T23:59:59Z',
    '2026-10-19T00:00:05Z',
  ]);
});

test('a month-end midnight crossing rolls into the next month', () => {
  const out = igcToGeoJson(
    [
      'HFDTE311026',
      'B2359595206343N00006198WA0058700558',
      'B0000055206343N00006198WA0058700558',
    ].join('\n'),
  );
  assert.deepEqual(out.features[0].properties.times, [
    '2026-10-31T23:59:59Z',
    '2026-11-01T00:00:05Z',
  ]);
});

test('the long-form HFDTEDATE: header is accepted', () => {
  const out = igcToGeoJson(['HFDTEDATE:181026', B1, B2].join('\n'));
  assert.equal(out.features[0].properties.date, '2026-10-18');
  assert.equal(out.features[0].properties.times[0], '2026-10-18T11:01:35Z');
});

test('a corrupt flight-date header is refused, not silently dropped', () => {
  assert.throws(
    () => igcToGeoJson(['HFDTE999999', B1, B2].join('\n')),
    (err) =>
      err instanceof IgcGeoImportError && /flight-date/.test(err.message),
  );
});

test('no date header means no times or date, still a valid line', () => {
  const out = igcToGeoJson([B1, B2].join('\n'));
  assert.deepEqual(out.features[0].properties, { fixCount: 2 });
});

test('overlong pilot names are capped, not refused', () => {
  const long = `HFPLTPILOTINCHARGE:${'N'.repeat(200)}`;
  const out = igcToGeoJson([long, B1, B2].join('\n'));
  assert.equal(out.features[0].properties.pilot.length, 120);
});

test('empty input is refused', () => {
  assert.throws(
    () => igcToGeoJson('   \n'),
    (err) => err instanceof IgcGeoImportError && /file text/.test(err.message),
  );
});

test('fix caps refuse rather than truncate', () => {
  assert.throws(
    () => igcToGeoJson([B1, B2, B3].join('\n'), { maxFixes: 2 }),
    (err) => err instanceof IgcGeoImportError && /2 fixes/.test(err.message),
  );
});
