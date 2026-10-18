# Earthquake magnitudes must show their scale

## Rule

A bare "M5.2" is not a complete magnitude. Any surface that shows an
earthquake magnitude must label it with the scale it was measured on —
`M5.2 (Mw)`, `M5.2 (Ml)`, `M5.2 (Mb)` — never a bare `M5.2`, and never
"Richter".

## Why this matters

"M" is not one scale. The USGS feed reports magnitudes on several
scales — moment (Mw), local (Ml), body-wave (Mb), surface-wave (Ms),
duration (Md), and moment variants (Mww, Mwc, Mwb, Mwr, Mwp) — and the
scales are calibrated to roughly agree only near magnitude 6. They
diverge for large, deep, or distant events: an Ml and an Mw of the same
event are two different measurements, not two spellings of one number.
The feed carries the scale in `properties.magType`, but nothing in the
app reads it. The overlay title renders a bare `M${mag.toFixed(1)}`
("M5.2"), silently dropping the scale, so two events labelled "M5.2"
can be on different scales and a reader comparing them is comparing
unlike with unlike. That is the whole gap: the data was there, the label
was not.

Calling every magnitude "Richter" is the same error in the other
direction. The Richter scale is the local magnitude Ml. USGS magnitudes
above 4.0 are generally moment magnitude, and a USGS press release's
bare "M" is implicitly moment — but the feed's `magType` is the
authority here, and a missing `magType` is unknown, not implicitly Mw.

## What the app does

`formatMagnitudeLabel(mag, magType)`
(`src/layers/earthquakes/magnitudeType.js`) builds the label:

- `M5.2 (Mw)` — known type, canonical code. Feed spellings
  canonicalize case-insensitively (`mw` → `Mw`, `ML` → `Ml`).
- `M5.2 (Mwp)` — USGS alias spellings collapse to one code: `Mi` is
  the same scale as `Mwp`, and `mb_lg` / `MLg` collapse to `mb_Lg`
  (the USGS page's own spelling — never an invented `Mlg`).
- `M5.2 (scale unknown)` — missing, malformed, or non-scale `magType`
  (`null`, `""`, `"banana"`, `"M"`, `"M5.2"`). The label never prints
  a bare magnitude as if the scale were known, and never defaults a
  missing type to Mw.
- `M5.2 (Mlv)` — a feed code outside the verified table that still
  looks like a magnitude code (M + 1–4 letters) is quoted verbatim.
  Quoting reports exactly what the feed said; it is not an endorsement.
  `magnitudeTypeName` returns `null` for such codes, so no surface can
  show an expanded name it has not verified.
- `Magnitude unknown` — missing, non-numeric, or non-finite magnitude.
  `Number(null)` and `Number('')` are both 0, so both are rejected
  explicitly rather than coerced into a fake `M0.0`.

`magnitudeTypeName(code)` returns the verified expanded name
(`Mw` → "Moment magnitude", `Ml` → "Local magnitude", `Mb` →
"Body-wave magnitude", `Ms` → "Surface-wave magnitude", `Md` →
"Duration magnitude", `Mww` → "Moment magnitude (W-phase)", `Mwc` /
`Mwb` / `Mwr` → the centroid/regional moment variants, `Mwp` →
"Moment magnitude (P-wave integral)", `mb_Lg` → "Lg-wave magnitude"),
or `null` for anything unverified. Magnitudes render to one decimal,
matching the existing overlay title. Negative magnitudes
(microearthquakes) format, never clamp — range checks belong to the
feed validator, not this formatter.

Sources: USGS, "Magnitude Types"
(`usgs.gov/programs/earthquake-hazards/magnitude-types`); PNSN,
"Glossary for Recent Earthquakes Pages" (magnitude-type table).

## What not to do

- Never show an earthquake magnitude without its scale — not in the
  overlay, not in the analyst record, not in an export or snapshot.
- Never call a magnitude "Richter" — not even an Ml. The name is
  "Local magnitude".
- Never default a missing `magType` to Mw, and never treat a missing
  `magType` as implicitly Mw because a press release would.
- Never expand an unlisted feed code into a name. Quote it verbatim
  or call it unknown; a guessed expansion is a fabricated fact.
- Never use the formatter's output for filtering, thresholds, sorting,
  or any comparison. It is display-only: comparing an Ml to an Mw as
  numbers is the exact error this label exists to expose.

## Adoption (follow-up, not this change)

This change ships the helper, its tests, and this rule — display-only.
No call site is migrated yet, and the feed path does not yet carry the
type: `normalizeEarthquakeSnapshot` (`records.js`) currently drops
`properties.magType` entirely, so wiring the label in also means
threading `magType` through the snapshot, the analyst record, and the
overlay title (`createEarthquakeOverlayEntry`). When the label lands
alongside the review-status label (Cycle 4 branch, unmerged), the two
compose as `M5.2 (Mw) · PRELIMINARY` — type first (what was measured),
status second (how final) — never as a single fused string that hides
one of them.
