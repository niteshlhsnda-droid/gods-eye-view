# Declared dependencies — Gemini lane (feat/lane-gemini)

Dependencies are declared here and in `package.json` with **exact versions**.
They are NOT installed in this lane (`node_modules` is a symlink to the shared
clone; `npm install` is forbidden). The orchestrator installs once centrally.

| Name | Version | SPDX license | Why |
| ---- | ------- | ------------ | --- |
| `animejs` | 4.5.0 | MIT | Approved animation library for Director Mode auto-tours (`src/director/tours/autoTour.js` — `createTourRunner` drives cinematic camera tweens via `anime.createTimeline`). Chosen over GSAP, which is proprietary and banned from this codebase. Verified via jsDelivr/npm listing: v4.5.0, MIT. |
| `@turf/turf` | 7.1.0 | MIT | Geospatial analysis for the multi-globe comparison (`src/compare/compareModel.js` — `computeAreaDelta` uses `turf.area` + `turf.difference` for before/after deltas, e.g. flood-area delta in km²). Injected, never statically imported, so modules stay unit-testable. Verified via Turfjs/turf releases: v7.1.0, MIT. |
| `@mkkellogg/gaussian-splats-3d` | 0.4.7 | MIT | Three.js-based 3D Gaussian splat viewer for the digital-twin panel (`src/twin/twinViewer.js` — `viewerFactoryFromModule` wraps `Splats.Viewer`; `addSplatScene` loads `.ply`/`.splat`/`.ksplat`). Injected for testability. Verified via jsDelivr/npm listing: v0.4.7, MIT. |

## License audit notes (2026-10-12)

- All three packages are MIT-licensed and compatible with this repo's MIT license.
- No copyleft, no proprietary, no commercial-use restrictions found on the
  packages themselves.
- Caveat: Gaussian-splat *data* carries its own rights — splat scenes a user
  captures are theirs, but the subjects in front of the lens (private property,
  artwork, people) are the user's responsibility to clear. Documented in
  `docs/digital-twin-pipeline.md`.
