# Base-map imagery vintage: undated, so never read as current

**Status:** rule, wired in. The disclosure is registered in the Data
attribution popover (`src/data/dataCredits.js`, key `basemap-vintage`) and
stated on the Google and Esri rows of `DATA_SOURCES.md`.

## The rule

1. **The base map is the only surface with no observation time anywhere.**
   Every view shows it, and no view may label it current. The tile responses
   this app consumes carry no per-tile capture date: `src/maps/google3d.js`
   reads no capture-date field when loading Google Photorealistic 3D Tiles,
   and the Esri/OSM providers in `src/maps/imagery.js` expose none either.
   Neither provider exposes one through the tile responses this app consumes.
2. **The base map gets NO freshness label.** A freshness label would be a
   lie: there is no observation time to report. It gets a standing VINTAGE
   UNKNOWN disclosure instead.
3. **Canonical wording** (owned by `src/data/basemapVintage.js`):

   > Base map imagery: capture date not provided — age varies by area and
   > may be years old. Do not read buildings, roads, or landscape as
   > current.

4. **Never write that the globe is current**, up to date, or shows the world
   as it is today. A building visible — or missing — on the globe proves
   nothing about today.

## Why

Readers treat photorealism as currency: a photorealistic building looks like
a photograph taken now. It is a render of imagery captured on an unpublished
schedule that varies by area — dense urban cores are re-flown more often
than remote areas — and in some areas the imagery is years old.

Concrete failure mode: a new building missing from the globe, or a
demolished one still standing, misleads anyone using the globe to judge
what is on the ground — checking a site, a road, or a construction state.

OSM note: OpenStreetMap objects carry edit history, but the app surfaces no
per-object edit date and the tile snapshot age is not shown — same rule: do
not read OSM-derived roads or places as verified current.

## What this document does not do

- It does not add per-tile capture dates. The providers do not expose them
  through the consumed responses, so there is nothing to display.
- It does not change the globe renderer, the map stack, or Live Now.
- It does not replace per-layer freshness / observation labels. Those govern
  overlay layers; this governs the base map itself.
- It does not cover street-level photo dates. Street-level photos carry
  their own capture dates from their providers — a separate surface.

## Relationship to prior honesty rules

- `docs/how-this-map-can-mislead.md` — the general pattern. This is the
  base-map instance of its vintage / coverage items, wired in rather than
  spec-only.
- LIVE-label rule — no static label asserts liveness. This extends it: the
  base map asserts no currency at all.
- Observation-time rule — freshness labels report observation time. The base
  map has none, so it reports vintage-unknown instead of a clock.
