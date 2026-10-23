// src/data/assetBase.test.mjs
// Unit tests for the deploy-base asset resolver (H-05/H-06 seam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  publicBase,
  resolvePublicUrl,
  setPublicBase,
} from './assetBase.js';

test('default base keeps root-absolute public URLs intact (dev unchanged)', () => {
  setPublicBase(null);
  assert.equal(publicBase(), '/');
  assert.equal(resolvePublicUrl('/models/airplane.glb'), '/models/airplane.glb');
  assert.equal(resolvePublicUrl('/mic.svg'), '/mic.svg');
});

test('subpath base prefixes public-asset URLs', () => {
  setPublicBase('/gods-eye-view/');
  try {
    assert.equal(publicBase(), '/gods-eye-view/');
    assert.equal(
      resolvePublicUrl('/models/airplane.glb'),
      '/gods-eye-view/models/airplane.glb',
    );
    assert.equal(resolvePublicUrl('/mic.svg'), '/gods-eye-view/mic.svg');
  } finally {
    setPublicBase(null);
  }
});

test('a base without trailing slash is normalized', () => {
  setPublicBase('/gods-eye-view');
  try {
    assert.equal(
      resolvePublicUrl('/models/airplane.glb'),
      '/gods-eye-view/models/airplane.glb',
    );
    assert.ok(
      !resolvePublicUrl('/models/airplane.glb').includes('//'),
      'no doubled slashes',
    );
  } finally {
    setPublicBase(null);
  }
});

test('an already base-prefixed URL passes through unchanged (idempotent)', () => {
  setPublicBase('/gods-eye-view/');
  try {
    assert.equal(
      resolvePublicUrl('/gods-eye-view/models/airplane.glb'),
      '/gods-eye-view/models/airplane.glb',
    );
  } finally {
    setPublicBase(null);
  }
});

test('a leading-slash-less asset name resolves the same way', () => {
  setPublicBase('/gods-eye-view/');
  try {
    assert.equal(resolvePublicUrl('mic.svg'), '/gods-eye-view/mic.svg');
  } finally {
    setPublicBase(null);
  }
});
