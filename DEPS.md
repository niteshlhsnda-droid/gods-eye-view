# Sprint dependency declarations (night sprint 2026-10-12)

Union of the five lane DEPS.md files. Installed centrally by the orchestrator.


---

## DeepSeek (integration) (`feat/lane-deepseek`)

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


---

## Gemini (architecture) (`feat/lane-gemini`)

# Declared dependencies — Gemini lane (feat/lane-gemini)

Dependencies are declared here and in `package.json` with **exact versions**.
They are NOT installed in this lane (`node_modules` is a symlink to the shared
clone; `npm install` is forbidden). The orchestrator installs once centrally.

| Name | Version | SPDX license | Why |
| ---- | ------- | ------------ | --- |
| `animejs` | 4.5.0 | MIT | Approved animation library for Director Mode auto-tours (`src/director/tours/autoTour.js` — `createTourRunner` drives cinematic camera tweens via `anime.createTimeline`). Chosen over GSAP, which is proprietary and banned from this codebase. Verified via jsDelivr/npm listing: v4.5.0, MIT. |
| `@turf/turf` | 7.1.0 | MIT | Geospatial analysis for the multi-globe comparison (`src/compare/compareModel.js` — `computeAreaDelta` uses `turf.area` + `turf.difference` for before/after deltas, e.g. flood-area delta in km²). Injected, never statically imported, so modules stay unit-testable. Verified via Turfjs/turf releases: v7.1.0, MIT. |
| `@mkkellogg/gaussian-splats-3d` | 0.4.7 | MIT | Three.js-based 3D Gaussian splat viewer for the digital-twin panel (`src/twin/twinViewer.js` — `viewerFactoryFromModule` wraps `Splats.Viewer`; `addSplatScene` loads `.ply`/`.splat`/`.ksplat`). Injected for testability. Verified via jsDelivr/npm listing: v0.4.7, MIT. |

## License audit notes (2026-10-12)

- All three packages are MIT-licensed and compatible with this repo's MIT license.
- No copyleft, no proprietary, no commercial-use restrictions found on the
  packages themselves.
- Caveat: Gaussian-splat *data* carries its own rights — splat scenes a user
  captures are theirs, but the subjects in front of the lens (private property,
  artwork, people) are the user's responsibility to clear. Documented in
  `docs/digital-twin-pipeline.md`.


---

## Grok (trust/QA) (`feat/lane-grok`)

# DEPS.md — Grok lane (trust / QA) dependency declarations

Branch `feat/lane-grok`. Only dependencies added or changed by this lane are
listed below. Everything else is unchanged from the base commit — see
`package.json` for the full tree.

| Name | Version | SPDX | Scope | Why |
|---|---|---|---|---|
| `playwright` | `1.64.0` (exact) | MIT | devDependency | Smoke gate: page loads, Cesium globe renders, zero console errors (`tests/smoke.spec.mjs`, CI `browser-gates.yml`) |
| `axe-core` | `4.14.0` (exact) | MPL-2.0 | devDependency | Accessibility gate: no critical-impact violations on the built page (`tests/axe-audit.spec.mjs`, CI `browser-gates.yml`) |

## New code with zero new runtime dependencies

- `src/anomaly/` (clean-room heuristic anomaly engine) — stdlib only.
- `src/data/feedState.js` latency tracker — stdlib only.
- `src/director/sharing/redaction.js` + `provenance.js` — stdlib only
  (deface runs out-of-band; see License verdicts).

## License verdicts (audited 2026-10-12)

| Repo | Declared license | Verdict |
|---|---|---|
| `signal-anomaly-detective` | **None declared** | **BLOCKED — never vendored.** Idea reimplemented clean-room in `src/anomaly/` (original code, fixed lookups + geometric clustering, no model). |
| `deepfake-detection` | **None declared** | **BLOCKED — never vendored.** No "AI probability" is computed or shown; the lane ships an honest provenance/metadata panel instead (`src/director/sharing/provenance.js`). |
| `alethia-main` | **None declared** | **BLOCKED — never vendored.** Same reasoning as `deepfake-detection`. |
| `deface` (ORB-HD/deface) | **MIT** (declared on the GitHub repo page; fork docs confirm "MIT — same as upstream") | **ALLOWED.** Faces-only face redaction. Integrated as a policy gate + attestation contract in the share-a-scene flow (`src/director/sharing/redaction.js`); the detector itself runs out-of-band via the deface CLI (Python/ONNX/ffmpeg — cannot run in the browser client). CenterFace model bundled by deface is also MIT per downstream docs. |

## Notes

- `node_modules` is a symlink to the shared clone; `npm install` was never run.
  The orchestrator installs centrally from the exact versions above.
- No secrets were introduced. CI fails on secrets via `secrets-scan.yml`
  (gitleaks, full history) and a pre-commit hook (`.pre-commit-config.yaml`).


---

## ChatGPT (experience) (`feat/lane-chatgpt`)

# ChatGPT lane — declared dependencies

Sprint: God's Eye View "experience / UX" lane (branch `feat/lane-chatgpt`).
Rule: never `npm install` in the lane — the orchestrator installs centrally from
`package.json`. Every new runtime dependency is declared there (exact version)
and documented here with its SPDX license and purpose.

| Package | Version | SPDX | Purpose |
|---|---|---|---|
| `@knight-lab/timelinejs` | 3.9.13 | MPL-2.0 | Story Mode timeline renderer (NUKnightLab/TimelineJS3). Used unmodified as a library via lazy `import()`; the story engine (`src/story/storyEngine.js`) is dependency-free and drives camera + layers even if the package is absent. **License note:** MPL-2.0 is weak (file-level) copyleft — linking it unmodified into the larger MIT work is permitted; do not copy its sources into the repo. |
| `driver.js` | 1.9.0 | MIT | Onboarding guided tour (`src/onboardingTour.js`). Vanilla, ~5kb, no dependencies. Lazy-loaded; tour steps are pure data so the tour degrades to a no-op if the import fails. |
| `i18next` | 26.4.4 | MIT | 4-language UI (`src/i18n/`). Lazy-loaded; a bundled fallback interpolator keeps every label working when the package is unavailable. |
| `rrweb` | 2.1.7 | MIT | Session record/replay (`src/replay/`). DOM-session replay — a different mechanism from the Gemini lane's Director Mode camera-tour share links (asset-bundle based, no URL params), so there are no file or param conflicts. Replay links use `?gev-replay=<sessionId>`. |
| `@oddsrabbit/toastry` | 1.2.0 | MIT | Toast system for Alert Me (`src/alerts/toasts.js`). Zero dependencies, ES modules, CSS auto-injected. (Note: the bare `toastry` name on npm is an unrelated 0.0.1 stub — the scoped `@oddsrabbit/toastry` is the maintained package.) Falls back to a local DOM renderer when unavailable. |
| `animejs` | 4.5.0 | MIT | Micro-animations (`src/ui/animate.js`): toast entrances, share-sheet open/close, story caption transitions. Lazy-loaded with a CSS-transition fallback; `prefers-reduced-motion` is always honored. GSAP is never used (proprietary). |

## Language choice for i18n (EN + HI + 2)

- **ES (Spanish)** — second-largest native-speaker base; maximizes classroom reach for Story Mode, the feature this locale set exists to serve.
- **PT (Portuguese)** — Brazil is one of the largest Lusophone internet populations; both additions are LTR, so no RTL layout work is required.

Translator-contribution path: `src/i18n/CONTRIBUTING.md`.

## Post-install step (orchestrator)

After the central `npm install`, add the TimelineJS3 stylesheet to the root
`style.css` (it is deliberately not imported from JS — a static import of an
uninstalled package breaks `npm test` and the build):

```css
@import '@knight-lab/timelinejs/dist/css/timeline.css';
```

If the installed package reports a different dist layout, point the import at
its actual CSS file. Without this line the timeline still mounts and drives
the story; it just renders unstyled.

## Push notifications

Explicitly deferred: `src/alerts/` ships toast alerts now. `getPushStatus()` /
`requestPushPermission()` document the later milestone and never request
permission today.


---

## Copilot (metrics) (`feat/lane-copilot`)

# Lane-copilot dependency declarations

New runtime dependencies declared in `package.json` by the copilot (metrics /
scoreboard) lane. Versions are pinned exact; licenses verified against the
npm registry on 2026-10-12. **The orchestrator installs centrally — never run
`npm install` in this worktree.**

| Package | Version | SPDX license | Why |
|---|---|---|---|
| `echarts` | 6.1.0 | Apache-2.0 | Apache ECharts HUD telemetry strip (`src/metrics/telemetryStrip.js`): live altitude/speed chart with history sparklines for tracked targets. Lazy-loaded; strip no-ops when absent. |
| `web-vitals` | 6.2.3 | Apache-2.0 | Core Web Vitals measurement (CLS/INP/LCP/FCP/TTFB) via `src/metrics/analytics.js`. Opt-in; no key required. |
| `heatmap.js` | 2.0.5 | MIT | Interaction heatmaps (`h337`) via `src/metrics/analytics.js`. Opt-in; no key required. Registry `license` field is empty but the package ships MIT license text (pa7/heatmap.js). |
| `posthog-js` | 1.438.8 | (Apache-2.0 AND MIT) | Product analytics via `src/metrics/analytics.js`. No-op without `apiKey`. |
| `@sentry/browser` | 11.7.0 | MIT | Browser error monitoring via `src/metrics/analytics.js`. No-op without `dsn`. |
| `@opentelemetry/sdk-trace-web` | 2.12.0 | Apache-2.0 | Browser distributed tracing via `src/metrics/analytics.js`. No-op without OTLP `endpoint`. |
| `@growthbook/growthbook` | 1.8.0 | MIT | Feature flags / experimentation via `src/metrics/analytics.js`. No-op without `clientKey`. |

## Notes

- All seven are **optional at runtime**: every consumer uses dynamic
  `import()` inside try/catch and degrades to a no-op status object when the
  package is not installed. The app must never break because a measurement
  package is missing.
- No secrets or keys are declared here or in code. Keys arrive at runtime via
  `initMetrics(config)` (see `docs/METRICS.md`).
- `echarts` is the only one with a UI-facing consumer; the rest are
  measurement-only and add zero bytes to the critical path when disabled
  (they are never statically imported).
