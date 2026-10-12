/**
 * deck.gl entity bridge — pure record mapping.
 *
 * The deck.gl overlay renders live entity records (aircraft, vessels, …) as
 * one GPU-instanced ScatterplotLayer. Records arrive from the existing
 * Cesium layers (their `getAnalystRecords()` shapes) through the app wiring;
 * this module only normalizes them into deck.gl data + layer props so the
 * mapping is unit-testable without deck.gl installed.
 */

export const ENTITY_COLORS = Object.freeze({
  aircraft: [255, 170, 40, 230],
  vessel: [60, 180, 255, 230],
  satellite: [180, 120, 255, 230],
  debris: [255, 120, 90, 200],
  default: [200, 200, 200, 230],
});

export const ENTITY_POINT_RADIUS_M = 9000;
// world-space point radius for the scatter layer (visible at globe scale).

/**
 * Normalize one entity record into a deck.gl datum.
 * Accepts `{ lat, lon, altM?, altitude?, kind?, id? }`.
 */
export function entityToDatum(record) {
  const lat = Number(record?.lat);
  const lon = Number(record?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const altMeters = Number(record?.altM ?? record?.altitude ?? 0);
  const kind = typeof record?.kind === 'string' ? record.kind : 'default';
  return {
    id: record?.id ?? `${lon}:${lat}`,
    kind,
    position: [lon, lat, Number.isFinite(altMeters) ? altMeters : 0],
    fillColor: ENTITY_COLORS[kind] ?? ENTITY_COLORS.default,
    headingDeg: Number.isFinite(Number(record?.headingDeg))
      ? Number(record.headingDeg)
      : null,
  };
}

/** Map a record list into deck.gl data, dropping malformed entries. */
export function recordsToDeckData(records) {
  const data = [];
  for (const record of records ?? []) {
    const datum = entityToDatum(record);
    if (datum) data.push(datum);
  }
  return data;
}

/** ScatterplotLayer props for the entity field (deck.gl constructs the layer). */
export function entityScatterProps(data, { id = 'deck-entities' } = {}) {
  return {
    id,
    data,
    pickable: true,
    getPosition: (d) => d.position,
    getFillColor: (d) => d.fillColor,
    getRadius: () => ENTITY_POINT_RADIUS_M,
    radiusUnits: 'meters',
    radiusMinPixels: 2,
    radiusMaxPixels: 24,
    stroked: false,
    filled: true,
    parameters: { depthTest: false },
  };
}
