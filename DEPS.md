# DEPS.md — lane-deepseek dependency additions

New runtime dependencies added to `package.json` (exact pins, no ranges).
The orchestrator installs once centrally; **never run `npm install` from a
worktree** (node_modules is a symlink to the shared clone).

| Package | Version | SPDX license | Why needed |
| --- | --- | --- | --- |
| `deck.gl` | 9.4.0 | MIT | GPU-instanced entity scatterplot + H3HexagonLayer for the deck.gl Cesium overlay (`src/layers/deckgl/`). Verified 2026-10-12: deck.gl has **no** official Cesium package (`@deck.gl/cesium` does not exist on npm; `DeckRenderer` is ArcGIS-only in `@deck.gl/arcgis`) — integration is the documented transparent-canvas + `GlobeView` camera-sync pattern. |
| `h3-js` | 4.5.0 | Apache-2.0 | H3 hex-density aggregation toggle for the deck.gl overlay (`latLngToCell`, `cellToBoundary`). |
| `yuka` | 0.7.8 | MIT | Game-AI steering behaviors (flocking, wander, follow-path) for the living traffic sim (`src/sim/yukaTraffic.js`). License verified via npm registry. |
| `socket.io` | 4.8.4 | MIT | War-room transport server (`server/warroom.js`). |
| `socket.io-client` | 4.8.4 | MIT | War-room browser client (`src/warroom/index.js`). |
| `yjs` | 13.6.33 | MIT | CRDT shared annotations for war rooms (server room docs + client `Y.Doc`). |

## Deliberately NOT added

| Package | Version seen | License | Reason |
| --- | --- | --- | --- |
| `maplibre-wind-gl` | 0.3.0 | MIT | Scaffold only: it is a MapLibre `CustomLayerInterface` with no Cesium adapter; porting needs a Cesium Primitive rewrite (see `docs/wind-maplibre-cesium-adapter.md`). Adding an uninstallable dep would be dishonest. |
| `livekit-client` | 2.22.4 | Apache-2.0 | TIER 2 — config + self-host doc only (`docs/livekit-self-host.md`). Install when real rooms are wired. |
| `y-protocols` / `lib0` | — | MIT | Not needed: war-room sync uses a simpler star topology (full state on join + incremental update relay) documented in `server/warroom.js`. |
| `y-websocket` | — | MIT | Not needed: Socket.IO is the transport. |

## Verification notes

- All versions/licenses pulled from the npm registry (`registry.npmjs.org/<pkg>/latest`) on 2026-10-12.
- No secrets, keys, or tokens in any new code (LiveKit creds come from env at runtime).
- New `package.json` export entries: `./layers/debris`, `./layers/deckgl`,
  `./layers/wind-maplibre`, `./sim/yuka-traffic`, `./warroom`,
  `./server/warroom` (node) — each registered in `scripts/package-boundaries.json`.
