import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelCameraArrival,
  ownCameraArrival,
} from './cameraArrival.js';

test('release removes the registration so a later cancel is a no-op', () => {
  const viewer = {};
  let calls = 0;
  const release = ownCameraArrival(viewer, () => {
    calls += 1;
  });
  release();
  cancelCameraArrival(viewer);
  assert.equal(calls, 0);
});

test('release never invokes the cancel callback itself', () => {
  const viewer = {};
  let calls = 0;
  const release = ownCameraArrival(viewer, () => {
    calls += 1;
  });
  release();
  assert.equal(calls, 0);
});

test('release is idempotent: a second release is a silent no-op', () => {
  const viewer = {};
  let calls = 0;
  const release = ownCameraArrival(viewer, () => {
    calls += 1;
  });
  release();
  assert.doesNotThrow(() => release());
  cancelCameraArrival(viewer);
  assert.equal(calls, 0);
});

test('a second owner cancels the previous owner exactly once', () => {
  const viewer = {};
  let firstCalls = 0;
  let secondCalls = 0;
  ownCameraArrival(viewer, () => {
    firstCalls += 1;
  });
  ownCameraArrival(viewer, () => {
    secondCalls += 1;
  });
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);
  cancelCameraArrival(viewer);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
});

test('releasing a superseded owner does not disturb the current owner', () => {
  const viewer = {};
  let secondCalls = 0;
  const staleRelease = ownCameraArrival(viewer, () => {});
  ownCameraArrival(viewer, () => {
    secondCalls += 1;
  });
  staleRelease();
  cancelCameraArrival(viewer);
  assert.equal(secondCalls, 1);
});

test('cancel on a viewer with no registration does not throw', () => {
  assert.doesNotThrow(() => cancelCameraArrival({}));
});

test('cancel with a nullish viewer does not throw', () => {
  assert.doesNotThrow(() => cancelCameraArrival(null));
  assert.doesNotThrow(() => cancelCameraArrival(undefined));
});

test('cancel does not clear the registration: a second cancel re-invokes', () => {
  // Pinned current behavior, not endorsed: callers that need
  // cancel-once semantics must guard idempotence in the callback itself
  // (cameraGroundGuard's stop() does this with its `done` flag).
  const viewer = {};
  let calls = 0;
  ownCameraArrival(viewer, () => {
    calls += 1;
  });
  cancelCameraArrival(viewer);
  cancelCameraArrival(viewer);
  assert.equal(calls, 2);
});

test('a cancel callback that releases its own registration leaves no stale entry', () => {
  // Mirrors cameraGroundGuard's stop(), which calls release() itself:
  // after the cancel, the entry must be gone, not re-invokable.
  const viewer = {};
  let calls = 0;
  let release = () => {};
  release = ownCameraArrival(viewer, () => {
    calls += 1;
    release();
  });
  cancelCameraArrival(viewer);
  assert.equal(calls, 1);
  cancelCameraArrival(viewer);
  assert.equal(calls, 1);
});

test('owning with an undefined cancel registers without throwing on cancel', () => {
  const viewer = {};
  const release = ownCameraArrival(viewer, undefined);
  assert.doesNotThrow(() => cancelCameraArrival(viewer));
  assert.doesNotThrow(() => release());
});

test('owning with a non-object viewer throws (WeakMap key)', () => {
  // Pinned current behavior: callers must pass an object viewer.
  assert.throws(() => ownCameraArrival(null, () => {}), TypeError);
  assert.throws(() => ownCameraArrival('viewer', () => {}), TypeError);
});

test('registrations are isolated per viewer', () => {
  const first = {};
  const second = {};
  let firstCalls = 0;
  let secondCalls = 0;
  ownCameraArrival(first, () => {
    firstCalls += 1;
  });
  ownCameraArrival(second, () => {
    secondCalls += 1;
  });
  cancelCameraArrival(first);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);
  cancelCameraArrival(second);
  assert.equal(secondCalls, 1);
});

test('re-owning after release registers only the new cancel', () => {
  const viewer = {};
  let firstCalls = 0;
  let secondCalls = 0;
  const release = ownCameraArrival(viewer, () => {
    firstCalls += 1;
  });
  release();
  ownCameraArrival(viewer, () => {
    secondCalls += 1;
  });
  cancelCameraArrival(viewer);
  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 1);
});
