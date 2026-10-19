# Colors must ship with their key

## Rule

A color that encodes data is a claim, and a claim without a key is
incomplete. Any surface that renders a data-driven color ramp must be
able to show what each color means — the band it owns, in the ramp's
units — and must never let a reader infer severity, quality, or
precision the ramp does not encode.

## Why this matters

Five layers render data as color with no on-screen legend (verified
against the tree, cf5e011):

- **earthquakes** colors markers by focal depth: red < 70 km,
  orange 70–300 km, yellow > 300 km (`depthColor`,
  `src/layers/earthquakes/model.js`). Red reads as "big quake"; it
  means shallow.
- **firms** colors fire dots by detection heat — a blend of fire
  radiative power (MW) and detection confidence, thresholded at 0.72
  and 0.42 (`DETECTION_COLOR_STOPS`, `src/layers/firms/policy.js`;
  `detectionColorStop`, `src/layers/firms/model.js`). Red reads as
  "severe fire"; it means the sensor sees it strongly. A missing
  confidence value makes the heat NaN, which falls through to yellow —
  so a yellow dot can mean "inputs missing", never "confirmed weak".
- **traffic** colors dots by TomTom traffic level (current speed /
  free-flow speed): green ≥ 0.85, amber 0.55–0.85, red < 0.55
  (`flowBucket`, `src/data/trafficFlowStyle.js`). A non-finite level
  degrades to green by design, so green can mean "unusable data".
- **bikeshare** colors stations by bike-availability ratio: green >
  60%, amber 30–60%, red < 30%, neutral gray for no status, muted gray
  for offline (`statusToColor`,
  `src/layers/bikeshare/rendering.js`). Neutral gray reads as "empty";
  it means unknown.
- **deckgl** colors H3 hexes by entity count on a log scale
  (`densityFillColor`, `src/layers/deckgl/h3density.js`). The top of
  the ramp is the current view's maximum count — the same bright fill
  can mean 5 entities or 5,000 depending on the view.

Without the key, every one of these invites the same error: reading
color as a stronger claim than the data supports.

## What the app does

`src/data/colorRampLabels.js` is the canonical vocabulary — ramp name
→ stops → what each stop means, with units — for exactly those five
ramps:

- `colorRampSpec(rampId)` — the full verified spec: stops with
  `{ id, label, color, band, meaning }`, the unknown label, and the
  honesty notes that travel with any legend built from it.
- `colorRampCardLegend(rampId, { maxCount })` — a `railCardBlocks`
  legend payload (`{ colors, labels, categorical, units }`); the
  H3-density ramp renders as a continuous gradient.
- `colorRampRowLegend(rampId, { maxCount })` — `layerPanel`
  row-controls entries (`[{ label, color, blurb }]`).
- `labelEarthquakeDepthBand(depthKm)` — the band label with the
  unknown-guard the renderer lacks: null, `''`, non-finite, and
  negative depths read as `Depth unknown`, never as shallow.

The legends are not wired into the layer panels yet — this module is
the vocabulary the wiring will consume, so no layer's rendering or
controls changed here.

## Unknowns and relative scales

Two ramps need more than band labels:

- **Unknown is not the common band.** The earthquakes layer calls
  `depthColor(depthKm || 0)`, so a quake with an unreported depth
  currently paints shallow red. `labelEarthquakeDepthBand` refuses to
  endorse that fallback: unknown depth reads `Depth unknown`. Fixing
  the renderer's `|| 0` is a separate, wiring-level change.
- **Relative ramps say so.** The H3-density top stop labels as
  `High (highest in view)` and may name the count — `High (42 in
  view)` — only when the caller supplies a finite `maxCount`. A
  missing, non-finite, or non-positive `maxCount` keeps the relative
  label; the module never invents an absolute scale.

## Tests

`src/data/colorRampLabels.test.mjs` pins the vocabulary to the actual
renderers: earthquake banding is swept against `depthColor` at every
threshold edge (70 and 300 km own the side the code gives them),
traffic bands against `flowBucket`, FIRMS stop colors against
`DETECTION_COLOR_STOPS` in order, bikeshare stops against the
`policy.js` palette hues, and the H3-density endpoint swatches against
`densityFillColor` at t = 0 and t = 1. A drift in any renderer fails
the suite.
