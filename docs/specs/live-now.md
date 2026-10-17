# BUILD SPEC — "Live Now": the daily-habit view for God's Eye View

**Status:** spec for lane review (not yet approved for build)
**Date:** 2026-10-13 | **Goal:** goal_b30e9ba23ebe
**Author:** Jarvis (main agent), from user direction: *"don't add features, add reasons to open the app daily"*

---

## 1. What it is

A single "Live Now" entry point on the globe that answers: **what happened on Earth recently?**
On load (or one tap), the user gets a ranked carousel of recent events — cyclones, quakes, fires,
breaking news clusters, air-traffic anomalies, satellite events — each with a card stamped with its
snapshot time; tapping a card
flies the camera to the event; a "Play today's tour" button auto-generates a Director Mode cinematic
tour through the top events.

This is the feature that turns God's Eye View from a tool you admire into a habit you open daily.

## 2. Non-goals (explicitly out of this sprint)

- Famous-people tracking layer (round-2 Domain A — next sprint)
- Price predictions panel (round-2 Domain B — next sprint)
- Push notifications (backlog item; Live Now ships pull-first)
- User accounts / personalization
- Mobile app port

## 3. What already exists (reuse, don't rebuild)

| Existing piece | Location | Reuse as |
|---|---|---|
| RSS news aggregation + normalization | `server/providers/regional/news.js`, `src/data/regionalModel.js` | one ingest source |
| Anomaly detectors (squawk 7700/7600/7500, AIS dark gaps, quake swarms) | `src/anomaly/` | event sources with severity |
| Weather alerts, cyclones, FIRMS fires | `server/providers/weather.js`, `cyclones.js`, `firms.js` | event sources |
| Live provider registry | `server/providers/live.js` | registry to extend |
| Director Mode camera tours, playback, sharing | `src/director/` | "Play today's tour" + card fly-to |
| Feed-health badges | sprint module | per-source health display on the panel |

**New:** GDELT 2.0 DOC API client (round-2 consensus pick: `alex9smith/gdelt-doc-api`,
canonical PyPI package `gdeltdoc`, MIT). Used **only** as an *attention meter* (article-volume
timelines per topic) to rank news clusters, not as an archive — the DOC API caps at 250 rows /
3 months. Runs server-side in the existing Node/Python sidecar pattern behind the proxy-key setup.

## 4. Architecture

### 4.1 Unified event schema

```ts
interface LiveEvent {
  id: string;            // stable: `${type}:${geohash5}:${keywordHash}`
  type: 'cyclone' | 'quake' | 'fire' | 'news' | 'aviation' | 'maritime' | 'space' | 'weather';
  title: string;         // ≤ 90 chars, human-written template per type
  summary: string;       // ≤ 200 chars
  lat: number; lon: number;
  severity: 1 | 2 | 3 | 4 | 5;      // normalized per type (see §4.3)
  startedAt: string;     // ISO
  updatedAt: string;     // ISO
  sources: { name: string; url: string }[];  // ≥1, provenance requirement
  confidence: 'verified' | 'reported' | 'unconfirmed';
  mediaAttention?: number;  // 0–100, from GDELT volume timeline (news type only)
  links: { label: string; url: string }[];   // deep links: fly-to is client-side
}
```

### 4.2 Ingest pipeline (server)

New module: `server/providers/livenow/` 

- `ingest.js` — pulls each source on a 10-minute cron, normalizes to `LiveEvent[]`
- `gdelt.js` — GDELT DOC client wrapper (timeline mode); keyed queries from news-cluster keywords
- `rank.js` — dedupe + scoring (see §4.3)
- `cache.js` — writes `public/data/live-now.json` (≤ 200 KB target); serves `GET /api/live-now`
- Health: each source reports to the existing feed-health badge system; a dead source degrades
  the panel (shows "2 sources stale") rather than failing the whole view

Dedupe rule: same `type` + geohash-5 + overlapping keyword set within 6h ⇒ merge, keep earliest
`startedAt`, union sources. Prevents the "5 outlets, 5 cards for one cyclone" problem.

### 4.3 Ranking (transparent, tunable)

```
score = recency(0–40) + severity(0–30) + sourceCount(0–20) + mediaAttention(0–10)
```

- `recency`: linear decay, 40 at t=0 → 0 at 24h (events older than 48h drop out entirely)
- `severity`: per-type mapping table in `rank.js` (e.g. quake M≥6 → 5, squawk 7700 → 5,
  Cat-3+ cyclone → 5, FIRMS cluster >50 hotspots → 4). Table is data, not code — tunable JSON.
- `sourceCount`: 2+ independent outlets → full marks (anti-single-rumor weight)
- `mediaAttention`: GDELT percentile for news-type events

Top 12 returned; client renders all 12, globe shows top 5 as pulsing markers.

### 4.4 Client UI

New module: `src/livenow/` (browser boundary — must satisfy `package-boundaries.json`)

- `panel.js` — "Live Now" button in the main toolbar (globe icon with pulsing dot when ≥1
  severity-5 event is fresh); opens a bottom-sheet carousel of event cards
- `card.js` — card: severity chip, title, summary, time-ago, source count, confidence label,
  "Fly there" button
- `tour.js` — "Play today's tour": builds a `src/director` camera document from the top 8
  ranked events (3s dwell each), hands to existing playback + shareable tour links
- `markers.js` — top-5 events as pulsing markers. **Implementation note (2026-10-13):**
  implemented with Cesium pulsing entities rather than the deck.gl/H3 layer originally
  specified here, because the sprint's deck.gl layer is not yet mounted in the app. The visible
  requirement (pulsing top-5 markers) is met; a future pass may migrate markers to deck.gl/H3
  once that layer is mounted.
- Empty state: "Quiet planet — last checked Xm ago" (copy by ChatGPT lane)
- i18n: EN/HI/ES/PT strings from day one (sprint established the pattern)

### 4.5 Provenance & safety gates (non-negotiable)

- Every card shows ≥1 source link; `confidence: unconfirmed` events get a visible "unconfirmed"
  treatment and never appear in the auto-tour
- No private-person data: news-cluster keywords come from public feeds only; the famous-people
  layer is a separate future sprint with its own review
- Severity-5 aviation/maritime events: title templates must not speculate on casualties
  (templates reviewed by ChatGPT lane)

## 5. Lane plan

| Lane | Owner | Deliverable |
|---|---|---|
| DeepSeek | build | `server/providers/livenow/` — ingest, GDELT client, rank, cache, `/api/live-now`, severity tables |
| Gemini | build | `src/livenow/` — panel, cards, markers, fly-to, tour builder wiring into `src/director` |
| Grok | finish/QA | integration test the full loop, visual QA pass, perf (panel open <300ms on cached JSON), edge cases |
| ChatGPT | sell | all user-facing copy (card templates per type, empty states, confidence labels), docs page, demo tour script |
| Copilot | scoreboard | CI workflow for the new modules, bundle-budget check (panel ≤ 60 KB gz), boundary tests |

Cross-lane contract: DeepSeek's `/api/live-now` JSON shape (the `LiveEvent` schema above) is frozen
before Gemini starts client work. Lanes coordinate via `post` CLI as in the night sprint.

## 6. Acceptance criteria

1. `GET /api/live-now` returns ≤12 ranked events, valid against the schema, refresh ≤10 min old
2. Killing any 2 sources still yields a working panel with stale-source badges (degrade, don't die)
3. Card tap flies camera to event ≤2s; "Play today's tour" produces a shareable Director link
4. Panel opens in <300ms on cached data; new bundle ≤60 KB gz over current baseline
5. `npm run test:features` green for all new modules; browser test: carousel renders with mock JSON
6. No secrets in repo (gitleaks CI), GDELT queried server-side only, no API key in client bundle
7. i18n strings present for EN/HI/ES/PT; a11y: cards keyboard-navigable, severity not color-only

## 7. Data licensing notes

- GDELT 2.0 DOC API: free for research/non-commercial use via the public API; volume queries only,
  no article redistribution — we store counts + links, not article text
- News RSS: headlines + links only (existing pattern in `news.js`; no full-text storage)
- USGS quakes, FIRMS fires, NOAA weather: public domain / open — fine
- Aviation/maritime anomaly: derived from already-ingested public feeds; no new license surface

## 8. Estimate

One focused sprint at night-sprint pace: **3–4 nights** for MVP (ingest + ranking + panel + tour),
then 2–3 nights polish/QA. Roughly one week wall-clock with lanes parallel.

## 9. What "done" looks like

A user opens the globe, taps Live Now, sees "Cyclone Remal — Cat 3, landfall in 6h", taps it,
flies over the Bay of Bengal, hits "Play today's tour", and shares the link on WhatsApp.
That loop — open, see, fly, share — is the habit.
