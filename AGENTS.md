# AGENTS.md — God's Eye View

Entry point for coding agents. Read before touching any code. This file does
not duplicate the docs below — it tells you what to read, in what order,
for your task.

## Read order by task

| Your task | Read first | Then |
|---|---|---|
| New feature / UI change | `docs/Rules.md` → `docs/Design.md` | `docs/PRD.md`, `docs/Architecture.md` |
| Provider / data-layer change | `docs/Rules.md` → `docs/Architecture.md` | `docs/PRD.md` (FR-xxx for that layer) |
| Fixing a bug | `docs/Memory.md` (known quirks) → `docs/Architecture.md` | `docs/Tasks.md` if it has a GEO-xxx entry |
| Anything touching layer honesty labels | `docs/Rules.md` § Honest labels + `docs/Design.md` § State catalog | — |
| Picking up backlog work | `docs/Tasks.md` | `docs/Rules.md` |

Words we use have fixed meanings — see `docs/GLOSSARY.md` (lane, layer,
panel, chrome, shell, cycle, scratch branch, batch merge, gate, toast).

## Hard rules (full text in docs/Rules.md)

1. **One writer, one branch.** Never commit to a branch someone else owns.
2. **Approvals come from Muse.** You do not approve your own merge/deploy.
   The founder decides only if Muse cannot. Money, sign-ins, filings,
   and the KDP Publish click are never delegated.
3. **Gates run solo.** Never pipe a gate command when you rely on its exit
   code. Never run gates concurrently with another full-suite runner (OOM).
4. **Never touch:** `Live Now`, deploy workflows (`.github/workflows`),
   secrets, `analystEngine.test.mjs`, or the 400ms analyst budget.
5. **New modules must be registered** in `scripts/package-boundaries.json`
   in every group whose build graph reaches them. `ui-shell` must never
   import `../locations.js`. `src/tooling/*.js` may not import `node:fs`
   (move such modules to `scripts/*.mjs`).
6. **Build/deploy:** `vite build --base=/gods-eye-view/` with
   `CESIUM_ION_TOKEN` in the build env only. Never hardcode the token.
7. **Labels are promises.** LIVE means live. Recorded means RECORDED.
   Everything else is CONTINUOUS. A dead feed must say so — it must never
   look like a healthy empty layer.
8. **No private-person surveillance.** No plate reading, no owner lookups,
   no identifying individuals. CCTV only from genuinely public sources.
9. **YouTube:** embed the official player or link out. Never download,
   buffer, or re-host someone else's video.

## Handoff format (what you report when done)

- Files changed (paths).
- Decisions made (or link the DEC-xxx in `docs/Memory.md` you followed).
- Tests run: exact commands + outcomes. Failures listed, not hidden.
- What you did NOT test, and why.
- Remaining issues for the next lane.
