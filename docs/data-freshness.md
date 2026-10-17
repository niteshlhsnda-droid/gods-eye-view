# Data freshness: what "live" means on this map

This page is the human-readable companion to the machine-readable
`gev/feed-health` contract (`docs/FEED-HEALTH-CONTRACT.md`). That contract
reports per-feed grades; this page says, in plain words, how often each layer
actually re-polls and what its "live" wording is allowed to claim.

## The rule

**A static label must never assert liveness.** Static source strings name the
provider only (for example `NASA FIRMS`). The word `LIVE` may appear only in a
dynamic, age-qualified label that already shows how old the data is (for
example `LIVE · updated 12m ago`), and even there it means "fresh per the
feed's own stale flag", not "instantaneous".

The reason is arithmetic, not pedantry: a poll interval is the time between
`update()` calls (`src/data/lifecycle.js`, `_armUpdateLoop`). It is not a
guarantee of new data. Upstream feeds may return unchanged data, and proxy
caches add age on top of the poll interval. A static `LIVE` badge hides all of
that; an age qualifier shows it.

## How fresh each layer is

Every cadence below was read from the cited source line. "Poll" means the
lifecycle manager's tick between `update()` calls while the layer is enabled.
Where a proxy cache or source latency adds age beyond the poll, the table says
so — that extra age is the part a `LIVE` badge would hide.

| Layer | Poll cadence | What the cadence does not cover |
| --- | --- | --- |
| Military Flights | 15 s (`src/layers/military/queries.js`) | — |
| Transit (GTFS-RT) | 15 s (`src/layers/transit/policy.js`, `TRANSIT_POLL_MS`) | — |
| Live Flights | 30 s (`src/layers/flights/queries.js`) | — |
| Live AIS Vessels | 60 s (`src/layers/vessels/policy.js`, `REFRESH_MS`) | — |
| Earthquakes (24h) | 60 s (`src/layers/earthquakes/index.js`) | — |
| Bikeshare | 60 s (`src/layers/bikeshare/policy.js`, `STATUS_POLL_MS`) | Station-status refresh, not vehicle movement. |
| CCTV | 10 s active frame refresh, 60 s idle (`src/layers/cctv/policy.js`) | Still frames, not video. |
| FIRMS Active Fires | Client polls every 10 min (`src/layers/firms/policy.js`); proxy cache TTL 30 min (`server/providers/firms.js`, `TTL_MS`) | Displayed data can be ~40 min old at the moment it renders, and detections cover the trailing 24 h of VIIRS/MODIS NRT passes (`DATA_SOURCES.md`). Serve-stale-on-failure past the TTL is flagged `STALE`, not `LIVE`. |
| Weather — rain radar / satellite clouds | 2 min (`src/layers/weather/index.js`) | Satellite clouds are hourly imagery with typically 2–3 h source latency (`docs/KNOWN-ISSUES.md`). A 2 min poll re-fetches; it does not make the clouds 2 min old. |
| Weather — lightning density | 10 min (`src/layers/weather/index.js`) | A 15-minute density product on an ~8 km grid, not a live strike counter (`docs/KNOWN-ISSUES.md`). |
| Cyclone advisories | 5 min (`src/layers/cyclones/index.js`) | Advisories only, NOAA basins only (`docs/KNOWN-ISSUES.md`). |
| Space Missions (30d) | 5 min (`src/layers/launches/controls.js`) | Schedule data, not a live launch stream. |
| Fire Perimeters | 5 min (`src/layers/perimeters/index.js`) | Perimeters, not fire-front movement. |
| Satellites | Positions propagated per frame from TLEs; catalog refresh 5 min (`src/layers/satellites/controls.js`) | Propagated, not tracked: positions are computed from the last element set. |
| Orbital Debris | 30 min (`src/layers/debris/index.js`) | Propagated from element sets, like satellites. |
| Radio | 45 min (`src/layers/radio/controls.js`) | Station-directory refresh, not audio. |
| Wind | 60 min (`src/layers/wind/index.js`) | A forecast (`GFS / ECMWF IFS · FORECAST`), not observations. |
| Street Traffic | No periodic poll (`updateInterval: 0`); self-managed via camera listener + preRender (`src/layers/traffic/controls.js`) | Dots are simulated flow on road data, per the layer's own controls. |
| No periodic refresh (`updateInterval: 0`) | ALPR Cameras, Global Context, Mapped Installations, Directions, Recent Imagery, Street Level, Submarine Cables | The lifecycle manager does not re-poll these (`src/data/lifecycle.js`, `_armUpdateLoop`); they load on demand or manage their own updates. |

## Case study: FIRMS stopped saying LIVE

The FIRMS layer used to carry `source: 'NASA FIRMS · LIVE'` in the application
catalog (`src/app/constructCatalog.js`), and the key-setup row promised `Live
active-fire detections` (`src/keySetupCore.mjs`). Both were unconditional:
the row read `LIVE` even when the proxy was serving a past-TTL cached payload
or when no key was configured at all.

The code already knew better. The dynamic row detail is age-qualified —
`LIVE · updated Xm ago` when fresh, `STALE · cached Xh` when the proxy serves
past-TTL cache (`src/layers/firms/queries.js`, `getStats`) — and the stale
flag comes from the proxy payload itself (`src/layers/firms/ingestion.js`,
`_stale = Boolean(payload?.stale)`), with `_lastUpdate` set to the proxy's
`fetchedAt`, i.e. data age, not response age.

The fix follows the code's own honest pattern:

- Catalog source string: `NASA FIRMS · LIVE` → `NASA FIRMS` (matching the
  factory default already in `src/app/layers/firms.js`).
- Key-setup row: `Live active-fire detections` → `Active-fire detections`.
- `DATA_SOURCES.md`: `fetched live at runtime` → `fetched at runtime` (the
  same paragraph documents the 30 min proxy cache).
- The dynamic `LIVE · updated Xm ago` label is kept: it carries its age
  qualifier and flips to `STALE` when the payload is past-TTL.

## Known leftover (not fixed here)

The same retired string still exists in `src/data/localLayers.js`
(`source: 'NASA FIRMS · LIVE'`). A repo-wide grep finds no importer for that
module, so it was deliberately left untouched — it belongs to a dead-code
sweep, not to a wording fix. Do not copy wording out of that file.
Historical quotes of the old row in `docs/CURRENT-STATE.md` are log entries,
not live copy, and are left as written.

## When adding or renaming a layer

1. Put the provider name in `source`, nothing else. No `LIVE`, no `REAL-TIME`.
2. If the layer has a dynamic status line, include the data age in the same
   string (`updated Xm ago`, `cached Xh`).
3. Add a row to the table above with the poll interval and the file that sets
   it. If a proxy cache or source latency adds age beyond the poll, say so —
   that is the number users actually experience.
