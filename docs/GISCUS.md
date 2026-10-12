# giscus comments (`src/metrics/giscus.js`)

Config-gated [giscus](https://giscus.app) (GitHub Discussions) embed for
scenes and docs pages. No secrets are involved — giscus identifiers are
public — but the widget stays fully disabled until the maintainer completes
the config below.

## Setup (maintainer, ~2 minutes)

1. In the fork's repo settings, enable **Discussions** and create a
   discussion category for comments (e.g. `General`).
2. Visit https://giscus.app, enter `niteshlhsnda-droid/gods-eye-view`,
   pick the category, and copy the **repo ID** and **category ID** it shows.
   (They look like `R_kgDO…` / `DIC_kwDO…`.)
3. Install the [giscus GitHub App](https://github.com/apps/giscus) on the
   fork so it can read discussions.
4. Wire the config at runtime — for example in the page that hosts the
   comments section:

```js
import { mountGiscus, resolveGiscusConfig } from './metrics/giscus.js';

mountGiscus(document.getElementById('comments'), resolveGiscusConfig({
  enabled: true,
  repo: 'niteshlhsnda-droid/gods-eye-view',
  repoId: 'R_kgDO…',      // from giscus.app
  category: 'General',
  categoryId: 'DIC_kwDO…', // from giscus.app
}));
```

`mountGiscus` returns `{ ok: false, reason: 'not-configured' }` until
`enabled` is true **and** `repo`/`repoId`/`categoryId` contain real values
(placeholders like `OWNER/REPO` are rejected). Until then, no script tag is
injected and the page is unaffected.

## Options

`theme` (`dark` default), `mapping` (`pathname` default), `lang`,
`inputPosition`, `strict`, `reactionsEnabled`, `emitMetadata`, `loading` —
all pass through as `data-*` attributes on the giscus client script.
