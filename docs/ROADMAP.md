# GOD'S EYE VIEW — Roadmap & Blueprint
**Making it one of the best open-source repos on GitHub**

Date: 2026-10-13 | Owner: niteshlhsnda-droid/gods-eye-view | Status: living document

---

## 1. The vision (one line)

**Google Earth shows you the world. God's Eye View shows you the world *happening*.**

## 1a. The founding thesis: we don't invent, we compose

We are not building anything new from scratch. The pieces already exist — scattered across
hundreds of brilliant open-source repos. Our work is **bringing them together and making the
next big thing out of the composition**.

- The moat is **curation**: knowing which 15 repos out of 10,000 are worth integrating.
- The moat is **integration**: making deck.gl, SGP4, GDELT, Wikidata, forecasting libraries
  and forty other systems behave as *one* living planet, not forty tabs.
- The moat is **composition**: the "next big thing" isn't a new algorithm — it's the thing
  that only exists when the pieces meet (Live Now, a day on Earth, point-at-sky).

This is why the research engine (§5) is the heart of the project, not a side activity.
Screening is our R&D. Every sprint starts from the shortlist, and the shortlist is the asset.

Everything we build serves the one-line vision. If a feature doesn't make the planet feel more
*alive*, more *verifiable*, or more *shareable*, it doesn't ship — and if a feature can be
achieved by integrating something excellent rather than building it, we integrate.

## 2. What "one of the best repos" actually means

Stars follow; they don't lead. The repos that stay great share five traits. We will deliberately
build all five:

1. **It works live, every day.** A dead feed is worse than no feed. Every data source gets a
   health badge, graceful degradation, and a stale-data policy. Uptime of the *demo* matters
   more than breadth of sources.
2. **Every feature has a 60-second demo.** Nobody reads architecture docs first; they watch.
   Director Mode isn't just a feature — it's our marketing engine. Each sprint ships its demo video.
3. **Provenance on everything.** Every pin, every forecast, every alert carries its source and
   timestamp. In an age of synthetic media, "here's the receipt" is the moat.
4. **Contributors can land in an hour.** Clear module boundaries (already enforced by
   package-boundaries.json), good-first-issues, one-command dev setup, CI that teaches.
5. **A healthy upstream relationship.** We fork-diverged fast. Long-term we contribute flagship
   modules back upstream where they fit, and keep our experimental edge in the fork. A fork at
   war with upstream rots; a fork that feeds upstream compounds.

## 3. The four pillars (what we add, and why)

| Pillar | Meaning | Example features |
|---|---|---|
| **LIVE** | The planet, recent snapshot | Live Now view (in build), satellite pass alerts, disaster auto-tracking |
| **DEEP** | Time + context | Time-machine slider, famous-people layer, price-prediction panel with uncertainty |
| **CINEMATIC** | Stories, not dashboards | Director Mode tours, "A day on Earth" auto-video, embeddable event widget |
| **OPEN** | Platform, not app | Public API, self-hosting docs, contributor ladder, upstream PRs |

## 4. Phase plan (rolling monthly sprints)

We run **one focused build sprint per month** (~1 week of lane time) plus **continuous research**.
No more feature-cramming: each sprint ships one pillar-deep feature, polished, demoed.

### Phase 1 — "Open it daily" (Oct → Nov 2026)
*Goal: give people a reason to open the app every day.*
- **Live Now** (in build now): ranked live-events carousel + fly-to + auto-tour. *The habit.*
- **Notable People layer** (round-2 Domain A, researched): pywikibot + Wikidata-Toolkit +
  news-please + GDELT attention meter. Public figures only; pins pulse when a biography is edited.
- **Future Prices panel** (round-2 Domain B, researched): yfinance + fredapi + statsforecast /
  prophet / darts. Confidence bands, source timestamps, labeled as model output — never advice.

### Phase 2 — "Tell the story" (Dec 2026 → Jan 2027)
*Goal: turn the globe into a storytelling medium and a distribution flywheel.*
- **"A day on Earth" auto-video**: 60-second cinematic recap of the last 24h, generated nightly
  from Live Now + anomaly detector. Doubles as daily content for our own channels.
- **Point-at-sky mode**: hold up the phone, see every satellite overhead with names (builds on
  the SGP4 work). The screenshot feature.
- **Embeddable event widget**: newsrooms embed a live event globe. One cyclone embed is worth a
  year of marketing — and it's the cleanest commercial on-ramp.
- **Public API** (REST + WebSocket over the fused layers): turns the project from demo to platform.

### Phase 3 — "Go deep" (Feb → Mar 2027)
*Goal: depth nobody else offers in one place.*
- **Time-machine slider**: Earth Engine–style timelapse on any location (deforestation, city
  growth, glacier retreat). Heaviest infra lift; start tile research in Phase 1.
- **Voice AI rooms** (LiveKit, researched): talk to the globe — "show me every cyclone this year."
- **Push notifications**: the backlog item — flight landed, ship entered port, quake near family.
  (Only after Live Now proves the ranking quality; alerts must be trustworthy.)
- **Mobile-first pass**: the current app is desktop-heavy; the daily habit lives on phones.

### Phase 4 — "Compound" (Apr 2027+)
*Goal: the repo sustains itself.*
- Upstream PR program: flagship modules proposed back to bilawalsidhu/gods-eye-view.
- Contributor ladder + maintainer docs; first external maintainer onboarded.
- Hosted-tier experiment (optional, only if Phase 2's widget shows demand): managed feeds +
  SLA for newsrooms — the open core stays MIT forever.
- Annual "State of the Planet" report generated from our own data: the repo markets itself.

## 5. The research engine (what happens *between* sprints)

The night sprint proved the lanes can build a month of work in a night. Research is what keeps
that speed *aimed*. Standing research program, always on:

- **Weekly repo screen**: each lane screens ~20 repos in its domain (data sources, viz tech,
  forecasting, geo tooling). Monthly dedupe → top-15 shortlist → feeds the next sprint's spec.
  (Round 2's 100-repo screen is the template.)
- **Competitor & upstream watch**: track the upstream repo, major forks, and adjacent projects
  (Cesium, kepler.gl, deck.gl ecosystem). Monthly 1-page brief: what shipped, what to borrow,
  what to differentiate against.
- **Paper watch**: forecasting (Chronos, TimesFM class), remote sensing, entity linking —
  one practical takeaway per month, prototype-grade.
- **License & cost watch**: every new data source gets a license card (like the round-2 license
  audit) before it touches the codebase. No surprise API bills, no tainted training data.
- **"State of the Planet Stack"**: monthly 1-page internal report — new sources, dead sources,
  cost changes, upstream movements. This is the document future contributors will wish existed.

Research output is *always* a shortlist + license card + integration sketch — never a link dump.

## 6. Operating rhythm

| Cadence | Activity |
|---|---|
| Weekly | Lane repo screens (async, ~20 repos/lane) |
| Monthly | Dedupe → top-15 → sprint spec (research → plan → execute, in that order) |
| Monthly | 1-week build sprint → demo video → merge decision by the user |
| Monthly | "State of the Planet Stack" report |
| Quarterly | Roadmap review: kill what's stale, double down on what earned attention |

Rules that don't change: **research first, then plan, then execute**; no sprint starts without a
frozen spec; merges need the user's word; unconfirmed data never ships as fact; every sprint
produces its 60-second demo.

## 7. How we know it's working (metrics)

- **Health**: feed uptime %, demo deploy green, CI pass rate, issue response time
- **Love**: stars, forks, contributors (not just drive-bys), demo video views
- **Depth**: external embeds of the widget, API keys issued, upstream PRs accepted
- **Habit**: (once hosted) daily active users of Live Now, tour shares per week

Review quarterly. If a phase's features don't move at least one metric, the next sprint changes
direction — no sunk-cost building.

## 8. Risks & guardrails

- **Maintenance burden**: every new feed is a pet that needs feeding. Cap: no new source without
  a health badge + a named lane owner + a kill switch.
- **Upstream divergence**: rebase against upstream monthly; keep the diff intentional and
  documented, not accidental.
- **Data licensing**: license card before code, every time. Market data is the minefield —
  delayed feeds and redistribution limits get flagged in the spec phase.
- **Attention dilution**: this project is a capped side bet next to the revenue sprint. Monthly
  sprints, not nightly ones, unless a phase earns it.
- **Hype without trust**: one wrong alert (fake quake, mislabeled casualty) burns the
  provenance moat. The Grok finish/QA lane exists for exactly this.

## 9. Ranked backlog (beyond the phases)

1. Offline tile packs for low-bandwidth regions
2. Crowd-verified ground truth (citizen photo pins, provenance-gated)
3. Classroom mode (guided tours for teachers, curriculum packs)
4. Multi-language voice narration for tours
5. Historical disasters archive ("where were you" mode)
6. AR mode for point-at-sky (native app dependency)

---

*This document evolves. Each monthly sprint updates the phase it's in and re-ranks the backlog.
The question is never "what can we add" — it's "what makes someone open it tomorrow."*
