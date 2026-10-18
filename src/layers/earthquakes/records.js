/** USGS review state for one event. Only the two states USGS documents as
 *  human-review states are carried: `automatic` (machine-located, not yet
 *  reviewed by a human) and `reviewed`. Anything else — missing, `deleted`,
 *  or unrecognized — normalizes to null, which means "no review claim",
 *  never "reviewed". Status is a label, not an inclusion rule: an
 *  unrecognized status never drops a row the feed itself includes. */
export function normalizeEarthquakeReviewStatus(status) {
  if (status === 'automatic' || status === 'reviewed') return status;
  return null;
}

/** Validate a complete feed before replacing the last good earthquake snapshot. */
export function normalizeEarthquakeSnapshot(geojson) {
  if (!Array.isArray(geojson?.features)) return null;
  const rows = [];
  const ids = new Set();
  for (const [index, feature] of geojson.features.entries()) {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties;
    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      !properties ||
      typeof properties !== 'object' ||
      Array.isArray(properties) ||
      (feature.geometry.type != null && feature.geometry.type !== 'Point')
    )
      return null;
    const [lon, lat, depthKm] = coordinates;
    const mag = properties.mag;
    if (
      !Number.isFinite(lon) ||
      Math.abs(lon) > 180 ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      (depthKm != null && !Number.isFinite(depthKm)) ||
      (mag != null && (!Number.isFinite(mag) || mag > 10))
    )
      return null;
    // A missing magnitude cannot establish that this event meets M2.5+.
    if (mag == null || mag < 2.5) continue;
    const stableId =
      feature.id == null || feature.id === ''
        ? `event-${index + 1}`
        : String(feature.id);
    if (ids.has(stableId)) return null;
    ids.add(stableId);
    rows.push({
      stableId,
      usgsId: feature.id ?? null,
      lon,
      lat,
      depthKm: depthKm ?? null,
      mag,
      place: typeof properties.place === 'string' ? properties.place : null,
      time: Number.isFinite(properties.time) ? properties.time : null,
      reviewStatus: normalizeEarthquakeReviewStatus(properties.status),
    });
  }
  return rows;
}
