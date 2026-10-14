import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirmsSource } from './source.js';

test('a malformed successful response is never accepted as an empty fire snapshot', async () => {
  for (const payload of [{}, { fires: null }, { fires: {} }]) {
    const source = createFirmsSource({
      fetchImpl: async () => ({ ok: true, json: async () => payload }),
    });
    await assert.rejects(source.getSnapshot(), /Malformed fire snapshot/);
  }
});
test('optional-key guidance is distinct from denial or upstream failure', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const source = createFirmsSource({
      fetchImpl: async () => ({
        ok: false,
        status,
        json: async () => ({ error: 'no_key' }),
      }),
    });
    if (status === 503)
      assert.deepEqual(await source.getSnapshot(), { keyRequired: true });
    else
      await assert.rejects(
        source.getSnapshot(),
        new RegExp(`FIRMS HTTP ${status}`),
      );
  }
});
test('response-body completion honors cancellation without replacing records', async () => {
  const abort = new AbortController();
  const source = createFirmsSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        abort.abort();
        return { fires: [] };
      },
    }),
  });
  await assert.rejects(source.getSnapshot({ signal: abort.signal }), {
    name: 'AbortError',
  });
});

test('static hosting: the honest error throws before any fetch', async () => {
  const { probeApiAvailable, resetStaticHostingProbe } =
    await import('../../sources/staticHosting.js');
  const { NEEDS_DESKTOP_SERVER_CODE } =
    await import('../../sources/needsDesktopServer.js');
  resetStaticHostingProbe();
  try {
    await probeApiAvailable({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    let calls = 0;
    const source = createFirmsSource({
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, json: async () => ({ fires: [] }) };
      },
    });
    const error = await source.getSnapshot().catch((e) => e);
    assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
    assert.match(error.message, /Active fire detections/);
    assert.match(error.message, /needs the desktop server/);
    assert.equal(calls, 0);
  } finally {
    resetStaticHostingProbe();
  }
});
