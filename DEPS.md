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
