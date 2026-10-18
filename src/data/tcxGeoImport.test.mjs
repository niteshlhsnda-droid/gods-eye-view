import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMPORT_ALTITUDE,
  MAX_IMPORT_ENTITIES,
  MAX_IMPORT_POSITIONS,
} from './geoImportLimits.js';
import {
  MAX_TCX_ALTITUDE,
  MAX_TCX_ENTITIES,
  MAX_TCX_NAME_LENGTH,
  MAX_TCX_POSITIONS,
  TcxGeoImportError,
  isTcxText,
  parseTcxToFeatureCollection,
} from './tcxGeoImport.js';

const trackpoint = ({
  lat = '25.6200',
  lon = '85.1400',
  time = '2026-10-18T06:00:01Z',
  alt = '55.2',
  dist = '3.1',
  hr = '128',
  cad = '82',
  position = true,
} = {}) =>
  `<Trackpoint><Time>${time}</Time>${
    position
      ? `<Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position>`
      : ''
  }${alt === null ? '' : `<AltitudeMeters>${alt}</AltitudeMeters>`}${
    dist === null ? '' : `<DistanceMeters>${dist}</DistanceMeters>`
  }${hr === null ? '' : `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>`}${
    cad === null ? '' : `<Cadence>${cad}</Cadence>`
  }</Trackpoint>`;

const activity = (
  trackpoints,
  {
    sport = 'Running',
    id = '2026-10-18T06:00:00Z',
    lapStart = '2026-10-18T06:00:00Z',
  } = {},
) =>
  `<Activity Sport="${sport}"><Id>${id}</Id><Lap StartTime="${lapStart}"><Track>${trackpoints}</Track></Lap></Activity>`;

const tcx = (body, { ns = '', decl = true } = {}) => {
  const rootOpen = ns
    ? `<${ns}TrainingCenterDatabase xmlns:${ns.replace(/:$/, '')}="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">`
    : '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">';
  let prefixed = body;
  if (ns) {
    prefixed = body
      .replace(/<\//g, '\u0000')
      .replace(/</g, `<${ns}`)
      .replace(/\u0000/g, `</${ns}`);
  }
  return (
    `${decl ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''}` +
    `${rootOpen}${prefixed}</${ns}TrainingCenterDatabase>`
  );
};

test('isTcxText classifies TCX, rejects GPX/plain text/non-strings', () => {
  const plain = tcx('<Activities></Activities>');
  const prefixed = tcx('<Activities></Activities>', { ns: 'ns2:' });
  assert.equal(isTcxText(plain), true);
  assert.equal(isTcxText(prefixed), true);
  assert.equal(
    isTcxText('<?xml version="1.0"?><gpx version="1.1"><trk></trk></gpx>'),
    false,
  );
  assert.equal(isTcxText('just some text'), false);
  assert.equal(isTcxText(''), false);
  assert.equal(isTcxText(null), false);
});

test('caps alias the importer limits so the numbers cannot drift', () => {
  assert.equal(MAX_TCX_ENTITIES, MAX_IMPORT_ENTITIES);
  assert.equal(MAX_TCX_POSITIONS, MAX_IMPORT_POSITIONS);
  assert.equal(MAX_TCX_ALTITUDE, MAX_IMPORT_ALTITUDE);
});

test('an empty database parses to an empty FeatureCollection', () => {
  const result = parseTcxToFeatureCollection(
    tcx('<Activities></Activities><Courses></Courses>'),
  );
  assert.equal(result.type, 'FeatureCollection');
  assert.deepEqual(result.features, []);
  assert.equal(result.skipped, 0);
});

test('a lap track becomes a LineString with per-point arrays', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities>${activity(
        trackpoint() +
          trackpoint({
            lat: '25.6201',
            lon: '85.1402',
            time: '2026-10-18T06:00:02Z',
            alt: '55.8',
            dist: '7.4',
            hr: '131',
            cad: '84',
          }) +
          trackpoint({
            lat: '25.6203',
            lon: '85.1405',
            time: '2026-10-18T06:00:03Z',
            alt: null,
            dist: null,
            hr: null,
            cad: null,
          }),
      )}</Activities>`,
    ),
  );
  assert.equal(result.features.length, 1);
  const [feature] = result.features;
  assert.equal(feature.geometry.type, 'LineString');
  assert.deepEqual(feature.geometry.coordinates, [
    [85.14, 25.62, 55.2],
    [85.1402, 25.6201, 55.8],
    [85.1405, 25.6203],
  ]);
  assert.deepEqual(feature.properties, {
    kind: 'activity',
    sport: 'Running',
    activityId: '2026-10-18T06:00:00Z',
    lapIndex: 0,
    lapStartTime: '2026-10-18T06:00:00Z',
    trackIndex: 0,
    startTime: '2026-10-18T06:00:01Z',
    endTime: '2026-10-18T06:00:03Z',
    times: [
      '2026-10-18T06:00:01Z',
      '2026-10-18T06:00:02Z',
      '2026-10-18T06:00:03Z',
    ],
    elevations: [55.2, 55.8, null],
    distances: [3.1, 7.4, null],
    heartRates: [128, 131, null],
    cadences: [82, 84, null],
  });
  assert.equal(result.skipped, 0);
});

test('a trackpoint without a position is skipped and counted', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities>${activity(
        trackpoint() +
          trackpoint({ position: false }) +
          trackpoint({ lat: '25.6201' }),
      )}</Activities>`,
    ),
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry.coordinates.length, 2);
  assert.equal(result.skipped, 1);
});

test('a trackpoint with a blank latitude is skipped, not refused', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities>${activity(
        trackpoint() + trackpoint({ lat: '' }) + trackpoint({ lat: '25.6201' }),
      )}</Activities>`,
    ),
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.skipped, 1);
});

test('a lone trackpoint becomes a Point', () => {
  const result = parseTcxToFeatureCollection(
    tcx(`<Activities>${activity(trackpoint())}</Activities>`),
  );
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry, {
    type: 'Point',
    coordinates: [85.14, 25.62, 55.2],
  });
});

test('an empty track yields no feature', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities><Activity Sport="Biking"><Id>x</Id><Lap StartTime="y"><Track></Track></Lap></Activity></Activities>`,
    ),
  );
  assert.deepEqual(result.features, []);
  assert.equal(result.skipped, 0);
});

test('multiple laps and activities become separate features with indices', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities>` +
        `<Activity Sport="Running"><Id>run-1</Id>` +
        `<Lap StartTime="t0"><Track>${trackpoint()}</Track></Lap>` +
        `<Lap StartTime="t1"><Track>${trackpoint()}${trackpoint({ lat: '25.63' })}</Track></Lap>` +
        `</Activity>` +
        `<Activity Sport="Biking"><Id>bike-1</Id>` +
        `<Lap StartTime="t2"><Track>${trackpoint()}</Track></Lap>` +
        `</Activity></Activities>`,
    ),
  );
  assert.equal(result.features.length, 3);
  const props = result.features.map((f) => f.properties);
  assert.deepEqual(
    props.map((p) => [p.kind, p.sport, p.activityId, p.lapIndex, p.trackIndex]),
    [
      ['activity', 'Running', 'run-1', 0, 0],
      ['activity', 'Running', 'run-1', 1, 0],
      ['activity', 'Biking', 'bike-1', 0, 0],
    ],
  );
  assert.deepEqual(
    props.map((p) => p.lapStartTime),
    ['t0', 't1', 't2'],
  );
});

test('a course track keeps the course name and decodes entities', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Courses><Course><Name>Ganga &amp; ghat loop</Name><Track>${trackpoint()}${trackpoint({ lat: '25.6201' })}</Track></Course></Courses>`,
    ),
  );
  assert.equal(result.features.length, 1);
  const [feature] = result.features;
  assert.equal(feature.geometry.type, 'LineString');
  assert.equal(feature.properties.kind, 'course');
  assert.equal(feature.properties.courseName, 'Ganga & ghat loop');
  assert.deepEqual(feature.properties.heartRates, [128, 128]);
});

test('a course nested in a CourseFolder still parses', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Courses><CourseFolder><Name>folder</Name><Course><Name>nested</Name><Track>${trackpoint()}</Track></Course></CourseFolder></Courses>`,
    ),
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.courseName, 'nested');
});

test('course names are capped at the importer name length', () => {
  const long = 'x'.repeat(MAX_TCX_NAME_LENGTH + 40);
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Courses><Course><Name>${long}</Name><Track>${trackpoint()}</Track></Course></Courses>`,
    ),
  );
  assert.equal(
    result.features[0].properties.courseName.length,
    MAX_TCX_NAME_LENGTH,
  );
});

test('namespaced elements parse the same as unprefixed ones', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities>${activity(trackpoint() + trackpoint({ lat: '25.6201' }))}</Activities>`,
      { ns: 'ns2:' },
    ),
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry.coordinates.length, 2);
  assert.equal(result.features[0].properties.sport, 'Running');
});

test('extensions, creators and workouts are ignored, not refused', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities>${activity(
        trackpoint() +
          `<Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Speed>3.1</Speed></TPX></Extensions>`,
      )}</Activities><Workouts></Workouts><Author><Name>me</Name></Author>`,
    ),
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.skipped, 0);
});

test('a trackpoint inside an activity history wrapper still parses', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities><History>${activity(trackpoint())}</History></Activities>`,
    ),
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.kind, 'activity');
});

test('garbled sensor fields degrade to null instead of refusing', () => {
  const result = parseTcxToFeatureCollection(
    tcx(
      `<Activities>${activity(trackpoint({ cad: 'fast', hr: 'fast', dist: 'far' }))}</Activities>`,
    ),
  );
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].properties.cadences, [null]);
  assert.deepEqual(result.features[0].properties.heartRates, [null]);
  assert.deepEqual(result.features[0].properties.distances, [null]);
});

test('non-TCX input, plain text and non-strings are refused', () => {
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        '<?xml version="1.0"?><gpx version="1.1"><trk></trk></gpx>',
      ),
    TcxGeoImportError,
  );
  assert.throws(
    () => parseTcxToFeatureCollection('just some text'),
    TcxGeoImportError,
  );
  assert.throws(() => parseTcxToFeatureCollection(''), TcxGeoImportError);
  assert.throws(() => parseTcxToFeatureCollection(null), TcxGeoImportError);
  assert.throws(() => parseTcxToFeatureCollection(42), TcxGeoImportError);
});

test('malformed XML refuses the whole file', () => {
  // Unclosed Trackpoint.
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx(
          `<Activities>${activity('<Trackpoint><Time>t</Time>')}</Activities>`,
        ),
      ),
    TcxGeoImportError,
  );
  // Mismatched close.
  assert.throws(
    () => parseTcxToFeatureCollection(tcx('<Activities></Courses>')),
    TcxGeoImportError,
  );
  // Bad attribute.
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx('<Activities><Activity Sport=Running></Activity></Activities>'),
      ),
    TcxGeoImportError,
  );
  // Unterminated tag.
  assert.throws(
    () => parseTcxToFeatureCollection(tcx('<Activities>')),
    TcxGeoImportError,
  );
});

test('out-of-range and non-numeric coordinates refuse the whole file', () => {
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx(
          `<Activities>${activity(trackpoint({ lat: '95.0' }))}</Activities>`,
        ),
      ),
    TcxGeoImportError,
  );
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx(
          `<Activities>${activity(trackpoint({ lon: '-181' }))}</Activities>`,
        ),
      ),
    TcxGeoImportError,
  );
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx(
          `<Activities>${activity(trackpoint({ lat: 'north' }))}</Activities>`,
        ),
      ),
    TcxGeoImportError,
  );
});

test('bad altitudes refuse the whole file', () => {
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx(`<Activities>${activity(trackpoint({ alt: 'up' }))}</Activities>`),
      ),
    TcxGeoImportError,
  );
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx(
          `<Activities>${activity(trackpoint({ alt: String(MAX_IMPORT_ALTITUDE + 1) }))}</Activities>`,
        ),
      ),
    TcxGeoImportError,
  );
});

test('more trackpoints than the position cap refuses the file', () => {
  // Minimal trackpoints keep the hostile input small; the cap trips
  // during the scan, before the tree finishes building.
  const tiny =
    '<Trackpoint><Position><LatitudeDegrees>1</LatitudeDegrees><LongitudeDegrees>2</LongitudeDegrees></Position></Trackpoint>';
  const many = new Array(MAX_IMPORT_POSITIONS + 1).fill(tiny).join('');
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx(`<Activities>${activity(many)}</Activities>`),
      ),
    TcxGeoImportError,
  );
});

test('more tracks than the entity cap refuses the file', () => {
  const oneTrack = `<Lap StartTime="t"><Track>${trackpoint({ time: null })}</Track></Lap>`;
  const laps = new Array(MAX_IMPORT_ENTITIES + 1).fill(oneTrack).join('');
  assert.throws(
    () =>
      parseTcxToFeatureCollection(
        tcx(
          `<Activities><Activity Sport="Running"><Id>x</Id>${laps}</Activity></Activities>`,
        ),
      ),
    TcxGeoImportError,
  );
});
