import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShareTargets,
  defaultShareText,
  withUtmTags,
  SHARE_UTM_CAMPAIGN,
  SHARE_UTM_MEDIUM,
} from './shareTargets.js';

const SCENE_URL =
  'https://example.com/#lat=20.0000&lon=86.4000&alt=1900000&style=normal';

test('withUtmTags tags the query string and preserves the scene hash', () => {
  const tagged = withUtmTags(SCENE_URL, 'whatsapp');
  const parsed = new URL(tagged);
  assert.equal(parsed.searchParams.get('utm_source'), 'whatsapp');
  assert.equal(parsed.searchParams.get('utm_medium'), SHARE_UTM_MEDIUM);
  assert.equal(parsed.searchParams.get('utm_campaign'), SHARE_UTM_CAMPAIGN);
  assert.ok(parsed.hash.includes('lat=20.0000'));
});

test('withUtmTags returns the input unchanged when unparseable', () => {
  assert.equal(withUtmTags('not a url', 'x'), 'not a url');
  assert.equal(withUtmTags('', 'x'), '');
  assert.equal(withUtmTags(null, 'x'), null);
});

test('WhatsApp is the first share target (owner standing rule)', () => {
  const targets = buildShareTargets({ url: SCENE_URL });
  assert.equal(targets[0].id, 'whatsapp');
  assert.ok(targets[0].href.startsWith('https://wa.me/?text='));
  assert.ok(
    targets[0].href.includes(encodeURIComponent('utm_source%3Dwhatsapp')) ||
      targets[0].href.includes('utm_source%253Dwhatsapp') ||
      decodeURIComponent(targets[0].href).includes('utm_source=whatsapp'),
  );
});

test('every link target carries pre-filled text and a tagged URL', () => {
  const targets = buildShareTargets({ url: SCENE_URL, text: 'Hello world' });
  for (const target of targets) {
    if (target.kind !== 'link') continue;
    const decoded = decodeURIComponent(target.href);
    assert.ok(decoded.includes('Hello world'), `${target.id} text`);
    assert.ok(decoded.includes('utm_medium=share'), `${target.id} utm`);
  }
});

test('the copy target has no href (it uses the clipboard path)', () => {
  const targets = buildShareTargets({ url: SCENE_URL });
  const copy = targets.find((entry) => entry.id === 'copy');
  assert.equal(copy.kind, 'copy');
  assert.equal(copy.href, null);
});

test('defaultShareText mentions the scene label when given', () => {
  assert.ok(defaultShareText().includes("God's Eye View"));
  assert.ok(
    defaultShareText({ sceneLabel: 'the Bay of Bengal' }).includes(
      'the Bay of Bengal',
    ),
  );
});
