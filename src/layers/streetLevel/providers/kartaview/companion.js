/**
 * Same-sequence-companion preference for the KartaView nearest-image pick.
 *
 * A lone KartaView photo opens a dead end: ‹ › stepping walks its
 * sequence, and the cones draw a page of it, so a photo with no
 * same-sequence neighbour in the set leaves the viewer with nowhere to
 * go. A photo with a same-sequence companion in the set opens a run the
 * viewer can walk. So a lone nearest shot yields to a companion-bearing
 * shot nearby — but a companion halfway down the street does not beat the
 * lone shot of the doorway asked about, so the preference is bounded: a
 * companion-bearing shot wins only within NEAREST_COMPANION_REACH × the
 * nearest candidate's distance.
 *
 * The preference only displaces a *lone* nearest shot: when the nearest
 * candidate already has company the pool is returned unchanged and the
 * caller's freshness ordering decides among all of them, as before.
 * Companion-in-set is a proxy, not sequence length: a long drive whose
 * next shot falls outside the probed set looks lone here, and the reach
 * bound keeps that misread cheap. The imagery filter still decides first
 * — only passing photos are ever candidates — and the caller still orders
 * the narrowed pool by freshness, so among qualifying companion-bearing
 * shots the newest wins. A missing or blank sequence id never counts as
 * company: two id-less photos prove nothing about each other.
 */

/**
 * How much farther a candidate with a same-sequence companion may be than
 * the nearest candidate and still win the nearest-image pick: twice its
 * distance.
 */
export const NEAREST_COMPANION_REACH = 2;

/** The sequence id of a candidate's photo, or null when it has none. */
function sequenceIdOf(photo) {
  const raw = photo?.sequenceId;
  if (raw == null) return null;
  const id = String(raw).trim();
  return id === '' ? null : id;
}

/** True when `entry` shares its sequence with another placed entry. */
function hasCompanion(entry, placed) {
  const id = sequenceIdOf(entry.photo);
  if (id === null) return false;
  return placed.some(
    (other) => other !== entry && sequenceIdOf(other.photo) === id,
  );
}

/**
 * Narrow `entries` to the companion-bearing photos within
 * NEAREST_COMPANION_REACH × the nearest candidate's distance, when the
 * nearest candidate is lone and any such photo exists; otherwise return
 * `entries` unchanged. Entries without a finite distance never anchor
 * the bound and never qualify.
 * @param {Array<{photo: {sequenceId: string|null}, metres: number}>} entries
 * @returns {Array<{photo: {sequenceId: string|null}, metres: number}>} the narrowed pool
 */
export function preferCompanion(entries) {
  const placed = entries.filter(({ metres }) => Number.isFinite(metres));
  if (!placed.length) return entries;
  const byDistance = [...placed].sort((a, b) => a.metres - b.metres);
  const nearest = byDistance[0];
  if (hasCompanion(nearest, placed)) return entries;
  const bound = Math.max(0, nearest.metres) * NEAREST_COMPANION_REACH;
  const accompanied = placed.filter(
    (entry) => hasCompanion(entry, placed) && entry.metres <= bound,
  );
  return accompanied.length ? accompanied : entries;
}
