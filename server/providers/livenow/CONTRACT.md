# Live Now — frozen API contract (v1)

**Status:** FROZEN by the DeepSeek BUILD lane, 2026-10-13. The Gemini lane may
build `src/livenow/` against this shape. Any change needs a version bump and a
new freeze announcement.

**Endpoint:** `GET /api/live-now` → `200 application/json` (served from the
atomic cache `public/data/live-now.json`; refresh cadence 10 min).
`503 {error:'live_now_unavailable'}` only when no cache exists yet.

## Top-level shape

```jsonc
{
  "schema": "gev/live-now",      // string, constant
  "version": 1,                  // integer; bump on breaking change
  "generatedAt": "2026-10-13T14:18:46.295Z", // ISO-8601, cache write time
  "events": [ /* LiveEvent[], ≤12, ranked desc by score */ ],
  "feedHealth": { /* gev/feed-health contract v1, see below */ },
  "staleSources": ["fires", "weather", "maritime"] // adapter ids not nominal
}
```

## LiveEvent (spec §4.1 + documented extras)

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable: `${type}:${geohash5}:${keywordHash8}` |
| `type` | enum | `cyclone` `quake` `fire` `news` `aviation` `maritime` `space` `weather` |
| `title` | string | ≤90 chars. ⚠️ DRAFT copy — ChatGPT lane owns final templates |
| `summary` | string | ≤200 chars |
| `lat`, `lon` | number | event centroid |
| `severity` | 1–5 | from `severity.json` (tunable data) |
| `startedAt`, `updatedAt` | ISO-8601 | |
| `sources` | `[{name, url}]` | ≥1, provenance requirement |
| `confidence` | enum | `verified` `reported` `unconfirmed`. `unconfirmed` events get a visible treatment and are EXCLUDED from auto-tours |
| `mediaAttention` | number 0–100 | GDELT attention meter; **news type only**, omitted otherwise |
| `links` | `[{label, url}]` | deep links (fly-to is client-side) |
| `keywords` | string[] | **extra**: dedupe keys; safe to ignore or show as tags |
| `score` | number 0–100 | **extra**: transparent rank score (recency 40 + severity 30 + sourceCount 20 + mediaAttention 10) |

## feedHealth block

Follows the repo's `gev/feed-health` contract (v1) — the same shape the World
Pulse dashboard consumes. Per-source entries:

```jsonc
{ "id": "quakes", "label": "Earthquakes (USGS)", "state": "nominal",
  "grade": "A", "score": 100, "lastUpdate": "2026-10-13T14:18:46.295Z",
  "ageMs": 836, "messageCount": 23, "latencyMs": null, "note": null }
```

`state` ∈ `nominal | loading | degraded | stale | partial | fallback | unavailable`.
A dead source shows its non-nominal state (stale badge) — the panel keeps
working on the remaining sources.

## Real example response (2026-10-13, live ingest)

```json
{
  "schema": "gev/live-now",
  "version": 1,
  "generatedAt": "2026-10-13T14:18:46.295Z",
  "events": [
    {
      "id": "quake:7xfjw:cb1d7d9f",
      "type": "quake",
      "title": "M6.9 earthquake — central Mid-Atlantic Ridge",
      "summary": "Magnitude 6.9 earthquake central Mid-Atlantic Ridge. Reported by USGS.",
      "lat": -0.4016,
      "lon": -19.4151,
      "severity": 5,
      "startedAt": "2026-10-13T12:23:07.383Z",
      "updatedAt": "2026-10-13T12:23:07.383Z",
      "sources": [
        { "name": "USGS", "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us6000u214" }
      ],
      "confidence": "verified",
      "links": [
        { "label": "USGS event page", "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us6000u214" }
      ],
      "keywords": ["earthquake", "central", "atlantic", "ridge"],
      "score": 75
    }
  ],
  "feedHealth": {
    "contract": "gev/feed-health",
    "version": 1,
    "generatedAt": "2026-10-13T14:18:46.295Z",
    "source": "livenow-ingest",
    "overall": { "grade": "C", "score": 62 },
    "feeds": [
      { "id": "quakes", "label": "Earthquakes (USGS)", "state": "nominal", "grade": "A", "score": 100, "lastUpdate": "2026-10-13T14:18:46.295Z", "ageMs": 836, "messageCount": 23, "latencyMs": null, "note": null },
      { "id": "cyclones", "label": "Cyclones (NOAA NHC)", "state": "nominal", "grade": "A", "score": 100, "lastUpdate": "2026-10-13T14:18:46.295Z", "ageMs": 836, "messageCount": 1, "latencyMs": null, "note": null },
      { "id": "fires", "label": "Fires (NASA FIRMS)", "state": "unavailable", "grade": "F", "score": 0, "lastUpdate": null, "ageMs": null, "messageCount": null, "latencyMs": null, "note": "no FIRMS_MAP_KEY configured" },
      { "id": "weather", "label": "Weather alerts (NWS)", "state": "unavailable", "grade": "F", "score": 0, "lastUpdate": null, "ageMs": null, "messageCount": null, "latencyMs": null, "note": "NWS unreachable" },
      { "id": "news", "label": "News clusters (Google News RSS)", "state": "nominal", "grade": "A", "score": 100, "lastUpdate": "2026-10-13T14:18:46.295Z", "ageMs": 836, "messageCount": 18, "latencyMs": null, "note": null },
      { "id": "aviation", "label": "Aviation (adsb.lol)", "state": "nominal", "grade": "A", "score": 100, "lastUpdate": "2026-10-13T14:18:46.295Z", "ageMs": 836, "messageCount": 412, "latencyMs": null, "note": "military feed sample" },
      { "id": "maritime", "label": "Maritime (AIS)", "state": "unavailable", "grade": "F", "score": 0, "lastUpdate": null, "ageMs": null, "messageCount": null, "latencyMs": null, "note": "no AIS traffic in this process (vessel layer not streaming)" }
    ]
  },
  "staleSources": ["fires", "weather", "maritime"]
}
```

## Client rules (for the Gemini lane)

1. Render all ≤12 `events` in the carousel; top 5 by `score` as pulsing globe markers.
2. Pulsing toolbar dot when ≥1 event has `severity: 5` and `startedAt` < 6h ago.
3. `confidence: "unconfirmed"` → visible "unconfirmed" treatment; **never** in auto-tours.
4. Empty `events` → "Quiet planet — last checked Xm ago" (Xm from `generatedAt`).
5. Per-feed badges: read `feedHealth.feeds[].state`; non-nominal → stale/degraded badge.
6. Severity-5 aviation/maritime titles never speculate on casualties (server templates comply; keep it so).
7. i18n EN/HI/ES/PT from day one; severity must not be color-only (a11y).

## Safety gates (non-negotiable)

- No private-person data anywhere: news keywords come from public feeds only.
- GDELT stores counts + links, never article text. Server-side only, no key in client code.
- `severity.json` is tunable data — severity policy changes need no code deploy review.
