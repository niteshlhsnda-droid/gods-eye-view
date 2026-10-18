# Earthquake review status: preliminary quakes are labelled PRELIMINARY

## The problem

The Earthquakes layer shows every event as a bare magnitude label —
`M5.2` — with no indication of whether that number is final. It is not
always final. The USGS feed this layer consumes carries a per-event
`properties.status` field: `automatic` means the event was located by
machine and has **not yet been reviewed by a human**; `reviewed` means a
human has reviewed it. An automatic event's magnitude, location, and depth
can still change when a human reviews it — and the first report of a large
event is the one most likely to be revised.

Before this change, the normalizer dropped `status` entirely, so an
automatic M5.2 and a reviewed M5.2 rendered identically. A reader had no
way to tell a preliminary number from a settled one. That is the same
class of honesty failure as the ones fixed before it (satellite positions
presented as live observations, simulated traffic presented as live
vehicles): a computed-or-preliminary value presented as a finished fact.

## The rule

1. **Automatic → `PRELIMINARY`.** An automatic event's ambient map label
   reads `M5.2 · PRELIMINARY`, and its full label is
   `PRELIMINARY · automatic (unreviewed)`. Its analyst record carries
   `reviewStatus: 'automatic'`.
2. **Reviewed → `Reviewed`.** A reviewed event keeps the plain `M5.2`
   label — reviewed is the default expectation, so it needs no qualifier
   on the map. Its analyst record carries `reviewStatus: 'reviewed'`.
3. **Unknown → no claim.** A missing, `deleted`, or otherwise
   unrecognized status normalizes to `null`. The label stays plain and
   the record carries `reviewStatus: null`. Unknown must never read as
   reviewed, and must never read as preliminary either — both would be
   claims the feed does not support.
4. **Status is a label, not an inclusion rule.** The feed's own M2.5+
   filter decides which events are shown. An unrecognized status never
   drops a row the feed includes, and no row is hidden on the basis of
   its review state. (USGS removes deleted events from the feed itself;
   if one ever arrived with `status: 'deleted'`, it would still render
   with no review claim rather than being silently suppressed by a
   label rule.)

## Where the label appears

| Surface | Automatic | Reviewed | Unknown |
| --- | --- | --- | --- |
| Ambient map label (`createEarthquakeOverlayEntry`) | `M5.2 · PRELIMINARY` | `M5.2` | `M5.2` |
| Full review label (`earthquakeReviewLabel`) | `PRELIMINARY · automatic (unreviewed)` | `Reviewed` | `null` |
| Analyst record (`mapAnalystRecord`) | `reviewStatus: 'automatic'` | `reviewStatus: 'reviewed'` | `reviewStatus: null` |
| Entity properties (analyst seam) | `reviewStatus: 'automatic'` | `reviewStatus: 'reviewed'` | `reviewStatus: null` |

The short `· PRELIMINARY` suffix on the ambient label is deliberate: the
ambient label is small and shared with the magnitude, so it carries the
short form; the full wording lives in `earthquakeReviewLabel` for any
detail surface that adopts it.

## What this document does not do

- It does not change which events are shown, the M2.5+ floor, the 60 s
  poll, or the disc rendering. The only visible change is the
  `· PRELIMINARY` suffix on automatic events' labels.
- It does not surface `magType` (e.g. `ml` vs `mw`). Magnitude-type
  honesty is a separate question: two `M5.2` events computed on
  different magnitude scales are not strictly comparable, but the feed's
  `status` is the preliminary-vs-final distinction, and that is what
  this change covers.
- It does not claim a review timeline. USGS does not publish one in the
  feed; the label says only that review has not happened yet, not when
  it will.

## Implementation pointers

- `src/layers/earthquakes/records.js` —
  `normalizeEarthquakeReviewStatus` (the single normalization rule) and
  the `reviewStatus` field on normalized rows.
- `src/layers/earthquakes/model.js` — `earthquakeReviewLabel`,
  the `· PRELIMINARY` suffix in `createEarthquakeOverlayEntry`, and the
  `reviewStatus` field on `mapAnalystRecord`.
- `src/layers/earthquakes/index.js` — `reviewStatus` threaded from rows
  into entity properties, overlay entries, and `getAnalystRecords`.
- `src/data/earthquakes.test.mjs` — normalization, label, overlay-title,
  and end-to-end lifecycle coverage.
- `DATA_SOURCES.md` (USGS row) — notes that automatic events are
  labelled PRELIMINARY.
