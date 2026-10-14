import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STATIC_API_PROBE_PATH,
  STATIC_API_PROBE_TIMEOUT_MS,
  isApiAvailable,
  isStaticHosting,
  probeApiAvailable,
  resetStaticHostingProbe,
} from './staticHosting.js';

test('probe resolves true when the API backend answers 2xx', async () => {
  resetStaticHostingProbe();
  try {
    const calls = [];
    const available = await probeApiAvailable({
      fetchImpl: async (path, options) => {
        calls.push({ path, options });
        return { ok: true, status: 200 };
      },
    });
    assert.equal(available, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, STATIC_API_PROBE_PATH);
    assert.equal(isApiAvailable(), true);
    assert.equal(isStaticHosting(), false);
  } finally {
    resetStaticHostingProbe();
  }
});

test('probe resolves false on 404 (static hosting)', async () => {
  resetStaticHostingProbe();
  try {
    const available = await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    assert.equal(available, false);
    assert.equal(isApiAvailable(), false);
    assert.equal(isStaticHosting(), true);
  } finally {
    resetStaticHostingProbe();
  }
});

test('probe resolves false on network failure', async () => {
  resetStaticHostingProbe();
  try {
    const available = await probeApiAvailable({
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    assert.equal(available, false);
    assert.equal(isStaticHosting(), true);
  } finally {
    resetStaticHostingProbe();
  }
});

test('probe resolves false when the request exceeds the timeout', async () => {
  resetStaticHostingProbe();
  try {
    const started = Date.now();
    const available = await probeApiAvailable({
      fetchImpl: (_path, { signal } = {}) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      timeoutMs: 50,
    });
    assert.equal(available, false);
    assert.ok(
      Date.now() - started < STATIC_API_PROBE_TIMEOUT_MS,
      'timed out well before the default budget',
    );
    assert.equal(isStaticHosting(), true);
  } finally {
    resetStaticHostingProbe();
  }
});

test('probe result is cached: one request serves concurrent and later callers', async () => {
  resetStaticHostingProbe();
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true, status: 200 };
    };
    const [first, second] = await Promise.all([
      probeApiAvailable({ fetchImpl }),
      probeApiAvailable({ fetchImpl }),
    ]);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(calls, 1);
    assert.equal(await probeApiAvailable({ fetchImpl }), true);
    assert.equal(calls, 1);
  } finally {
    resetStaticHostingProbe();
  }
});

test('isStaticHosting is false before the probe runs', () => {
  resetStaticHostingProbe();
  assert.equal(isApiAvailable(), null);
  assert.equal(isStaticHosting(), false);
});

test('probe without an injectable fetch in a non-browser runtime assumes the server', async () => {
  resetStaticHostingProbe();
  try {
    // node:test has no `window`: detection is a page concern, so the default
    // probe must not misreport a server-less test runtime as static hosting.
    assert.equal(await probeApiAvailable(), true);
    assert.equal(isStaticHosting(), false);
  } finally {
    resetStaticHostingProbe();
  }
});
