# Aircraft positions must show their source and what the dot really is

## Rule

A dot on the map is not a position. Any surface that labels an aircraft
track must say how the fix was measured — ADS-B, MLAT, or an upstream
blend — and what the rendered dot actually is — an observed fix, an
interpolation between fixes, or an extrapolated forecast. Never a bare
track, and never a source claim the data cannot support.

## Why this matters

The tracks this app renders mix measurement sources of very different
precision, and today nothing records the source:

- **ADS-B** is the aircraft's own GNSS position — high precision.
- **MLAT** is multilaterated by the receiver network from Mode S replies —
  meaningfully less precise, and it must never read as a GPS point.
- The upstream snapshots (OpenSky, adsb.lol fallback) merge both **without
  per-fix attribution**. The adsb.lol API carries a per-record MLAT flag
  upstream, but this app does not consume it — so nothing here can tell a
  multilaterated fix from a GNSS one on the upstream feed. Claiming plain
  'ADS-B' for an upstream fix would be fabrication.
- The app's own receiver network (`localAdsb`, readsb/dump1090) is
  known-good ADS-B.

On top of that, the renderer itself moves the dot away from the fixes:
between polls it walks a straight chord between two known fixes
(interpolation — the normal render-delay regime), and when the feed goes
stale it dead-reckons past the newest fix (extrapolation — a forecast).
The fleet records keep `rawLat`/`rawLon` (the actual reported fix) distinct
from the dead-reckoned billboard position, and a coasting contact fades to
45% alpha — but nothing says _what the faded dot is_. A reader can trust
an extrapolated forecast exactly as much as a GNSS fix.

Defaulting is the same error in the other direction. "Most tracks are
ADS-B" does not make an unlabelled fix ADS-B; "the dot is near the fix"
does not make it the fix. An unknown source is unknown, not the common
case.

## What the app does

`formatPositionProvenanceLabel({ source, renderedAs })`
(`src/data/positionProvenance.js`) is the single source of truth for
position-provenance labels. It is display-only: it never feeds filters,
thresholds, sorting, or queries, and it never judges whether a fix is
good enough to show.

| Input                                                  | Output                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `{ source: 'ads-b', renderedAs: 'observed' }`          | `ADS-B (aircraft-reported GNSS) · observed fix`                     |
| `{ source: 'mlat', renderedAs: 'observed' }`           | `MLAT (multilaterated) · observed fix`                              |
| `{ source: 'opensky', renderedAs: 'interpolated' }`    | `Upstream (ADS-B + MLAT) · interpolated between fixes`              |
| `{ source: 'local-adsb', renderedAs: 'extrapolated' }` | `Local ADS-B receiver · extrapolated forecast — not an observation` |
| `{ source: 'ads-b', renderedAs: 'teleported' }`        | `ADS-B (aircraft-reported GNSS) · position rendering unknown`       |
| `{ source: 'LIDAR', renderedAs: 'observed' }`          | `position source undisclosed · observed fix`                        |
| `{}`                                                   | `Position provenance unknown`                                       |

Helpers: `normalizePositionSource` / `normalizeRenderedPosition`
canonicalize source spellings (`ADSB` → `ads-b`, `multilateration` →
`mlat`, `OpenSky` → `upstream-mix`, `dump1090` → `local-adsb`,
`dead-reckoned` → `extrapolated`, `fix` → `observed`) or return `null`
for anything unverified; `positionSourceName` gives verified expanded
names for long-form surfaces (`aircraft-reported ADS-B GNSS position`,
`network-multilaterated position (lower precision than ADS-B)`,
`upstream snapshot (ADS-B and MLAT mixed; per-fix source undisclosed)`,
`local ADS-B receiver position`).

## Edge rules

- **Upstream is never plain ADS-B.** `OpenSky`, `adsb.lol`, and
  `ADS-B + MLAT` spellings all normalize to `upstream-mix`. The module
  has no way to know whether one upstream fix is ADS-B or MLAT, so it
  says the only true thing: the blend.
- **Extrapolation is always a forecast.** Whatever the source, an
  extrapolated display renders as `extrapolated forecast — not an
observation` — never as `live`, `current`, or `now`.
- **Interpolation is named, not smoothed over.** The normal render-delay
  regime reads as `interpolated between fixes`; the chord is a
  straight line the turning aircraft may not have flown.
- **No call-site migration.** No existing call site is changed by this
  module. Surfaces adopt it when they are next touched; until then their
  labels stay exactly as they are.

## What this does not do

- No per-fix ADS-B/MLAT attribution for the upstream feed (the data does
  not exist in the app; the adsb.lol MLAT flag is not consumed).
- No fix-quality judgment: an implausible-but-reported fix still renders
  with its source label. Quality signals (NIC/NACp) belong to the gnss
  layer, not this label module.
- No freshness claim: fix age is the `observedFreshness` module's job.
