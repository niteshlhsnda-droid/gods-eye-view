import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnavailableCapability, sourceResponseError } from './capability.js';

// `capability.js` had zero dedicated tests; it is the shared "permanent
// capability miss / no background retry" gate used by the Overpass,
// annotation, ALPR, installations, traffic, and request layers. These pins
// capture its exact coercion and cooldown semantics as current behaviour —
// including the surprising ones, which are annotated, NOT fixed.

const headers = (value) => ({
  headers: { get: (name) => (name === 'retry-after' ? value : null) },
});

test('isUnavailableCapability is false for missing and empty values', () => {
  assert.equal(isUnavailableCapability(null), false);
  assert.equal(isUnavailableCapability(undefined), false);
  assert.equal(isUnavailableCapability({}), false);
});

test('isUnavailableCapability is false for non-object values', () => {
  assert.equal(isUnavailableCapability('OVERPASS_NOT_CONFIGURED'), false);
  assert.equal(isUnavailableCapability(0), false);
  assert.equal(isUnavailableCapability(true), false);
  assert.equal(isUnavailableCapability([]), false);
});

test('isUnavailableCapability matches the exact capability-miss code', () => {
  assert.equal(
    isUnavailableCapability({ code: 'OVERPASS_NOT_CONFIGURED' }),
    true,
  );
});

test('isUnavailableCapability code match is case- and whitespace-sensitive', () => {
  assert.equal(
    isUnavailableCapability({ code: 'overpass_not_configured' }),
    false,
  );
  assert.equal(
    isUnavailableCapability({ code: ' OVERPASS_NOT_CONFIGURED' }),
    false,
  );
  assert.equal(
    isUnavailableCapability({ code: 'OVERPASS_NOT_CONFIGURED ' }),
    false,
  );
  assert.equal(isUnavailableCapability({ code: 'OVERPASS' }), false);
});

test('isUnavailableCapability requires unavailable to be exactly true', () => {
  assert.equal(isUnavailableCapability({ unavailable: true }), true);
  assert.equal(isUnavailableCapability({ unavailable: 1 }), false);
  assert.equal(isUnavailableCapability({ unavailable: 'true' }), false);
  assert.equal(isUnavailableCapability({ unavailable: {} }), false);
  assert.equal(isUnavailableCapability({ unavailable: false }), false);
});

test('isUnavailableCapability requires retryable to be exactly false', () => {
  assert.equal(isUnavailableCapability({ retryable: false }), true);
  assert.equal(isUnavailableCapability({ retryable: 0 }), false);
  assert.equal(isUnavailableCapability({ retryable: null }), false);
  assert.equal(isUnavailableCapability({ retryable: undefined }), false);
  assert.equal(isUnavailableCapability({ retryable: 'false' }), false);
});

test('isUnavailableCapability is an OR over the three signals', () => {
  assert.equal(
    isUnavailableCapability({
      code: 'OVERPASS_NOT_CONFIGURED',
      unavailable: false,
      retryable: true,
    }),
    true,
  );
  assert.equal(
    isUnavailableCapability({
      code: 'SOMETHING_ELSE',
      unavailable: true,
      retryable: true,
    }),
    true,
  );
  assert.equal(
    isUnavailableCapability({
      code: 'SOMETHING_ELSE',
      unavailable: false,
      retryable: true,
    }),
    false,
  );
});

test('sourceResponseError returns a plain Error with defaults', () => {
  const error = sourceResponseError(undefined, undefined, 'upstream failed');
  assert.equal(error instanceof Error, true);
  assert.equal(error.name, 'Error');
  assert.equal(error.message, 'upstream failed');
  assert.equal(error.code, undefined);
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 0);
});

test('sourceResponseError preserves an undefined or empty message as empty', () => {
  assert.equal(sourceResponseError({}, undefined, undefined).message, '');
  assert.equal(sourceResponseError({}, undefined, '').message, '');
});

test('sourceResponseError copies code verbatim, including falsy codes', () => {
  assert.equal(sourceResponseError({ code: 'X' }, undefined, 'm').code, 'X');
  assert.equal(sourceResponseError({ code: 0 }, undefined, 'm').code, 0);
  assert.equal(
    sourceResponseError({ code: false }, undefined, 'm').code,
    false,
  );
  assert.equal(sourceResponseError({ code: null }, undefined, 'm').code, null);
});

test('sourceResponseError treats only retryable:false as non-retryable', () => {
  // Surprising but pinned: 0 / null / 'no' all mean retryable here,
  // because the check is `!== false`, not truthiness.
  for (const retryable of [undefined, true, 0, null, '', 'no', 1]) {
    assert.equal(
      sourceResponseError({ retryable }, undefined, 'm').retryable,
      true,
      `retryable=${String(retryable)}`,
    );
  }
  assert.equal(
    sourceResponseError({ retryable: false }, undefined, 'm').retryable,
    false,
  );
});

test('sourceResponseError takes the larger of body and header cooldowns', () => {
  assert.equal(
    sourceResponseError({ retryAfterMs: 5000 }, headers('2'), 'm').retryAfterMs,
    5000,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: 1000 }, headers('2'), 'm').retryAfterMs,
    2000,
  );
  assert.equal(sourceResponseError({}, headers('2'), 'm').retryAfterMs, 2000);
  assert.equal(
    sourceResponseError({ retryAfterMs: 5000 }, undefined, 'm').retryAfterMs,
    5000,
  );
});

test('sourceResponseError converts header seconds to ms, including fractions', () => {
  assert.equal(sourceResponseError({}, headers('1.5'), 'm').retryAfterMs, 1500);
  assert.equal(sourceResponseError({}, headers('0'), 'm').retryAfterMs, 0);
  // Number() trims whitespace and parses exponents.
  assert.equal(sourceResponseError({}, headers(' 2 '), 'm').retryAfterMs, 2000);
  assert.equal(
    sourceResponseError({}, headers('2e3'), 'm').retryAfterMs,
    2000000,
  );
});

test('sourceResponseError ignores a missing, null, or header-less response', () => {
  assert.equal(sourceResponseError({}, undefined, 'm').retryAfterMs, 0);
  assert.equal(sourceResponseError({}, null, 'm').retryAfterMs, 0);
  assert.equal(sourceResponseError({}, {}, 'm').retryAfterMs, 0);
  assert.equal(sourceResponseError({}, headers(null), 'm').retryAfterMs, 0);
  assert.equal(
    sourceResponseError({}, headers(undefined), 'm').retryAfterMs,
    0,
  );
});

test('sourceResponseError ignores non-numeric header values', () => {
  assert.equal(sourceResponseError({}, headers('abc'), 'm').retryAfterMs, 0);
  assert.equal(sourceResponseError({}, headers(''), 'm').retryAfterMs, 0);
  // A multi-value header ('120, 60') is not parsed as two values.
  assert.equal(
    sourceResponseError({}, headers('120, 60'), 'm').retryAfterMs,
    0,
  );
});

test('sourceResponseError ignores a non-finite header but keeps a body Infinity', () => {
  // Asymmetry pinned as current behaviour: the header side is guarded by
  // Number.isFinite, the body side is not.
  assert.equal(
    sourceResponseError({}, headers('Infinity'), 'm').retryAfterMs,
    0,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: Infinity }, undefined, 'm')
      .retryAfterMs,
    Infinity,
  );
});

test('sourceResponseError clamps a lone negative header to zero', () => {
  assert.equal(sourceResponseError({}, headers('-3'), 'm').retryAfterMs, 0);
});

test('sourceResponseError can return a NEGATIVE cooldown when both sides are negative', () => {
  // Surprising but pinned: Math.max(-100, -3000) is -100, and nothing
  // floors the result at zero. A lone negative body is masked by the
  // implicit 0 on the header side, so this only escapes with a negative
  // header too.
  assert.equal(
    sourceResponseError({ retryAfterMs: -100 }, headers('-3'), 'm')
      .retryAfterMs,
    -100,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: -100 }, undefined, 'm').retryAfterMs,
    0,
  );
});

test('sourceResponseError coerces body retryAfterMs with Number()', () => {
  assert.equal(
    sourceResponseError({ retryAfterMs: '2500' }, undefined, 'm').retryAfterMs,
    2500,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: true }, undefined, 'm').retryAfterMs,
    1,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: false }, undefined, 'm').retryAfterMs,
    0,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: '' }, undefined, 'm').retryAfterMs,
    0,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: 'abc' }, undefined, 'm').retryAfterMs,
    0,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: NaN }, undefined, 'm').retryAfterMs,
    0,
  );
  assert.equal(
    sourceResponseError({ retryAfterMs: null }, undefined, 'm').retryAfterMs,
    0,
  );
});

test('sourceResponseError does not copy extra body or response fields', () => {
  const error = sourceResponseError(
    { code: 'X', detail: 'upstream detail', retryAfterMs: 5 },
    { status: 503, headers: { get: () => null } },
    'm',
  );
  assert.equal(error.detail, undefined);
  assert.equal(error.status, undefined);
});

test('sourceResponseError does not mutate its body argument', () => {
  const body = { code: 'X', retryAfterMs: 7 };
  sourceResponseError(body, headers('2'), 'm');
  assert.deepEqual(body, { code: 'X', retryAfterMs: 7 });
});

test('sourceResponseError tolerates a non-object body', () => {
  for (const body of ['oops', 5, ['x'], true]) {
    const error = sourceResponseError(body, undefined, 'm');
    assert.equal(error.code, undefined);
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 0);
  }
});

test('sourceResponseError returns an independent Error per call', () => {
  const first = sourceResponseError({ code: 'A' }, undefined, 'a');
  const second = sourceResponseError({ code: 'B' }, undefined, 'b');
  assert.notEqual(first, second);
  first.code = 'CHANGED';
  assert.equal(second.code, 'B');
});
