import test from 'node:test';
import assert from 'node:assert/strict';
import { withShareSignal } from './lifetime.js';

// Behavior pins for withShareSignal (src/director/sharing/lifetime.js):
// who wins when file/adaptor work races an AbortSignal, and that no
// rejected work ever escapes as an unhandled rejection. Tests-only:
// production source must stay byte-identical.

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/**
 * Minimal AbortSignal double that records add/removeEventListener calls,
 * so listener registration options and cleanup are pinnable.
 */
function fakeSignal({ aborted = false, reason = undefined } = {}) {
  const calls = [];
  const state = { aborted, reason, listeners: new Map() };
  const signal = {
    get aborted() {
      return state.aborted;
    },
    get reason() {
      return state.reason;
    },
    addEventListener(type, listener, options) {
      calls.push({ op: 'add', type, options });
      state.listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      calls.push({ op: 'remove', type });
      if (state.listeners.get(type) === listener) state.listeners.delete(type);
    },
    fireAbort(nextReason) {
      state.aborted = true;
      if (nextReason !== undefined) state.reason = nextReason;
      const listener = state.listeners.get('abort');
      // Mimic { once: true }: a second fire is a no-op.
      state.listeners.delete('abort');
      if (listener) listener();
    },
  };
  return { signal, calls };
}

/** Flush one macrotask so swallowed rejections would surface if unhandled. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function watchUnhandled() {
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  return {
    seen,
    async stop() {
      await flush();
      process.removeListener('unhandledRejection', onUnhandled);
    },
  };
}

test('no signal: plain values resolve as-is (undefined and null signals)', async () => {
  assert.equal(await withShareSignal(42, undefined), 42);
  assert.equal(await withShareSignal(42, null), 42);
  assert.equal(await withShareSignal(), undefined);
});

test('no signal: a native promise work is passed through by identity', async () => {
  const work = Promise.resolve('ok');
  const out = withShareSignal(work, undefined);
  assert.strictEqual(out, work);
  assert.equal(await out, 'ok');
});

test('no signal: thenable work is adopted', async () => {
  const thenable = { then: (resolve) => resolve('thenable-value') };
  assert.equal(await withShareSignal(thenable, undefined), 'thenable-value');
});

test('no signal: rejected work rejects with the work error', async () => {
  const err = new Error('work blew up');
  await assert.rejects(
    withShareSignal(Promise.reject(err), undefined),
    (e) => e === err,
  );
});

test('pre-aborted signal: rejects with the abort reason object, never resolves', async () => {
  const controller = new AbortController();
  const reason = new Error('already gone');
  controller.abort(reason);
  const gate = deferred();
  const out = withShareSignal(gate.promise, controller.signal);
  gate.resolve('too late');
  await assert.rejects(out, (err) => err === reason);
});

test('pre-aborted signal: a rejecting work promise is swallowed, never unhandled', async () => {
  const controller = new AbortController();
  controller.abort('pre-aborted');
  const watcher = watchUnhandled();
  try {
    await assert.rejects(
      withShareSignal(
        Promise.reject(new Error('work failed')),
        controller.signal,
      ),
      (err) => err === 'pre-aborted',
    );
    await watcher.stop();
    assert.deepEqual(watcher.seen, []);
  } finally {
    process.removeAllListeners('unhandledRejection');
  }
});

test('pre-aborted signal: no abort listener is added (remove still called, quirk)', async () => {
  const { signal, calls } = fakeSignal({ aborted: true, reason: 'gone' });
  await assert.rejects(
    withShareSignal('work', signal),
    (err) => err === 'gone',
  );
  // abort() unconditionally calls removeEventListener even though nothing
  // was ever added — a harmless no-op remove.
  assert.deepEqual(calls, [{ op: 'remove', type: 'abort' }]);
});

test('abort while work is pending rejects with the abort reason', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const out = withShareSignal(gate.promise, controller.signal);
  controller.abort('stop-the-presses');
  await assert.rejects(out, (err) => err === 'stop-the-presses');
});

test('default abort reason surfaces as an AbortError DOMException', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const out = withShareSignal(gate.promise, controller.signal);
  controller.abort();
  await assert.rejects(
    out,
    (err) => err instanceof DOMException && err.name === 'AbortError',
  );
  gate.resolve('unused');
});

test('work resolving before any abort wins; a later abort is a no-op', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const out = withShareSignal(gate.promise, controller.signal);
  gate.resolve('settled');
  assert.equal(await out, 'settled');
  controller.abort('too-late');
  assert.equal(await out, 'settled');
});

test('work rejecting before any abort rejects with the work error, abort later changes nothing', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const out = withShareSignal(gate.promise, controller.signal);
  const err = new Error('work failed first');
  gate.reject(err);
  await assert.rejects(out, (e) => e === err);
  controller.abort('too-late');
  await assert.rejects(out, (e) => e === err);
});

test('abort wins over a later work rejection; the late rejection never leaks', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const out = withShareSignal(gate.promise, controller.signal);
  controller.abort('abort-first');
  const watcher = watchUnhandled();
  try {
    gate.reject(new Error('late work failure'));
    await assert.rejects(out, (err) => err === 'abort-first');
    await watcher.stop();
    assert.deepEqual(watcher.seen, []);
  } finally {
    process.removeAllListeners('unhandledRejection');
  }
});

test('late results never regain ownership: abort then work resolves stays rejected', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const out = withShareSignal(gate.promise, controller.signal);
  controller.abort('cancelled');
  gate.resolve('late-value');
  await assert.rejects(out, (err) => err === 'cancelled');
  await assert.rejects(out, (err) => err === 'cancelled');
});

test('abort beats already-settled work when the abort lands first in the same tick', async () => {
  const controller = new AbortController();
  const out = withShareSignal(
    Promise.resolve('settled-early'),
    controller.signal,
  );
  controller.abort('raced');
  await assert.rejects(out, (err) => err === 'raced');
});

test('double abort keeps the first reason', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const out = withShareSignal(gate.promise, controller.signal);
  controller.abort('first');
  controller.abort('second');
  await assert.rejects(out, (err) => err === 'first');
  gate.resolve('unused');
});

test('abort listener is registered with { once: true }', async () => {
  const { signal, calls } = fakeSignal();
  const gate = deferred();
  const out = withShareSignal(gate.promise, signal);
  assert.deepEqual(calls, [
    { op: 'add', type: 'abort', options: { once: true } },
  ]);
  gate.resolve('cleanup');
  await out;
});

test('listener is removed when work resolves before any abort', async () => {
  const { signal, calls } = fakeSignal();
  const gate = deferred();
  const out = withShareSignal(gate.promise, signal);
  gate.resolve('done');
  assert.equal(await out, 'done');
  assert.deepEqual(
    calls.filter((c) => c.op === 'remove'),
    [{ op: 'remove', type: 'abort' }],
  );
});

test('listener is removed when work rejects before any abort', async () => {
  const { signal, calls } = fakeSignal();
  const gate = deferred();
  const out = withShareSignal(gate.promise, signal);
  const err = new Error('nope');
  gate.reject(err);
  await assert.rejects(out, (e) => e === err);
  assert.deepEqual(
    calls.filter((c) => c.op === 'remove'),
    [{ op: 'remove', type: 'abort' }],
  );
});

test('listener is removed when the abort fires; a later work settle double-removes (quirk)', async () => {
  const { signal, calls } = fakeSignal({ reason: 'fired' });
  const gate = deferred();
  const out = withShareSignal(gate.promise, signal);
  signal.fireAbort();
  await assert.rejects(out, (err) => err === 'fired');
  // The settle path removes the listener unconditionally, even though the
  // abort path already removed it — a harmless double removeEventListener.
  gate.resolve('late');
  await flush();
  assert.equal(calls.filter((c) => c.op === 'remove').length, 2);
});

test('firing abort twice does not change the rejection', async () => {
  const { signal } = fakeSignal({ reason: 'once' });
  const gate = deferred();
  const out = withShareSignal(gate.promise, signal);
  signal.fireAbort();
  signal.fireAbort();
  await assert.rejects(out, (err) => err === 'once');
  gate.resolve('unused');
});

test('a truthy non-signal object rejects with a TypeError', async () => {
  const gate = deferred();
  await assert.rejects(
    withShareSignal(gate.promise, { aborted: false }),
    (err) => err instanceof TypeError,
  );
  gate.resolve('unused');
});
