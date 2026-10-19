# PRD.md — Product requirements (intent)

Product contract. Says WHAT and WHY, never HOW (how is
`docs/Architecture.md`). Requirements carry stable IDs (FR-xxx) so
tasks and decisions can link to them.

## Vision

**Google Earth shows you the world. God's Eye View shows you the world
*happening*.** Thesis: we don't invent, we compose — the moat is
curation and integration of existing open work into one living planet.

## Users and use cases

- **Curious explorers:** fly anywhere, watch live flights/ships/cams,
  ride a recorded drive-through of 179 cities (City Drives).
- **Trackers:** follow a flight, a vessel, the ISS; check earthquakes,
  fires, cyclones, space weather with honest freshness labels.
- **Learners:** Story Mode tours, "how this map can mislead"
  disclosures, provenance on every pin.

## Feature inventory (31 catalog layers + panels)

**Movement:** Live Flights, Military Flights, Local ADS-B (own
receiver), Live Vessels (AIS), Satellites (TLE/SGP4), Space Missions
(30d), GNSS Integrity, Street Traffic, Transit, Bikeshare, Directions.
**Cameras & street level:** CCTV Mesh, Mapped ALPR cameras, Street
Level (Mapillary → Google → KartaView), City Drives (179 recorded
drive-throughs + live local radio). **Events & environment:**
Earthquakes (24h), Active Fires (FIRMS), Fire Perimeters, Tropical
Cyclones, Wind, Observed Weather (NOAA nowCOAST), Radio. **Reference:**
infrastructure layers, submarine cables. **Import:** GeoJSON/KML/KMZ/
GPX (+ 12-format loader routing). **Across layers:** Live Now, Cockpit,
Voice control, Search, Share links & scenes, Story Mode, Alerts, Draw/
annotate, DISPLAY panel, visual styles.

## Functional requirements

- **FR-GLOBE-001:** one interactive 3D globe; camera fly-to from any
  panel/search; globe is the primary focal point.
- **FR-LAYER-001:** every catalog layer has an on/off toggle that does
  not reset unrelated layers or the camera.
- **FR-HONEST-001:** every layer shows its freshness chip (LIVE /
  CONTINUOUS / SNAPSHOT / SIMULATED / PROPAGATED / STALE / PRELIMINARY
  / VINTAGE UNKNOWN). A snapshot is never called live.
- **FR-HONEST-002 (failure states):** feed failure → the layer shows
  "unavailable" or "stale" with a retry path. A dead feed must never
  look like a healthy empty layer. Never present old data as current.
- **FR-HONEST-003:** predicted positions (satellites) are labelled
  PROPAGATED/SIMULATED, never observed.
- **FR-CITYDRIVE-001:** after a location search, tapping 🚗 starts the
  drive at once: the searched location is matched to a drive city (name
  match first, else nearest catalog city within 150 km of the camera;
  cities with known-dead videos, flagged `videoOk: false`, are skipped),
  the camera flies there, and the city card opens in player mode. The
  card carries a Drive tab (recorded drive-through, always labelled
  "Recorded drive-through (not live)") + Live Radio tab (live stream or
  "No live stream found"). If nothing matches within 150 km, the nearest
  drive city (any distance) auto-plays with a toast naming it — no dead
  ends, no forced list-picking. No searched location falls back to the
  browse panel (179-city list) with a toast. Credits shown in the panel.
- **FR-STREET-001:** street-level cascade Mapillary → Google →
  KartaView; freshness by `shotDate`/`capturedAt`; upload-date vs
  capture-date distinguished (OQ-1: `startDate` = upload date).
- **FR-IMPORT-001:** GeoJSON import strips legacy `crs` with a visible
  "CRS ignored — coordinates assumed WGS 84" warning (never silent).
- **FR-PROVENANCE-001:** every pin/forecast/alert carries source +
  timestamp. No music without a named source/licence.
- **FR-SAFETY-001:** no private-person surveillance surface anywhere:
  no plate reading, no owner lookups, no identifying individuals;
  street-level stays at public vantage points.

## Non-functional requirements

Performance (lite-first, progressive load), reliability (graceful
degradation per FR-HONEST-002), accessibility (keyboard nav, reduced
motion, contrast — see `docs/Design.md`), security/privacy (no
credentials in bundle; no surveillance features), devices (desktop +
mobile; touch targets ≥44px).

## Non-goals

- No keyless whole-world live camera layer (does not exist for free —
  research confirmed; USA Open-Eagle-Eye/Caltrans/WSDOT/FL511,
  Finland Digitraffic, Ireland TII, UK TfL are the keyless set).
- No private surveillance features, ever (DEC-003 context).
- No Panoramax in this port (Phase 1 later, DEC-004).
- No OMM migration (TLE-only, DEC-011).
- No promises about third-party embed behaviour (ads, availability).

## Acceptance / success metrics

- Demo boots on the project subpath with no 404 assets; every layer
  toggle works without resetting camera.
- Every layer shows a correct freshness chip; killing a feed shows
  "unavailable", never a fake-live view.
- City Drives: any of 179 cities → camera flies, card opens, drive
  labelled recorded, radio live or honest "not found".
- Full gate suite green (9,740 pass / 0 fail baseline, 2026-10-19).
