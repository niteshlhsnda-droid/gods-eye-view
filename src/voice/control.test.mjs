// src/voice/control.test.mjs
// H-05: the mic-orbit `<img>` in the JS-injected voice-button markup must
// resolve against the Vite deploy base — the root-absolute `/mic.svg` 404'd
// on the `/gods-eye-view/` subpath deployment while the asset itself is live
// at `/gods-eye-view/mic.svg`. Fails on pre-fix code (the markup baked in a
// literal `/mic.svg` and exposed no markup seam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPublicBase } from '../data/assetBase.js';
import { voiceControlMarkup } from './control.js';

test('H-05: mic-orbit img resolves against the pinned deploy base', () => {
  setPublicBase('/gods-eye-view/');
  try {
    const markup = voiceControlMarkup();
    assert.match(markup, /<img src="\/gods-eye-view\/mic\.svg"[^>]*>/);
    assert.ok(
      !markup.includes('src="/mic.svg"'),
      'no root-absolute mic src may survive a subpath build',
    );
  } finally {
    setPublicBase(null);
  }
});

test('H-05: markup keeps the root mic path on the default base (dev)', () => {
  const markup = voiceControlMarkup();
  assert.match(markup, /<img src="\/mic\.svg"[^>]*>/);
});

test('H-05: markup still carries the voice-button contract ids', () => {
  const markup = voiceControlMarkup();
  for (const id of [
    'gev-voice-button',
    'gev-voice-status',
    'gev-voice-tier',
    'gev-voice-help',
    'gev-voice-card',
  ]) {
    assert.ok(markup.includes(`id="${id}"`), `missing #${id}`);
  }
});
