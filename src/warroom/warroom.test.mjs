import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnnotation,
  validateAnnotation,
  upsertAnnotation,
  removeAnnotation,
  indexAnnotations,
  ANNOTATION_KINDS,
} from './annotations.js';
import { WARROOM_PATH, ANNOTATIONS_ARRAY, WARROOM_EVENTS } from './protocol.js';
import { livekitRoomConfig, livekitReadiness } from './livekit.js';

describe('annotations model', () => {
  it('creates valid annotations with defaults', () => {
    const a = createAnnotation({ lat: 25.6, lon: 85.1, text: 'Watch this' });
    assert.equal(a.kind, 'pin');
    assert.equal(a.author, 'anonymous');
    assert.ok(a.id.startsWith('ann-'));
    assert.ok(ANNOTATION_KINDS.includes('note'));
  });

  it('rejects invalid annotations', () => {
    assert.throws(() => createAnnotation({ lat: 999, lon: 0 }), TypeError);
    assert.throws(() => createAnnotation({ lat: 0, lon: 0, kind: 'nuke' }), TypeError);
    assert.throws(() => upsertAnnotation([], { lat: 0, lon: 0, kind: 'nope' }), TypeError);
  });

  it('upserts by id and removes by id immutably', () => {
    const a = createAnnotation({ id: 'x', lat: 1, lon: 2 });
    const b = createAnnotation({ id: 'x', lat: 3, lon: 4, text: 'moved' });
    const list = upsertAnnotation(upsertAnnotation([], a), b);
    assert.equal(list.length, 1);
    assert.equal(list[0].text, 'moved');
    assert.equal(removeAnnotation(list, 'x').length, 0);
    assert.equal(list.length, 1); // original untouched
  });

  it('indexes by id', () => {
    const a = createAnnotation({ id: 'k1', lat: 1, lon: 2 });
    const index = indexAnnotations([a]);
    assert.equal(index.get('k1'), a);
  });
});

describe('war-room protocol constants', () => {
  it('exports a stable wire contract', () => {
    assert.equal(WARROOM_PATH, '/warroom');
    assert.equal(ANNOTATIONS_ARRAY, 'annotations');
    assert.equal(WARROOM_EVENTS.yjsUpdate, 'warroom:yjs-update');
  });
});

describe('livekit config (TIER 2)', () => {
  it('reports disabled without a server URL and never fakes a room', () => {
    const config = livekitRoomConfig({ env: {} });
    assert.equal(config.enabled, false);
    const readiness = livekitReadiness(config);
    assert.equal(readiness.ready, false);
    assert.match(readiness.reason, /LIVEKIT_URL/);
  });

  it('reports ready only with a URL, still requiring server-side tokens', () => {
    const config = livekitRoomConfig({ env: { LIVEKIT_URL: 'wss://live.example.com' } });
    assert.equal(config.enabled, true);
    assert.match(livekitReadiness(config).reason, /token endpoint/);
  });
});
