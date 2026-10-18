import assert from 'node:assert/strict';
import test from 'node:test';
import { NEAREST_COMPANION_REACH, preferCompanion } from './companion.js';

/** A candidate `metres` away, in sequence `seq` (null = no sequence). */
const entry = (id, metres, seq) => ({
  photo: { id, sequenceId: seq },
  metres,
});
const ids = (entries) => entries.map(({ photo }) => photo.id);

test('a lone nearest shot yields to companion-bearing shots within twice its distance', () => {
  const entries = [
    entry('lone', 5, 'seq-lone'),
    entry('pair-near', 9, 'seq-run'),
    // Past the bound itself, but still in the set: it proves the 9 m
    // shot has company.
    entry('pair-far', 11, 'seq-run'),
  ];
  assert.deepEqual(ids(preferCompanion(entries)), ['pair-near']);
  assert.equal(NEAREST_COMPANION_REACH, 2);
});

test('a companion-bearing shot exactly at twice the nearest distance still wins', () => {
  const entries = [
    entry('lone', 5, 'seq-lone'),
    entry('pair-near', 10, 'seq-run'),
    entry('pair-far', 12, 'seq-run'),
  ];
  assert.deepEqual(ids(preferCompanion(entries)), ['pair-near']);
});

test('a companion-bearing shot past twice the nearest distance leaves the pool alone', () => {
  const entries = [
    entry('lone', 5, 'seq-lone'),
    entry('pair-near', 11, 'seq-run'),
    entry('pair-far', 12, 'seq-run'),
  ];
  assert.equal(preferCompanion(entries), entries, 'the same pool, untouched');
});

test('when the nearest shot already has company the pool is untouched', () => {
  // The lone shot is listed first: the check runs on the nearest by
  // distance, not on input order.
  const entries = [
    entry('lone', 5, 'seq-lone'),
    entry('pair-near', 3, 'seq-run'),
    entry('pair-far', 9, 'seq-run'),
  ];
  assert.equal(preferCompanion(entries), entries);
});

test('when every shot is lone the pool is untouched, and an empty pool stays empty', () => {
  const entries = [
    entry('a', 5, 'seq-a'),
    entry('b', 6, 'seq-b'),
    entry('c', 7, 'seq-c'),
  ];
  assert.equal(preferCompanion(entries), entries);
  assert.deepEqual(preferCompanion([]), []);
});

test('a missing or blank sequence id never counts as company', () => {
  const entries = [
    entry('no-id', 5, null),
    entry('blank-id', 6, ''),
    entry('spaces-id', 7, '   '),
    entry('pair-far', 30, 'seq-run'),
    entry('pair-farther', 31, 'seq-run'),
  ];
  // The three id-less shots look like a group but prove nothing; the
  // real pair is past twice the nearest distance, so the pool is alone.
  assert.equal(preferCompanion(entries), entries);
  // …while a real pair within reach still displaces the id-less nearest.
  const withPair = [
    entry('no-id', 5, null),
    entry('blank-id', 6, ''),
    entry('lone', 7, 'seq-lone'),
    entry('pair-near', 9, 'seq-run'),
    entry('pair-far', 9.5, 'seq-run'),
  ];
  assert.deepEqual(ids(preferCompanion(withPair)), [
    'pair-near',
    'pair-far',
  ]);
});

test('a lone nearest shot at zero distance admits only company at zero distance', () => {
  const entries = [
    entry('lone', 0, 'seq-lone'),
    entry('pair-near', 5, 'seq-run'),
    entry('pair-far', 6, 'seq-run'),
  ];
  assert.equal(preferCompanion(entries), entries);
});

test('entries without a finite distance never anchor the bound or qualify', () => {
  const entries = [
    entry('lost', Infinity, 'seq-lost'),
    entry('lone', 10, 'seq-lone'),
    entry('pair-near', 19, 'seq-run'),
    entry('pair-far', 20, 'seq-run'),
  ];
  assert.deepEqual(ids(preferCompanion(entries)), ['pair-near', 'pair-far']);
  // A non-finite entry cannot prove company for a placed one.
  const nanProvesNothing = [
    entry('lone', 5, 'seq-lone'),
    entry('ghost', NaN, 'seq-run'),
    entry('pair-near', 9, 'seq-run'),
  ];
  assert.equal(preferCompanion(nanProvesNothing), nanProvesNothing);
  // Only non-finite entries: nothing to anchor on, pool untouched.
  const lost = [entry('lost', Infinity, 'seq-lost')];
  assert.equal(preferCompanion(lost), lost);
});
