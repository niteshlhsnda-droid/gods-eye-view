import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHOTO_ATTRIBUTION_SOURCES,
  attributionSourceOf,
  auditRenderedAttribution,
  escapeHtml,
  photoCardAttribution,
} from './photoAttribution.js';
import { MAPILLARY_CREDIT_HTML } from './providers/mapillary/policy.js';
import { KARTAVIEW_CREDIT_HTML } from './providers/kartaview/policy.js';
import { GOOGLE_CREDIT_HTML } from './providers/google/policy.js';

const MAPILLARY_DEF = {
  id: 'mapillary',
  name: 'Mapillary',
  credit: { html: MAPILLARY_CREDIT_HTML },
};
const KARTAVIEW_DEF = {
  id: 'kartaview',
  name: 'KartaView',
  credit: { html: KARTAVIEW_CREDIT_HTML },
};
const GOOGLE_DEF = {
  id: 'google',
  name: 'Google',
  credit: { html: GOOGLE_CREDIT_HTML },
};
const PER_PHOTO = 'Imagery © <a href="https://example.test">Example</a>';

test('a pose with per-image attribution uses it verbatim', () => {
  const resolved = photoCardAttribution({
    provider: MAPILLARY_DEF,
    pose: { attributionHtml: PER_PHOTO },
  });
  assert.equal(resolved.html, PER_PHOTO);
  assert.equal(resolved.source, PHOTO_ATTRIBUTION_SOURCES.PER_PHOTO);
});

test('per-image attribution wins over the provider credit', () => {
  const resolved = photoCardAttribution({
    provider: MAPILLARY_DEF,
    pose: { attributionHtml: PER_PHOTO },
  });
  assert.ok(!resolved.html.includes('Mapillary'));
});

test('a whitespace-only per-image line is ignored, the provider line used', () => {
  const resolved = photoCardAttribution({
    provider: MAPILLARY_DEF,
    pose: { attributionHtml: '   ' },
  });
  assert.equal(resolved.html, MAPILLARY_CREDIT_HTML);
  assert.equal(resolved.source, PHOTO_ATTRIBUTION_SOURCES.PROVIDER);
});

test('a provider without a per-image line falls back to its credit', () => {
  const resolved = photoCardAttribution({ provider: KARTAVIEW_DEF, pose: {} });
  assert.equal(resolved.html, KARTAVIEW_CREDIT_HTML);
  assert.equal(resolved.source, PHOTO_ATTRIBUTION_SOURCES.PROVIDER);
});

test('an explicit photoAttribution line beats the on-globe credit', () => {
  const provider = {
    ...MAPILLARY_DEF,
    photoAttribution: { html: 'Photo-card-only line' },
  };
  const resolved = photoCardAttribution({ provider, pose: {} });
  assert.equal(resolved.html, 'Photo-card-only line');
  assert.equal(resolved.source, PHOTO_ATTRIBUTION_SOURCES.PROVIDER);
});

test('a provider with no credit at all gets an explicit fallback line', () => {
  const resolved = photoCardAttribution({
    provider: { id: 'mystery', name: 'Mystery Cam' },
    pose: {},
  });
  assert.equal(
    resolved.html,
    'Mystery Cam · contributor attribution unavailable',
  );
  assert.equal(resolved.source, PHOTO_ATTRIBUTION_SOURCES.FALLBACK);
});

test('a missing provider definition gets a generic fallback, never empty', () => {
  const resolved = photoCardAttribution({ provider: null, pose: null });
  assert.ok(resolved.html.length > 0);
  assert.match(resolved.html, /attribution unavailable/);
  assert.equal(resolved.source, PHOTO_ATTRIBUTION_SOURCES.FALLBACK);
});

test('the fallback escapes a hostile provider name', () => {
  const resolved = photoCardAttribution({
    provider: { id: 'evil', name: '<img src=x onerror=alert(1)>' },
    pose: {},
  });
  assert.ok(!resolved.html.includes('<img'));
  assert.ok(resolved.html.includes('&lt;img'));
});

test('attributionSourceOf reports provider for every in-repo provider', () => {
  for (const def of [MAPILLARY_DEF, KARTAVIEW_DEF, GOOGLE_DEF])
    assert.equal(
      attributionSourceOf(def),
      PHOTO_ATTRIBUTION_SOURCES.PROVIDER,
      def.id,
    );
});

test('attributionSourceOf reports fallback when nothing is supplied', () => {
  assert.equal(
    attributionSourceOf({ id: 'mystery' }),
    PHOTO_ATTRIBUTION_SOURCES.FALLBACK,
  );
  assert.equal(attributionSourceOf(null), PHOTO_ATTRIBUTION_SOURCES.FALLBACK);
});

test('escapeHtml escapes the five HTML-significant characters', () => {
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});

test('auditRenderedAttribution is clean for a closed viewer', () => {
  assert.deepEqual(auditRenderedAttribution({ viewer: { open: false } }), []);
});

test('auditRenderedAttribution flags an open card with no attribution line', () => {
  const issues = auditRenderedAttribution({
    viewer: { open: true, captionAttribution: null },
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /no license attribution line/);
});

test('auditRenderedAttribution passes an open card that carries its line', () => {
  const issues = auditRenderedAttribution({
    viewer: { open: true, captionAttribution: MAPILLARY_CREDIT_HTML },
  });
  assert.deepEqual(issues, []);
});

test('every in-repo provider resolves a non-empty card line', () => {
  for (const def of [MAPILLARY_DEF, KARTAVIEW_DEF, GOOGLE_DEF]) {
    const resolved = photoCardAttribution({ provider: def, pose: {} });
    assert.ok(resolved.html.trim().length > 0, def.id);
    assert.notEqual(
      resolved.source,
      PHOTO_ATTRIBUTION_SOURCES.FALLBACK,
      def.id,
    );
  }
});
