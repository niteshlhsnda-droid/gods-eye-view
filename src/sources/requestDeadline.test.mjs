import test from 'node:test';
import assert from 'node:assert/strict';
import { requestWithDeadline, waitForSignal } from './requestDeadline.js';

const never = () => new Promise(() => {});
const delay = (ms, value) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('requestWithDeadline resolves with the operation value on a live signal', async () => {
  const outer = new AbortController();
  let seen;
  const value = await requestWithDeadline(
    (signal) => {
      seen = signal;
      assert.equal(signal instanceof AbortSignal, true);
      assert.notEqual(signal, outer.signal);
      assert.equal(signal.aborted, false);
      return delay(5, 'road-pack');
    },
    { signal: outer.signal, timeoutMs: 500 },
  );
  assert.equal(value, 'road-pack');
});

test('requestWithDeadline times out a transport that ignores abort', async () => {
  let seen;
  let abortReason;
  const pending = requestWithDeadline(
    (signal) => {
      seen = signal;
      signal.addEventListener(
        'abort',
        () => {
          abortReason = signal.reason;
        },
        { once: true },
      );
      return never();
    },
    { timeoutMs: 20 },
  );
  let caught;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.name, 'TimeoutError');
  assert.equal(caught?.message, 'Request timed out');
  assert.equal(seen.aborted, true);
  assert.equal(abortReason?.name, 'TimeoutError');
});

test('requestWithDeadline keeps the timeout rejection after a late resolve', async () => {
  const pending = requestWithDeadline(() => delay(60, 'too-late'), {
    timeoutMs: 20,
  });
  let caught;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.name, 'TimeoutError');
  // The late resolve must not surface as an unhandled rejection or a
  // second settlement; the timed-out call stays rejected.
  await delay(80);
});

test('requestWithDeadline rejects at once on a pre-aborted signal without calling the operation', async () => {
  const reason = new Error('outer cancelled');
  const outer = new AbortController();
  outer.abort(reason);
  let calls = 0;
  const pending = requestWithDeadline(
    () => {
      calls += 1;
      return Promise.resolve('never');
    },
    { signal: outer.signal, timeoutMs: 500 },
  );
  let caught;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, reason);
  assert.equal(calls, 0);
});

test('requestWithDeadline propagates an outer mid-flight abort to the operation signal', async () => {
  const reason = new Error('user navigated away');
  const outer = new AbortController();
  let seen;
  let operationReason;
  const pending = requestWithDeadline(
    (signal) => {
      seen = signal;
      signal.addEventListener(
        'abort',
        () => {
          operationReason = signal.reason;
        },
        { once: true },
      );
      return never();
    },
    { signal: outer.signal, timeoutMs: 5000 },
  );
  setTimeout(() => outer.abort(reason), 10);
  let caught;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, reason);
  assert.equal(seen.aborted, true);
  assert.equal(operationReason, reason);
});

test('requestWithDeadline works without an outer signal and still enforces the deadline', async () => {
  assert.equal(
    await requestWithDeadline(() => delay(5, 'pack'), { timeoutMs: 500 }),
    'pack',
  );
  let caught;
  try {
    await requestWithDeadline(() => never(), { timeoutMs: 20 });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.name, 'TimeoutError');
});

test('requestWithDeadline lets a synchronous operation throw propagate unwrapped', async () => {
  const boom = new Error('operation exploded');
  let caught;
  try {
    await requestWithDeadline(
      () => {
        throw boom;
      },
      { timeoutMs: 500 },
    );
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, boom);
});

test('requestWithDeadline aborts the operation signal during cleanup after success', async () => {
  let seen;
  await requestWithDeadline(
    (signal) => {
      seen = signal;
      return Promise.resolve('done');
    },
    { timeoutMs: 500 },
  );
  assert.equal(seen.aborted, true);
});

test('waitForSignal passes the value through when there is no signal', async () => {
  assert.equal(await waitForSignal(delay(5, 'shared'), undefined), 'shared');
});

test('waitForSignal resolves when the promise wins the race', async () => {
  const outer = new AbortController();
  setTimeout(() => outer.abort(new Error('too late')), 100);
  assert.equal(await waitForSignal(delay(5, 'names'), outer.signal), 'names');
});

test('waitForSignal rejects on abort without cancelling the shared acquisition', async () => {
  const reason = new Error('pane closed');
  const outer = new AbortController();
  let settled = false;
  const shared = delay(60, 'shared-names').then((value) => {
    settled = true;
    return value;
  });
  const pending = waitForSignal(shared, outer.signal);
  setTimeout(() => outer.abort(reason), 10);
  let caught;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, reason);
  // The shared acquisition keeps running: the abort cancels one consumer.
  assert.equal(settled, false);
  assert.equal(await shared, 'shared-names');
  assert.equal(settled, true);
});

test('waitForSignal rejects at once on a pre-aborted signal while the work runs on', async () => {
  const reason = new Error('already gone');
  const outer = new AbortController();
  outer.abort(reason);
  let settled = false;
  const work = delay(30, 'late').then((value) => {
    settled = true;
    return value;
  });
  let caught;
  try {
    await waitForSignal(work, outer.signal);
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, reason);
  assert.equal(settled, false);
  assert.equal(await work, 'late');
});

test('waitForSignal lets an early upstream rejection win over a later abort', async () => {
  const outer = new AbortController();
  setTimeout(() => outer.abort(new Error('abort')), 100);
  const upstream = new Error('upstream failed');
  await assert.rejects(
    waitForSignal(
      delay(5).then(() => {
        throw upstream;
      }),
      outer.signal,
    ),
    (error) => error === upstream,
  );
});
