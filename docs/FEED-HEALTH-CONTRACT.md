# `window.__feedHealth` contract (gev/feed-health v1)

Shared contract between the live app, the World Pulse dashboard, and the Grok
lane's feed-health data model. Implemented in
`src/metrics/feedHealthContract.js` (portable — no browser globals, works in
Node); the live-app adapter lives in `src/metrics/worldPulsePublisher.js`.

## Shape

```jsonc
{
  "contract": "gev/feed-health",
  "version": 1,
  "generatedAt": "2026-10-12T18:00:00.000Z",
  "source": "gods-eye-view",
  "overall": { "grade": "C", "score": 50 },
  "feeds": [
    {
      "id": "flights",            // stable feed id
      "label": "Flights (ADS-B)", // human label
      "state": "stale",           // nominal|loading|degraded|stale|partial|fallback|unavailable
      "grade": "C",               // public letter: A|B|C|D|F
      "score": 50,                // 0–100
      "lastUpdate": "2026-10-12T17:41:00.000Z",
      "ageMs": 1140000,
      "messageCount": 1842,
      "latencyMs": 380,
      "note": "adsb.lol fallback active"
    }
  ]
}
```

## State → grade mapping

| state | grade | score |
|---|---|---|
| nominal | A | 100 |
| loading, partial | B | 80 / 75 |
| fallback, stale | C | 60 / 50 |
| degraded | D | 30 |
| unavailable (incl. unknown states) | F | 0 |

`overall` is the **worst** feed grade, never the average — one dead feed must
not hide behind healthy ones.

## Where it is published

`publishFeedHealth(snapshot, { host, storage })` writes:

1. `host.__feedHealth` (usually `globalThis`) — live in-page reads.
2. `storage` key `gev:feed-health:v1` (usually `localStorage`) — the World
   Pulse dashboard reads this when opened as a standalone page.

The dashboard's fallback chain is: `window.__feedHealth` →
`localStorage["gev:feed-health:v1"]` → `feed-health.json` (static, optional) →
clearly-labelled sample data.

## Wiring the live app (one call)

```js
import { startFeedHealthPublishing } from './metrics/worldPulsePublisher.js';

startFeedHealthPublishing({
  getLayers: () => [
    { id: 'flights', label: 'Flights (ADS-B)', stats: flights.getStats() },
    { id: 'vessels', label: 'Vessels (AIS)', stats: vessels.getStats() },
    // … one entry per layer
  ],
});
```

Layer states go through the existing `layerFeedState()` normalizer
(`src/data/feedState.js`), so the dashboard can never disagree with the
app's own layer chips. Publishing every 30 s by default.

## Coordination note (Grok lane)

The Grok lane owns the deeper feed-health data model. Anything that emits
the shape above — whichever lane produces it — feeds the same dashboard.
If the shape needs to change, bump `FEED_HEALTH_CONTRACT_VERSION` and update
`public/pulse.html`'s renderer in the same commit.
