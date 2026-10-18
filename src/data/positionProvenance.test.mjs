import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPositionProvenanceLabel,
  normalizePositionSource,
  normalizeRenderedPosition,
  positionSourceName,
} from './positionProvenance.js';

test('observed ADS-B fix renders both dimensions', () => {
  assert.equal(
    formatPositionProvenanceLabel({ source: 'ads-b', renderedAs: 'observed' }),
    'ADS-B (aircraft-reported GNSS) · observed fix',
  );
  assert.equal(
    formatPositionProvenanceLabel({
      source: 'local-adsb',
      renderedAs: 'observed',
    }),
    'Local ADS-B receiver · observed fix',
  );
});

test('MLAT source never reads as a GPS point', () => {
  assert.equal(
    formatPositionProvenanceLabel({ source: 'mlat', renderedAs: 'observed' }),
    'MLAT (multilaterated) · observed fix',
  );
  assert.equal(
    positionSourceName('mlat'),
    'network-multilaterated position (lower precision than ADS-B)',
  );
});

test('upstream blends are never labelled plain ADS-B', () => {
  assert.equal(normalizePositionSource('OpenSky'), 'upstream-mix');
  assert.equal(normalizePositionSource('adsb.lol'), 'upstream-mix');
  assert.equal(
    formatPositionProvenanceLabel({
      source: 'opensky',
      renderedAs: 'interpolated',
    }),
    'Upstream (ADS-B + MLAT) · interpolated between fixes',
  );
});

test('extrapolated positions read as forecasts, never current', () => {
  assert.equal(
    formatPositionProvenanceLabel({
      source: 'local-adsb',
      renderedAs: 'extrapolated',
    }),
    'Local ADS-B receiver · extrapolated forecast — not an observation',
  );
  assert.equal(
    formatPositionProvenanceLabel({
      source: 'ads-b',
      renderedAs: 'dead-reckoned',
    }),
    'ADS-B (aircraft-reported GNSS) · extrapolated forecast — not an observation',
  );
});

test('unknown source and unknown rendering stay unknown', () => {
  assert.equal(
    formatPositionProvenanceLabel({}),
    'Position provenance unknown',
  );
  assert.equal(
    formatPositionProvenanceLabel({ source: 'VHF triangulation' }),
    'Position provenance unknown',
  );
  assert.equal(
    formatPositionProvenanceLabel({
      source: 'ads-b',
      renderedAs: 'teleported',
    }),
    'ADS-B (aircraft-reported GNSS) · position rendering unknown',
  );
  assert.equal(
    formatPositionProvenanceLabel({ source: 'LIDAR', renderedAs: 'observed' }),
    'position source undisclosed · observed fix',
  );
});

test('non-string and empty inputs are rejected, never coerced', () => {
  assert.equal(normalizePositionSource(null), null);
  assert.equal(normalizePositionSource(42), null);
  assert.equal(normalizePositionSource(''), null);
  assert.equal(normalizeRenderedPosition(undefined), null);
  assert.equal(normalizeRenderedPosition(true), null);
  assert.equal(
    formatPositionProvenanceLabel(null),
    'Position provenance unknown',
  );
  assert.equal(
    formatPositionProvenanceLabel('ads-b'),
    'Position provenance unknown',
  );
});

test('source matching is case-insensitive, trims, canonicalizes aliases', () => {
  assert.equal(normalizePositionSource('ADSB'), 'ads-b');
  assert.equal(normalizePositionSource('  dump1090  '), 'local-adsb');
  assert.equal(normalizePositionSource('multilateration'), 'mlat');
  assert.equal(normalizePositionSource('ADS-B + MLAT'), 'upstream-mix');
  assert.equal(normalizeRenderedPosition('DEAD RECKONED'), 'extrapolated');
  assert.equal(normalizeRenderedPosition('coasting'), 'extrapolated');
  assert.equal(normalizeRenderedPosition('fix'), 'observed');
});

test('long-form source names stay verified', () => {
  assert.equal(
    positionSourceName('ads-b'),
    'aircraft-reported ADS-B GNSS position',
  );
  assert.equal(
    positionSourceName('upstream-mix'),
    'upstream snapshot (ADS-B and MLAT mixed; per-fix source undisclosed)',
  );
  assert.equal(
    positionSourceName('local-adsb'),
    'local ADS-B receiver position',
  );
  assert.equal(positionSourceName('GNSS++'), null);
});
