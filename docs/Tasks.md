# Tasks.md — Execution queue (forward-looking)

Usable work queue, not a wishlist. Every task: stable ID, named lane,
explicit scope, observable acceptance criteria, completion-evidence
fields. Statuses: proposed → implemented → tested → reviewed →
released. "Done" claims one status only with evidence.

Template per task: **Lane · Scope · Acceptance · Evidence** (files
changed, test commands + outcomes, manual checks, what was NOT tested).

## Now

### GEO-001 — Dispatch Cycle 23 (8 lanes)
**Lane:** main agent (coordinator). **Scope:** dispatch 8 lane idea
branches from current main; Fo reviews; batch-merge under approval
authority (DEC-012). **Acceptance:** 8 branches land, full gates green
solo, merged to main, deployed, live-verified. **Evidence:** merge
commits, gate output, deploy check.

### GEO-002 — Colour-ramp legend wiring (5 layer panels)
**Lane:** ChatGPT lane. **Scope:** wire colour-ramp labels into the 5
layer panels (owed since Cycle 22). **Acceptance:** each panel's legend
matches its renderer's ramp; unknown/missing values labelled, not
miscoloured. **Evidence:** panel screenshots, targeted tests.

### GEO-003 — Renderer label bugs (earthquakes + FIRMS)
**Lane:** Grok lane (QA) + implementing lane. **Scope:** (a)
earthquakes `depthColor(depthKm || 0)` paints unknown depth as shallow
red — use an explicit unknown treatment; (b) FIRMS missing
confidence/FRP falls through to yellow — use explicit
unknown treatment. **Acceptance:** unknown inputs render as
"unknown", never as a meaningful colour. **Evidence:** before/after
screenshots, regression tests.

### GEO-004 — providerAgreement arbitration (PRODUCT DECISION)
**Lane:** founder (Muse recommends). **Scope:** should Street Level
"nearest" consult ALL providers, or stay ordered Mapillary → Google →
KartaView? Google billing implications. **Acceptance:** written
decision → DEC-xxx in `docs/Memory.md`; dormant wiring activated or
removed. **Evidence:** decision record.

## Triage (scoreboard findings)

### GEO-005 — Dead-parameter triage (284 findings)
**Lane:** Copilot lane. **Scope:** triage 284 dead-parameter findings;
fix or explicitly allowlist each. **Acceptance:** zero untriaged;
allowlist entries dated. **Evidence:** triage log.

### GEO-006 — Error-swallowing triage (452 findings)
**Lane:** Copilot lane. **Scope:** triage 452 error-swallowing
findings (report-only to date). **Acceptance:** real swallows fixed;
benign ones allowlisted with reason. **Evidence:** triage log.

### GEO-007 — Test-async-gap triage (49 findings)
**Lane:** Copilot lane. **Scope:** triage 49 findings. **Acceptance:**
gaps closed or accepted with reason. **Evidence:** triage log.

### GEO-008 — Copilot category-E allowlist re-decision (DEADLINE 2026-11-18)
**Lane:** Muse. **Scope:** 10 category-E entries expire 2026-11-18.
**Acceptance:** re-decision recorded before expiry. **Evidence:**
decision record.

## Wiring follow-ups

### GEO-009 — GNSS normalization wiring
**Lane:** GNSS builder. **Scope:** wire hex/callsign normalization for
`duplicateIcao24` + `crcParityPlausibility` (both inert until wired);
`formatTleAge` negative-input guard; header doc-fix (wrong NIC 10 +
NACp 7 example). **Acceptance:** plausibility checks active on live
data; docs corrected. **Evidence:** tests, doc diff.

### GEO-010 — viewCone target-coverage wiring
**Lane:** Satellites lane. **Scope:** wire viewCone target coverage
(landed math, unwired). **Acceptance:** cone renders for supported
targets. **Evidence:** visual check, tests.

### GEO-011 — KartaView `uploadedAt` carry + gzip tile sniff
**Lane:** Street Level builder. **Scope:** carry `uploadedAt`
(index.js:426); sniff gzip-wrapped tiles via `DecompressionStream`
instead of refusing. **Acceptance:** upload dates shown; gzipped tiles
load. **Evidence:** tests.

## Research and bookkeeping

### GEO-012 — TOP 20 final derivation (QA)
**Lane:** Copilot (evidence QA) + Fo. **Scope:** formal dedupe pass
(confirm 100→88), resolve papers 18-headings-vs-16-entries, then FINAL
TOP 20 derivation from ALL sources. **Acceptance:** derivation cites
every source batch; counts reconciled. **Evidence:** QA report.

### GEO-013 — Refresh `port-status.md`
**Lane:** coordinator. **Scope:** rewrite stale status (claims merges
need founder go-ahead — superseded by DEC-012). **Acceptance:** status
matches git evidence. **Evidence:** diff vs `git log`.
