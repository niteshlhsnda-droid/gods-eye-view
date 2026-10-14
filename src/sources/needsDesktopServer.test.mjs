import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NEEDS_DESKTOP_SERVER_CODE,
  isNeedsDesktopServerError,
  needsDesktopServerError,
  throwIfStaticHosting,
} from './needsDesktopServer.js';
import {
  isStaticHosting,
  probeApiAvailable,
  resetStaticHostingProbe,
} from './staticHosting.js';

test('honest error carries the code, name and a needs-server message', () => {
  const error = needsDesktopServerError('Live flights');
  assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
  assert.equal(error.name, 'NeedsDesktopServerError');
  assert.match(error.message, /Live flights/);
  assert.match(error.message, /needs the desktop server/);
  assert.ok(error instanceof Error);
});

test('isNeedsDesktopServerError only matches the coded error', () => {
  assert.equal(
    isNeedsDesktopServerError(needsDesktopServerError('Wind')),
    true,
  );
  assert.equal(isNeedsDesktopServerError(new Error('nope')), false);
  assert.equal(isNeedsDesktopServerError({ code: 'OTHER' }), false);
  assert.equal(isNeedsDesktopServerError(null), false);
  assert.equal(isNeedsDesktopServerError(undefined), false);
});

test('throwIfStaticHosting throws only once the probe says static', async () => {
  resetStaticHostingProbe();
  try {
    // Unprobed: isStaticHosting() is false, desktop behavior unchanged.
    assert.equal(isStaticHosting(), false);
    assert.doesNotThrow(() => throwIfStaticHosting('Live vessels'));

    // Probe says the backend answered: still no throw.
    await probeApiAvailable({ fetchImpl: async () => ({ ok: true }) });
    assert.equal(isStaticHosting(), false);
    assert.doesNotThrow(() => throwIfStaticHosting('Live vessels'));
  } finally {
    resetStaticHostingProbe();
  }

  resetStaticHostingProbe();
  try {
    // Probe says static hosting: the honest error throws, before any fetch.
    await probeApiAvailable({ fetchImpl: async () => ({ ok: false }) });
    assert.equal(isStaticHosting(), true);
    const error = (() => {
      try {
        throwIfStaticHosting('Transit feeds');
      } catch (e) {
        return e;
      }
      return null;
    })();
    assert.ok(error);
    assert.equal(error.code, NEEDS_DESKTOP_SERVER_CODE);
    assert.match(error.message, /Transit feeds/);
  } finally {
    resetStaticHostingProbe();
  }
});
