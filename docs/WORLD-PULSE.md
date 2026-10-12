# World Pulse dashboard (`public/pulse.html`)

A public "the data is real" page: per-layer feed-health grades for God's
Eye View, client-side only, no server.

- **URL (after deploy):** `https://niteshlhsnda-droid.github.io/gods-eye-view/pulse.html`
- **Data:** reads the `gev/feed-health` v1 contract
  (`docs/FEED-HEALTH-CONTRACT.md`) via
  `window.__feedHealth` → `localStorage["gev:feed-health:v1"]` →
  `feed-health.json` (optional static file) → clearly-labelled sample data.
- **Refresh:** manual button + 30 s auto-refresh.

## Making it live

The dashboard shows real grades as soon as the app publishes them. Wire the
publisher once at app startup (see `docs/FEED-HEALTH-CONTRACT.md`):

```js
import { startFeedHealthPublishing } from './metrics/worldPulsePublisher.js';
startFeedHealthPublishing({ getLayers: /* … */ });
```

The app and the dashboard must share an origin for the `localStorage`
path to work; otherwise publish a static `feed-health.json` next to the
page (e.g. from the upptime/data pipeline).

## Sibling page

`public/leaderboard.html` — community contributor leaderboard, client-side,
sourced from the GitHub API (`/repos/niteshlhsnda-droid/gods-eye-view/contributors`).
Caches 24 h in `localStorage`; on 403 rate-limit or offline it falls back to
the cache with a visible warning, and to an empty state with retry when no
cache exists.
