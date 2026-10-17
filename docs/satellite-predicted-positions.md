# Satellite positions are predictions, not observations

## Rule

Every satellite position the app shows is an SGP4 prediction propagated from
a two-line element set (TLE), never a live observation of the satellite. Any
surface that presents a satellite position must say so, and must date the
prediction by the age of the element set it was propagated from — never by
when the element set was fetched.

## Why this matters

A satellite dot looks exactly like an aircraft or vessel dot, and those dots
*are* observations (ADS-B / AIS reports of where the craft was). A satellite
dot is different in kind: CelesTrak publishes element sets, the app runs
SGP4 forward from each set's epoch, and the dot is where the model says the
satellite should be. Two failure modes follow from forgetting that:

1. **A fresh fetch of a stale TLE still propagates a stale prediction.**
   The catalog can be re-fetched every 15 minutes while every element set in
   it is days old. Dating the position by fetch time would read "just now"
   for a prediction propagated from a 4-day-old epoch.
2. **SGP4 error grows with epoch age.** The further the propagation runs
   from the epoch, the less the predicted position can be trusted — for
   low-orbit satellites, drag makes old element sets go stale fastest. An
   undated dot invites the reader to treat a days-old prediction as exact.

## What the app does

- `satellitePredictionLabel(line1, { nowMs })` (`src/sources/tle.js`)
  builds the label:
  - `PREDICTED · TLE 25 min old` — propagated from an element set 25
    minutes past its epoch.
  - `PREDICTED · TLE 4 d old · STALE` — the element set is older than
    `TLE_STALE_AGE_MS` (72 h), the same threshold the refresh scheduler
    (`src/layers/satellites/tleRefresh.js`) uses to call a catalog stale.
  - `PREDICTED · TLE age unknown` — the element set is missing, its epoch
    field is malformed, or its epoch lies in the future. The label never
    invents an age.
- Analyst records (`src/layers/satellites/records.js`) carry
  `positionKind: 'predicted'` (constant, filterable) and `positionLabel`
  from the catalog entry's own `line1`, so the qualifier travels with the
  data wherever the record is rendered or exported.
- The in-app Data attribution popover (`src/data/dataCredits.js`,
  `celestrak` entry) and the CelesTrak row of `DATA_SOURCES.md` state the
  prediction nature and the age-degrades-accuracy caveat.
- The internal policy comment (`src/layers/satellites/policy.js`) already
  said positions are predictions; this doc makes that a user-facing rule
  instead of a code comment.

## What not to do

- Never label a satellite position "live", "real-time", or "current"
  without the PREDICTED qualifier — those words assert an observation.
- Never date a satellite position by fetch/refresh time. The only honest
  clock is the element-set epoch.
- Never drop the qualifier when a record is re-rendered (analyst answers,
  exports, snapshots). `positionKind` exists so consumers can check it
  programmatically; `positionLabel` is the human-readable form.
