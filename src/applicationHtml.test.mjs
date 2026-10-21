// src/applicationHtml.test.mjs
// H-02: `data-logo-src` must be rebased to the deploy base at template
// expansion time — Vite's HTML asset pass rewrites `<img src>` but leaves
// data attributes untouched, so `/logo.svg` 404'd on the deployed subpath
// and the gaze-animated logo never installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandApplicationHtml,
  setApplicationHtmlBase,
} from '../build/application-html.js';

test('expandApplicationHtml: data-logo-src is rebased to the deploy base', () => {
  const out = expandApplicationHtml('<!-- gev:template hud-loading -->\n', {
    base: '/gods-eye-view/',
  });
  assert.match(out, /data-logo-src="\/gods-eye-view\/logo\.svg"/);
  assert.ok(
    !out.includes('data-logo-src="/logo.svg"'),
    'no root-absolute data-logo-src may survive a subpath build',
  );
});

test('expandApplicationHtml: both logo templates are rebased', () => {
  const out = expandApplicationHtml(
    '<!-- gev:template hud-loading -->\n<!-- gev:template scene-chrome -->\n',
    { base: '/gods-eye-view/' },
  );
  const hits = out.match(/data-logo-src="\/gods-eye-view\/logo\.svg"/g) || [];
  assert.equal(hits.length, 2);
});

test('expandApplicationHtml: <img src> is left for Vite\'s own asset pass', () => {
  const out = expandApplicationHtml('<!-- gev:template hud-loading -->\n', {
    base: '/gods-eye-view/',
  });
  // Vite rewrites <img src> itself; the template expander must not touch it.
  assert.match(out, /<img src="\/logo\.svg"/);
});

test('expandApplicationHtml: default base keeps the root path intact', () => {
  setApplicationHtmlBase('/');
  try {
    const out = expandApplicationHtml('<!-- gev:template hud-loading -->\n');
    assert.match(out, /data-logo-src="\/logo\.svg"/);
    assert.ok(!out.includes('//logo.svg'), 'no doubled slashes');
  } finally {
    setApplicationHtmlBase('/');
  }
});

test('expandApplicationHtml: a base without trailing slash still works', () => {
  const out = expandApplicationHtml('<!-- gev:template hud-loading -->\n', {
    base: '/gods-eye-view',
  });
  assert.match(out, /data-logo-src="\/gods-eye-view\/logo\.svg"/);
  assert.ok(!out.includes('//logo.svg'), 'no doubled slashes');
});
