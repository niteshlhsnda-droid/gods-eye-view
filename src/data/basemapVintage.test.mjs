import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASEMAP_VINTAGE_DISCLOSURE,
  basemapVintageNote,
} from './basemapVintage.js';

test('canonical disclosure states vintage-unknown without claiming currency', () => {
  assert.match(BASEMAP_VINTAGE_DISCLOSURE, /capture date not provided/);
  assert.match(BASEMAP_VINTAGE_DISCLOSURE, /age varies by area/);
  assert.match(BASEMAP_VINTAGE_DISCLOSURE, /may be years old/);
  assert.match(
    BASEMAP_VINTAGE_DISCLOSURE,
    /Do not read buildings, roads, or landscape as current/,
  );
  // The prohibition ("do not read ... as current") is not a currency claim:
  // no liveness word may appear as an assertion.
  assert.doesNotMatch(BASEMAP_VINTAGE_DISCLOSURE, /\blive\b/i);
  assert.doesNotMatch(BASEMAP_VINTAGE_DISCLOSURE, /real-time/i);
  assert.doesNotMatch(BASEMAP_VINTAGE_DISCLOSURE, /up-to-date|up to date/i);
  assert.doesNotMatch(BASEMAP_VINTAGE_DISCLOSURE, /shows? the world as/i);
});

test('provider-named disclosure names the provider without doubling Imagery', () => {
  assert.equal(
    basemapVintageNote('Google Photorealistic 3D Tiles'),
    'Google Photorealistic 3D Tiles imagery: capture date not provided — ' +
      'age varies by area and may be years old. ' +
      'Do not read buildings, roads, or landscape as current.',
  );
  assert.equal(
    basemapVintageNote('Esri World Imagery'),
    'Esri World imagery: capture date not provided — ' +
      'age varies by area and may be years old. ' +
      'Do not read buildings, roads, or landscape as current.',
  );
  assert.equal(
    basemapVintageNote('  Google Photorealistic 3D Tiles  '),
    basemapVintageNote('Google Photorealistic 3D Tiles'),
  );
});

test('blank provider falls back to the canonical disclosure', () => {
  assert.equal(basemapVintageNote(), BASEMAP_VINTAGE_DISCLOSURE);
  assert.equal(basemapVintageNote('   '), BASEMAP_VINTAGE_DISCLOSURE);
  assert.equal(basemapVintageNote(null), BASEMAP_VINTAGE_DISCLOSURE);
  assert.equal(basemapVintageNote(undefined), BASEMAP_VINTAGE_DISCLOSURE);
});

test('DATA_SOURCES.md states vintage-unknown on the imagery base-map rows', () => {
  const sources = readFileSync(
    new URL('../../DATA_SOURCES.md', import.meta.url),
    'utf8',
  );
  const google = sources
    .split('\n')
    .find((line) => line.startsWith('| **Google Map Tiles API**'));
  const esri = sources
    .split('\n')
    .find((line) => line.startsWith('| **Esri World Imagery**'));
  assert.ok(google, 'Google 3D Tiles row must exist in DATA_SOURCES.md');
  assert.ok(esri, 'Esri World Imagery row must exist in DATA_SOURCES.md');
  for (const row of [google, esri]) {
    assert.match(row, /capture dates are not provided/);
    assert.match(row, /may be years old/);
  }
});
