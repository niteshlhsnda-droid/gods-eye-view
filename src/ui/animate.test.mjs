import test from 'node:test';
import assert from 'node:assert/strict';
import {
  animateElement,
  fadeIn,
  fadeOut,
  prefersReducedMotion,
  __setAnimateForTests,
} from './animate.js';

function fakeElement() {
  const style = {};
  return { style };
}

test('prefersReducedMotion reads matchMedia and never throws', () => {
  assert.equal(
    prefersReducedMotion(() => ({ matches: true })),
    true,
  );
  assert.equal(
    prefersReducedMotion(() => ({ matches: false })),
    false,
  );
  assert.equal(prefersReducedMotion(null), false);
  assert.equal(
    prefersReducedMotion(() => {
      throw new Error('nope');
    }),
    false,
  );
});

test('animation helpers resolve without a DOM target', async () => {
  __setAnimateForTests(undefined);
  await animateElement(null, { opacity: [0, 1] });
  await fadeIn(undefined);
  await fadeOut('#missing-in-node');
});

test('an injected animator receives normalized params', async () => {
  const seen = [];
  __setAnimateForTests((el, params) => {
    seen.push({ el, params });
    return { finished: Promise.resolve() };
  });
  const el = fakeElement();
  await fadeIn(el, { duration: 120 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].el, el);
  assert.equal(seen[0].params.duration, 120);
  assert.deepEqual(seen[0].params.opacity, [0, 1]);
  __setAnimateForTests(undefined);
});

test('a throwing animator falls back instead of rejecting', async () => {
  __setAnimateForTests(() => {
    throw new Error('anime boom');
  });
  // No document in node: asElement(null-style) -> resolves via the early return.
  await fadeIn(fakeElement(), { duration: 5 });
  __setAnimateForTests(undefined);
});
