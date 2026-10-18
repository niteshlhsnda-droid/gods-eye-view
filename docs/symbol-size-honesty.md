# Symbol-size honesty: say what marker size encodes

**Status:** proposed disclosure pattern — display-only vocabulary, not yet
wired into any view. No UI changes ship with this document. A view adopts
the pattern only when it renders the honesty label described below.

Canonical wording is owned by `src/data/symbolSizeHonesty.js`:

- `SYMBOL_SIZE_RULE` — the standing rule.
- `UNIFORM_MARKER_LABEL` — for layers whose markers are all one size.
- `quakeSymbolLabel(mag)` — for the earthquake ground circles.
- `QUAKE_REPLAY_RING_LABEL` — for the time-rewind replay shockwave ring.

## The rule

A map reader naturally reads a marker's size as information: a bigger circle
looks like a bigger affected area, a stronger signal, or a higher rank. So:

1. **Every sized marker gets a label stating what size encodes.** The label
   sits with the marker it qualifies, on screen — not buried in a settings
   page.
2. **Uniform markers get a label too.** Uniform size is not a rank: a view
   whose dots are all the same size must say `UNIFORM_MARKER_LABEL`, so a
   reader does not infer importance from position alone.
3. **A missing or unknowable encoding is labeled unknown**, never guessed.
   If a layer's sizing formula cannot be verified in the code, the label says
   so explicitly rather than assuming a default encoding.

## Why

Two concrete failure modes, both verified in this codebase:

**1. The earthquake circle is not an impact zone.** The earthquake layer
renders each event as a ground-clamped ellipse
(`src/layers/earthquakes/index.js`):

```js
const baseRadius = Math.pow(2, mag) * 1000;
```

That is a display radius of `2^magnitude` kilometres — purely a display
convention. At magnitude 8 the circle is 256 km across. A reader sees a
256 km circle over land and reads it as a 256 km damage zone, the way a
weather radar's footprint reads as "the storm is here". Nothing in the view
contradicts that read today: there is no legend and no label.

**2. The growth is exponential, not linear.** A reader who does know the
circle is "sized by magnitude" still reads size as linear: M8 looks ~4× M2,
not 64×. The actual ratio is `2^8 / 2^2 = 64`. The label names the real
radius at the event's magnitude so the convention is visible, not implied.

A third instance shares the family: the time-rewind replay view expands a
"shockwave" ring from each visible event
(`src/timeRewind/replayView.js`: `BASE_RADIUS_KM × easeOut × (0.6 + 0.2×mag)`).
It is a cinematic — an ease-out animation loosely scaled by magnitude — and
must never read as a measured hazard zone.

## What this document does not do

- It does not change any view. Wiring a label into a view is separate work
  with its own review.
- It does not cover colour. Earthquake colour encodes depth and detection
  severity uses colour ramps — colour-ramp honesty is a separate gap (see
  follow-ups below).
- It does not replace per-layer provenance or freshness labels
  (`docs/FEED-HEALTH-CONTRACT.md`, `docs/data-freshness-live-labels.md`).
  This governs size; those govern source and time.
- It does not touch Live Now.

## Relationship to prior honesty rules

- `docs/how-this-map-can-mislead.md` — the general pattern. This is the
  symbol-size instance of its "Symbol size" distortion item, as display-only
  vocabulary.
- `docs/satellite-predicted-positions.md` — the same "say what it actually
  is" posture, applied to computed positions; this applies it to computed
  sizes.
- `docs/basemap-imagery-vintage.md` — the same house pattern (canonical
  wording in one module, display-only, no guessing when data is missing).

## Follow-ups discovered while researching

- **Colour-ramp honesty.** Depth colours on earthquakes, severity accents on
  FIRMS fires (`accentForSeverity`), and magnitude colours on replay rings
  (`magnitudeColor`) all use colour ramps with no on-screen legend. The
  breaks imply thresholds the view never states. Candidate for a later
  ChatGPT-lane honesty cycle.
- **Cohort-limit honesty.** FIRMS ambient cards cap at
  `FIRMS_AMBIENT_COHORT_LIMIT = 18` — a view showing "fires near you" shows
  at most 18 of them. If a view ever labels a count, it must say when the
  count is capped.
