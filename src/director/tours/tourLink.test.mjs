import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeTourLink,
  decodeTourLink,
  tourShareUrl,
} from './tourLink.js';
import { buildEventTour } from './autoTour.js';
import { validateSceneDocument } from '../document.js';

const project = () =>
  buildEventTour({
    kind: 'earthquake',
    lat: 38.72,
    lon: 70.5,
    mag: 6.3,
    place: 'Khwahan, Afghanistan',
  });

test('tour link round-trips through the hash fragment', () => {
  const original = project();
  const fragment = encodeTourLink(original);
  assert.ok(fragment.startsWith('#tour='));
  const decoded = decodeTourLink(fragment);
  validateSceneDocument(decoded);
  assert.deepEqual(decoded.scenes[0].title, original.scenes[0].title);
  assert.equal(decoded.scenes[0].shots.length, 4);
});

test('decodeTourLink returns null when no tour is present', () => {
  assert.equal(decodeTourLink(''), null);
  assert.equal(decodeTourLink('#lat=10&lon=20'), null);
  assert.equal(decodeTourLink(null), null);
});

test('decodeTourLink rejects malformed payloads', () => {
  assert.throws(() => decodeTourLink('#tour=!!!notbase64!!!'), /malformed|tour/);
  assert.throws(() => decodeTourLink('#tour=e30='), /scenes|invalid/);
});

test('tourShareUrl builds a full shareable URL', () => {
  const url = tourShareUrl(project(), 'https://example.com/globe');
  assert.ok(url.startsWith('https://example.com/globe#tour='));
  assert.throws(() => tourShareUrl(project(), ''), /baseUrl/);
});
