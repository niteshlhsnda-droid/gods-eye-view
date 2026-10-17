# Coordinate precision honesty

**Rule: never display more coordinate decimals than the source accuracy justifies.**

## Why

A coordinate printed to 6 decimals claims ~0.11 m precision. When the source
is only accurate to a kilometre (a satellite fire pixel, a geocoded town, a
coarse public dataset), those extra digits are not measurement — they are
noise wearing a lab coat. Readers copy them into reports, navigation, and
further analysis, and the false precision propagates. The display must round
to what the source actually supports, and say that it did.

## The mapping

Implemented in `src/data/coordinatePrecision.js` (single source of truth):

| Decimals shown | Grid step | Use when source accuracy is |
|---|---|---|
| 1 | ~11.1 km | ≥ 10 km |
| 2 | ~1.11 km | ≥ 1 km |
| 3 | ~111 m | ≥ 100 m, **or unknown** |
| 4 | ~11.1 m | ≥ 10 m |
| 5 | ~1.11 m | ≥ 1 m |
| 6 | ~0.11 m | < 1 m (survey-grade / exact) |

Boundaries are inclusive at the top: exactly 1 km earns 2 decimals, never 3.

## How to use it

```js
import {
  formatLatLon,
  coordinatePrecisionNote,
} from '../data/coordinatePrecision.js';

// A fire pixel whose source accuracy is ~1 km:
formatLatLon(fire.lat, fire.lon, 1000); // "12.35, 77.12" — not 6 decimals
coordinatePrecisionNote(1000);
// "Coordinates shown to 2 decimal places, matching the source accuracy
// (≈1 km); extra decimals would imply false precision."
```

- Pass the source's **stated** accuracy in metres. Do not guess a tighter one
  because the number "looks" precise.
- **Unknown accuracy → 3 decimals + the unknown-accuracy note.** Never
  default to 6 decimals "because the value has them".
- Show `coordinatePrecisionNote()` beside any displayed coordinate whose
  decimals were rounded, so the rounding is disclosed rather than silent.

## What NOT to round

Display only. Render keys, cache keys, hashes, and API query parameters keep
full precision — rounding there would merge distinct positions. Identity is
not display.

## Related

- Basemap imagery vintage: `docs/basemap-imagery-vintage.md` (unknown
  vintage is disclosed, never upgraded to "current").
- Satellite positions: labelled PREDICTED with TLE age
  (`docs/satellite-predicted-positions.md`).
- Freshness labels report observation time, not fetch time.
