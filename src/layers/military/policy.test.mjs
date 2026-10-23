// src/layers/military/policy.test.mjs
// H-06: the military layer's 3D-model URLs must resolve against the Vite
// deploy base — the root-absolute constants 404'd on the `/gods-eye-view/`
// subpath deployment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPublicBase } from '../../data/assetBase.js';

test('H-06: JET_MODEL_URL / PLANE_MODEL_URL resolve against the pinned base', async () => {
  setPublicBase('/gods-eye-view/');
  try {
    const policy = await import('./policy.js?h06=1');
    assert.equal(policy.JET_MODEL_URL, '/gods-eye-view/models/jet.glb');
    assert.equal(policy.PLANE_MODEL_URL, '/gods-eye-view/models/airplane.glb');
  } finally {
    setPublicBase(null);
  }
});

test('H-06: model URLs stay root-absolute on the default base', async () => {
  const policy = await import('./policy.js?h06=2');
  assert.equal(policy.JET_MODEL_URL, '/models/jet.glb');
  assert.equal(policy.PLANE_MODEL_URL, '/models/airplane.glb');
});
