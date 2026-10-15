import test from 'node:test';
import assert from 'node:assert/strict';

import { createWeatherLayer } from './index.js';
import { needsDesktopServerError } from '../../sources/needsDesktopServer.js';

/** Minimal harness: only the snapshot-failure path is exercised. */
function setup(getSnapshot) {
  let calls = 0;
  const rendering = {
    getDiagnostics: () => ({}),
  };
  const layer = createWeatherLayer({
    id: 'weather-radar',
    feed: {
      getSnapshot: async (...args) => {
        calls += 1;
        return getSnapshot(...args);
      },
    },
    createRendering: () => rendering,
    documentRef: { hidden: false },
    eventTarget: { addEventListener: () => () => {} },
    matchMedia: () => ({ matches: false }),
  });
  layer.enable();
  return { layer, calls: () => calls };
}

test('static hosting honest state is terminal: honest stats error, later updates no-op', async () => {
  const { layer, calls } = setup(async () => {
    throw needsDesktopServerError('Observed weather');
  });
  await layer.update();
  assert.equal(calls(), 1);
  assert.match(layer.getStats().error, /Observed weather/);
  assert.match(layer.getStats().error, /needs the desktop server/);
  // The 2-minute manager tick must not re-enter the source.
  await layer.update();
  await layer.update();
  assert.equal(calls(), 1);
  assert.match(layer.getStats().error, /needs the desktop server/);
  layer.disable();
});

test('disabling re-arms the honest state so a re-enable re-settles it', async () => {
  const { layer, calls } = setup(async () => {
    throw needsDesktopServerError('Observed weather');
  });
  await layer.update();
  assert.equal(calls(), 1);
  layer.disable();
  layer.enable();
  await layer.update();
  assert.equal(calls(), 2);
  assert.match(layer.getStats().error, /needs the desktop server/);
  layer.disable();
});

test('ordinary observation failures keep the generic message and stay retryable', async () => {
  const { layer, calls } = setup(async () => {
    throw new Error('Weather HTTP 500');
  });
  await layer.update();
  assert.equal(calls(), 1);
  assert.equal(layer.getStats().error, 'Weather HTTP 500');
  await layer.update();
  assert.equal(calls(), 2);
  layer.disable();
});
