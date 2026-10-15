import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';

import {
  NHC_PROBE_CONCURRENCY,
  NHC_STALE_ADVISORY_MS,
  buildStormFromKml,
  fetchNhcDirectSnapshot,
  normalizeAdvisoryNumber,
  parseConeRing,
  parseNhcValidAt,
} from './nhcDirect.js';
import { validateCycloneSnapshot } from './source.js';

const fixture = (name) =>
  readFileSync(
    new URL(`../../data/fixtures/${name}`, import.meta.url),
    'utf8',
  );

const TRUDY_TRACK = fixture('nhc-ep212026-003adv-track.kml');
const TRUDY_CONE = fixture('nhc-ep212026-003adv-cone.kml');
const SIMON_TRACK = fixture('nhc-ep202026-027aadv-track.kml');

// Trudy advisory #3: "Valid at: 9:00 PM CST October 13, 2026" = 03:00Z Oct 14.
const TRUDY_VALID_MS = Date.parse('2026-10-14T03:00:00.000Z');

test('parseNhcValidAt converts NHC advisory times to UTC', () => {
  assert.equal(
    parseNhcValidAt('9:00 PM CST October 13, 2026'),
    TRUDY_VALID_MS,
  );
  assert.equal(
    parseNhcValidAt('11:00 PM MST October 13, 2026'),
    Date.parse('2026-10-14T06:00:00.000Z'),
  );
  assert.equal(parseNhcValidAt('noon someday'), null);
  assert.equal(parseNhcValidAt('9:00 PM XYZ October 13, 2026'), null);
});

test('normalizeAdvisoryNumber strips padding and uppercases suffixes', () => {
  assert.equal(normalizeAdvisoryNumber('(Advisory #3)'), '3');
  assert.equal(normalizeAdvisoryNumber('(Advisory #27A)'), '27A');
  assert.equal(normalizeAdvisoryNumber('#027a'), '27A');
  assert.equal(normalizeAdvisoryNumber('no advisory here'), null);
});

test('parseConeRing extracts the closed cone ring', () => {
  const ring = parseConeRing(TRUDY_CONE);
  assert.ok(Array.isArray(ring));
  assert.ok(ring.length > 1000, `expected a large ring, got ${ring.length}`);
  const [first] = ring;
  const last = ring[ring.length - 1];
  assert.deepEqual(first, last);
  for (const [lon, lat] of ring.slice(0, 50)) {
    assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
  }
});

test('buildStormFromKml builds a validator-clean storm from real KML', () => {
  const storm = buildStormFromKml({
    trackKml: TRUDY_TRACK,
    coneRing: parseConeRing(TRUDY_CONE),
    nowMs: TRUDY_VALID_MS + 3600 * 1000,
  });
  assert.ok(storm);
  assert.equal(storm.id, 'ep212026');
  assert.equal(storm.basin, 'EP');
  assert.equal(storm.name, 'Trudy');
  assert.equal(storm.classification, 'TS');
  assert.equal(storm.advisoryNumber, '3');
  assert.equal(storm.geometryStatus, 'current');
  assert.equal(storm.geometryAdvisoryNumber, '3');
  assert.deepEqual(storm.position, { longitude: -97, latitude: 11.2 });
  assert.equal(storm.positionAt, '2026-10-14T03:00:00.000Z');
  assert.equal(storm.issuedAt, '2026-10-14T03:00:00.000Z');
  assert.equal(storm.windKt, 40);
  assert.equal(storm.forecastPoints.length, 9);
  assert.deepEqual(
    storm.forecastPoints.map((p) => p.tauHours),
    [0, 12, 24, 36, 48, 60, 72, 96, 120],
  );
  assert.equal(storm.forecastPoints[1].windKt, 50);
  assert.equal(storm.forecastPoints[1].gustKt, 60);
  assert.equal(storm.track.type, 'LineString');
  assert.equal(storm.track.coordinates.length, 9);
  assert.equal(storm.cone.type, 'Polygon');
  assert.equal(
    storm.outlookUrl,
    'https://www.nhc.noaa.gov/gtwo.php?basin=epac&fdays=7',
  );

  const snapshot = {
    schemaVersion: 1,
    source: 'nhc-direct',
    attribution: 'National Hurricane Center / NOAA',
    coverage: 'Atlantic and eastern/central North Pacific only.',
    fetchedAt: TRUDY_VALID_MS,
    stale: false,
    unavailable: false,
    reason: null,
    storms: [storm],
  };
  const validated = validateCycloneSnapshot(snapshot);
  assert.equal(validated.storms.length, 1);
});

test('buildStormFromKml handles an intermediate advisory number', () => {
  const storm = buildStormFromKml({
    trackKml: SIMON_TRACK,
    coneRing: parseConeRing(TRUDY_CONE),
    nowMs: Date.parse('2026-10-14T07:00:00.000Z'),
  });
  assert.ok(storm);
  assert.equal(storm.id, 'ep202026');
  assert.equal(storm.name, 'Simon');
  assert.equal(storm.classification, 'HU');
  assert.equal(storm.advisoryNumber, '27A');
  assert.equal(storm.windKt, 95);
});

test('staleness guard discards advisories older than ~30h', () => {
  const stale = buildStormFromKml({
    trackKml: TRUDY_TRACK,
    coneRing: parseConeRing(TRUDY_CONE),
    nowMs: TRUDY_VALID_MS + NHC_STALE_ADVISORY_MS + 1000,
  });
  assert.equal(stale, null);
  const fresh = buildStormFromKml({
    trackKml: TRUDY_TRACK,
    coneRing: parseConeRing(TRUDY_CONE),
    nowMs: TRUDY_VALID_MS + NHC_STALE_ADVISORY_MS - 1000,
  });
  assert.ok(fresh);
});

test('missing cone degrades the storm to pending, not fabricated', () => {
  const storm = buildStormFromKml({
    trackKml: TRUDY_TRACK,
    coneRing: null,
    nowMs: TRUDY_VALID_MS + 3600 * 1000,
  });
  assert.ok(storm);
  assert.equal(storm.geometryStatus, 'pending');
  assert.equal(storm.track, null);
  assert.equal(storm.cone, null);
  assert.deepEqual(storm.forecastPoints, []);
  assert.equal(storm.geometryAdvisoryNumber, null);
  // The pending shape still validates: position without geometry.
  const snapshot = {
    schemaVersion: 1,
    source: 'nhc-direct',
    attribution: 'National Hurricane Center / NOAA',
    coverage: 'Atlantic and eastern/central North Pacific only.',
    fetchedAt: TRUDY_VALID_MS,
    stale: false,
    unavailable: false,
    reason: null,
    storms: [storm],
  };
  assert.doesNotThrow(() => validateCycloneSnapshot(snapshot));
});

function kmzOf(kmlText, name) {
  return zipSync({ [name]: strToU8(kmlText) });
}

/** Exact-size ArrayBuffer: zipSync's .buffer may be larger than the view. */
function kmzBuffer(kmlText, name) {
  const zipped = kmzOf(kmlText, name);
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  );
}

/** Mock fetchImpl serving real KMZ bytes for Trudy, 404 otherwise. */
function mockFetch({ calls, inFlight }) {
  return async (url) => {
    calls.push(url);
    inFlight.current += 1;
    inFlight.max = Math.max(inFlight.max, inFlight.current);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (url.endsWith('EP212026_TRACK_latest.kmz')) {
        return {
          status: 200,
          ok: true,
          arrayBuffer: async () => kmzBuffer(TRUDY_TRACK, 'ep212026_003adv_TRACK.kml'),
        };
      }
      if (url.endsWith('EP212026_CONE_latest.kmz')) {
        return {
          status: 200,
          ok: true,
          arrayBuffer: async () => kmzBuffer(TRUDY_CONE, 'ep212026_003adv_CONE.kml'),
        };
      }
      return {
        status: 404,
        ok: false,
        body: { cancel: async () => {} },
      };
    } finally {
      inFlight.current -= 1;
    }
  };
}

test('fetchNhcDirectSnapshot discovers one storm within the probe budget', async () => {
  const calls = [];
  const inFlight = { current: 0, max: 0 };
  const snapshot = await fetchNhcDirectSnapshot({
    fetchImpl: mockFetch({ calls, inFlight }),
    year: 2026,
    nowMs: TRUDY_VALID_MS + 3600 * 1000,
  });
  const trackProbes = calls.filter((url) => url.includes('_TRACK_latest.kmz'));
  assert.equal(trackProbes.length, 90, 'one probe per basin x 01..30');
  assert.ok(
    inFlight.max <= NHC_PROBE_CONCURRENCY,
    `concurrency ${inFlight.max} exceeds budget`,
  );
  assert.equal(snapshot.unavailable, false);
  assert.equal(snapshot.storms.length, 1);
  assert.equal(snapshot.storms[0].id, 'ep212026');
  assert.equal(snapshot.attribution, 'National Hurricane Center / NOAA');
  assert.match(snapshot.coverage, /Bay of Bengal/);
  const validated = validateCycloneSnapshot(snapshot);
  assert.equal(validated.storms[0].geometryStatus, 'current');
});

test('fetchNhcDirectSnapshot is honestly empty when nothing is active', async () => {
  const snapshot = await fetchNhcDirectSnapshot({
    fetchImpl: async () => ({
      status: 404,
      ok: false,
      body: { cancel: async () => {} },
    }),
    year: 2026,
    nowMs: TRUDY_VALID_MS,
  });
  assert.equal(snapshot.unavailable, false);
  assert.deepEqual(snapshot.storms, []);
});

test('fetchNhcDirectSnapshot is unavailable when no probe answers', async () => {
  const snapshot = await fetchNhcDirectSnapshot({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    year: 2026,
    nowMs: TRUDY_VALID_MS,
  });
  assert.equal(snapshot.unavailable, true);
  assert.deepEqual(snapshot.storms, []);
  assert.match(snapshot.reason, /unreachable/);
});

test('fetchNhcDirectSnapshot skips corrupt KMZ payloads', async () => {
  const snapshot = await fetchNhcDirectSnapshot({
    fetchImpl: async (url) => {
      if (url.includes('_TRACK_latest.kmz')) {
        return {
          status: 200,
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      return { status: 404, ok: false, body: { cancel: async () => {} } };
    },
    year: 2026,
    nowMs: TRUDY_VALID_MS,
  });
  assert.equal(snapshot.unavailable, false);
  assert.deepEqual(snapshot.storms, []);
});
