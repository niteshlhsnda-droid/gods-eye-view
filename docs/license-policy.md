# License policy — Grok lane (trust / QA)

Audited 2026-10-12. This is the lane rule going forward.

## The rule

**Permissive-only.** A dependency or vendored snippet may enter the tree only
with one of these licenses:

- MIT
- Apache-2.0
- BSD-2-Clause / BSD-3-Clause
- ISC
- MPL-2.0

Anything else — copyleft (GPL/AGPL), proprietary, dual-license with a
commercial leg, or **no declared license at all** — needs explicit written
approval from the user before it is added, vendored, or even read into the
tree for "reference". A repository with no declared license is treated as
all-rights-reserved and **BLOCKED**: no vendoring, no copying, no "inspired
by" pasting. Reimplementation from a written spec of the *idea* (clean-room)
is the only path, and it must be original code.

## Current verdicts

- `signal-anomaly-detective` — **no declared license → BLOCKED.** Never
  vendored. The anomaly *idea* (squawk alerts, AIS dark gaps, quake swarms)
  was reimplemented from scratch in `src/anomaly/` — fixed lookups and
  geometric clustering, no model, no probabilities.
- `deepfake-detection` — **no declared license → BLOCKED.** Never vendored.
  An "AI authenticity probability" we cannot honestly compute is not shipped;
  the lane ships a provenance/metadata panel instead
  (`src/director/sharing/provenance.js`), which records source, capture time,
  and SHA-256 identity, and explicitly never claims authenticity.
- `alethia-main` — **no declared license → BLOCKED.** Never vendored; same
  reasoning as `deepfake-detection`.
- `deface` (ORB-HD/deface) — **MIT → ALLOWED.** Faces-only redaction, used
  as an out-of-band CLI pass. The share-a-scene flow enforces the policy gate
  (`src/director/sharing/redaction.js`): a bundle in `faces` mode cannot be
  exported or imported without a deface attestation on every visual asset,
  and no bundle may claim "redacted" unless the pass actually completed.

## How to add a dependency

1. Verify the license is in the permissive list (check the repo's LICENSE
   file or a declared SPDX field — not a README badge alone).
2. Declare it in `package.json` with an **exact version** (no ranges), plus
   the scope (dependency vs devDependency).
3. Add a row to the lane's `DEPS.md`: name, version, SPDX, why.
4. If it is a new runtime dependency, add a package-boundary entry in
   `scripts/package-boundaries.json` (every module it pulls in must be
   owned) and verify with `npm run check:boundaries`.
5. Merge the attribution into `THIRD_PARTY_NOTICES.md` at release time.

## Standing prohibitions

- No secrets in code, fixtures, or workflow files. CI fails on them
  (`secrets-scan.yml` scans full git history; pre-commit hook scans staged
  changes). QA fixture tokens live in `gitleaks.toml`'s allowlist and nowhere
  else.
- No fabricated trust signals: a badge, label, or panel must reflect a
  computed value (feed state, latency stats, digest) — never an invented one.
