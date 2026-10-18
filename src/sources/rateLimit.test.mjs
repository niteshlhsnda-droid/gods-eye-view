import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRateLimiter } from './rateLimit.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('per-key cap admits up to max then denies the same key', () => {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 2 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  assert.equal(allow('a'), false);
});

test('per-key caps are isolated: one exhausted key does not block another', () => {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  assert.equal(allow('b'), true);
  assert.equal(allow('b'), false);
});

test('globalMax caps admissions across keys, not per key', () => {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 10, globalMax: 3 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('b'), true);
  assert.equal(allow('c'), false);
  assert.equal(allow('a'), false);
});

test('a per-key denial does not consume a global slot', () => {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 1, globalMax: 2 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  // If the denied second call for 'a' had consumed a global slot, the
  // global budget (2) would be spent and 'b' would be denied.
  assert.equal(allow('b'), true);
  assert.equal(allow('c'), false);
});

test('an omitted globalMax imposes no aggregate cap', () => {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 1 });
  for (let i = 0; i < 50; i += 1) {
    assert.equal(allow(`key-${i}`), true);
  }
});

test('a globalMax of 0 disables the global backstop (falsy check)', () => {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 1, globalMax: 0 });
  for (let i = 0; i < 50; i += 1) {
    assert.equal(allow(`key-${i}`), true);
  }
});

test('window expiry frees a per-key slot', async () => {
  const allow = makeRateLimiter({ windowMs: 30, max: 1 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  await sleep(80);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
});

test('window expiry frees the global budget', async () => {
  const allow = makeRateLimiter({ windowMs: 30, max: 10, globalMax: 1 });
  assert.equal(allow('a'), true);
  assert.equal(allow('b'), false);
  await sleep(80);
  assert.equal(allow('b'), true);
  assert.equal(allow('c'), false);
});

test('a denied attempt does not extend the window', async () => {
  const allow = makeRateLimiter({ windowMs: 40, max: 1 });
  assert.equal(allow('a'), true);
  await sleep(10);
  assert.equal(allow('a'), false);
  // The denial at ~10ms must not push a new timestamp: the slot frees
  // ~40ms after the original admission, not ~40ms after the denial.
  await sleep(80);
  assert.equal(allow('a'), true);
});

test('independent limiters do not share state', () => {
  const first = makeRateLimiter({ windowMs: 60_000, max: 1 });
  const second = makeRateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(first('same-key'), true);
  assert.equal(second('same-key'), true);
  assert.equal(first('same-key'), false);
  assert.equal(second('same-key'), false);
});

test('the hard key cap evicts without denying fresh keys', () => {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 1 });
  for (let i = 0; i < 2001; i += 1) {
    assert.equal(allow(`key-${i}`), true);
  }
});

test('a max of 0 denies every call, including the first', () => {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 0 });
  assert.equal(allow('a'), false);
  assert.equal(allow('b'), false);
});
