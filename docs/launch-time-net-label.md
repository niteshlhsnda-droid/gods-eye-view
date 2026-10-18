# Launch times are NET, not liftoff times

## Rule

Never present a Launch Library 2 (LL2) launch time as an exact liftoff
moment. LL2's `net` field is a **No-Earlier-Than** bound: the earliest the
vehicle *could* go, not a scheduled T-0. The vehicle may lift off at any
point inside the launch window [`window_start`, `window_end`]. The mission
panel therefore shows a qualified label, never a bare timestamp:

- `NET · <ISO>` — time came from `net`, no usable window end.
- `NET · <ISO> · window until <ISO>` — `net` plus a real window end.
- `Window opens <ISO> · closes <ISO>` — no `net`; time came from
  `window_start` (with window end when supplied).
- `Window opens <ISO>` — `window_start` only.
- `Time unavailable` — no parseable time from either field.

## Field semantics (normalized launch record)

| Field | Meaning |
| --- | --- |
| `launchTime` | Machine time: ISO string from the first parseable source (`net`, then `window_start`), or `null`. Unchanged by this rule — sorting, countdown math, and analyst queries keep parsing it. Never display it bare. |
| `timeKind` | `'net'` \| `'window_start'` \| `null` — which source won. |
| `windowStart` / `windowEnd` | Parsed ISO bounds from `window_start` / `window_end`, or `null` when missing/unparseable. A window end at or before the start is recorded but never rendered as a window (a zero/negative window is not a window). |
| `launchTimeLabel` | Display string built by `formatLaunchTimeLabel`. The panel shows this (falling back to `launchTime` for hand-built records that lack it). |

## What did NOT change

- **Roster** shows the NET *date* only (`launchTime` day). A bare date is
  the NET date; adding a qualifier to every roster row would clutter the
  list, and the panel carries the full label.
- **Replay T− countdown** counts down to the NET moment for past launches.
  The replay is a reconstruction keyed to the scheduled NET, not a measured
  liftoff — the ascent path is already labelled reconstructed elsewhere, and
  the countdown inherits the NET meaning from `launchTime`.
- **A place name is never a time.** The old fallback
  `net || window_start || pad.location.name` is gone: a pad location name
  parsed to `NaN` and yielded a null time anyway, so dropping it changes no
  outcome — it only stops the code pretending a place name is a time
  candidate. An unparseable `net` now falls through to `window_start`
  instead of dropping the row.

## Evidence

- LL2 (The Space Devs) API: `net` = No Earlier Than; `window_start` /
  `window_end` = the launch window. The server proxy passes the full
  detailed payload through, so both window fields are available at
  normalize time.
- Precedent in this repo: the same over-precision pattern was fixed for
  FIRMS (`LIVE` badge removed — data can be ~40 min old), earthquake
  review status (`PRELIMINARY` for automatic events), and satellite
  `PREDICTED` labels (dated by TLE epoch age). A timestamp that is really a
  bound must say so.
