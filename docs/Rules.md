# Rules.md — Agent governance (the constitution)

**Authority order:** this file > `docs/Tasks.md` > `docs/PRD.md` >
`docs/Architecture.md` > `docs/Design.md` > `docs/Memory.md`. When two
docs conflict, this one wins. Decisions in `docs/Memory.md` are fixed
only after approval (see § Approval authority) — being written down is
not approval.

## Approval authority (founder-set 2026-10-17, verbatim: "All approvals should be given by muse. If he fails then last my decision")

- **Muse gives ALL approvals:** proposal-engine reviews, GEV
  conflicts, idea-branch merges, deploys, installs, any approval waiting
  on the founder. Agents do not approve their own work.
- **The founder decides only when Muse cannot** (missing evidence,
  genuine ambiguity, or failure) — fallback, not default.
- **NOT delegated, ever:** money/purchases, account sign-ins, KDP final
  Publish click, filings, runtime approval-card taps, bank/tax identity.
  Muse never approves these; do not ask it to.
- Supersedes the earlier "majority YES + founder tiebreak" (2026-10-16)
  and the "merges need founder's explicit go-ahead" rule.

## Collaboration discipline (user orders, standing)

- **One writer, one branch.** Exactly one agent writes on a branch.
  Never commit to a branch someone else owns.
- **One full-suite runner per worktree.** Lanes run TARGETED tests only
  while a merge job owns the full suite.
- **Gates run SOLO.** Never pipe a gate command when relying on its exit
  code (piping masks failures). Never run gates concurrently with another
  full-suite runner — OOM kills have been observed.
- **Never merge, deploy, or force-push except as approved.** A docs file
  does not grant this; approval is per-action.
- **Conflict rule:** work proceeds per the current call. Lanes disagree →
  log the conflict for the final vote, no discussion loops, only
  implementation. The final vote ends the matter — no relitigating.

## Protected: never touch without explicit approval

- `Live Now` (product surface), `.github/workflows` (deploy pipeline),
  any secret or credential.
- `analystEngine.test.mjs` and the 400ms analyst budget — do not touch
  the test or the budget (owner load characterization comes first).
- Cesium Ion token: build env (`CESIUM_ION_TOKEN`) only, never in code,
  never printed. Demo bundle is domain-restricted by design.

## Module boundaries (enforced by `npm run check:boundaries`)

- Every new module is registered in `scripts/package-boundaries.json`
  **in every group whose build graph reaches it**. Do not rewrite that
  file wholesale — surgical inserts only.
- `ui-shell` must NEVER import `../locations.js` (package-boundary
  violation). Use the shell's own `applyCameraState()`.
- Any `src/tooling/*.js` importing `node:fs`/`node:path` trips
  `browserModuleBoundary` — move such modules to `scripts/*.mjs`; the
  test stays under `src/tooling/` importing the scripts path.

## Honest labels (user ruling #7, 2026-10-16: "live means live")

Layer chips are promises. The full vocabulary (user guide):
**LIVE · CONTINUOUS · SNAPSHOT · SIMULATED · PROPAGATED · STALE ·
PRELIMINARY · VINTAGE UNKNOWN**.

- LIVE only for proven-live data/feed. Everything else is CONTINUOUS
  unless another chip fits better.
- Recorded content is always RECORDED-labelled (e.g. City Drives:
  "Recorded drive-through (not live)").
- Feed failure → the layer says "unavailable"/"stale". A dead feed must
  never look like a healthy empty layer. Never present old data as
  current.
- Never claim a deploy is live before the eyes-on check completes.

## Safety and content boundaries (non-negotiable)

- **No private-person surveillance.** No reading number plates, no
  pulling owners' details, no identifying or tracking individuals, no
  zooming into faces/plates. CCTV uses genuinely public traffic/webcam
  sources only (licensed/public-domain, or per-network written
  permission — user ruling #3).
- **YouTube:** EMBED via the official player or LINK OUT. Never
  download, buffer, cache, or re-host other creators' videos. Our own
  content may be buffered; research uses transcripts/metadata first.
  Partners cannot play YouTube like a person — do not claim otherwise.
- **Music/ambience:** no track ships without a named source/licence
  (user ruling #8). Binaural is an audio technique only — no health
  claims (ruling #9).
- **Embeds:** promise only what we control — never a "no ads" promise
  for third-party players (ruling #10).
- **NYC DOT CCTV:** agreement-gated, lowest priority. No code until the
  Video and Traffic Flow Data Sharing Partnership Agreement is signed.
- **Secrets:** no API keys, tokens, or credentials in code or chat. Keys
  via build env or `window.__GOOGLE_MAPS_API_KEY__` only.

## Lane ownership

| Lane | Owns | Must not touch without coordination |
|---|---|---|
| Satellites/GNSS | `src/satellites*`, `src/gnss*`, TLE pipeline | shared camera controller |
| Street Level | street-level providers, photo freshness | layer registry (shared) |
| Geo-import | import loaders, `prepareGeoJson` | provider modules |
| City Drives | `src/ui/cityDrivesPanel.js`, `src/data/cityDrives*.js` | `ui-shell` internals |
| Docs | `docs/`, user guide | production code |
| QA/Scoreboard | tests, scoreboards, CI gates | feature code (report-only) |
| Live Now | live-now server/panel | — (protected: do not touch) |

Shared infrastructure (layer registry, global camera controller, shell)
changes require a named task in `docs/Tasks.md` — never as a drive-by
inside a feature branch. Distinguish file ownership from interface
ownership: you may own a file but not the contract it implements.

## Handoff protocol (required when your lane finishes)

1. Files changed (paths, one per line).
2. Decisions made — or the DEC-xxx in `docs/Memory.md` you followed.
3. Tests run: exact commands + pass/fail counts. Failures listed openly.
4. What you did NOT test, and why.
5. Remaining issues / next lane's starting point.

"Implemented / tested / reviewed / released" are separate statuses.
"Done" without evidence is not done.
