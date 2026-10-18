// GBFS STATION PARSING — pin the coercion, shape-tolerance, and skip rules
// that bikeshare feeds depend on. GBFS providers disagree on field names,
// boolean spellings, and payload nesting, so the parser coerces liberally
// and silently drops stations it cannot place. These pins lock that
// behaviour, including the surprising coercions (empty string / null read
// as 0, no lat/lon range check) — do not "fix" them without a deliberate
// decision, because feed handling downstream may rely on the leniency.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStationsArray,
  normalizeGbfsBool,
  parseStationInformation,
  parseStationStatus,
  toNonNegativeInteger,
} from './gbfsStations.js';

test('normalizeGbfsBool passes booleans through untouched', () => {
  assert.equal(normalizeGbfsBool(true), true);
  assert.equal(normalizeGbfsBool(false), false);
});

test('normalizeGbfsBool returns the fallback for null and undefined', () => {
  assert.equal(normalizeGbfsBool(null), true);
  assert.equal(normalizeGbfsBool(undefined), true);
  assert.equal(normalizeGbfsBool(null, false), false);
  assert.equal(normalizeGbfsBool(undefined, false), false);
});

test('normalizeGbfsBool treats any finite nonzero number as true', () => {
  assert.equal(normalizeGbfsBool(0), false);
  assert.equal(normalizeGbfsBool(1), true);
  assert.equal(normalizeGbfsBool(2), true);
  assert.equal(normalizeGbfsBool(-1), true);
  assert.equal(normalizeGbfsBool(0.5), true);
});

test('normalizeGbfsBool coerces numeric strings through Number', () => {
  assert.equal(normalizeGbfsBool('0'), false);
  assert.equal(normalizeGbfsBool('1'), true);
  assert.equal(normalizeGbfsBool('2'), true);
  assert.equal(normalizeGbfsBool('0.0'), false);
  assert.equal(normalizeGbfsBool(''), false);
});

test('normalizeGbfsBool matches true/yes and false/no case-insensitively', () => {
  assert.equal(normalizeGbfsBool('true'), true);
  assert.equal(normalizeGbfsBool('TRUE'), true);
  assert.equal(normalizeGbfsBool('  Yes '), true);
  assert.equal(normalizeGbfsBool('false'), false);
  assert.equal(normalizeGbfsBool('FALSE'), false);
  assert.equal(normalizeGbfsBool('  No '), false);
});

test('normalizeGbfsBool falls back for unrecognized text and non-finite numbers', () => {
  assert.equal(normalizeGbfsBool('maybe'), true);
  assert.equal(normalizeGbfsBool('maybe', false), false);
  assert.equal(normalizeGbfsBool(Number.NaN), true);
  assert.equal(normalizeGbfsBool(Number.NaN, false), false);
  assert.equal(normalizeGbfsBool(Infinity), true);
  assert.equal(normalizeGbfsBool(-Infinity, false), false);
});

test('toNonNegativeInteger rounds halves up and passes integers through', () => {
  assert.equal(toNonNegativeInteger(5), 5);
  assert.equal(toNonNegativeInteger(0), 0);
  assert.equal(toNonNegativeInteger(5.4), 5);
  assert.equal(toNonNegativeInteger(5.5), 6);
  assert.equal(toNonNegativeInteger(5.9), 6);
  assert.equal(toNonNegativeInteger('12'), 12);
  assert.equal(toNonNegativeInteger('12.6'), 13);
});

test('toNonNegativeInteger returns the fallback for negatives and non-numbers', () => {
  assert.equal(toNonNegativeInteger(-1), null);
  assert.equal(toNonNegativeInteger(-0.1), null);
  assert.equal(toNonNegativeInteger('abc'), null);
  assert.equal(toNonNegativeInteger(undefined), null);
  assert.equal(toNonNegativeInteger(Number.NaN), null);
  assert.equal(toNonNegativeInteger(Infinity), null);
  assert.equal(toNonNegativeInteger(-1, 7), 7);
  assert.equal(toNonNegativeInteger('x', 7), 7);
});

test('toNonNegativeInteger coerces null, empty string, and booleans via Number', () => {
  assert.equal(toNonNegativeInteger(null), 0);
  assert.equal(toNonNegativeInteger(''), 0);
  assert.equal(toNonNegativeInteger(true), 1);
  assert.equal(toNonNegativeInteger(false), 0);
});

test('extractStationsArray accepts the canonical data.stations shape', () => {
  const stations = [{ station_id: 's1' }];
  const payload = { data: { stations } };
  assert.equal(extractStationsArray(payload), stations);
});

test('extractStationsArray accepts a bare data array', () => {
  const data = [{ station_id: 's1' }];
  assert.equal(extractStationsArray({ data }), data);
});

test('extractStationsArray unwraps one nested stations holder', () => {
  const stations = [{ station_id: 's1' }];
  assert.equal(extractStationsArray({ data: { en: { stations } } }), stations);
});

test('extractStationsArray prefers data.stations over a nested holder', () => {
  const stations = [{ station_id: 'top' }];
  const nested = [{ station_id: 'nested' }];
  assert.equal(
    extractStationsArray({ data: { stations, other: { stations: nested } } }),
    stations,
  );
});

test('extractStationsArray takes the first nested holder in key order', () => {
  const first = [{ station_id: 'first' }];
  const second = [{ station_id: 'second' }];
  assert.equal(
    extractStationsArray({
      data: { a: { stations: first }, b: { stations: second } },
    }),
    first,
  );
});

test('extractStationsArray returns an empty array for missing or malformed payloads', () => {
  assert.deepEqual(extractStationsArray(null), []);
  assert.deepEqual(extractStationsArray(undefined), []);
  assert.deepEqual(extractStationsArray({}), []);
  assert.deepEqual(extractStationsArray({ data: null }), []);
  assert.deepEqual(extractStationsArray({ data: {} }), []);
  assert.deepEqual(extractStationsArray({ data: { stations: 'no' } }), []);
  assert.deepEqual(extractStationsArray({ data: { stations: [] } }), []);
});

test('parseStationInformation maps the canonical fields', () => {
  const result = parseStationInformation({
    data: {
      stations: [
        {
          station_id: 's1',
          lat: 10,
          lon: 20,
          name: 'Central',
          capacity: 30,
          is_installed: true,
          is_renting: false,
          is_returning: true,
        },
      ],
    },
  });
  assert.ok(result instanceof Map);
  assert.deepEqual(result.get('s1'), {
    stationId: 's1',
    name: 'Central',
    lat: 10,
    lon: 20,
    capacity: 30,
    isInstalled: true,
    isRenting: false,
    isReturning: true,
  });
});

test('parseStationInformation accepts alternate field names', () => {
  const result = parseStationInformation({
    data: {
      stations: [
        {
          id: 's2',
          latitude: '12.5',
          longitude: '-3.25',
          short_name: '  Short  ',
        },
      ],
    },
  });
  assert.deepEqual(result.get('s2'), {
    stationId: 's2',
    name: 'Short',
    lat: 12.5,
    lon: -3.25,
    capacity: null,
    isInstalled: true,
    isRenting: true,
    isReturning: true,
  });
});

test('parseStationInformation prefers station_id/name over the alternates', () => {
  const result = parseStationInformation({
    data: {
      stations: [
        {
          station_id: 'A',
          id: 'B',
          lat: 1,
          lon: 2,
          name: 'Full',
          short_name: 'Short',
        },
      ],
    },
  });
  assert.equal(result.size, 1);
  assert.equal(result.get('A').name, 'Full');
  assert.equal(result.has('B'), false);
});

test('parseStationInformation trims ids and defaults a missing name to empty', () => {
  const result = parseStationInformation({
    data: { stations: [{ station_id: '  s1 ', lat: 1, lon: 2 }] },
  });
  assert.equal(result.get('s1').name, '');
});

test('parseStationInformation falls back to id when station_id is null', () => {
  const result = parseStationInformation({
    data: { stations: [{ station_id: null, id: 'x', lat: 1, lon: 2 }] },
  });
  assert.equal(result.size, 1);
  assert.equal(result.has('x'), true);
});

test('parseStationInformation stringifies a numeric zero id', () => {
  const result = parseStationInformation({
    data: { stations: [{ station_id: 0, lat: 1, lon: 2 }] },
  });
  assert.equal(result.has('0'), true);
});

test('parseStationInformation coerces capacity and defaults booleans to true', () => {
  const result = parseStationInformation({
    data: {
      stations: [
        { station_id: 'a', lat: 1, lon: 2, capacity: '10' },
        { station_id: 'b', lat: 1, lon: 2, capacity: 10.6 },
        { station_id: 'c', lat: 1, lon: 2, capacity: -1 },
        {
          station_id: 'd',
          lat: 1,
          lon: 2,
          is_installed: 0,
          is_renting: 'no',
          is_returning: 1,
        },
      ],
    },
  });
  assert.equal(result.get('a').capacity, 10);
  assert.equal(result.get('b').capacity, 11);
  assert.equal(result.get('c').capacity, null);
  assert.deepEqual(
    [
      result.get('a').isInstalled,
      result.get('a').isRenting,
      result.get('a').isReturning,
    ],
    [true, true, true],
  );
  assert.deepEqual(
    [
      result.get('d').isInstalled,
      result.get('d').isRenting,
      result.get('d').isReturning,
    ],
    [false, false, true],
  );
});

test('parseStationInformation skips stations without an id or usable coordinates', () => {
  const result = parseStationInformation({
    data: {
      stations: [
        { lat: 1, lon: 2 },
        { station_id: '   ', lat: 1, lon: 2 },
        { station_id: 'no-lat', lon: 2 },
        { station_id: 'bad-lat', lat: 'abc', lon: 2 },
        { station_id: 'bad-lon', lat: 1, lon: Infinity },
        { station_id: 'null-lon', lat: 1, lon: null },
        null,
        'x',
      ],
    },
  });
  assert.equal(result.size, 0);
});

test('parseStationInformation accepts an empty-string latitude as 0', () => {
  const result = parseStationInformation({
    data: { stations: [{ station_id: 's', lat: '', lon: 0 }] },
  });
  assert.equal(result.get('s').lat, 0);
});

test('parseStationInformation does not range-check coordinates', () => {
  const result = parseStationInformation({
    data: { stations: [{ station_id: 's', lat: 200, lon: 500 }] },
  });
  assert.equal(result.get('s').lat, 200);
  assert.equal(result.get('s').lon, 500);
});

test('parseStationInformation lets a later duplicate id overwrite the earlier one', () => {
  const result = parseStationInformation({
    data: {
      stations: [
        { station_id: 's', lat: 1, lon: 2, name: 'First' },
        { station_id: 's', lat: 3, lon: 4, name: 'Second' },
      ],
    },
  });
  assert.equal(result.size, 1);
  assert.equal(result.get('s').name, 'Second');
  assert.equal(result.get('s').lat, 3);
});

test('parseStationInformation returns an empty map for empty payloads', () => {
  assert.equal(parseStationInformation(null).size, 0);
  assert.equal(parseStationInformation({}).size, 0);
  assert.equal(parseStationInformation({ data: { stations: [] } }).size, 0);
});

test('parseStationStatus maps the canonical fields', () => {
  const result = parseStationStatus({
    data: {
      stations: [
        {
          station_id: 's1',
          num_bikes_available: 5,
          num_docks_available: 3,
          is_installed: true,
          is_renting: true,
          is_returning: false,
          last_reported: 1700000000,
        },
      ],
    },
  });
  assert.ok(result instanceof Map);
  assert.deepEqual(result.get('s1'), {
    stationId: 's1',
    bikesAvailable: 5,
    docksAvailable: 3,
    isInstalled: true,
    isRenting: true,
    isReturning: false,
    lastReported: 1700000000,
  });
});

test('parseStationStatus coerces counts and last_reported, null on missing or negative', () => {
  const result = parseStationStatus({
    data: {
      stations: [
        { station_id: 'a', num_bikes_available: 4.5, last_reported: '9' },
        { station_id: 'b', num_bikes_available: -1, last_reported: -5 },
        { station_id: 'c' },
      ],
    },
  });
  assert.equal(result.get('a').bikesAvailable, 5);
  assert.equal(result.get('a').lastReported, 9);
  assert.equal(result.get('a').docksAvailable, null);
  assert.equal(result.get('b').bikesAvailable, null);
  assert.equal(result.get('b').lastReported, null);
  assert.equal(result.get('c').bikesAvailable, null);
  assert.equal(result.get('c').docksAvailable, null);
  assert.equal(result.get('c').lastReported, null);
});

test('parseStationStatus defaults booleans to true and accepts the id fallback', () => {
  const result = parseStationStatus({
    data: {
      stations: [{ id: 's', num_bikes_available: 1, is_renting: 'false' }],
    },
  });
  assert.equal(result.get('s').isInstalled, true);
  assert.equal(result.get('s').isRenting, false);
  assert.equal(result.get('s').isReturning, true);
});

test('parseStationStatus includes stations without coordinates and skips id-less ones', () => {
  const result = parseStationStatus({
    data: {
      stations: [
        { station_id: 'no-coords', num_bikes_available: 2 },
        { num_bikes_available: 2 },
        { station_id: '  ', num_bikes_available: 2 },
      ],
    },
  });
  assert.equal(result.size, 1);
  assert.equal(result.get('no-coords').bikesAvailable, 2);
});

test('parseStationStatus lets a later duplicate id overwrite the earlier one', () => {
  const result = parseStationStatus({
    data: {
      stations: [
        { station_id: 's', num_bikes_available: 1 },
        { station_id: 's', num_bikes_available: 9 },
      ],
    },
  });
  assert.equal(result.size, 1);
  assert.equal(result.get('s').bikesAvailable, 9);
});

test('parseStationStatus returns an empty map for empty payloads', () => {
  assert.equal(parseStationStatus(null).size, 0);
  assert.equal(parseStationStatus({}).size, 0);
});
