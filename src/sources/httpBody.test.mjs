// SOURCES/HTTPBODY — capped fetch-body readers + in-flight request coalescing.
// What matters here: a hard byte cap is enforced BOTH by early
// Content-Length rejection and by a running cap while streaming, abort
// signals stop reads promptly, JSON bodies parse only after the cap check,
// byte reads reassemble chunks in order, and coalesced requests share one
// promise per key with identity-guarded eviction on settle.
//
// FINDINGS (tests-only; pinned, not fixed):
//  1. Asymmetric body cancel on early declared-length reject: the text
//     reader does `void body?.cancel()` (fire-and-forget) while the bytes
//     reader `await`s it. Both throw before reading, so the cap holds,
//     but cancellation ordering differs between the two helpers.
//  2. On mid-stream overflow the text variant's catch calls cancel() without
//     awaiting reader.cancel(); the bytes variant awaits it in catch. Same
//     cleanup, different timing.
//  3. The early reject trusts the declared Content-Length verbatim: a
//     smaller-than-real declaration is still caught by the running cap, but
//     a larger-than-real declaration refuses a legitimately small body
//     without ever reading it (intended "rejects early" per the docblock).
//
// Run with: node --test src/sources/httpBody.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coalesceProxyRequest,
  readResponseBytesCapped,
  readResponseJsonCapped,
  readResponseTextCapped,
} from './httpBody.js';

const enc = new TextEncoder();
const bytes = (s) => enc.encode(s);

/** A fake fetch Response covering both the reader path and the fallback path. */
function fakeResponse({
  contentLength = null,
  chunks = null,
  text = null,
  buffer = null,
} = {}) {
  const state = { cancelled: 0, textCalls: 0, bufferCalls: 0 };
  const headers = {
    get: (name) =>
      name.toLowerCase() === 'content-length' ? contentLength : null,
  };
  const body = chunks
    ? {
        getReader() {
          let i = 0;
          return {
            async read() {
              if (i < chunks.length) return { done: false, value: chunks[i++] };
              return { done: true, value: undefined };
            },
            async cancel() {
              state.cancelled += 1;
            },
            releaseLock() {},
          };
        },
        async cancel() {
          state.cancelled += 1;
        },
      }
    : undefined;
  return {
    state,
    headers,
    body,
    async text() {
      state.textCalls += 1;
      return text ?? '';
    },
    async arrayBuffer() {
      state.bufferCalls += 1;
      const b = buffer ?? new Uint8Array();
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  };
}

async function tooLarge(promise) {
  const error = await promise.then(
    () => null,
    (err) => err,
  );
  assert.ok(error instanceof Error, 'expected a rejection');
  assert.equal(error.code, 'RESPONSE_TOO_LARGE');
  assert.match(error.message, /too large/i);
  return error;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- text

test('text: early reject when declared content-length exceeds the cap', async () => {
  const res = fakeResponse({
    contentLength: '11',
    chunks: [bytes('0123456789')],
    text: '0123456789',
  });
  await tooLarge(readResponseTextCapped(res, 10));
  assert.equal(res.state.textCalls, 0, 'body must never be read');
  assert.equal(res.state.cancelled, 1, 'body must be cancelled');
});

test('text: declared content-length equal to the cap is accepted', async () => {
  const res = fakeResponse({ contentLength: '10', text: '0123456789' });
  assert.equal(await readResponseTextCapped(res, 10), '0123456789');
});

test('text: fallback text() path returns small bodies', async () => {
  const res = fakeResponse({ text: 'hello' });
  assert.equal(await readResponseTextCapped(res, 100), 'hello');
});

test('text: fallback text() path caps on encoded byte length, not chars', async () => {
  // 'ééé' is 3 chars but 6 bytes UTF-8.
  const res = fakeResponse({ text: 'ééé' });
  await tooLarge(readResponseTextCapped(res, 5));
});

test('text: non-numeric declared length falls through to streaming', async () => {
  const res = fakeResponse({
    contentLength: 'not-a-number',
    chunks: [bytes('ok')],
  });
  assert.equal(await readResponseTextCapped(res, 10), 'ok');
});

test('text: streaming concatenates chunks and decodes split multibyte chars', async () => {
  const full = bytes('héllo→world');
  const res = fakeResponse({
    chunks: [full.slice(0, 3), full.slice(3, 7), full.slice(7)],
  });
  assert.equal(await readResponseTextCapped(res, 100), 'héllo→world');
});

test('text: streaming rejects once the running total exceeds the cap', async () => {
  const res = fakeResponse({ chunks: [bytes('abc'), bytes('def')] });
  await tooLarge(readResponseTextCapped(res, 5));
});

test('text: empty stream returns empty string', async () => {
  const res = fakeResponse({ chunks: [] });
  assert.equal(await readResponseTextCapped(res, 10), '');
});

test('text: pre-aborted signal rejects before reading', async () => {
  const controller = new AbortController();
  controller.abort();
  const res = fakeResponse({ text: 'hello' });
  const error = await readResponseTextCapped(res, 100, controller.signal).then(
    () => null,
    (err) => err,
  );
  assert.equal(error?.name, 'AbortError');
  assert.equal(res.state.textCalls, 0, 'body must never be read');
});

test('text: abort mid-stream rejects and cancels the reader', async () => {
  const controller = new AbortController();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const resolvers = [];
  const res = fakeResponse({ contentLength: null });
  res.body = {
    getReader() {
      return {
        read() {
          return new Promise((resolve) => resolvers.push(resolve));
        },
        async cancel() {
          res.state.cancelled += 1;
          // Unblock the in-flight read() so the module's loop can unwind.
          for (const resolve of resolvers.splice(0)) resolve({ done: true });
          release();
        },
        releaseLock() {},
      };
    },
    async cancel() {
      res.state.cancelled += 1;
    },
  };
  const pending = readResponseTextCapped(res, 100, controller.signal);
  await tick();
  resolvers.shift()({ done: false, value: bytes('ab') });
  await tick();
  controller.abort();
  const error = await pending.then(
    () => null,
    (err) => err,
  );
  assert.equal(error?.name, 'AbortError');
  await gate;
  assert.ok(res.state.cancelled >= 1, 'reader cancel must be invoked');
});

// ---------------------------------------------------------------- JSON

test('json: parses a valid capped JSON body', async () => {
  const res = fakeResponse({ text: '{"a":1,"b":[2,3]}' });
  assert.deepEqual(await readResponseJsonCapped(res, 100), { a: 1, b: [2, 3] });
});

test('json: declared oversized length rejects before parsing', async () => {
  const res = fakeResponse({ contentLength: '500', text: '{}' });
  await tooLarge(readResponseJsonCapped(res, 100));
  assert.equal(res.state.textCalls, 0, 'body must never be read');
});

test('json: invalid JSON surfaces a SyntaxError within the cap', async () => {
  const res = fakeResponse({ text: 'not json' });
  await assert.rejects(readResponseJsonCapped(res, 100), SyntaxError);
});

test('json: streaming chunks are capped before parsing', async () => {
  const res = fakeResponse({
    chunks: [bytes('{"a":'), bytes('"oops-no-close"')],
  });
  await tooLarge(readResponseJsonCapped(res, 5));
});

// ---------------------------------------------------------------- bytes

test('bytes: early reject when declared content-length exceeds the cap', async () => {
  const res = fakeResponse({
    contentLength: '6',
    chunks: [bytes('01234')],
    buffer: bytes('01234'),
  });
  await tooLarge(readResponseBytesCapped(res, 5));
  assert.equal(res.state.bufferCalls, 0, 'body must never be read');
  assert.equal(res.state.cancelled, 1, 'body must be cancelled');
});

test('bytes: fallback arrayBuffer() path returns a Uint8Array copy', async () => {
  const res = fakeResponse({ buffer: bytes('abc') });
  const out = await readResponseBytesCapped(res, 10);
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual([...out], [...bytes('abc')]);
});

test('bytes: fallback rejects when bytes exceed the cap', async () => {
  const res = fakeResponse({ buffer: bytes('abcdef') });
  await tooLarge(readResponseBytesCapped(res, 5));
});

test('bytes: streaming reassembles chunks in order into one Uint8Array', async () => {
  const res = fakeResponse({
    chunks: [bytes('ab'), bytes(''), bytes('cde')],
  });
  const out = await readResponseBytesCapped(res, 100);
  assert.deepEqual([...out], [...bytes('abcde')]);
});

test('bytes: streaming rejects once the running total exceeds the cap', async () => {
  const res = fakeResponse({ chunks: [bytes('abc'), bytes('def')] });
  await tooLarge(readResponseBytesCapped(res, 5));
});

test('bytes: pre-aborted signal rejects before reading', async () => {
  const controller = new AbortController();
  controller.abort();
  const res = fakeResponse({ buffer: bytes('ab') });
  const error = await readResponseBytesCapped(res, 100, controller.signal).then(
    () => null,
    (err) => err,
  );
  assert.equal(error?.name, 'AbortError');
  assert.equal(res.state.bufferCalls, 0, 'body must never be read');
});

// ---------------------------------------------------------------- coalesce

test('coalesce: first call creates, shares nothing, and defers create', async () => {
  const inFlight = new Map();
  let created = 0;
  const { promise, shared } = coalesceProxyRequest(inFlight, 'k', async () => {
    created += 1;
    return 'v';
  });
  assert.equal(shared, false);
  assert.equal(created, 0, 'create must not run synchronously');
  assert.equal(inFlight.get('k'), promise);
  assert.equal(await promise, 'v');
  assert.equal(created, 1);
});

test('coalesce: concurrent callers share the same promise', async () => {
  const inFlight = new Map();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let created = 0;
  const first = coalesceProxyRequest(inFlight, 'k', () => {
    created += 1;
    return gate;
  });
  const second = coalesceProxyRequest(inFlight, 'k', () => {
    created += 1;
    return 'other';
  });
  assert.equal(first.shared, false);
  assert.equal(second.shared, true);
  assert.equal(second.promise, first.promise);
  await tick();
  assert.equal(created, 1);
  release('shared-value');
  assert.equal(await first.promise, 'shared-value');
  assert.equal(await second.promise, 'shared-value');
});

test('coalesce: fulfilled entry is evicted so the next call re-creates', async () => {
  const inFlight = new Map();
  let created = 0;
  const first = coalesceProxyRequest(inFlight, 'k', async () => {
    created += 1;
    return created;
  });
  assert.equal(await first.promise, 1);
  await tick();
  assert.equal(inFlight.has('k'), false);
  const second = coalesceProxyRequest(inFlight, 'k', async () => {
    created += 1;
    return created;
  });
  assert.equal(second.shared, false);
  assert.equal(await second.promise, 2);
});

test('coalesce: rejected entry is evicted so a retry creates anew', async () => {
  const inFlight = new Map();
  const first = coalesceProxyRequest(inFlight, 'k', async () => {
    throw new Error('boom');
  });
  await assert.rejects(first.promise, /boom/);
  await tick();
  assert.equal(inFlight.has('k'), false);
  const second = coalesceProxyRequest(inFlight, 'k', async () => 'recovered');
  assert.equal(second.shared, false);
  assert.equal(await second.promise, 'recovered');
});

test('coalesce: a foreign replacement is not evicted by a stale settle', async () => {
  const inFlight = new Map();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = coalesceProxyRequest(inFlight, 'k', () => gate);
  const foreign = Promise.resolve('foreign');
  inFlight.set('k', foreign);
  release('stale');
  assert.equal(await first.promise, 'stale');
  await tick();
  assert.equal(inFlight.get('k'), foreign, 'foreign entry must survive');
});

test('coalesce: different keys are independent', async () => {
  const inFlight = new Map();
  const a = coalesceProxyRequest(inFlight, 'a', async () => 'A');
  const b = coalesceProxyRequest(inFlight, 'b', async () => 'B');
  assert.notEqual(a.promise, b.promise);
  assert.equal(await a.promise, 'A');
  assert.equal(await b.promise, 'B');
});
