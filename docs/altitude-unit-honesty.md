# Altitudes must show their unit and datum

## Rule

A bare `5000` is not an altitude. Any surface that shows an altitude
must label it with the unit it was measured in — `5000 ft`, `120 m`,
`8 km` — and with the datum it was measured against — `5000 ft · MSL`,
`120 m · AGL`, `350 m · above WGS 84 ellipsoid`. Never a bare number,
and never a unit without its datum where a datum exists.

## Why this matters

The feeds this app renders report heights in different units and
against different datums, and today nothing records either:

- ADS-B reports aircraft altitude in **feet** (barometric,
  conventionally read against mean sea level).
- Terrain and camera heights are often **metres above ground level**.
- GNSS receivers report height above the **WGS 84 ellipsoid**.

A panel that mixes two of those sources and prints bare numbers
invites a reader to compare an MSL altitude with an AGL height as if
they were the same quantity. For an aircraft at 5,000 ft AGL over
4,000 ft terrain, the MSL altitude is 9,000 ft — the bare numbers
differ by 4,000 ft. The ellipsoid/MSL gap is subtler and just as
real: geoid separation reaches roughly 100 m, so a GNSS "altitude"
and a barometric MSL altitude for the same point can disagree by
more than a city block's height with neither being wrong.

Defaulting is the same error in the other direction. "Most aviation
feeds use feet" does not make an unlabelled feed feet; "most panels
show MSL" does not make an unlabelled altitude MSL. An unknown unit
or datum is unknown, not the common case.

## What the app does

`formatAltitudeLabel(value, { unit, datum })`
(`src/data/altitudeLabel.js`) is the single source of truth for
altitude labels. It is display-only: it never feeds filters,
thresholds, sorting, or queries, and it never converts — a converted
value must be re-labelled with its new unit and datum by the caller.

| Input | Output |
| --- | --- |
| `formatAltitudeLabel(5000, { unit: 'ft', datum: 'msl' })` | `5000 ft · MSL` |
| `formatAltitudeLabel(120, { unit: 'm', datum: 'agl' })` | `120 m · AGL` |
| `formatAltitudeLabel(350, { unit: 'm', datum: 'ellipsoid' })` | `350 m · above WGS 84 ellipsoid` |
| `formatAltitudeLabel(5000, { unit: 'ft' })` | `5000 ft (datum unknown)` |
| `formatAltitudeLabel(120, { datum: 'msl' })` | `120 (unit unknown) · MSL` |
| `formatAltitudeLabel(120, {})` | `120 (unit unknown, datum unknown)` |
| `formatAltitudeLabel(null, { unit: 'ft', datum: 'msl' })` | `Altitude unknown` |

Helpers: `normalizeAltitudeUnit` / `normalizeAltitudeDatum`
canonicalize source spellings (`feet` → `ft`, `HAE` → `ellipsoid`)
or return `null` for anything unverified; `altitudeUnitName` /
`altitudeDatumName` give verified expanded names for long-form
surfaces (`feet`, `mean sea level`, `above ground level`, `above the
WGS 84 ellipsoid`).

## Edge rules

- **Zero and negatives are valid.** Sea level is `0 m · MSL`;
  below-sea-level terrain is genuinely negative (`-430 m · MSL`
  at the Dead Sea shore). A negative value is a below-sea-level
  altitude, never relabelled as a depth.
- **Flight levels are rejected.** `FL350` is a pressure altitude in
  hundreds of feet, not an altitude of 350 anything. Flight-level
  spellings render as unknown unit; surfaces showing flight levels
  must label them as flight levels, not launder them through this
  module.
- **No call-site migration.** No existing call site is changed by
  this module. Surfaces adopt it when they are next touched; until
  then their labels stay exactly as they are.

## What this does not do

- No conversion between units or datums (that needs geoid data and
  is out of scope for a label module).
- No validity threshold: an implausible-but-finite altitude still
  renders with its unit and datum. Plausibility checks belong to
  ingestion, not display.
