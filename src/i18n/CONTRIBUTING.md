# Translating God's Eye View

The UI ships in four languages: **English** (`en`, the reference), **Hindi**
(`hi`), **Spanish** (`es`), and **Portuguese** (`pt`). Every other language is a
community contribution — this is the path.

## Where the strings live

- `src/i18n/locales/<code>.js` — one ES module per language, default-exporting
  a nested object. Copy `en.js` as your starting point.
- `src/i18n/index.js` — the loader: add your locale code to
  `SUPPORTED_LOCALES`, `LOCALE_NAMES`, and `RESOURCES`.

## Rules

1. **Key parity is law.** `src/i18n/localeConsistency.test.mjs` flattens every
   locale and requires the key set to match English exactly — no missing keys,
   no extra keys. Run `npm test` before opening a PR.
2. **No empty strings.** Every key must translate to non-blank text.
3. **Keep `{{variables}}` intact.** Strings like `alerts.quake`
   (`M{{mag}} earthquake — {{place}}`) interpolate at runtime — translate the
   words around them, never rename the variable.
4. **Chrome labels stay short.** Buttons and kicker labels (`app.subtitle`,
   `style.activeStyle`, `story.kicker`) are space-constrained; prefer the
   shortest natural phrasing.
5. **Formal register for Hindi** (आप, not तुम) — the app addresses the operator,
   not a friend.
6. **Brand names don't translate.** "God's Eye View", "GEV MIC", "Story Mode"
   as a product name stay as-is unless a genuine local equivalent exists.

## Marking translatable chrome

In HTML templates, annotate with data attributes — the loader paints them:

```html
<button data-i18n-aria-label="actions.share" data-i18n-title="actions.share">…</button>
<p data-i18n="app.subtitle">NO PLACE LEFT BEHIND</p>
```

In JS, use the `t()` import from `src/i18n/index.js`:

```js
import { t } from '../i18n/index.js';
button.textContent = t('share.title');
toast(t('alerts.quake', { mag: 6.1, place: 'Patna' }));
```

## What "covered" means today

The four shipped locales cover the main chrome and every ChatGPT-lane surface
(share sheet, story mode, tour, alerts, language switcher). Deeper panels
(layers, cockpit, provider settings) still render English — each one is a
follow-up PR that adds keys here plus `data-i18n` annotations there.
