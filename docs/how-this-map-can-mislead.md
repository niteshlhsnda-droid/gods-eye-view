# How this map can mislead

**Status:** proposed disclosure pattern (specification, not yet wired into any
view). No UI changes ship with this document. A view adopts the pattern only
when it renders the honesty note described below.

## The rule

Every view that generalises — projections, aggregated counts, colour ramps,
modelled-vs-observed data — carries a one-line honesty note stating:

1. **Projection** — which projection the view uses (global views default to
   the globe, never a flat Mercator, so area distortion is not silently baked
   in).
2. **Data vintage** — when the data was observed, and how stale it may be.
3. **Aggregation rule** — what was counted, binned, or averaged, and over
   which window.
4. **Coverage gaps** — where the view has no data, and what it shows instead
   (nothing, last-known, or a model).

One line per view, on screen, next to the data it qualifies — not buried in
a settings page. The note names what the map hides, not just what it shows.

## Why

Maps tell only one side of any story, reflecting the choices of their makers:
scale, projection, symbols, and generalisation are all sources of distortion,
and no flat map matches the globe — every projection is a compromise. The
goal is healthy scepticism about maps, not distrust of this one: a reader who
can see the compromise can use the map correctly.

Research basis (attributed, not the fork's own claims):

- Monmonier, _How to Lie with Maps_ (1991; 3rd ed. 2018) — every map is a
  lie of selection; scale, projection, symbols, and generalisation distort.
- Dossier entry 18 (blogs batch): "How this map can mislead" disclosure +
  globe-default projection; add a "Scepticism" entry to the Guide.
- Perplexity master M-38: same disclosure pattern, same four honesty-note
  fields (projection name, data vintage, aggregation rule, coverage gaps).

## The distortion checklist

Use this checklist when writing a view's honesty note. A view need not list
every item — only the ones that change what a reader would conclude.

| Distortion             | Question the note must answer                                                  |
| ---------------------- | ------------------------------------------------------------------------------ |
| Projection             | Does area, shape, or distance read wrong at this zoom?                         |
| Scale / generalisation | What was simplified or dropped to fit this view?                               |
| Symbol size            | Does a dot's size imply a magnitude the data does not carry?                   |
| Colour ramp            | Do the breaks imply thresholds the data does not support?                      |
| Aggregation            | Counts of what, over which window, with which exclusions?                      |
| Modelled vs observed   | Is this a measurement, a propagation, or a simulation?                         |
| Vintage / staleness    | How old is the newest datum? The oldest?                                       |
| Coverage               | Which regions, times, or categories have no data here?                         |
| Cherry-picked range    | Does a before/after pair show the full range, not just the most dramatic pair? |

Two standing applications of the checklist:

- **Satellite positions are propagated, not observed.** A satellite panel
  must say so (element/epoch age + expected error growth), never present a
  computed position as a live observation.
- **Simulated traffic is simulated.** A traffic view must say its vehicle
  positions are a simulation (live flow speeds may drive it; individual
  vehicle positions are not live observations).

## What this document does not do

- It does not change any view. Wiring the note into a view is separate work
  with its own review.
- It does not replace per-layer provenance. Source + freshness labels (see
  `docs/FEED-HEALTH-CONTRACT.md`) and the live-means-live labelling rule
  (ruling #7: a view called "live" must prove liveness, else it is
  "Continuous" or similar) stay in force alongside this pattern.
- It does not relax the licensing rule (ruling #3: licensed / public-domain
  sources only) or the privacy line (no identifying/tracking individuals,
  wide/high angles only).

## Adoption note for future work

When a view adopts this pattern, its honesty note is part of the view's
review: the reviewer checks the note against the checklist above and against
the view's actual data path. A note that says the right words about the
wrong data path is worse than no note — it launders the distortion.
