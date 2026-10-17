# Live Now — User Docs

## What it is

Live Now is the one-tap answer to *"what happened on Earth recently?"*
Open the globe, tap **Live Now**, and you get a ranked carousel of recent
events: cyclones, earthquakes, wildfires, breaking news clusters, air-traffic
anomalies, maritime alerts, space events, and severe weather. Each card is a
snapshot stamped with its update time — the panel refreshes every 10 minutes,
so it is never a live feed.

Tap any card and the camera **flies there** in under two seconds. Tap
**Play today's tour** and the globe plays a short cinematic tour through the
day's top events — shareable as a link, straight to WhatsApp.

This is the view you open every morning.

## Where the data comes from

Every event is built from public sensor and feed data, refreshed about every
10 minutes:

- **Earthquakes** — USGS earthquake feeds
- **Wildfires** — NASA FIRMS satellite heat-hotspot detections
- **Cyclones & severe weather** — national weather agencies (NOAA and
  regional counterparts)
- **Air-traffic anomalies** — public ADS-B feeds (e.g. emergency squawk
  codes 7700 / 7600 / 7500)
- **Maritime alerts** — public AIS vessel-tracking anomalies
- **Breaking news clusters** — RSS news feeds, ranked by media attention
  (GDELT article-volume timelines are used only as an *attention meter* to
  rank clusters — we store counts and links, never article text)

Each card carries **at least one source link** so you can always check the
origin yourself. If two or more sources are stale, the panel tells you
plainly ("2 sources stale") instead of failing silently.

## What the labels mean

**Confidence** — how sure we are the event is real:

- **verified** — confirmed by an authoritative source (e.g. USGS, NOAA,
  official agency). Safe to act on.
- **reported** — covered by multiple independent outlets, but not yet
  confirmed by an authority. Solid, still developing.
- **unconfirmed** — early reports only. The card says so in plain words
  ("reports suggest", "unverified"), and unconfirmed events **never enter
  the auto-tour**. Treat them as a heads-up, not a fact.

**Severity** — a 1-to-5 scale, normalized per event type:

1. **Minor** · 2. **Moderate** · 3. **Significant** · 4. **Severe** ·
5. **Critical**

(For example: a quake reaches Critical at magnitude 6+, an emergency squawk
7700 is always Critical.) Severity is shown as a labelled chip — never
color-only — so it works for everyone.

## What Live Now is not

- **Not advice.** Live Now is an observation layer, not a guidance system.
  It shows what sensors and feeds report — it does not tell you what to do.
  For safety decisions (evacuations, sheltering, travel), always follow your
  local authorities.
- **Not speculation.** For emergencies like aircraft or vessel incidents,
  cards state verified facts only — flight or vessel identifier, signal,
  location, time. We never guess at casualties. Full stop.
- **Not surveillance.** Live Now contains no private-person data — only
  public feeds about public events.

## Languages

Live Now ships in English, Hindi, Spanish, and Portuguese from day one. Card
templates adapt to the language; place names and numbers stay as reported.
