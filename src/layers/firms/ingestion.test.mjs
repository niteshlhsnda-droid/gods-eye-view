import test from 'node:test';
import assert from 'node:assert/strict';

import { createIngestion } from './ingestion.js';
import { needsDesktopServerError } from '../../sources/needsDesktopServer.js';

/** Minimal harness: only the load-failure path is exercised. */
function setup({ getSnapshot }) {
  const layerState = {
    _dataSource: {},
    _enabled: true,
    _loading: false,
    _staticTerminal: false,
    _error: null,
    _keyRequired: false,
  };
  const { methods } = createIngestion({
    layerState,
    services: { context: { clearSelectedEntityContextForLayer: () => {} } },
    components: {},
    config: { id: 'firms' },
    feed: { getSnapshot },
  });
  return { layerState, update: methods.update };
}

test('static honest error is terminal: message kept, later ticks no-op', async () => {
  let calls = 0;
  const { layerState, update } = setup({
    getSnapshot: async () => {
      calls += 1;
      throw needsDesktopServerError('Active fire detections');
    },
  });
  // The manager's immediate first update settles the honest state (this is
  // also the call the hash-restore path makes after re-enabling the layer).
  await update();
  assert.equal(calls, 1);
  assert.equal(layerState._staticTerminal, true);
  assert.match(layerState._error, /Active fire detections/);
  assert.match(layerState._error, /needs the desktop server/);
  // The scheduled 10-minute poll must not re-enter the source.
  await update();
  await update();
  assert.equal(calls, 1);
});

test('ordinary load failures keep the generic message and stay retryable', async () => {
  let calls = 0;
  const { layerState, update } = setup({
    getSnapshot: async () => {
      calls += 1;
      throw new Error('FIRMS HTTP 500');
    },
  });
  await update();
  assert.equal(layerState._staticTerminal, false);
  assert.equal(layerState._error, 'live feed unavailable');
  await update();
  assert.equal(calls, 2);
});
