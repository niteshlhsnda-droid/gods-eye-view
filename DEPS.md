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
