import assert from 'node:assert/strict';
import test from 'node:test';
import { NEAREST_PANO_REACH, preferPano } from './pano.js';

/** A candidate `metres` away, a 360° photo when `isPano`. */
const entry = (id, metres, isPano) => ({
  photo: { id, isPano },
  metres,
});
const ids = (entries) => entries.map(({ photo }) => photo.id);

test('a pano within twice the nearest flat distance narrows the pool to panos', () => {
  const entries = [
    entry('flat', 10, false),
    entry('pano', 19, true),
    entry('flat-far', 30, false),
  ];
  assert.deepEqual(ids(preferPano(entries)), ['pano']);
  assert.equal(NEAREST_PANO_REACH, 2);
});

test('a pano exactly at twice the nearest flat distance still wins', () => {
  const entries = [entry('flat', 10, false), entry('pano', 20, true)];
  assert.deepEqual(ids(preferPano(entries)), ['pano']);
});

test('a pano past twice the nearest flat distance leaves the pool alone', () => {
  const entries = [
    entry('flat', 10, false),
    entry('pano', 21, true),
    entry('flat-far', 30, false),
  ];
  assert.equal(preferPano(entries), entries, 'the same pool, untouched');
});

test('the bound anchors on the nearest flat, not the nearest candidate', () => {
  // The pano is nearest overall, but the bound is 2× the flat's 9 m:
  // the pano at 19 m is past it, while the pano at 5 m qualifies.
  const entries = [
    entry('pano-near', 5, true),
    entry('flat', 9, false),
    entry('pano-far', 19, true),
  ];
  assert.deepEqual(ids(preferPano(entries)), ['pano-near']);
  // …while a pano inside that same bound does narrow the pool.
  const inside = [
    entry('pano-near', 5, true),
    entry('flat', 9, false),
    entry('pano-mid', 17, true),
  ];
  assert.deepEqual(ids(preferPano(inside)), ['pano-near', 'pano-mid']);
});

test('with no flat photo there is nothing to displace: freshness keeps deciding', () => {
  const entries = [entry('pano-near', 5, true), entry('pano-far', 20, true)];
  assert.equal(preferPano(entries), entries);
});

test('with no pano the pool is untouched, and an empty pool stays empty', () => {
  const entries = [entry('flat', 10, false), entry('flat-far', 30, false)];
  assert.equal(preferPano(entries), entries);
  assert.deepEqual(preferPano([]), []);
});

test('entries without a finite distance never anchor the bound or qualify', () => {
  const entries = [
    entry('flat-lost', Infinity, false),
    entry('flat', 10, false),
    entry('pano-lost', NaN, true),
  ];
  assert.equal(
    preferPano(entries),
    entries,
    'no finite pano within 2× of 10 m: pool untouched',
  );
  // Only non-finite entries: nothing to anchor on, pool untouched.
  const lost = [entry('flat-lost', Infinity, false)];
  assert.equal(preferPano(lost), lost);
});

test('only a real boolean pano counts: a truthy impostor is a flat photo', () => {
  const entries = [
    entry('flat', 10, false),
    { photo: { id: 'impostor', isPano: 'yes' }, metres: 12 },
  ];
  assert.equal(preferPano(entries), entries);
});

test('a flat photo at zero distance admits only a pano at zero distance', () => {
  const entries = [
    entry('flat', 0, false),
    entry('pano-there', 0, true),
    entry('pano-step', 0.5, true),
  ];
  assert.deepEqual(ids(preferPano(entries)), ['pano-there']);
});
