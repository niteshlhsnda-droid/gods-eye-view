import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_LOCALES,
  lookupKey,
  interpolate,
  t,
  initI18n,
  setLanguage,
  getLocale,
  applyI18n,
  __resetI18nForTests,
} from './index.js';
import en from './locales/en.js';
import hi from './locales/hi.js';
import es from './locales/es.js';
import pt from './locales/pt.js';

const LOCALES = { en, hi, es, pt };

/** Flatten a nested locale table to dot-separated keys. */
function flatKeys(table, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(table)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') keys.push(...flatKeys(value, full));
    else keys.push(full);
  }
  return keys.sort();
}

test('all four locales carry exactly the English key set', () => {
  const reference = flatKeys(en);
  assert.ok(reference.length > 20, 'reference locale is non-trivial');
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.deepEqual(flatKeys(table), reference, `${code} key parity`);
  }
});

test('no locale ships an empty string', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of flatKeys(table)) {
      const value = lookupKey(code, key);
      assert.ok(
        typeof value === 'string' && value.trim().length > 0,
        `${code}:${key}`,
      );
    }
  }
});

test('interpolation keeps unknown vars in place', () => {
  assert.equal(interpolate('M{{mag}} — {{place}}', { mag: 6.1 }), 'M6.1 — {{place}}');
  assert.equal(interpolate('plain', {}), 'plain');
});

test('t() falls back to English, then to the key', async () => {
  __resetI18nForTests();
  await initI18n({ lng: 'hi' });
  assert.equal(getLocale(), 'hi');
  assert.equal(t('share.copied'), lookupKey('hi', 'share.copied'));
  assert.equal(t('alerts.quake', { mag: 6.1, place: 'Patna' }), 'M6.1 भूकंप — Patna');
  assert.equal(t('missing.key'), 'missing.key');
});

test('initI18n detects the stored locale and navigator language', async () => {
  __resetI18nForTests();
  const storage = { getItem: () => 'es', setItem: () => {} };
  assert.equal(await initI18n({ storage }), 'es');
  __resetI18nForTests();
  const bad = { getItem: () => { throw new Error('blocked'); } };
  assert.equal(await initI18n({ storage: bad }), 'en');
});

test('setLanguage rejects unsupported locales', async () => {
  __resetI18nForTests();
  await initI18n({ lng: 'en' });
  assert.equal(await setLanguage('xx'), 'en');
  assert.equal(getLocale(), 'en');
});

test('applyI18n paints data-i18n attributes', async () => {
  __resetI18nForTests();
  await initI18n({ lng: 'en' });
  const painted = [];
  const elements = [
    {
      getAttribute: (name) => (name === 'data-i18n' ? 'share.title' : null),
      set textContent(value) {
        painted.push(value);
      },
    },
  ];
  const root = {
    querySelectorAll: (selector) =>
      selector === '[data-i18n]' ? elements : [],
  };
  applyI18n(root);
  assert.deepEqual(painted, ['Share this scene']);
  applyI18n(null);
});
