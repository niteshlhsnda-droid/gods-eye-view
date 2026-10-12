# Time-Rewind Pipeline

## What shipped tonight (option B — client-side historical replay)

Planet-scale tile generation is not feasible on the sprint VM (Planetiler needs
Java + a large OSM extract; TiTiler needs Python/GDAL and COG rasters — none
are viable in one night). What ships is a **client-side historical replay**:

- `src/timeRewind/historySource.js` — fetches the USGS FDSN Event Web Service
  history (`/fdsnws/event/1/query?format=geojson&starttime=…&minmagnitude=5`)
  for the last 30 days (M5+), normalized through the existing earthquake
  layer's `normalizeEarthquakeSnapshot` validator — the same rows the live
  layer renders.
- `src/timeRewind/scrubberModel.js` — pure play/pause/seek/scrub with a speed
  multiplier (default 60×); events are sorted, indexed, and exposed with a
  playhead and progress fraction.
- `src/timeRewind/replayView.js` — renderer-agnostic shockwave descriptors:
  expanding rings colored by magnitude with age-driven fade; the app maps them
  to Cesium entities (growing ellipse + fading material).
- `docs` tests: `src/timeRewind/timeRewind.test.mjs` (11 tests, passing).

This is a real, working time-rewind over one month of significant seismic
history — no tile infrastructure required.

## Full path: planet-scale time-travel tiles (not built tonight)

For true scrub-anywhere history over the whole globe (imagery + vectors),
the production pipeline is:

1. **Source rasters (time-stamped)**
   - NASA GIBS provides daily global mosaics (the app already uses VIIRS via
     `src/layers/recentImagery`). For an archive, pull daily COGs from GIBS /
     AWS (`s3://gibs/...`) for the desired date range.
   - Serve with **TiTiler** (`cogeo/titiler`): `titiler` exposes any COG as
     XYZ/WMTS tiles with a `{time}` dimension — deploy as a container behind
     the app, or pre-render with `titiler` + `rio-tiler` into PMTiles.
2. **Source vectors (time-stamped)**
   - Download a planet or region OSM extract (Geofabrik `.osm.pbf`).
   - Run **Planetiler** (`planetiler/planetiler`, Java 21+):
     `java -jar planetiler.jar --download --area=planet --output=planet.pmtiles`
     with a profile that keeps `start_date`/`end_date` tags on features.
   - Host the `.pmtiles` statically (any CDN); the client reads slices
     directly — no tile server needed.
3. **Time dimension**
   - For rasters: encode the date into the tile URL template
     (`/tiles/{time}/{z}/{x}/{y}.png`); the scrubber swaps the template or
     swaps layers and cross-fades.
   - For vectors: keep per-epoch extracts (e.g. one PMTiles per year) or
     filter client-side on a `year` attribute; the scrubber switches sources.
4. **Client integration**
   - Extend `src/timeRewind/scrubberModel.js`'s playhead to drive the imagery
     layer day + vector source epoch together, so camera, imagery and features
     stay in lockstep.

Rough sizing: a single-city Planetiler run (e.g. Patna/Bihar extract,
~100 MB PBF) completes on a 4 vCPU box in minutes; a full planet run needs
~64 GB RAM and several hours — that is an ops task, not a sprint task.
