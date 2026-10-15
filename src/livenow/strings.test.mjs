import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ln,
  detectLocale,
  interpolateLiveNow,
  LIVE_NOW_LOCALES,
  LIVE_NOW_CHROME_KEYS,
} from './strings.js';
import copy from '../../docs/live-now/i18n.json' with { type: 'json' };

test('all four locales ship every chrome key (73 keys each, non-empty)', () => {
  for (const locale of LIVE_NOW_LOCALES) {
    assert.equal(
      Object.keys(copy[locale]).length,
      73,
      `${locale} should have 73 keys`,
    );
    for (const key of LIVE_NOW_CHROME_KEYS) {
      const value = copy[locale][key];
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
      assert.ok(value.length > 0, `${locale}.${key} must be non-empty`);
    }
  }
});

test('ln() serves all four languages with English fallback', () => {
  assert.equal(ln('en', 'panel.title'), 'Live Now');
  assert.equal(ln('hi', 'panel.title'), copy.hi['panel.title']);
  assert.equal(ln('es', 'severity.5'), copy.es['severity.5']);
  assert.equal(ln('pt', 'card.flyTo'), copy.pt['card.flyTo']);
  // Unknown locale falls back to English.
  assert.equal(ln('xx', 'panel.title'), 'Live Now');
  // Missing key returns the key itself (never throws).
  assert.equal(ln('en', 'nope.missing'), 'nope.missing');
});

test('ln() interpolates single-brace placeholders at render time', () => {
  assert.equal(
    ln('en', 'panel.empty', { m: 7 }),
    'Quiet planet — last checked 7 min ago',
  );
  assert.equal(
    ln('hi', 'panel.sourcesStale', { n: 2 }),
    interpolateLiveNow(copy.hi['panel.sourcesStale'], { n: 2 }),
  );
  assert.equal(ln('en', 'card.sourcesOther', { n: 3 }), '3 sources');
  assert.equal(ln('en', 'card.sourcesOne'), '1 source');
});

test('interpolateLiveNow leaves unknown vars in place', () => {
  assert.equal(interpolateLiveNow('a {x} b', {}), 'a {x} b');
  assert.equal(interpolateLiveNow('a {x} b', { x: 1 }), 'a 1 b');
});

test('detectLocale prefers stored app locale, then navigator, then en', () => {
  const storage = (value) => ({ getItem: () => value });
  assert.equal(detectLocale(storage('hi')), 'hi');
  assert.equal(detectLocale(storage('es')), 'es');
  assert.equal(detectLocale(storage(null), { language: 'pt-BR' }), 'pt');
  assert.equal(detectLocale(storage(null), { language: 'fr-FR' }), 'en');
  assert.equal(detectLocale(storage('xx'), { language: 'hi' }), 'hi');
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(detectLocale(throwing, { language: 'es' }), 'es');
});
