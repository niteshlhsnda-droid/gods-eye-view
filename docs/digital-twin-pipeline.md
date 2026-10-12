# Digital-Twin Pipeline (Gaussian Splats)

## What shipped tonight (demo/scaffold)

The viewer integration is complete and tested; a verified sample scene is
**not** wired in because no fetchable sample could be confirmed tonight:

- `src/twin/twinViewer.js` — session lifecycle (`empty → loading → ready →
  error`) around the GaussianSplats3D viewer. The library module is injected
  via `viewerFactoryFromModule(Splats)` so unit tests run without the
  dependency installed. `resolveSceneConfig` validates `http(s)` URLs and the
  `.ply`/`.splat`/`.ksplat` formats; `twinPlaceholderCopy()` gives the app
  consistent empty-state UI text.
- Tests: `src/twin/twinViewer.test.mjs` (8 tests, passing).
- Dependency declared: `@mkkellogg/gaussian-splats-3d@0.4.7` (MIT) — see
  `DEPS.md`; the orchestrator installs it centrally.

**Sample-scene status (verified tonight):**

- Package confirmed: npm `@mkkellogg/gaussian-splats-3d`, latest `0.4.7`,
  MIT license, Three.js-based viewer with `Viewer.addSplatScene(url, opts)`.
- The well-known `antimatter15.com/splat` sample files could not be resolved
  to a fetchable direct URL tonight (direct fetch returned HTTP 404; the
  viewer page uses relative `?url=` paths that do not map to a stable file
  URL), and the HuggingFace `bonsai.splat` is a 37 MB Xet-backed file whose
  CORS headers are unverified. Shipping an unverified URL would present a
  broken demo, so the session ships with a clean placeholder loader and the
  URL left for the user to configure.
- To demo: open the app, point the twin panel at any CORS-enabled
  `.ply`/`.splat`/`.ksplat` URL (e.g. your own capture hosted below), and the
  session walks the `loading → ready` path with the viewer's own loading UI.

## Capture pipeline: your city as a splat

1. **Capture** — walk/drive the block and record overlapping video from
   multiple heights and angles (phone is fine; 2–5 minutes for a street block).
   Keep the lens clean, avoid moving people/cars where possible, capture in
   daylight.
2. **Reconstruct** — pick one:
   - **Phone-first (easiest):** Scaniverse (iOS) or Polycam — capture in-app,
     export `.ply` / `.splat` directly.
   - **Cloud training:** Luma AI — upload the video, wait ~30 min, download
     "Gaussian Splat".
   - **Local (most control):** COLMAP for poses + `gsplat`/`nerfstudio` for
     training, export `.ply`.
3. **Shrink** — large captures can be hundreds of MB; downsample or use the
   `.ksplat` compressed format so the browser loads it over the network.
4. **Host** — put the file on any CORS-enabled HTTPS host (the app's own
   `public/` dir, an S3 bucket with CORS, etc.). The browser must be able to
   `fetch` it cross-origin.
5. **Load** — paste the URL into the twin panel; `createTwinSession` handles
   load progress, error surfacing, and disposal.

Rights note: splats you capture are yours, but the rights in front of the lens
(private property, artwork, brands, people) are yours to clear.
