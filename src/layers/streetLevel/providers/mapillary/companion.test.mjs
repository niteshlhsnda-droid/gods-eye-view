import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapillaryProvider } from './index.js';
import {
  NEAREST_COMPANION_REACH,
  preferCompanion,
  sequenceIdOf,
} from './policy.js';

test('sequenceIdOf reads the Graph API string id, or null without one', () => {
  assert.equal(sequenceIdOf({ sequence: 'seq-1' }), 'seq-1');
  assert.equal(sequenceIdOf({ sequence: { id: 'seq-2' } }), 'seq-2');
  assert.equal(sequenceIdOf({ sequence: 123 }), '123');
  assert.equal(sequenceIdOf({}), null);
  assert.equal(sequenceIdOf({ sequence: '' }), null);
  assert.equal(sequenceIdOf({ sequence: '   ' }), null);
  assert.equal(sequenceIdOf({ sequence: null }), null);
  assert.equal(sequenceIdOf({ sequence: {} }), null);
  assert.equal(sequenceIdOf(null), null);
});

test('preferCompanion picks nothing from an empty or unplaced set', () => {
  assert.equal(preferCompanion([]), undefined);
  assert.equal(
    preferCompanion([
      { sequenceId: 'a', metres: Infinity },
      { sequenceId: 'a', metres: Number.NaN },
    ]),
    undefined,
  );
});

test('preferCompanion keeps the nearest shot when it already has company', () => {
  const entries = [
    { sequenceId: 'a', metres: 5 },
    { sequenceId: 'a', metres: 9 },
    { sequenceId: 'b', metres: 3 },
  ];
  // The 3 m shot is lone; the nearest companion-bearing entry is the 5 m one.
  assert.equal(preferCompanion(entries), entries[0]);
  const paired = [
    { sequenceId: 'a', metres: 3 },
    { sequenceId: 'a', metres: 9 },
    { sequenceId: 'b', metres: 5 },
  ];
  assert.equal(preferCompanion(paired), paired[0]);
});

test('preferCompanion passes over a lone nearest shot for company nearby', () => {
  const entries = [
    { sequenceId: 'lone', metres: 5 },
    { sequenceId: 'run', metres: 9 },
    { sequenceId: 'run', metres: 11 },
  ];
  assert.equal(preferCompanion(entries), entries[1]);
});

test('preferCompanion keeps the lone shot when company is past the reach', () => {
  assert.equal(NEAREST_COMPANION_REACH, 2);
  const entries = [
    { sequenceId: 'lone', metres: 5 },
    { sequenceId: 'run', metres: 11 },
    { sequenceId: 'run', metres: 12 },
  ];
  assert.equal(preferCompanion(entries), entries[0]);
  // Exactly at twice the distance still counts as nearby.
  const atReach = [
    { sequenceId: 'lone', metres: 5 },
    { sequenceId: 'run', metres: 10 },
    { sequenceId: 'run', metres: 12 },
  ];
  assert.equal(preferCompanion(atReach), atReach[1]);
});

test('preferCompanion keeps the lone shot at zero metres', () => {
  const entries = [
    { sequenceId: 'lone', metres: 0 },
    { sequenceId: 'run', metres: 5 },
    { sequenceId: 'run', metres: 6 },
  ];
  assert.equal(preferCompanion(entries), entries[0]);
});

test('preferCompanion keeps the nearest shot when every shot is lone', () => {
  const entries = [
    { sequenceId: 'a', metres: 5 },
    { sequenceId: 'b', metres: 6 },
    { sequenceId: 'c', metres: 7 },
  ];
  assert.equal(preferCompanion(entries), entries[0]);
});

test('preferCompanion never counts a missing sequence id as company', () => {
  const entries = [
    { sequenceId: null, metres: 5 },
    { sequenceId: null, metres: 6 },
    { sequenceId: 'run', metres: 30 },
    { sequenceId: 'run', metres: 31 },
  ];
  // The two id-less shots look like a pair but prove nothing; the real
  // pair is past twice the nearest distance, so the nearest shot wins.
  assert.equal(preferCompanion(entries), entries[0]);
});

function fakeSource({ nearest = [] } = {}) {
  return {
    hasToken: () => true,
    getStatus: async () => ({ configured: true }),
    getTile: async () => new Uint8Array(0),
    getSequenceImages: async () => [],
    nearestImages: async () => nearest,
  };
}

function fakeContext(filter = { pano: 'all', sinceMs: null }) {
  return {
    services: {},
    getFilter: () => filter,
    isActive: () => true,
    notify: () => {},
    actions: { openImage: () => {}, reportError: () => {} },
  };
}

/** A Mapillary record ~`metres` east of (lon 2, lat 1). */
function at(id, lon, sequence) {
  return {
    id,
    is_pano: false,
    captured_at: 10,
    sequence,
    geometry: { type: 'Point', coordinates: [lon, 1] },
  };
}

test('nearestImage passes over a lone nearest shot for a paired one nearby', async () => {
  const source = fakeSource({
    nearest: [
      at('lone', 2.00005, 'seq-lone'), // ~5 m east, alone in its sequence
      at('pair-near', 2.00009, 'seq-run'), // ~10 m east, with company
      at('pair-far', 2.00011, 'seq-run'),
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'pair-near');
});

test('nearestImage keeps the nearest shot when it already has company', async () => {
  const source = fakeSource({
    nearest: [
      at('pair-near', 2.00005, 'seq-run'),
      at('pair-far', 2.0001, 'seq-run'),
      at('lone', 2.0002, 'seq-lone'),
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'pair-near');
});

test('nearestImage keeps the lone shot when the pair is too far away', async () => {
  const source = fakeSource({
    nearest: [
      at('lone', 2.00005, 'seq-lone'), // ~5 m east
      at('pair-near', 2.0004, 'seq-run'), // ~45 m east, past twice the distance
      at('pair-far', 2.00041, 'seq-run'),
    ],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'lone');
});

test('nearestImage applies the imagery filter before looking for company', async () => {
  const pair = [
    { ...at('pano-near', 2.00009, 'seq-run'), is_pano: true },
    { ...at('pano-far', 2.00011, 'seq-run'), is_pano: true },
  ];
  const source = fakeSource({
    nearest: [at('flat-lone', 2.00005, 'seq-lone'), ...pair],
  });
  // Flat-only: the pano pair is not a candidate, so the lone flat wins.
  const flat = createMapillaryProvider({ source }).create(
    fakeContext({ pano: 'flat', sinceMs: null }),
  );
  assert.equal(await flat.nearestImage({ lat: 1, lon: 2 }), 'flat-lone');
  // Unfiltered: the pano pair wins, as before.
  const all = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await all.nearestImage({ lat: 1, lon: 2 }), 'pano-near');
});

test('nearestImage still falls back to a position-less record', async () => {
  const source = fakeSource({
    nearest: [{ id: 'no-place', is_pano: false, captured_at: 10 }],
  });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), 'no-place');
  const mixed = fakeSource({
    nearest: [
      { id: 'no-place', is_pano: false, captured_at: 10 },
      at('placed', 2.00005, 'seq-lone'),
    ],
  });
  const placed = createMapillaryProvider({ source: mixed }).create(
    fakeContext(),
  );
  assert.equal(await placed.nearestImage({ lat: 1, lon: 2 }), 'placed');
});

test('nearestImage returns null when nothing passes', async () => {
  const source = fakeSource({ nearest: [] });
  const instance = createMapillaryProvider({ source }).create(fakeContext());
  assert.equal(await instance.nearestImage({ lat: 1, lon: 2 }), null);
});
