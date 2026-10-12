# maplibre-wind-gl → Cesium adapter: feasibility & path

Status: **scaffold only** (2026-10-12). Nothing here renders wind yet.

## What the library is

`maplibre-wind-gl` (MIT, `maplibre-wind-gl@0.3.0`, single-file UMD
`maplibre-wind-gl.js`, ~480 lines) renders GPU-advected wind particles with
age-stratified trails. Data contract: a JSON array of two `{ header, data }`
objects (U then V wind components) in grib2json format on a global
equirectangular grid (typically 360×181, 1°).

## Why it can't drop into Cesium tonight

1. **Render-loop coupling.** The library implements MapLibre's
   `CustomLayerInterface` — it is driven by MapLibre's `prerender`/`render`
   callbacks and reads MapLibre's internal WebGL state. Cesium has no
   equivalent custom-layer hook; its render loop is owned by
   `Scene.render()`.
2. **Projection coupling.** Particles are advected in unit-sphere space and
   projected with MapLibre's globe `mainMatrix`. A Cesium port must project
   with Cesium's camera view/projection matrices instead (different
   coordinate conventions, different globe tessellation).
3. **No existing adapter.** Verified 2026-10-12: no official or community
   Cesium adapter exists for this library. Writing one is a port, not a
   configuration.

## The adapter path (recommended)

Port the technique, not the library — the shaders are the valuable part:

1. **Data bridge.** This repo's wind provider (`/api/wind`, GFS/IFS via
   `server/providers/wind.js`) already serves the model fields. Build a
   `/api/wind/gfs-pair` endpoint (or client-side transform) that emits the
   grib2json U/V pair the shaders expect. The scaffold's
   `validateWindDataContract()` in `src/layers/windMaplibre/index.js` is the
   contract test for that bridge.
2. **Cesium Primitive port.** Reimplement as a `Cesium.Primitive` (or a
   `PostProcessStage`-style fullscreen pass) with its own render-to-texture
   loop driven from `viewer.scene.preRender`:
   - update shader: advect particle state textures on the GPU (copy the
     library's equirectangular→sphere math, replacing `mainMatrix` with a
     Cesium view-projection uniform);
   - draw shader: age-stratified trail ring buffer drawn as `GL_LINES`
     with speed-based color ramp.
3. **Reuse in-repo.** `src/layers/wind/gpuRendering.js` already does
   Cesium-native GPU wind rendering — evaluate extending it with the
   age-stratified trail technique before writing a new Primitive from
   scratch.

Estimated effort: 1–2 focused days (data bridge + shader port + depth/occlusion
tuning against the Cesium globe). Do **not** add `maplibre-wind-gl` to
`package.json` until the port exists — there is no Cesium entry point to
import.

## Tonight's seam

`src/layers/windMaplibre/index.js` exports `defaultWindOptions()`,
`validateWindDataContract()`, and `windAdapterReport()`; `createWindMaplibreAdapter()`
throws until a real port lands.
