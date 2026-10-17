# Live Now — Card Copy Pack (English master)

ChatGPT SELL lane, 2026-10-13. Newsroom-grade, tight, no filler.
Rendered limits: **title ≤ 90 chars, summary ≤ 200 chars** (placeholders
counted at literal length; the ingest layer must re-check and truncate
after substitution — never let a long place name push a card over).

## Placeholder reference

| Placeholder | Meaning | Example |
|---|---|---|
| `{name}` | Cyclone/storm name | Remal |
| `{cat}` | Category number | 3 |
| `{winds}` | Sustained wind speed, km/h | 185 |
| `{mag}` | Quake magnitude | 6.2 |
| `{depth}` | Quake depth, km | 10 |
| `{hotspots}` | FIRMS hotspot count | 47 |
| `{area}` | Burned area, km² | 12 |
| `{topic}` | News cluster keyword/topic | "port strike" |
| `{sources}` | Number of independent outlets | 6 |
| `{flight}` | Flight number / callsign | AI-202 |
| `{squawk}` | Transponder code | 7700 |
| `{vessel}` | Vessel name (public AIS) | MV Aurora |
| `{event}` | Space event label | Falcon 9 launch |
| `{alert}` | Weather alert type | Heatwave warning |
| `{place}` | Nearest named place | Bay of Bengal |
| `{time}` | Relative or absolute event time | 2h ago |

## Variant convention (all types)

- **title1 / summary1** — default for `confidence: verified`
- **title2 / summary2** — alternate for `confidence: verified|reported`
- **title3 / summary3** — `confidence: unconfirmed` ONLY. Always cautious
  wording ("reports suggest", "unconfirmed", "unverified"). These NEVER
  enter the auto-tour script (§4.5).

## Safety gates (non-negotiable, §4.5)

1. **Aviation & maritime, severity-5:** NEVER speculate on casualties.
   No "likely killed", no body counts, no "disaster". Stick to verified
   facts only: flight number / vessel name, squawk code, location, time.
   The summaries below model this explicitly.
2. **Unconfirmed:** stated as possibility, never fact; variant 3 wording only.
3. **No private-person data** anywhere in any template.

---

## cyclone

- title1: Cyclone {name} — Cat {cat} bearing down on {place}
- title2: {name} intensifies to Cat {cat}, {place} in its path
- title3: Reports suggest a cyclone forming near {place} — unconfirmed
- summary1: {name} is a Category {cat} cyclone with {winds} km/h winds, {time}. Landfall expected near {place}.
- summary2: Cat {cat} cyclone {name} tracked {time}, moving toward {place}. Sustained winds {winds} km/h.
- summary3: Unconfirmed reports suggest tropical cyclone activity near {place}, {time}. Treat with caution.

## quake

- title1: M{mag} earthquake strikes {place}
- title2: Earthquake M{mag} hits {place}, depth {depth} km
- title3: Unverified reports of an earthquake near {place} — checking
- summary1: A magnitude {mag} earthquake struck near {place}, {time}, at {depth} km depth. Shaking reports being compiled.
- summary2: M{mag} quake recorded near {place} {time} ({depth} km deep). Aftershocks possible.
- summary3: Early, unconfirmed reports suggest seismic activity near {place}, {time}. Awaiting verification.

## fire

- title1: Wildfire burning across {place}
- title2: {hotspots} fire hotspots detected near {place}
- title3: Reports of a fire near {place} — unconfirmed
- summary1: Satellites detected an active fire near {place}, {time}, covering roughly {area} km². Crews are responding.
- summary2: {hotspots} heat hotspots picked up near {place} {time}. Spread unknown — keep clear of the area.
- summary3: Unconfirmed reports of a fire near {place}, {time}. Not yet verified by satellite.

## news

- title1: {topic} — the story gripping {place}
- title2: {topic}: developing in {place}
- title3: Reports suggest {topic} near {place} — unconfirmed
- summary1: Breaking: {topic} reported from {place} {time}, covered by {sources} outlets. Developing story.
- summary2: A cluster of {sources} reports points to {topic} in {place}, {time}. Details still emerging.
- summary3: Early, unconfirmed reports suggest {topic} near {place} ({time}). Awaiting corroboration.

## aviation (⚠ severity-5: casualty speculation FORBIDDEN)

- title1: {flight} declares emergency (squawk {squawk}) near {place}
- title2: Emergency squawk {squawk} from {flight} over {place}
- title3: Possible emergency signal from {flight} near {place} — unverified
- summary1: {flight} broadcast emergency squawk {squawk} near {place} {time}. Verified facts only — aircraft is being tracked.
- summary2: Emergency transponder code {squawk} detected from {flight} near {place}, {time}. Position tracked; no casualty claims until verified.
- summary3: Unverified reports suggest {flight} may have squawked {squawk} near {place}, {time}. Awaiting confirmation.

## maritime (⚠ severity-5: casualty speculation FORBIDDEN)

- title1: {vessel} goes dark near {place}
- title2: AIS anomaly: {vessel} off {place}
- title3: Possible distress signal near {place} — unverified
- summary1: Maritime alert: {vessel} showed an AIS anomaly near {place} {time}. Verified facts only — last reported position as shown.
- summary2: {vessel} dropped AIS contact near {place} at {time}. Tracking continues; no casualty claims until verified.
- summary3: Unconfirmed reports of a maritime incident near {place}, {time}. Treat with caution.

## space

- title1: {event} — launch window over {place}
- title2: Underway: {event} from {place}
- title3: Unconfirmed schedule change for {event} — checking
- summary1: {event} is scheduled at {place}, {time}. Tracking starts at launch.
- summary2: A {event} is underway from {place} ({time}). Follow the trajectory as tracking updates arrive.
- summary3: Reports of a schedule change for {event} ({time}) are unconfirmed. Awaiting official word.

## weather

- title1: {alert} issued for {place}
- title2: Severe weather alert: {place}
- title3: Possible severe weather near {place} — unconfirmed
- summary1: A {alert} is in effect for {place}, {time}. Conditions can change fast — follow official guidance.
- summary2: Weather alert for {place} ({time}): {alert}. Stay updated.
- summary3: Unverified reports of severe weather near {place}, {time}. Confirm with official sources.

---

## Notes for the build lane (Gemini)

- Placeholder substitution must preserve the `{...}` braces in i18n keys
  (`docs/live-now/i18n.json`) — substitute at render time, not ingest time,
  so the card can switch language client-side.
- Placeholder VALUES are data, not copy: proper nouns and numbers stay the
  same across languages; only the template words translate.
- If substitution pushes a title over 90 chars, truncate with "…" — never
  mid-word for Hindi.
