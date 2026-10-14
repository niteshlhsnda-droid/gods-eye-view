import test from 'node:test';
import assert from 'node:assert/strict';

import { createIngestion } from './ingestion.js';
import { needsDesktopServerError } from '../../sources/needsDesktopServer.js';

/** Minimal harness for the mission-update path. */
function setup(source) {
  const layerState = {
    _enabled: true,
    _lifecycleToken: 1,
    _staticTerminal: false,
    _lastError: null,
    _updateDirty: false,
    _updatePromise: null,
    _updatePromiseToken: 0,
    _sourceController: new AbortController(),
    _activeTleText: null,
    _activeTlePromise: null,
    _activeTlePromiseToken: 0,
  };
  const { requestMissionUpdate } = createIngestion({
    state: layerState,
    services: {},
    parts: {},
    source,
  });
  return { layerState, requestMissionUpdate };
}

test('static honest error is terminal: message kept, later updates no-op', async () => {
  let calls = 0;
  const { layerState, requestMissionUpdate } = setup({
    getLaunches: async () => {
      calls += 1;
      throw needsDesktopServerError('Space missions');
    },
    getActiveTle: async () => {
      throw needsDesktopServerError('Space missions');
    },
  });
  await requestMissionUpdate();
  assert.equal(calls, 1);
  assert.equal(layerState._staticTerminal, true);
  assert.match(layerState._lastError, /Space missions/);
  assert.match(layerState._lastError, /needs the desktop server/);
  // The 5-minute manager tick must not re-enter the source.
  await requestMissionUpdate();
  await requestMissionUpdate();
  assert.equal(calls, 1);
});

test('ordinary mission failures keep the message and stay retryable', async () => {
  let calls = 0;
  const { layerState, requestMissionUpdate } = setup({
    getLaunches: async () => {
      calls += 1;
      throw new Error('HTTP 500');
    },
    getActiveTle: async () => null,
  });
  await requestMissionUpdate();
  assert.equal(layerState._staticTerminal, false);
  assert.equal(layerState._lastError, 'HTTP 500');
  await requestMissionUpdate();
  assert.equal(calls, 2);
});
