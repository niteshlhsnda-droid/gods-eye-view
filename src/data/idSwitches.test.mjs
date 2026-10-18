import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIdSwitches,
  encodeIdSwitches,
  decodeIdSwitches,
  patchRequestedIdSwitches,
} from './idSwitches.js';

// Tests-only behavior pins for src/data/idSwitches.js (Cycle 17, grok lane).
// These capture the module's CURRENT behavior exactly, including quirks.
// Quirk findings are collected in FOLLOW-UPS at the bottom; production code
// must remain byte-identical.

test('normalize sorts fields lexicographically and preserves on/off flags', () => {
  assert.equal(normalizeIdSwitches('b-1*a-0'), 'a-0*b-1');
  assert.equal(normalizeIdSwitches('a-1'), 'a-1');
  assert.equal(
    normalizeIdSwitches('zebra-0*apple-1*mango-1'),
    'apple-1*mango-1*zebra-0',
  );
});

test('normalize returns empty string for empty string input', () => {
  assert.equal(normalizeIdSwitches(''), '');
});

test('normalize returns null for non-string input', () => {
  assert.equal(normalizeIdSwitches(undefined), null);
  assert.equal(normalizeIdSwitches(null), null);
  assert.equal(normalizeIdSwitches(123), null);
  assert.equal(normalizeIdSwitches(['a-1']), null);
  assert.equal(normalizeIdSwitches({}), null);
});

test('normalize rejects strings longer than 256 characters', () => {
  const id = 'a'.repeat(200);
  const short = `${id}-1`; // 202 chars: accepted
  assert.ok(short.length <= 256);
  assert.equal(normalizeIdSwitches(short), short);
  const long = `${'b'.repeat(128)}-1*${'c'.repeat(128)}-1`; // 261 chars
  assert.ok(long.length > 256);
  assert.equal(normalizeIdSwitches(long), null);
});

test('normalize rejects malformed fields', () => {
  for (const bad of [
    'a', // missing flag
    'a-2', // flag must be 0 or 1
    'A-1', // must start lowercase
    '1a-1', // must start with a letter
    'a-1*', // trailing separator leaves an empty field
    '*a-1', // leading separator leaves an empty field
    'a-1**b-0', // empty field between separators
    'a-1*b', // second field malformed
    'a-1*a-0', // duplicate id with different flags
    'a-1*a-1', // duplicate id with same flags
    '-1', // missing id
    'a-', // missing flag
  ]) {
    assert.equal(
      normalizeIdSwitches(bad),
      null,
      `expected null for ${JSON.stringify(bad)}`,
    );
  }
});

test('normalize rejects ids present in reservedIds', () => {
  assert.equal(normalizeIdSwitches('a-1*b-0', ['a']), null);
  assert.equal(normalizeIdSwitches('a-1*b-0', ['b']), null);
  assert.equal(normalizeIdSwitches('a-1*b-0', ['c']), 'a-1*b-0');
  assert.equal(normalizeIdSwitches('a-1', []), 'a-1');
});

test('normalize accepts hyphenated ids and trailing-hyphen ids as-is', () => {
  // FOLLOW-UP: 'a--1' parses as id "a-" — ids may end with a hyphen.
  assert.equal(normalizeIdSwitches('my-switch-1'), 'my-switch-1');
  assert.equal(normalizeIdSwitches('a--1'), 'a--1');
});

test('normalize rejects multi-character flags outright', () => {
  // The ENTRY regex requires exactly one flag char at the end, so "a-01"
  // and "a-10" do not parse as id-with-digit — the whole string is rejected.
  assert.equal(normalizeIdSwitches('a-01'), null);
  assert.equal(normalizeIdSwitches('a-10'), null);
});

test('encode sorts, normalizes flags, and round-trips through decode', () => {
  assert.equal(
    encodeIdSwitches([
      ['b', true],
      ['a', false],
    ]),
    'a-0*b-1',
  );
  assert.equal(encodeIdSwitches([]), '');
  const round = encodeIdSwitches([
    ['one', true],
    ['two', false],
  ]);
  assert.deepEqual(
    decodeIdSwitches(round),
    new Map([
      ['one', true],
      ['two', false],
    ]),
  );
});

test('encode only treats boolean true as on; other truthy values encode off', () => {
  // FOLLOW-UP: strict `on === true` means 1 / "yes" silently encode as off.
  assert.equal(encodeIdSwitches([['a', 1]]), 'a-0');
  assert.equal(encodeIdSwitches([['a', 'yes']]), 'a-0');
  assert.equal(encodeIdSwitches([['a', undefined]]), 'a-0');
});

test('encode throws RangeError before validating ids when over the limit', () => {
  const entries = [];
  for (let i = 0; i < 60; i++) entries.push([`switch-${i}`, true]);
  assert.throws(() => encodeIdSwitches(entries), RangeError);
  // FOLLOW-UP: length is checked first — an over-long payload with an invalid
  // id throws RangeError, never the TypeError the invalid id would produce.
  assert.throws(() => encodeIdSwitches([['A', true], ...entries]), RangeError);
});

test('encode throws TypeError for ids that cannot normalize', () => {
  assert.throws(() => encodeIdSwitches([['A', true]]), TypeError);
  assert.throws(
    () =>
      encodeIdSwitches([
        ['a', true],
        ['a', false],
      ]),
    TypeError,
  );
});

test('decode returns a Map of id to boolean', () => {
  assert.deepEqual(
    decodeIdSwitches('a-0*b-1'),
    new Map([
      ['a', false],
      ['b', true],
    ]),
  );
});

test('decode of empty string is an empty Map', () => {
  assert.deepEqual(decodeIdSwitches(''), new Map());
});

test('decode of malformed input silently returns an empty Map', () => {
  // FOLLOW-UP: invalid input decodes to an empty Map instead of throwing or
  // returning null — callers cannot distinguish "no switches" from "bad data".
  assert.deepEqual(decodeIdSwitches('garbage'), new Map());
  assert.deepEqual(decodeIdSwitches('A-1'), new Map());
  assert.deepEqual(decodeIdSwitches(null), new Map());
});

test('patchRequestedIdSwitches applies requested ids from the applied set', () => {
  const out = patchRequestedIdSwitches('a-1*b-0', 'a-0*b-0*c-1', { a: true });
  // "a" was requested, so it takes the applied value (off); "b" keeps its
  // previous value; "c" was never in previous, so it is not added.
  assert.equal(out, 'a-0*b-0');
});

test('patchRequestedIdSwitches returns undefined when nothing was requested', () => {
  assert.equal(patchRequestedIdSwitches('a-1*b-0', 'a-0*b-1', {}), undefined);
  assert.equal(
    patchRequestedIdSwitches('a-1*b-0', 'a-0*b-1', { c: true }),
    undefined,
  );
});

test('patchRequestedIdSwitches ignores non-boolean requested values', () => {
  assert.equal(patchRequestedIdSwitches('a-1', 'a-0', { a: 1 }), undefined);
  assert.equal(patchRequestedIdSwitches('a-1', 'a-0', { a: 'yes' }), undefined);
});

test('patchRequestedIdSwitches drops previous ids absent from applied', () => {
  // FOLLOW-UP: ids in previous but missing from applied are silently dropped
  // from the result, even when requested.
  assert.equal(
    patchRequestedIdSwitches('a-1*z-1', 'a-0', { a: true, z: true }),
    'a-0',
  );
});

test('patchRequestedIdSwitches tolerates unparseable previous strings', () => {
  // FOLLOW-UP: a malformed previous string decodes to an empty Map, so the
  // result contains only requested ids present in applied.
  assert.equal(
    patchRequestedIdSwitches('not-valid', 'a-1', { a: true }),
    'a-1',
  );
});

test('patchRequestedIdSwitches with null requested throws a TypeError', () => {
  // FOLLOW-UP: Object.hasOwn on a nullish requested throws instead of
  // behaving like an empty request set.
  assert.throws(() => patchRequestedIdSwitches('a-1', 'a-0', null), TypeError);
});
