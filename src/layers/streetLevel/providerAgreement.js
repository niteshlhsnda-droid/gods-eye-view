/**
 * Cross-provider pick arbitration for street-level imagery.
 *
 * Each provider's `nearestImage` ranks only its own imagery, and the layer
 * (`index.js`) opens the first provider in registry order that returns a
 * hit. That cascade is arbitrary: a 45 m Mapillary shot can beat a 5 m
 * KartaView shot purely because Mapillary is listed first. When two
 * providers both land within AGREEMENT_RADIUS_M of the query point they
 * agree on coverage — they are looking at the same street segment — and the
 * viewer should open the better shot, not the first provider's.
 *
 * The comparison stays provider-neutral. Mapillary's `quality_score` is a
 * provider-internal blur score with no KartaView counterpart, so comparing
 * raw scores across providers would be invented precision; distance, pano
 * status and capture freshness are carried by every normalized provider
 * record and are the honest tie-breakers:
 *
 * 1. entries with a usable pick are ranked by distance (nearest first);
 * 2. a 360° pano within AGREEMENT_PANO_REACH_FACTOR × the nearest flat's
 *    distance wins over that flat — the same 2× rule both providers'
 *    landed pano-over-flat preferences use, so the agreement never
 *    contradicts a provider's own pick;
 * 3. exact distance ties go to the fresher capture (unknown dates last);
 * 4. a final lexical providerId tie-break keeps the pick deterministic.
 *
 * Conservative by design: when no provider lands inside the agreement
 * radius the nearest overall pick still wins — an agreement module must
 * never lose the hit — and when providers disagree about the spot (picks
 * farther apart than the radius) the established registry order stands.
 * Standalone and pure: it takes already-normalized picks
 * (`{providerId, recordId, metres, isPano, capturedAt}`), so no provider
 * wiring is needed to use it.
 */

/**
 * Both providers must land within this many metres of the query point for
 * the agreement rule to apply. Beyond it the providers cover different
 * spots and registry order stands.
 */
export const AGREEMENT_RADIUS_M = 20;

/**
 * How far away a 360° pano may sit and still win over the nearest flat:
 * within this multiple of the nearest flat's distance, matching both
 * providers' landed pano-over-flat preferences.
 */
export const AGREEMENT_PANO_REACH_FACTOR = 2;

/** Sort distance-ascending; exact ties break by freshness (fresher first,
 * unknown dates last), then by providerId so the result is deterministic. */
function byDistanceThenFreshness(a, b) {
  if (a.metres !== b.metres) return a.metres - b.metres;
  const aKnown = Number(a.capturedAt) > 0;
  const bKnown = Number(b.capturedAt) > 0;
  if (aKnown && bKnown && a.capturedAt !== b.capturedAt)
    return Number(b.capturedAt) - Number(a.capturedAt);
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  return String(a.providerId).localeCompare(String(b.providerId));
}

/** Whether the entry is a usable provider pick. */
function isUsable(entry) {
  return (
    entry != null &&
    typeof entry === 'object' &&
    (typeof entry.providerId === 'string' ||
      typeof entry.providerId === 'number') &&
    (typeof entry.recordId === 'string' ||
      typeof entry.recordId === 'number') &&
    Number.isFinite(entry.metres) &&
    entry.metres >= 0
  );
}

/**
 * The provider pick to open for a query point both providers agree on.
 *
 * @param {Array<{providerId: string, recordId: string, metres: number, isPano?: boolean, capturedAt?: number}>} picks
 *   One normalized pick per provider (distance in metres from the query
 *   point; `capturedAt` as epoch ms, unknown when missing/0/future-side).
 * @param {{agreementRadiusM?: number}} [options]
 * @returns {object|null} The winning pick entry, or null when none is usable.
 */
export function agreementPick(
  picks,
  { agreementRadiusM = AGREEMENT_RADIUS_M } = {},
) {
  if (!Array.isArray(picks) || picks.length === 0) return null;
  const radius =
    Number.isFinite(agreementRadiusM) && agreementRadiusM >= 0
      ? agreementRadiusM
      : AGREEMENT_RADIUS_M;
  const usable = picks.filter(isUsable);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];

  const ranked = [...usable].sort(byDistanceThenFreshness);
  const agreeing = ranked.filter((entry) => entry.metres <= radius);
  // Nobody agrees on the spot: the nearest pick still wins — never lose
  // the hit because the providers disagree.
  const pool = agreeing.length > 0 ? agreeing : ranked;

  const nearest = pool[0];
  if (nearest.isPano === true) return nearest;
  // A 360° pano within reach wins over the nearest flat, mirroring both
  // providers' own pano-over-flat rules.
  const reach = AGREEMENT_PANO_REACH_FACTOR * nearest.metres;
  for (const entry of pool) {
    if (entry.metres > reach) break;
    if (entry.isPano === true) return entry;
  }
  return nearest;
}
