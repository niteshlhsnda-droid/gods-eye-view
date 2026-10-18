/**
 * 360° preference for the KartaView nearest-image pick.
 *
 * A 360° photo covers every heading, so the viewer can look around the
 * whole junction instead of staring one fixed way. A flat shot of the
 * doorway asked about still beats a pano halfway down the street, so
 * the preference is bounded: a pano wins over a flat photo only when it
 * sits within NEAREST_PANO_REACH × the nearest flat photo's distance.
 *
 * The bound anchors on the nearest *flat* photo, not the nearest
 * candidate overall: when every candidate is already a pano there is no
 * flat shot to displace, and freshness keeps deciding among the panos
 * (a pano-filtered lookup is untouched by this rule). The imagery
 * filter still decides first — with a flat-only filter no pano is ever
 * a candidate — and the caller still orders the narrowed pool by
 * freshness, so among qualifying panos the newest shot wins.
 */

/**
 * How much farther a 360° photo may be than the nearest flat photo and
 * still win the nearest-image pick: twice its distance.
 */
export const NEAREST_PANO_REACH = 2;

/**
 * Narrow `entries` to the 360° photos within NEAREST_PANO_REACH × the
 * nearest flat photo's distance, when any such photo exists; otherwise
 * return `entries` unchanged. Entries without a finite distance never
 * anchor the bound and never qualify.
 * @param {Array<{photo: {isPano: boolean}, metres: number}>} entries
 * @returns {Array<{photo: {isPano: boolean}, metres: number}>} the narrowed pool
 */
export function preferPano(entries) {
  const placed = entries.filter(({ metres }) => Number.isFinite(metres));
  if (!placed.length) return entries;
  const flats = placed.filter(({ photo }) => photo?.isPano !== true);
  if (!flats.length) return entries;
  const nearestFlat = Math.max(
    0,
    Math.min(...flats.map(({ metres }) => metres)),
  );
  const panos = placed.filter(
    ({ photo, metres }) =>
      photo?.isPano === true && metres <= nearestFlat * NEAREST_PANO_REACH,
  );
  return panos.length ? panos : entries;
}
