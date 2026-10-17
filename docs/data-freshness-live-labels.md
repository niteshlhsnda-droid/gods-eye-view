# Live-label audit: the remaining static "live" claims

Companion to `docs/data-freshness.md`, which states the rule this audit
applies and documents the FIRMS case study. FIRMS is not re-audited here:
its strings belong to that guide's companion fix and are left untouched
by this change.

## The rule (from `docs/data-freshness.md`)

**A static label must never assert liveness.** Static source strings name
the provider only. The word `LIVE` may appear only in a dynamic,
age-qualified label (for example `LIVE · updated 12m ago`), and even there
it means "fresh per the feed's own stale flag", not "instantaneous".

## What counts as a label

Not every occurrence of "live" is a liveness claim. This audit changed a
hit only when it was a **label**: a layer-table row, a keys-table row, a
source-table row, a key-setup `unlocks` string, an attribution credit, or
an `.env.example` comment naming a layer. The verdicts for everything
else:

| Use | Verdict | Why |
| --- | --- | --- |
| Marketing prose ("Track the world live", "live aircraft", "live telemetry", "live planet") | Left | Prose, not a label. A prose pass is a separate editorial decision; this change keeps its diff to labels so reviewers can verify each one. |
| Section heading "Live sources" (`DATA_SOURCES.md`) | Left | Defined term: the gloss "(fetched at runtime — not stored in this repo)" already says what "live" means there — runtime-fetched vs bundled. |
| Proper names ("Live Traffic NSW", "Live Contacts" mission) | Left | The provider's / feature's own name. Renaming a provider is not ours to do. |
| Genuine live video (DelDOT / Statens vegvesen HLS, `LIVE STREAM` in `src/layers/cctv/presentation.js`) | Left | HLS streams really are live video. The CCTV code already enforces this: `LIVE STREAM` for HLS only, never for stills. |
| Compliance / production uses ("uses it live" = not cached, "live product" = production deployment) | Left | Not freshness claims. |
| Negations ("not a live strike counter") | Left | Saying what a layer does *not* provide. |
| Dynamic age-qualified labels (`LIVE · updated Xm ago`, `STALE · cached Xh`) | Left | The allowed form: liveness plus age, with a stale flip. |
| In-app layer display names `Live Flights` / `Live Vessels` | Left — known leftover, see below | Load-bearing strings (used in tests and in `throwIfStaticHosting` messages). Renaming them needs a coordinated rename of app + tests + docs, not a one-sided README edit that would desync docs from the app. |

Two wording swaps were used where "live" meant something precise rather
than "fresh": "fetched live" → "fetched at request time" (per-request
fetch, e.g. camera frames) and "fetched live" → "fetched at runtime"
(one-off runtime fetch, e.g. map state / Ontario 511 catalog).

## What changed in this pass

Every changed string drops the unqualified liveness word and keeps all
other wording byte-identical. Cadences were read from the cited source
line; each one is a poll interval, not a guarantee of new data (proxy
caches and upstream latency add age on top).

| File | Before → After | Why it was wrong |
| --- | --- | --- |
| `README.md` (layer table) | "11,000+ live aircraft" → "11,000+ aircraft" | Flights poll every 30 s (`src/layers/flights/queries.js`, `updateInterval: 30000`). Layer name `Live Flights` kept — see leftover. |
| `README.md` (layer table) | "Live buses, trams, metros…" → "Buses, trams, metros…" | Transit polls every 15 s (`TRANSIT_POLL_MS`, `src/layers/transit/policy.js`) *and* the row already says "delayed playback between reports" — the `Live` contradicted the row's own qualifier. |
| `README.md` (layer table) | "Live station availability" → "Station availability" | Bikeshare polls station status every 60 s (`STATUS_POLL_MS`, `src/layers/bikeshare/policy.js`); it is a status refresh, not vehicle movement. |
| `README.md` (keys table) | "🚢 Live global ships" → "🚢 Global ships" | Vessels refresh every 60 s (`REFRESH_MS`, `src/layers/vessels/policy.js`). |
| `README.md` (keys table) | "🚦 Live flow speeds…" → "🚦 Flow speeds…" | TomTom tiles sit behind a 120 s proxy cache (`TILE_TTL_MS`, `server/providers/traffic.js`), so displayed flow can be 2+ min old. |
| `README.md` (TOC) | "[What's Live](#-whats-on-the-globe)" → "[What's on the Globe](#-whats-on-the-globe)" | Link text now matches the heading it points to; the heading itself was already "What's on the Globe". |
| `DATA_SOURCES.md` | "Primary worldwide live-flight snapshot" → "Primary worldwide flight snapshot" | OpenSky snapshot, 30 s flight poll. |
| `DATA_SOURCES.md` | "Bounded live-flight fallback" → "Bounded flight fallback" | adsb.lol fallback; same 30 s flight cadence. |
| `DATA_SOURCES.md` | "Live vessels (AIS)" → "Vessels (AIS)" | 60 s vessel refresh. |
| `DATA_SOURCES.md` | "Traffic roads and live congestion" → "Traffic roads and congestion" | 120 s TomTom proxy cache. |
| `DATA_SOURCES.md` (7 operator rows) | "Transit layer live vehicles, …" → "Transit layer vehicles, …" | 15 s GTFS-Realtime poll + delayed playback; report age is shown separately (`DATA_SOURCES.md`, Transit note). |
| `DATA_SOURCES.md` (Ontario 511) | "live-fetched at runtime" → "fetched at runtime" | "Live" added nothing to "fetched at runtime". |
| `DATA_SOURCES.md` (TxDOT) | "Frames are fetched live at request time" → "Frames are fetched at request time" | "Live" added nothing to "at request time". |
| `DATA_SOURCES.md` (Tallinn) | "stills are fetched live from" → "stills are fetched at request time from" | Still images, fetched per request — "live" was the wrong word for a still. |
| `DATA_SOURCES.md` (TomTom) | "served live and cached only transiently" → "served at request time and cached only transiently" | Served through a 120 s cache; "served live" hid that. |
| `.env.example` | "Current map state is fetched live." → "Current map state is fetched at runtime." | Runtime fetch, not a freshness claim. |
| `.env.example` | "Optional: Live AIS vessels layer" → "Optional: AIS vessels layer" | 60 s vessel refresh. Env var names (`VITE_AIS_LIVE_*`) are identifiers and were not renamed. |
| `.env.example` | "Optional: TomTom live traffic flow" → "Optional: TomTom traffic flow" | 120 s proxy cache. |
| `src/keySetupCore.mjs` | `unlocks: 'Live ships, worldwide'` → `'Ships, worldwide'` | Key-setup rows are labels; 60 s vessel refresh. |
| `src/keySetupCore.mjs` | `unlocks: 'Real live traffic (keyless runs a simulation)'` → `'Real traffic flow (keyless runs a simulation)'` | The real-vs-simulated distinction is kept ("Real … flow"); "live" was the unqualified part. |
| `src/data/dataCredits.js` | `'Live vessels (AIS): '` → `'Vessels (AIS): '` | Attribution popover is a static label; 60 s vessel refresh. |

## Known leftovers (not fixed here)

- **In-app layer names `Live Flights` / `Live Vessels`.** They appear as
  layer names in tests and in `throwIfStaticHosting('Live vessels')`
  messages. A rename must land in app, tests, and docs together.
- **`src/data/localLayers.js`** (`source: 'NASA FIRMS · CONTINUOUS'` /
  dead copy). Already flagged in `docs/data-freshness.md`: no importer
  found, belongs to a dead-code sweep, not a wording fix. Do not copy
  wording out of that file.
- **Marketing prose** (`README.md` narrative sections, image alt-text).
  Left deliberately; a prose rewrite is a separate decision with a
  different reviewer bar than a label fix.
- **`DATA_SOURCES.md` "Live sources" heading.** Defined term with an
  explicit gloss; renaming it would churn the heading for no freshness
  gain.

## When adding or renaming a layer

1. Put the provider name in `source`, nothing else. No `LIVE`, no
   `REAL-TIME` — in the catalog, in `DATA_SOURCES.md`, in `.env.example`
   comments, in key-setup `unlocks`, and in attribution credits.
2. If the layer has a dynamic status line, include the data age in the
   same string (`updated Xm ago`, `cached Xh`).
3. If a proxy cache or source latency adds age beyond the poll, say so
   where the layer is described — that is the number users actually
   experience.
4. Do not name a layer `Live …` without a coordinated rename plan: the
   name propagates into tests and error strings.
