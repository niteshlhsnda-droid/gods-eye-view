# Live Now — Scoreboard

Visible record of what each lane shipped for the "Live Now" feature
(goal_b30e9ba23ebe). Facts only. If a lane claims done without verification
evidence, it is recorded as **unverified** — Copilot records, Jarvis judges.

Spec (source of truth): `~/workspace/gods-eye-view/specs/live-now.md`

## Status by lane

| Lane | Deliverable (spec §5) | Status | Verified where |
|---|---|---|---|
| Spec | `specs/live-now.md` v1 (acceptance criteria §6) | done 2026-10-13 | spec file, read by all lanes |
| Copilot | CI workflow `.github/workflows/live-now.yml`: feature suites, boundary tests, `check:boundaries`, bundle budget, gitleaks (fails on any finding) | done 2026-10-13 | commands run locally — see "Copilot lane evidence" below |
| Copilot | Boundary contract tests `src/tooling/liveNowBoundaries.test.mjs` (browser `src/livenow/*` can't import server code; `server/providers/livenow/*` can't enter client bundle) | done 2026-10-13 | `node --test src/tooling/liveNowBoundaries.test.mjs`: 6 pass, 1 skip (modules not landed yet) |
| Copilot | Bundle-budget check `tools/check-live-now-bundle.mjs` (≤ 60 KB gz over baseline) | done 2026-10-13 | baseline measured from real build: 3,852,717 gz bytes @ 86c9042; script asserts current − baseline ≤ 61,440 |
| Copilot | Feature-suite runner `tools/run-live-now-tests.mjs` + `npm run test:features` / `test:livenow` (discovers `server/providers/livenow/**/*.test.mjs` + `src/livenow/**/*.test.mjs`) | done 2026-10-13 | exits 0 with "no suites landed yet" note — green pre-landing |
| DeepSeek | `server/providers/livenow/` — ingest, GDELT client, rank, cache, `GET /api/live-now`, severity tables | partially landed 2026-10-13 (uncommitted): `rank.js`, `rank.test.mjs`, `gdelt.js`, `gdelt.test.mjs`, `severity.json` — `ingest.js`/`cache.js` still pending | `npm run test:features`: 33/33 pass; import-directions gate: 1004 modules, 0 violations |
| DeepSeek | ⚠️ `server/providers/livenow/rank.js` and `gdelt.js` fail `npm run format:check` ("Needs formatting") | flagged 2026-10-13 | NOT fixed by Copilot lane — DeepSeek lane must run `npm run format` before committing |
| Gemini | `src/livenow/` — panel, cards, markers, fly-to, tour wiring into `src/director` | pending | — |
| Grok | integration tests for the full loop, visual QA, perf (<300ms panel on cached JSON) | pending | — |
| ChatGPT | copy (card templates, empty states, confidence labels), docs page, demo tour script | landed 2026-10-13 (commit 86c9042): `docs/live-now/copy-pack.md`, `demo-tour-script.md`, `docs-page.md`, `i18n.json` (69 keys × EN/HI/ES/PT) — recorded as landed, not independently verified | commit 86c9042, 4 files, 537 insertions |

## Copilot lane evidence (2026-10-13, branch `feat/live-now`)

- `node --test src/tooling/liveNowBoundaries.test.mjs` → 7 tests, 6 pass, 0 fail,
  1 skip (`livenow modules not landed yet`). Fixture tests prove the checkers
  reject: browser livenow → server import, node builtins in browser code,
  server modules smuggled into a browser boundary build, client modules
  smuggled into a node boundary build.
- `npm run test:features` → exit 0. Pre-landing: printed "no feature suites
  landed yet". After DeepSeek landed `rank.test.mjs` + `gdelt.test.mjs`
  (2026-10-13): discovered and ran both — **33 tests, 33 pass, 0 fail**.
- `npm run format:check` → "Checked 1376 source files", exit 0.
- Baseline build: `npm run build` on `feat/live-now` @ `86c9042` succeeded in
  ~38s; `dist/assets` = 25 JS files, 3,852,717 gzip bytes (largest: egm96 chunk
  1,849,987 B gz; app entry 878,454 B gz). Recorded in
  `tools/check-live-now-bundle.mjs` header.
- `node tools/check-live-now-bundle.mjs` end-to-end (rebuilds, measures,
  compares): **25 JS files, 3,852,717 gz bytes, delta +0 → within budget ✓**,
  exit 0.
- Workflow YAML validated locally; pinned action SHAs mirror `ci.yml` /
  `secrets-scan.yml`. Gitleaks also run locally (binary v8.28.0, repo
  `gitleaks.toml`, full history): **no leaks found** (12 commits, 40.4 MB
  scanned in ~5s).

## Registration contract (for DeepSeek/Gemini lanes, when modules land)

Per the night-sprint "register all sprint modules" convention, when the new
modules exist they MUST be registered or `npm run check:boundaries` fails:

- `package.json` exports: `"./livenow": "./src/livenow/index.js"` (browser)
  and `"./server/providers/livenow": { "node": "./server/providers/livenow/ingest.js" }`
  (node-only — this is what keeps GDELT/API keys out of the client bundle).
- `scripts/package-boundaries.json` groups: `"livenow"` (browser, owns
  `src/livenow/*` modules) and `"livenow-server"` (`"runtime": "node"`, owns
  `server/providers/livenow/*`). Shared portable modules (e.g.
  `src/sources/httpBody.js`) are listed in the importing group's `modules`
  per the shared-module convention — third-party bundles go to `external`.
- The repo-state test in `liveNowBoundaries.test.mjs` is currently skipping;
  it turns green once this registration lands.

## Acceptance criteria tracker (spec §6)

1. `GET /api/live-now` ≤12 ranked events, schema-valid, ≤10 min old — pending (DeepSeek)
2. Kill 2 sources → working panel + stale badges — pending (DeepSeek/Grok)
3. Card tap fly-to ≤2s; tour → shareable Director link — pending (Gemini/Grok)
4. Panel <300ms on cached data; bundle ≤60 KB gz over baseline — CI gate in place (Copilot); client code pending (Gemini)
5. `npm run test:features` green — runner in place (Copilot); suites pending (DeepSeek/Gemini/Grok)
6. No secrets in repo (gitleaks CI); GDELT server-side only, no key in client bundle — CI gate + boundary contract in place (Copilot); code pending
7. i18n EN/HI/ES/PT; a11y keyboard nav, severity not color-only — pending (Gemini/ChatGPT)
