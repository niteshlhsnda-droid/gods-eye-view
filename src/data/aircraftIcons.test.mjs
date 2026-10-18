import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKED_ICON_PX, aircraftIcon } from './aircraftIcons.js';

/**
 * Behavioral pins for src/data/aircraftIcons.js (previously zero-coverage).
 *
 * Pin rules: production code is byte-identical — these tests describe
 * observed behavior only. Anything that looks wrong is recorded as a
 * FOLLOW-UP in the report, not fixed here.
 *
 * The module builds nose-up aircraft silhouette SVG data URIs for Cesium
 * billboards: one glyph per classifyAircraft() kind, cached per kind+size,
 * falling back to the airliner glyph for unknown kinds.
 */

const KNOWN_KINDS = [
  'airliner',
  'widebody',
  'quadjet',
  'turboprop',
  'light',
  'glider',
  'helicopter',
  'fastjet',
  'bizjet',
  'tr3b',
  'tr3bHot',
  'uav',
];

const URI_PREFIX = 'data:image/svg+xml;base64,';

/** Decode the SVG payload back to text. */
const decode = (uri) =>
  Buffer.from(uri.slice(URI_PREFIX.length), 'base64').toString('utf8');

test('exports TRACKED_ICON_PX as the 192 px tracked raster size', () => {
  assert.equal(TRACKED_ICON_PX, 192);
});

test('returns a base64 SVG data URI', () => {
  const uri = aircraftIcon('airliner');
  assert.ok(uri.startsWith(URI_PREFIX));
  const svg = decode(uri);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('</svg>'));
});

test('defaults to the 64 px fleet raster size', () => {
  const svg = decode(aircraftIcon('glider'));
  assert.ok(svg.includes('width="64"'));
  assert.ok(svg.includes('height="64"'));
});

test('explicit px parameter sets the SVG width and height', () => {
  const svg = decode(aircraftIcon('glider', 192));
  assert.ok(svg.includes('width="192"'));
  assert.ok(svg.includes('height="192"'));
});

test('TRACKED_ICON_PX passed explicitly selects the tracked raster size', () => {
  const svg = decode(aircraftIcon('airliner', TRACKED_ICON_PX));
  assert.ok(svg.includes('width="192"'));
  assert.ok(svg.includes('height="192"'));
});

test('SVG keeps the 96-unit nose-up viewBox with the glyph centred', () => {
  const svg = decode(aircraftIcon('airliner'));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('viewBox="0 0 96 96"'));
  // Glyph centre at 48,48; each body is drawn around the origin, nose -Y.
  assert.ok(svg.includes('transform="translate(48,48)"'));
});

test('every documented kind returns a data URI', () => {
  for (const kind of KNOWN_KINDS) {
    const uri = aircraftIcon(kind);
    assert.ok(
      uri.startsWith(URI_PREFIX),
      `expected a data URI for kind "${kind}"`,
    );
  }
});

test('every kind has a distinct silhouette', () => {
  const uris = KNOWN_KINDS.map((kind) => aircraftIcon(kind));
  assert.equal(new Set(uris).size, KNOWN_KINDS.length);
});

test('unknown kind falls back to the airliner glyph', () => {
  assert.equal(aircraftIcon('spaceship'), aircraftIcon('airliner'));
});

test('undefined, null, and empty-string kinds fall back to airliner', () => {
  const airliner = aircraftIcon('airliner');
  assert.equal(aircraftIcon(undefined), airliner);
  assert.equal(aircraftIcon(null), airliner);
  assert.equal(aircraftIcon(''), airliner);
});

test('kind lookup is case-sensitive', () => {
  // 'TR3B' is not a known key, so it pins to the airliner fallback.
  assert.equal(aircraftIcon('TR3B'), aircraftIcon('airliner'));
});

test('same kind and size return the identical cached string', () => {
  assert.ok(aircraftIcon('quadjet', 64) === aircraftIcon('quadjet', 64));
  // Default size is the same cache entry as an explicit 64.
  assert.ok(aircraftIcon('quadjet') === aircraftIcon('quadjet', 64));
});

test('the cache key includes the pixel size', () => {
  const small = aircraftIcon('fastjet', 64);
  const big = aircraftIcon('fastjet', 192);
  assert.notEqual(small, big);
  assert.ok(big === aircraftIcon('fastjet', 192));
});

test('unknown kind shares the normalized airliner cache entry', () => {
  assert.ok(aircraftIcon('bogus', 64) === aircraftIcon('airliner', 64));
});

test('fleet glyphs are white-filled with a dark hairline stroke', () => {
  const svg = decode(aircraftIcon('airliner'));
  assert.ok(svg.includes('fill="white"'));
  assert.ok(svg.includes('stroke="rgba(0,0,0,0.32)"'));
});

test('quadjet carries four bold engine pods and the heavier stroke', () => {
  const svg = decode(aircraftIcon('quadjet'));
  const pods = svg.match(/<rect x="(?:-31|-17|10|24)" y=/g) ?? [];
  assert.equal(pods.length, 4);
  assert.ok(svg.includes('stroke="rgba(0,0,0,0.38)"'));
});

test('helicopter carries a solid main-rotor disc, not a fixed wing', () => {
  const svg = decode(aircraftIcon('helicopter'));
  assert.ok(svg.includes('cy="-6" r="31"'));
  assert.ok(svg.includes('fill-opacity="0.22"'));
});

test('glider spans the widest with high-aspect tapered wings', () => {
  const svg = decode(aircraftIcon('glider'));
  assert.ok(svg.includes('45,-10.5'));
});

test('uav spans long straight wings with a bulbous sensor nose', () => {
  const svg = decode(aircraftIcon('uav'));
  assert.ok(svg.includes('43,-7'));
  assert.ok(svg.includes('fill="white"'));
});

test('tr3b breaks the white-fill contract with a near-black hull', () => {
  const svg = decode(aircraftIcon('tr3b'));
  assert.ok(svg.includes('fill="#0d1014"'));
  assert.ok(!svg.includes('fill="white"'));
});

test('tr3bHot adds a radial glow gradient for the thermal emitters', () => {
  const svg = decode(aircraftIcon('tr3bHot'));
  assert.ok(svg.includes('<radialGradient id="tr3bGlow"'));
  assert.ok(svg.includes('fill="url(#tr3bGlow)"'));
  assert.ok(svg.includes('fill="#0b0e12"'));
});

test('the encoded payload decodes back to the exact authored SVG shape', () => {
  const svg = decode(aircraftIcon('light'));
  // Structural round-trip: the 64 px wrapper plus the light body.
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes('translate(48,48)'));
  assert.ok(svg.includes('cy="-29"'));
});
