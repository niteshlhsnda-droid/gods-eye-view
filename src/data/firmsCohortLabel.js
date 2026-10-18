/**
 * @module firmsCohortLabel
 * @description Canonical display vocabulary for the FIRMS ambient fire cohort cap.
 *
 * The FIRMS ambient overlay renders at most FIRMS_AMBIENT_COHORT_LIMIT (18)
 * unselected fire detections at a time; selected fires bypass this cohort
 * (see src/data/firmsLabels.js). The cap exists so the ambient label layer
 * stays legible and the world-overlay allocation worker stays inside its
 * per-frame allocation budget (see src/overlays/worldOverlayAllocation.worker.mjs).
 *
 * Why this module: a user who sees 18 fire cards can read that as "18 fires
 * total" when the real detection count is far higher. Every UI surface that
 * shows the ambient cohort must render the canonical label this module
 * produces instead of a bare count, so the cap is always visible as a cap.
 *
 * House rule: null on invalid input, never throw.
 */
import { FIRMS_AMBIENT_COHORT_LIMIT } from './firmsLabels.js';

/** The shipped cap, re-exported so call sites never restate the number. */
export const FIRMS_COHORT_LIMIT = FIRMS_AMBIENT_COHORT_LIMIT;

/** Short note for docs/tooltips explaining why the cap exists. */
export const FIRMS_COHORT_WHY =
  'The ambient fire layer shows at most ' +
  FIRMS_AMBIENT_COHORT_LIMIT +
  ' unselected detections to keep labels legible and overlay allocation bounded. ' +
  'Fires you select are shown in full regardless of this cap.';

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

function fmt(value) {
  return Number(value).toLocaleString('en-US');
}

/**
 * Canonical label for a rendered FIRMS fire cohort.
 *
 * @param {object} input
 * @param {number} input.shown - number of fire cards actually rendered (required).
 * @param {number | null} [input.total] - number of detections in the full cohort,
 *     when the feed did not report one (required for a completeness claim).
 * @returns {{ shown: number, total: number | null, hasMore: boolean, text: string } | null}
 *   Null on any invalid input. `hasMore` is true exactly when the total is
 *   known and the rendered cohort is a strict subset; otherwise false (we
 *   never assert more fires exist without knowing the total).
 */
export function firmsCohortLabel(input) {
  const { shown, total } = input ?? {};
  if (!isNonNegativeInt(shown)) return null;

  if (total === null || total === undefined) {
    if (shown === 0) return null;
    return {
      shown,
      total: null,
      hasMore: false,
      text: `showing ${fmt(shown)}+ (total unavailable)`,
    };
  }

  if (!isNonNegativeInt(total) || shown > total) return null;

  if (shown === 0 && total === 0) {
    return { shown, total, hasMore: false, text: 'No active fires detected' };
  }
  if (shown < total) {
    return {
      shown,
      total,
      hasMore: true,
      text: `showing ${fmt(shown)} of ${fmt(total)} (truncated)`,
    };
  }
  return {
    shown,
    total,
    hasMore: false,
    text: `showing ${fmt(shown)} of ${fmt(total)}`,
  };
}
