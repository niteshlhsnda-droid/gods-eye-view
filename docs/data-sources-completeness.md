# Data-sources completeness: every live layer must have a DATA_SOURCES.md row

**Status:** rule. `DATA_SOURCES.md` is the app's canonical index of
third-party data sources (its in-app companion is the Data attribution
popover, `src/data/dataCredits.js`). A layer that fetches, tiles, or embeds
third-party content with no row there is a documentation bug, even when the
code is correct — readers cannot tell what the globe is showing, under what
terms, or how fresh it is.

## The rule

1. **Every live layer has a row.** "Live layer" means any map layer, map
   stack, terrain provider, overlay, or embedded player that pulls content
   from a third party at runtime (directly, through a same-origin proxy,
   or as an embedded player). Bundled snapshots have rows in the bundled
   table instead. User-supplied content (geo file import, local receivers)
   is documented in its own section, not a provider row.
2. **A row must contain:**
   - **Provider** — who serves it, with the host/endpoint where the code
     pins one (e.g. `tiles.dontgetflocked.com`, `overpass-api.de`).
     A generic "community-hosted" with no host does not count.
   - **What it serves** — which layer(s) consume it and what the user sees.
     When one provider serves several paths (OSM: raster stack, ALPR
     tiles, Nominatim, Overpass), name each path.
   - **License / terms** — the provider's license or terms, or an honest
     "no licence published" where that is true. Never invent terms.
   - **Attribution** — the credit string shown in-app.
   - **Freshness / liveness, honestly** — never claim "live" for a
     snapshot, a polled feed, or a cached tile set. State the poll
     interval, the cache TTL, and what "latest" means for that source
     (e.g. "newest available observation, not zero-delay real time",
     "cached 5 minutes", "hourly extract"). A base map with no capture
     date anywhere gets a **vintage-unknown** disclosure instead of a
     freshness label — never a clock, never "current".
3. **When you add a source, update both surfaces.** Add the row to
   `DATA_SOURCES.md` **and** a `DATA_CREDITS` entry in
   `src/data/dataCredits.js` so the credit surfaces in the app. (Follow-up
   owed at the time of writing: `DATA_CREDITS` entries for the Cesium ion /
   Bing / World Terrain rows added by the Cycle 7 completeness audit —
   docs landed first under a docs-only scope.)
4. **When you change a source, change its row.** A new endpoint, a new
   fallback host, a changed cache TTL, or a retired path (e.g. Bing Road)
   all require a row edit in the same change.

## How to check (audit procedure)

1. List the live layers: `MAP_STACKS` in `src/maps/catalog.js`, the
   `src/layers/*` directories, the server providers in
   `server/providers/`, and the terrain providers in `src/maps/terrain.js`.
2. List the upstreams the code actually calls: grep for `https://` in
   `src` and `server` (excluding tests/fixtures), plus the endpoint
   constants in each layer's `policy.js` / `source.js`.
3. Every upstream host that serves user-visible content must appear in
   `DATA_SOURCES.md` — in a row, a named note, or a named fallback. A
   host that appears only as a link-out (e.g. the NHC `gtwo.php` outlook
   URL) is documented as a link, not a fetched feed.
4. Read each existing row against the code it describes. A row is stale
   when the code has moved on (new host, new path, new TTL) and the row
   has not.

## Scope notes (what this rule does not cover)

- **Live Now** is owned by the Live Now lanes and is out of this audit's
  scope. Known gap at the time of writing: Live Now ingest also reads
  NWS weather alerts (`api.weather.gov/alerts/active`) and links AISHub
  (`www.aishub.net`); those need rows from the Live Now lanes, under
  this same rule.
- **Not data layers, no row required:** the voice-model provider
  (OpenAI — the screenshot disclosure lives in the camera-frame-content
  note), analytics/feature flags (PostHog, GrowthBook — see
  `docs/METRICS.md`), and font assets (Google Fonts). If any of those
  ever serves user-visible map content, it graduates to a row.
- **Tests:** `src/data/dataSourcesCompleteness.test.mjs` pins the rows
  this audit added, following the existing pattern of
  `src/data/transitFeeds.test.mjs` (tests read `DATA_SOURCES.md` and
  assert on row text). Extend it when you add a row it should pin.
