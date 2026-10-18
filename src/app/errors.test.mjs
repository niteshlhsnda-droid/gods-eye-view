import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from './errors.js';

test('falsy values report the generic initialization message', () => {
  assert.equal(describeError(null), 'Unknown initialization error');
  assert.equal(describeError(undefined), 'Unknown initialization error');
  assert.equal(describeError(0), 'Unknown initialization error');
  assert.equal(describeError(''), 'Unknown initialization error');
  assert.equal(describeError(false), 'Unknown initialization error');
  assert.equal(describeError(Number.NaN), 'Unknown initialization error');
  assert.equal(describeError(0n), 'Unknown initialization error');
});

test('Error instances surface the trimmed message', () => {
  assert.equal(describeError(new Error('boom')), 'boom');
  assert.equal(describeError(new Error('  boom  ')), 'boom');
  assert.equal(describeError(new TypeError('nope')), 'nope');
  assert.equal(
    describeError(new AggregateError([new Error('x')], 'many')),
    'many',
  );
});

test('Error instances with blank messages fall back to the error name', () => {
  assert.equal(describeError(new Error('')), 'Error');
  assert.equal(describeError(new Error('   ')), 'Error');
  const named = new Error('   ');
  named.name = 'AbortError';
  assert.equal(describeError(named), 'AbortError');
});

test('Error instances with a blank message and blank name use the last-resort message', () => {
  // current behavior: empty string name is falsy, so the generic name fallback applies
  const e = new Error('   ');
  e.name = '';
  assert.equal(describeError(e), 'Initialization error');
});

test('non-empty strings are returned trimmed', () => {
  assert.equal(describeError('boom'), 'boom');
  assert.equal(describeError('  boom  '), 'boom');
});

test('whitespace-only strings are returned untrimmed as current behavior', () => {
  // current behavior: the string branch requires a non-empty trimmed value,
  // then falls through to String(error) — the raw whitespace is kept
  assert.equal(describeError('   '), '   ');
});

test('objects with a message field surface it trimmed', () => {
  assert.equal(describeError({ message: 'kaput' }), 'kaput');
  assert.equal(describeError({ message: '  kaput  ' }), 'kaput');
  assert.equal(describeError({ message: 500 }), '500');
});

test('objects with an error field surface it when message is absent', () => {
  assert.equal(describeError({ error: 'net fail' }), 'net fail');
});

test('message wins over error when both are present', () => {
  assert.equal(describeError({ message: 'first', error: 'second' }), 'first');
});

test('falsy message/error fields fall back to JSON serialization', () => {
  assert.equal(describeError({ message: 0 }), '{"message":0}');
  assert.equal(
    describeError({ message: '', error: '' }),
    '{"message":"","error":""}',
  );
  assert.equal(describeError({ code: 500 }), '{"code":500}');
  assert.equal(describeError(['a', 'b']), '["a","b"]');
});

test('empty plain objects stringify to the generic object tag', () => {
  // current behavior: '{}' serialization is treated as no information
  assert.equal(describeError({}), '[object Object]');
});

test('circular objects degrade to the generic object tag', () => {
  const circular = {};
  circular.self = circular;
  assert.equal(describeError(circular), '[object Object]');
});

test('null-prototype objects with a message are handled', () => {
  const obj = Object.create(null);
  obj.message = 'bare';
  assert.equal(describeError(obj), 'bare');
});

test('other primitives stringify directly', () => {
  assert.equal(describeError(42), '42');
  assert.equal(describeError(true), 'true');
  assert.equal(describeError(Symbol('x')), 'Symbol(x)');
});

test('the returned message never includes a raw Error name prefix', () => {
  const out = describeError(new Error('plain'));
  assert.ok(!out.startsWith('Error:'));
});
