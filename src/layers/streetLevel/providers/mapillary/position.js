/**
 * The position a Mapillary record ranks by in a nearest-image search: its
 * SfM-refined `computed_geometry` when that fix is usable, else its GPS
 * `geometry`, else null (last-resort: the record has no place to rank by).
 *
 * The nearest lookup used to take `computed_geometry || geometry` on
 * truthiness alone, so a placeholder or corrupt refined fix mis-ranked the
 * image: a `[0, 0]` refined fix (Mapillary's placeholder for a missing fix)
 * pushed a genuinely near photo to the far end of the ranking, while the
 * sequence cones already fell back to the GPS fix for the same record —
 * cone and nearest pick could disagree about where one photo is. This is
 * the same validity rule the other position guards use: finite coords
 * only, `[0, 0]` dropped, |lon| ≤ 180, |lat| ≤ 90.
 * @param {object} record a Mapillary graph image record
 * @returns {{lon: number, lat: number}|null}
 */
export function nearestPosition(record) {
  return (
    usablePosition(record?.computed_geometry?.coordinates) ??
    usablePosition(record?.geometry?.coordinates)
  );
}

/** A coordinate pair as numbers, or null when it cannot place a photo. */
function usablePosition(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lon, lat] = coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  // [0, 0] is a missing fix, not a photo in the Gulf of Guinea.
  if (lon === 0 && lat === 0) return null;
  return { lon, lat };
}
