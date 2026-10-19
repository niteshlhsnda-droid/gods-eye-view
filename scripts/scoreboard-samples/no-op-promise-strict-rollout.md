# no-op-promise `--strict` policy rollout (Cycle 22)

Phase 1 of the `--strict` policy rollout (Cycle 21 follow-up). Phase 0
(report-only scoreboard + raw `--strict` flag) shipped in Cycle 21;
this cycle adds the enforcement mechanism: a versioned policy file with
an allowlist, evaluated by `--strict`.

## Live-run categorization (2026-10-19)

`npm run scoreboard:no-op-promise` on `cf5e011`: **82 findings, 53 files,
all `noop-catch-anonymous`** — zero `noop-catch-named`, zero
`noop-then-fulfillment`. Every finding's surrounding code was read and
classified:

| Cat | Meaning                                                                                       | Count | Review date |
| --- | --------------------------------------------------------------------------------------------- | ----- | ----------- |
| A   | Promise-chain sequencing guard (keeps a stored chain alive)                                   | 10    | 2027-01-19  |
| B   | Stream-cancel during error teardown (cancel failure is meaningless; the real error is thrown) | 16    | 2027-01-19  |
| C   | Fire-and-forget side effect (beacon, keepalive, analytics, prefetch)                          | 8     | 2027-01-19  |
| D   | Documented graceful degradation (in-code comment or an obvious null-fallback ladder)          | 38    | 2027-01-19  |
| E   | Undocumented swallow — pending review                                                         | 10    | 2026-11-18  |

Top offender: `src/sources/httpBody.js` (5, all category B).

## Rule set v1 (also in `scripts/noOpPromise.policy.json`)

- **R1 — ratchet.** `--strict` fails on any enforced-class finding with no
  matching live allowlist entry. New code must be clean or explicitly
  allowlisted with a reason and review date.
- **R2 — expiry.** Every allowlist entry carries a review date (≤ 90 days
  out). An entry past its review date fails `--strict` until re-reviewed.
- **R3 — no stale entries.** An entry matching no live finding
  (file+class+line) fails `--strict`. Line-exact matching is deliberate:
  moving code near a swallow re-triggers review instead of silently
  inheriting the old justification. Near-misses (±5 lines) are reported
  as advisory drift notes.
- **R4 — empty-class ratchet.** `noop-catch-named` and
  `noop-then-fulfillment` have zero live findings; any new one fails
  `--strict` immediately.
- **R5 — pending burn-down.** The 10 category-E swallows carry 30-day
  review dates (2026-11-18). Each must gain an in-code justification or be
  fixed before its review date, or the gate starts failing.

## Category E — pending review (must be documented or fixed by 2026-11-18)

- `src/layers/cctv/projection.js:413` — `video.play()` rejection swallowed, no comment (likely autoplay-denial)
- `src/layers/cctv/videoPlayback.js:55` — `video.play()` rejection swallowed, no comment (likely autoplay-denial)
- `src/ui/mapSourceControls.js:64` — `select()` rejection from a user click swallowed silently
- `src/app/globePanelRuntime.js:624` — display-mode request rejection ignored, no note
- `src/voice/realtimeInput.js:229` — `AudioContext.resume()` failure swallowed, no note
- `src/voice/realtimeInput.js:352` — `AudioContext.close()` failure swallowed, no note
- `src/layers/radio/tuningNoise.js:83` — AudioContext resume failure swallowed, no note
- `src/layers/radio/tuningNoise.js:135` — AudioContext suspend failure swallowed, no note
- `src/layers/radio/lifecycle.js:81` — tuning-noise close failure swallowed, no note
- `src/layers/streetLevel/providers/kartaview/viewer.js:213` — `step()` rejection swallowed in `checkEnds`, no note

## Usage

- `npm run scoreboard:no-op-promise:strict` — the gate (exit 1 on any
  violation or stale entry). Green today: 82/82 allowlisted.
- `npm run scoreboard:no-op-promise` — report-only; appends the policy
  summary without failing.
- `--policy PATH` overrides the default `scripts/noOpPromise.policy.json`;
  `--no-policy` restores the raw pre-policy `--strict` behavior.
- Scoped runs (`--strict src/foo.js`) judge violations on the shown files
  but staleness against the whole tree.

## Phases

- Phase 0 (Cycle 21, done): report-only scoreboard + raw `--strict`.
- Phase 1 (this cycle): policy file + allowlist evaluation wired into
  `--strict`; `scoreboard:no-op-promise:strict` npm script.
- Phase 2 (proposed): burn down the 10 category-E entries; then tighten
  (e.g. require an in-code `// allowlisted:` marker next to new swallows).
- Phase 3 (proposed): CI gate on the strict script.

## Files

- `scripts/noOpPromisePolicy.mjs` — pure policy engine (browser-boundary-safe; no node: imports)
- `scripts/noOpPromise.policy.json` — v1 policy: rules + 82-entry allowlist
- `scripts/scoreboard-no-op-promise.mjs` — CLI: `--policy`/`--no-policy`, policy evaluation under `--strict`
- `scripts/noOpPromise.mjs` — shared arg parser gained `--policy`/`--no-policy`
- `src/tooling/noOpPromisePolicy.js` — thin re-export (house pattern)
- `src/tooling/noOpPromisePolicy.test.mjs` — 11 unit tests
