/**
 * Debris-field layer policy.
 *
 * Groups verified against the live CelesTrak GP element-set index
 * (https://celestrak.org/NORAD/elements/) 2026-10-12: CelesTrak exposes no
 * generic `debris` group — debris is split into the three breakup-event
 * groups below. `path` is the upstream GROUP name forwarded by the
 * /api/celestrak proxy; `tag` is the internal key used for styling.
 */
export const DEBRIS_GROUPS = [
  { tag: 'fengyun-1c', path: 'fengyun-1c-debris', label: 'FENGYUN 1C debris' },
  { tag: 'iridium-33', path: 'iridium-33-debris', label: 'IRIDIUM 33 debris' },
  {
    tag: 'cosmos-2251',
    path: 'cosmos-2251-debris',
    label: 'COSMOS 2251 debris',
  },
];

export const DEBRIS_GROUP_PATHS = new Set(DEBRIS_GROUPS.map((g) => g.path));

// Debris TLEs go stale like any other catalog set. Canonical value lives in
// src/sources/tle.js — re-exported here under the debris name so existing
// importers are unchanged.
export { TLE_MAX_AGE_MS as DEBRIS_TLE_MAX_AGE_MS } from '../../sources/tle.js';

export const DEBRIS_PROPAGATE_MS = 1000;
// re-propagate the whole field every 1s (SGP4, matches satellites cadence).

export const DEBRIS_POINT_PIXEL_SIZE = 2;
// dim sub-pixel-safe dots: debris is context, not the subject.

export const DEBRIS_POINT_ALPHA = 0.55;
