# Speeds must show their unit and basis

## Rule

A bare `120` is not a speed. Any surface that shows a speed must label
it with the unit it was measured in — `120 kn`, `100 km/h`, `25 m/s`,
`60 mph` — and, where the source distinguishes a basis, with the basis
it was measured on — `120 kn · ground speed`, `120 kn · airspeed`,
`8 kn · water speed`, `25 kn · wind speed`. Never a bare number, and
never a unit without its basis where a basis exists.

## Why this matters

The feeds this app renders report speeds in different units and on
different bases, and today nothing records either:

- ADS-B reports aircraft **ground speed** in knots.
- A pitot reports **airspeed** — in knots or mph depending on the
  source.
- AIS reports vessel **speed over ground** in knots; a vessel log
  reports **speed through water**.
- NHC reports **wind speed** in knots.

A panel that mixes two of those sources and prints bare numbers
invites a reader to compare a ground speed with an airspeed as if
they were the same quantity. For an aircraft in a 100-knot headwind
they differ by 100 knots. The existing `formatKnots` helper
(`src/data/detectionDraw.js`) attaches a unit (`14 kn`) but no basis:
correct for a vessel panel where speed over ground is the only
speed shown, and silently ambiguous anywhere a second basis can
appear.

Defaulting is the same error in the other direction. "Most feeds use
knots" does not make an unlabelled feed knots; "most panels show
ground speed" does not make an unlabelled speed a ground speed. An
unknown unit or basis is unknown, not the common case.

## What the app does

`formatSpeedLabel(value, { unit, basis })`
(`src/data/speedLabel.js`) builds the label:

- `120 kn · ground speed` — known unit, known basis. Feed spellings
  canonicalize case-insensitively (`KNOTS` → `kn`, `kph` → `km/h`,
  `mps` → `m/s`, `mi/h` → `mph`; `SOG` → ground, `TAS` / `IAS` →
  air, `STW` → water).
- `120 kn (basis unknown)` — known unit, missing or unverified basis
  (`null`, `""`, `"banana"`). The label never prints a bare `120 kn`
  that invites the reader to assume the basis.
- `120 (unit unknown) · ground speed` — missing or unverified unit
  (`null`, `""`, `"furlongs"`). Never a bare `120`, never defaulted
  to knots.
- `120 (unit unknown, basis unknown)` — neither known.
- `Speed unknown` — missing, non-numeric, non-finite, or negative
  speed. `Number(null)` and `Number('')` are both 0, so both are
  rejected explicitly rather than coerced into a fake `0 kn`. Zero
  itself is valid: a moored vessel or parked aircraft genuinely has
  zero speed.

`normalizeSpeedUnit` / `normalizeSpeedBasis` return the canonical
code/basis or `null` for anything unverified.
`speedUnitName` / `speedBasisName` return the verified expanded name
(`kn` → "knots", `km/h` → "kilometres per hour", `m/s` →
"metres per second", `mph` → "miles per hour"; `ground` →
"ground speed", `air` → "airspeed", `water` → "water speed",
`wind` → "wind speed"), or `null` for anything unverified.

## Non-goals

- **No conversion.** This module formats; it never converts. A
  converted value must be re-labelled with its new unit by the
  caller, never silently relabelled here.
- **No IAS/TAS sub-distinction.** Both indicated and true airspeed
  render as "airspeed". A surface that needs the sub-distinction
  must say so explicitly, not lean on this label.
- **No call-site migration.** No panel is rewired in this change;
  threading unit/basis through aircraft, vessel, wind, and cyclone
  records into their labels is a follow-up. `formatKnots` keeps
  working as-is for the vessel panel.
