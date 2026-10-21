# Camera label honesty

**Status:** wired into the CCTV view (H-03 fix, `audit-fix/h-bundle`).
`src/layers/cctv/cameraLabelHonesty.js` implements the rule below;
`src/layers/cctv/presentation.js` renders it via `honestFeedModeToken`:
the transport label (`LIVE STREAM` / `LOOPED CLIP` / `SNAPSHOT`) while the
fetch pipeline is healthy, the spec's verdict the moment the health sync
reports a failed pipeline. No per-frame fetch clock exists in the CCTV
pipeline, so the spec runs without `lastGoodFetchMs` and reports UNKNOWN
on absence of evidence.

## The rule

A camera's display label must never claim **live** when the feed is a loop
or stale. The label vocabulary is fixed — four labels, nothing else may
render as a liveness claim:

| Label        | Meaning                           | When it fires                                                                                                       |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `LIVE`       | Truly streaming now               | HLS transport, fetch pipeline working, last good frame within threshold                                             |
| `CONTINUOUS` | Regularly refreshed, but not live | Looping finite video clip (mp4/webm), or a snapshot/still re-fetched on cadence, with a fresh last good frame       |
| `STALE`      | The picture is out of date        | Last good fetch older than the staleness threshold — or the fetch pipeline is failing after at least one good fetch |
| `UNKNOWN`    | We cannot say what this feed is   | No frame ever received, or no health/fetch data to judge by                                                         |

## Why

- The standing honesty rule (`docs/data-freshness-live-labels.md`): a
  static label must never assert liveness. CCTV already enforces the
  static side — `LIVE STREAM` for HLS only, never for looping clips
  (`cctvFeedModeLabel` in `src/layers/cctv/presentation.js`). This module
  is the dynamic side: the same vocabulary plus data age and pipeline
  health.
- The Oct-15 "FAILED TO FETCH CAMERAS" problem: while the fetch pipeline
  is failing, a badge that reads `LIVE` or `CONTINUOUS` contradicts the
  banner on the same screen. A failed health flag therefore overrides
  everything else — the label flips to `STALE` (with a last-good frame) or
  `UNKNOWN` (with no frame ever) until fetching recovers.
- `UNKNOWN` is a claim, not a gap: "no frame received yet; fetch pipeline
  failing" tells the reader exactly what is missing. Rendering nothing,
  or a stale `LIVE`, hides the gap.

## Inputs

`cameraFeedHonestyLabel({ feedType, healthStatus, lastGoodFetchMs,
refreshCadenceMs, staleThresholdMs, nowMs })` returns
`{ label, reason }` — `label` is the display token, `reason` the one-line
justification (for tooltips and QA).

- `feedType`: `'hls'` is the only streaming transport; `'mp4'`/`'webm'`
  are looping clips; anything else (image, mjpeg, …) is a snapshot
  refresh. Match is case-insensitive; unknown types degrade to snapshot
  semantics rather than inventing a claim.
- `healthStatus`: `'ok' | 'failed' | 'unknown'` from the health sync.
  `'failed'` is the fetch-pipeline-down case; it blocks `LIVE` and
  `CONTINUOUS` outright.
- `lastGoodFetchMs`: timestamp of the last successfully fetched frame.
  Absent ⇒ `UNKNOWN` (absence of evidence must not render as liveness).
- `staleThresholdMs`: age beyond which the feed reads `STALE`; defaults
  to 15 min (`DEFAULT_STALE_AFTER_MS` — 15× the 60 s idle snapshot
  cadence, well past normal poll jitter).
- `nowMs`: clock, injectable for tests; defaults to `Date.now()`.
  Future `lastGoodFetchMs` values are treated as clock skew (clamped to
  now), never as extra freshness.

## Examples

- HLS, health ok, frame 9 s ago → `LIVE` — "HLS streaming; last good
  frame 9s ago"
- mp4, health ok, frame 45 s ago → `CONTINUOUS` — "looped clip; last
  good frame 45s ago"
- image, health ok, frame 20 s ago, 60 s cadence → `CONTINUOUS` —
  "snapshot refresh; last good frame 20s ago, refreshed every 1m"
- HLS, health failed, frame 30 s ago → `STALE` — "fetch pipeline
  failing; last good frame 30s ago"
- image, health failed, no frame ever → `UNKNOWN` — "no frame received
  yet; fetch pipeline failing"

## Test coverage

`src/layers/cctv/cameraLabelHonesty.test.mjs` exercises every label path:
each of the four labels, the failed-pipeline override, the exact
staleness boundary, custom/invalid thresholds, case-insensitive feed
types, unknown feed types, missing metadata, future timestamps, and the
default clock.
