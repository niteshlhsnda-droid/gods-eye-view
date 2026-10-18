# Street-level photos must show their capture date

## Rule

A street-level photo is a snapshot of one moment, and that moment can be
years before today. Any surface that shows a street-level photo must label
it with the date it was captured — never present it bare, where it reads
as "now".

## Why this matters

A street-level photo looks like the present. Nothing in the frame says
"this shopfront was photographed in 2019" — the image itself is the
evidence, and the evidence is old. A reader planning a visit, checking
whether a road is open, or judging what a neighbourhood looks like will
treat an undated photo as current, and act on a world that may no longer
exist. The capture date already travels with the open image
(`state.street.capturedAt`, plus `capturedAtPrecision`); the app stored it
and never showed it. That is the whole gap: the data was there, the label
was not.

## What the app does

`captureLabel(capturedAt, precision)` (`src/layers/streetLevel/captureDate.js`)
builds the label:

- `Captured 12 Mar 2024 · 2 years ago` — day-precision providers
  (Mapillary, KartaView) render the full date plus a calendar age.
- `Captured Mar 2024 · 2 years ago` — month-precision providers
  (Google Street View dates are `YYYY-MM`) render month-only. The stored
  epoch for a Google date is the 1st of the month, but the 1st is a
  storage artifact, not the capture day — the label never invents a day,
  and the age never resolves finer than a month.
- `Capture date unknown` — missing, malformed, zero/negative, or
  future-dated values. A capture dated after now is clock skew or bad
  data, never a real photo (same stance as the TLE future-epoch rule).
  The label never prints a blank, an epoch date, or a future date.

Dates render in UTC: a capture date is a calendar date, and the viewer's
local timezone must not shift it across a day boundary. Ages are
calendar-based (UTC year/month/day), so "1 month ago" means the same
calendar month last month, and 19 Oct 2025 → 18 Oct 2026 reads as
"11 months ago", not a rounded-up "1 year ago".

## What not to do

- Never show a street-level photo without its capture label — not in the
  viewer, not in a thumbnail, not in an export or snapshot.
- Never render a month-precision date with a day. "1 Mar 2024" for a
  Google image is a fabricated day.
- Never date a photo by fetch, open, or panel-render time. The only
  honest clock is the provider's capture date.
- Never drop the label when a photo is re-rendered elsewhere. The label
  is part of the photo's identity, like the provider credit.

## Adoption (follow-up, not this change)

This change ships the helper, its tests, and this rule — display-only.
No panel call site is migrated yet. Wiring `captureLabel` into the
street-level viewer caption is a follow-up; until then the rule is
recorded here so the wiring has exactly one correct implementation to
reach for.
