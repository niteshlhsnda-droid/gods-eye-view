// src/layers/flights/policy.test.mjs
// H-06: the flights layer's 3D-model URL must resolve against the Vite deploy
// base — the root-absolute constant 404'd on the `/gods-eye-view/` subpath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPublicBase } from '../../data/assetBase.js';

test('H-06: PLANE_MODEL_URL resolves against the pinned deploy base', async () => {
  setPublicBase('/gods-eye-view/');
  try {
    const policy = await import('./policy.js?h06=1');
    assert.equal(
      policy.PLANE_MODEL_URL,
      '/gods-eye-view/models/airplane.glb',
    );
  } finally {
    setPublicBase(null);
  }
});

test('H-06: PLANE_MODEL_URL stays root-absolute on the default base', async () => {
  const policy = await import('./policy.js?h06=2');
  assert.equal(policy.PLANE_MODEL_URL, '/models/airplane.glb');
});
