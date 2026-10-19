# Memory.md — Preserved decisions

Curated, durable record. A decision is fixed only after the approval in
its entry — being written here is not approval. Superseded decisions
are kept with a link to their replacement, never deleted.

## Fixed decisions

### DEC-003 — Live third-party webcam embedding: licensed/PD only
**Approved:** user ruling 2026-10-16 ~06:40 IST ("Go with majority").
**Statement:** Live layer uses only public-domain/licensed sources
(NASA ISS + credited data + cam networks with written permission).
Per-network permission path (Option B) may add networks later. Reject
aggregator re-streams on fair-use claims. Third-party feeds via official
embed or link-out — never downloaded/buffered/re-hosted.

### DEC-004 — Panoramax: out of port, Phase 1 later
**Approved:** user ruling 2026-10-16. Panoramax stays out of the port
scope; street-level cascade is Mapillary → Google → KartaView.
Revisit in Phase 1.

### DEC-005 — GeoJSON legacy `crs`: import + visible warning
**Approved:** user ruling 2026-10-16. `prepareGeoJson()` strips `crs`
and shows "CRS ignored — coordinates assumed WGS 84" (amber) on the
import row. Never silent.

### DEC-006 — Loading: progressive
**Approved:** user ruling 2026-10-16. Video + "Now Over" + next
sunrise/sunset first; rest lazy-loads behind collapsible panels.

### DEC-007 — Honest labels: live means live
**Approved:** user ruling 2026-10-16. "Live Now" only for proven-live
data/feed; everything else CONTINUOUS. Full chip vocabulary in
`docs/Rules.md`.

### DEC-008 — AI-assisted music: licence stated explicitly
**Approved:** user ruling 2026-10-16. Any AI-assisted ambience ships
with explicit ownership/licence; never assumed public-domain.

### DEC-009 — Binaural: technique only, no health claims
**Approved:** user ruling 2026-10-16.

### DEC-010 — Embeds: promise only what we control
**Approved:** user ruling 2026-10-16. No "no ads" promise for
third-party players.

### DEC-011 — Satellites: TLE-only (no OMM migration)
**Approved:** Muse 2026-10-17 (per 2026-10-17 approval rule).
**Statement:** Stay TLE-only via satellite.js; no migration, no code
change. OMM is not drop-in for the pipeline (13 touchpoints); the only
acceptable future shape is a flag-gated hybrid, never a flag-day.
Revisit on: TLE deprecation/outage, a TLE-parsing incident, or an
OMM-only feature need. Record: `decision-pack-11-omm.md`.

### DEC-012 — Approval authority: Muse approves, founder is fallback
**Approved:** user 2026-10-17 (verbatim: "All approvals should be given
by muse. If he fails then last my decision"). Muse gives all approvals
(merges, deploys, installs, reviews). Founder decides only if Muse
fails. NOT delegated: money, sign-ins, KDP Publish, filings,
approval-card taps, bank/tax identity.

### DEC-013 — Execution metric: pilots/customers/revenue
**Approved:** user 2026-10-18 ~03:02 IST. Proposal-engine hourly idea
generation stops; hourly cadence = execution progress on the chosen
idea (GuestProof). GEV hourly code cycles continue (they land code).
Head contest judged on implemented outcomes, not idea count.

### DEC-014 — Port complete and deployed
**Completed:** 2026-10-17. `port/upstream-gaps` merged + deployed;
ancestry-verified on main. NYC DOT CCTV NOT ported (agreement-gated).

### DEC-015 — City Drives: 179 drive-through cities
**Shipped:** 2026-10-19 (main `934014e` → `17b9c779` → `8dd9638`).
Drive tab = RECORDED drive-throughs via driveandlisten.app iframe
(always labelled "Recorded drive-through (not live)"); Live Radio tab
via radio-browser.info; credits (Drive & Listen, Drive From Home,
Radio Garden, radio-browser.info) in the panel footer. Search box +
selected-city state. Panel unit tests 20/20.

## Rejected alternatives

- **OMM flag-day migration** (Option B): rejected — 13 touchpoints, no
  drop-in path (DEC-011).
- **Panoramax in port** (Options B/C): rejected, Phase 1 later (DEC-004).
- **Aggregator re-streams on fair-use claims** (conflict #3 Option C):
  rejected (DEC-003).
- **tile→sequence for KartaView** (Conflict-1): unbuildable — tiles carry
  no sequence IDs. Wider-retry + distinguished message shipped instead.
- **Bing Streetside:** retired June 2025 — do not build on it.
- **Moscow govt surveillance feeds:** rejected outright.
- **Buffering others' YouTube videos:** never (embed or link out).

## Known quirks and limitations

- Upstream demo `maptheworld.ai` is dead (now a Substack) — research via
  repo + docs only.
- KartaView v1 API is dead; use `api.kartaview.org/2.0/` only.
- adsb.lol empty-but-valid `{"ac":[],"total":0}` = valid snapshot,
  never retry.
- `lite/demo` branch exists but is not a deployed lite site. Page
  weight ~9MB (Cesium 5.6MB) — slim-loading job proposed, awaiting
  founder decision.
- `port-status.md` is stale (says merges need founder go-ahead —
  superseded by DEC-012).
- Drive & Listen city pages are JS-rendered; no public API.
- Partners cannot watch YouTube like a person (transcripts/metadata
  only); Grok deep-research mode stalls on some topics.

## Open questions (provisional, with owners)

- **OQ-PROVIDER:** Street Level nearest-button — consult ALL providers
  (Google billing implications)? Product decision owed. Owner: founder.
- **OQ-C23:** Cycle 23 dispatch — ~15h gap since Cycle 22. Owner: main
  agent.
- **OQ-COPILOT-E:** Copilot no-op-promise allowlist, 10 category-E
  entries expire 2026-11-18 — re-decision needed before then.
- **OQ-TOP20:** TOP 20 research derivation — final re-derivation from
  all sources still owed (draft from 4 batches only).
- **OQ-SLIM:** demo slim-loading job — founder decision pending.
- **Renderer bugs (ChatGPT audit):** earthquakes `depthColor(depthKm ||
  0)` paints unknown depth as shallow red; FIRMS missing
  confidence/FRP falls through to yellow; colour-ramp legend wiring
  into 5 layer panels owed.
- **GNSS:** hex/callsign normalization wiring for `duplicateIcao24` +
  `crcParityPlausibility`; `formatTleAge` negative-input guard;
  header doc-fix (wrong NIC/NACp example).
- **Geo-import:** gzip-wrapped tiles refused (`DecompressionStream`
  sniff follow-up); KartaView `uploadedAt` carry.
- **Scoreboard triage owed:** dead parameters (284), error-swallowing
  (452), test-async-gap (49).
