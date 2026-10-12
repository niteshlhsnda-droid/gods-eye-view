/**
 * maplibre-wind-gl Cesium adapter — SCAFFOLD (not shippable tonight).
 *
 * maplibre-wind-gl (MIT, single-file UMD) renders GPU-advected wind
 * particles as a MapLibre `CustomLayerInterface`: it hooks MapLibre's
 * prerender/render loop and projects unit-sphere particle positions with
 * MapLibre's globe `mainMatrix`. Cesium has no equivalent custom-layer hook,
 * so the library cannot be dropped in — it needs a Cesium-side port (see
 * docs/wind-maplibre-cesium-adapter.md).
 *
 * This scaffold is the integration seam: option defaults mirroring the
 * library's runtime-tunable API, the adapter feasibility report, and the
 * wind-data contract the eventual port must satisfy.
 */

export const WIND_ADAPTER_STATUS = 'scaffold';

/** Runtime-tunable options mirroring maplibre-wind-gl's API surface. */
export function defaultWindOptions(overrides = {}) {
  return {
    particles: 100_000,
    speed: 1.0,
    maxAge: 15,
    dropRate: 0.02,
    dropRateBump: 0,
    colorRamp: [
      [0, 0.3, 0.2, 0.7],
      [5, 0.1, 0.5, 0.9],
      [10, 0.1, 0.8, 0.6],
      [15, 0.4, 0.9, 0.2],
      [20, 0.9, 0.9, 0.1],
      [25, 0.9, 0.5, 0.1],
      [30, 0.9, 0.1, 0.1],
    ],
    color: null,
    opacity: 0.55,
    speedRange: [0, 80],
    ...overrides,
  };
}

/**
 * Validate a candidate wind-data payload against the grib2json pair contract
 * maplibre-wind-gl expects: an array of exactly two { header, data } objects
 * (U then V) on a global equirectangular grid.
 * Returns { ok, errors }.
 */
export function validateWindDataContract(payload) {
  const errors = [];
  if (!Array.isArray(payload) || payload.length !== 2) {
    errors.push('payload must be an array of exactly two (U, V) components');
    return { ok: false, errors };
  }
  for (const [index, component] of payload.entries()) {
    const header = component?.header;
    if (!header || !Array.isArray(component?.data)) {
      errors.push(`component ${index}: missing header or data array`);
      continue;
    }
    for (const key of ['nx', 'ny', 'lo1', 'la1', 'dx', 'dy']) {
      if (!Number.isFinite(Number(header[key])))
        errors.push(`component ${index}: header.${key} is not finite`);
    }
    if (component.data.length !== header.nx * header.ny)
      errors.push(
        `component ${index}: data length ${component.data.length} != nx*ny ${header.nx * header.ny}`,
      );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Structured feasibility report for the Cesium adapter. `createAdapter`
 * throws until a real port lands — this keeps the scaffold honest: nothing
 * here renders wind yet.
 */
export function windAdapterReport() {
  return {
    status: WIND_ADAPTER_STATUS,
    library: 'maplibre-wind-gl',
    feasible: true,
    shippableTonight: false,
    blockers: [
      'maplibre-wind-gl is a MapLibre CustomLayerInterface; Cesium has no equivalent render-loop hook.',
      'Particle projection uses MapLibre globe mainMatrix — a Cesium port must project unit-sphere positions with Cesium camera matrices instead.',
      'No official or community Cesium adapter exists for this library (verified 2026-10-12).',
    ],
    recommendedPath:
      'Port the age-stratified trail + GPU advection shaders into a Cesium Primitive with its own preRender-driven render-to-texture loop, reusing the repo wind provider (/api/wind) as the data source. Full path in docs/wind-maplibre-cesium-adapter.md.',
  };
}

export function createWindMaplibreAdapter() {
  throw new Error(
    'maplibre-wind-gl has no Cesium adapter yet — see windAdapterReport() and docs/wind-maplibre-cesium-adapter.md',
  );
}
