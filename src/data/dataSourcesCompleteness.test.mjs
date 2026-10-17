import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Docs-consistency pins for DATA_SOURCES.md rows added/corrected by the
 * Cycle 7 completeness audit. Follows the existing pattern in
 * transitFeeds.test.mjs: tests read DATA_SOURCES.md and assert on row text,
 * so a later code move that orphans a row fails here instead of silently.
 */
const sources = readFileSync(
  new URL('../../DATA_SOURCES.md', import.meta.url),
  'utf8',
);

function rowStartingWith(prefix) {
  const row = sources
    .split('\n')
    .find((line) => line.startsWith(prefix));
  assert.ok(row, `DATA_SOURCES.md is missing the row: ${prefix}`);
  return row;
}

test('Cesium ion row covers Bing stacks, World Terrain, and the ion-hosted Google route', () => {
  const row = rowStartingWith('| **Cesium ion**');
  assert.match(row, /Bing Aerial \/ Bing Labels/);
  assert.match(row, /Cesium World Terrain/);
  assert.match(row, /asset 1/);
  assert.match(row, /2275207/);
  assert.match(row, /vintage unknown/);
  assert.doesNotMatch(row, /\blive\b/i);
});

test('Google and Esri rows disclose base-map vintage as unknown', () => {
  for (const prefix of [
    '| **Google Map Tiles API**',
    '| **Esri World Imagery**',
  ]) {
    const row = rowStartingWith(prefix);
    assert.match(row, /capture dates are not provided/);
    assert.match(row, /vintage unknown/);
  }
  assert.match(
    rowStartingWith('| **Google Map Tiles API**'),
    /Cesium ion/,
  );
});

test('OpenStreetMap row names every live path and discloses vintage-unknown', () => {
  const row = rowStartingWith('| **OpenStreetMap**');
  assert.match(row, /tile\.openstreetmap\.org/);
  assert.match(row, /tiles\.dontgetflocked\.com/);
  assert.match(row, /overpass-api\.de/);
  assert.match(row, /maps\.mail\.ru/);
  assert.match(row, /OVERPASS_UPSTREAMS/);
  assert.match(row, /vintage unknown/);
});

test('OpenFreeMap row names its consumers; USGS row names both endpoints', () => {
  const openFreeMap = rowStartingWith('| **OpenFreeMap / OpenMapTiles**');
  assert.match(openFreeMap, /mapped-installations/);
  assert.match(openFreeMap, /Traffic/);
  const usgs = rowStartingWith('| **USGS**');
  assert.match(usgs, /all_day\.geojson/);
  assert.match(usgs, /FDSNWS/);
});

test('NHC row names the static-hosting KMZ path and the gtwo link-out', () => {
  const row = rowStartingWith('| **NOAA NHC / CPHC advisories**');
  assert.match(row, /storm-graphics KMZ/);
  assert.match(row, /30 h/);
  assert.match(row, /gtwo\.php/);
  assert.match(row, /a link, not a fetched feed/);
  assert.match(sources, /storm-graphics KMZ track\/cone products directly/);
});

test('ALPR section names the tile host and the Overpass fallback', () => {
  assert.match(sources, /tiles\.dontgetflocked\.com/);
  assert.match(sources, /overpass-api\.de.*first/);
  assert.match(sources, /maps\.mail\.ru.*mirror/);
});

test('embedded witness-media providers are named', () => {
  assert.match(sources, /youtube-nocookie\.com/);
  assert.match(sources, /connect\.facebook\.net/);
  assert.match(sources, /platform\.twitter\.com/);
});
