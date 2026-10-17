/**
 * Shared angle / longitude wrapping math.
 *
 * Six angle-wrapping implementations currently coexist with DIVERGENT edge
 * semantics (evidence, `origin/main` @ `16831c4`):
 * - `src/annotations/drawMode.js:172` `wrapLongitude` — [-180, 180),
 *   in-range values returned EXACTLY, -0 mapped to 0 on the modulo path,
 *   non-finite passed through. (Its -0 claim leaks: the in-range early
 *   return hands -0 straight back, so `wrapLongitude(-0)` is -0 there;
 *   the canonical version below normalizes it.)
 * - `src/layers/streetLevel/tileMath.js:10` `wrapLon` — [-180, 180]
 *   INCLUSIVE: 180 stays 180 (a tile-edge special case — `lonToTileX`
 *   treats 180 as the east edge of the last column, so this one must stay
 *   local and must NOT be migrated to the canonical helper).
 * - `src/layers/wind/model.js:2` `normalizeLongitude` — bare modulo:
 *   180 maps to -180, but every in-range value pays floating-point
 *   error (0.0005 comes back as 0.0004999999999881766).
 * - `src/sdr/adsbDecoder.js:55` `normalizeLongitude` — while-loop:
 *   180 stays 180, and cost is O(|lon| / 360) instead of O(1).
 * - `src/locations.js:1111` `wrapLongitude` — bare modulo, 180 maps to
 *   -180.
 * - `src/cockpitMath.js:4` `normalizeHeading` ([0, 360), non-finite -> 0)
 *   vs `src/layers/cctv/model.js:25` `normalizeHeading` (same range,
 *   non-finite -> NaN) — two heading normalizers that disagree on NaN.
 * On top of those, 15 call sites inline the delta formula
 * `((x + 540) % 360) - 180` by hand: `src/cockpitMath.js:14,238`,
 * `src/data/bhoteKoshiEvent.js:400`, `src/data/contactPlayback.js:195,497,522,558`,
 * `src/data/trafficBounds.js:82`, `src/director/camera.js:44`,
 * `src/director/timeline.js:43`, `src/layers/radio/navigation.js:88`,
 * `src/layers/transit/movement.js:120`, `src/layers/transit/rendering.js:163`,
 * `src/layers/transit/trails.js:148`, `src/layers/wind/rendering.js:265`.
 *
 * The same copies exist verbatim in `upstream-compare` (`drawMode.js`,
 * `tileMath.js`, `wind/model.js`, `locations.js`), so the duplication is
 * inherited from the upstream original, not introduced by this fork.
 *
 * The practical consequence is that the same input gets two answers
 * depending on which copy runs: 180° is -180 in the wind grid and the
 * annotation ring but +180 in the tile math and the ADS-B decoder, and
 * NaN becomes 0 in the cockpit but stays NaN in CCTV. This module fixes
 * one canonical semantics per operation and documents the choice:
 * - Longitude: [-180, 180), adopting `drawMode`'s careful semantics
 *   (exact in-range passthrough, -0 -> 0, non-finite passthrough).
 *   180 maps to -180, matching the GeoJSON/antimeridian convention.
 * - Heading: [0, 360), adopting `cockpitMath`'s semantics (non-finite
 *   -> 0, because a heading display must always render something).
 * - Difference: [-180, 180), same as every inline delta copy, with the
 *   180 tie resolving to -180 (again matching the inline copies).
 *
 * Pure: no DOM, no Cesium, no imports.
 *
 * Adoption follow-up (NOT done here): migrating a call site means adding
 * this file to every boundary group that owns the importing module
 * (`scripts/package-boundaries.json` rejects unowned transitive imports),
 * so migration is a separate, per-group change — no call site is
 * re-pointed in this commit. `tileMath.wrapLon` is deliberately excluded
 * from migration (see above).
 *
 * @module data/angleMath
 */

/**
 * Wrap a longitude into [-180, 180).
 * @param {number} lon Longitude in degrees.
 * @returns {number} The equivalent longitude in [-180, 180).
 */
export function wrapLongitude(lon) {
  if (!Number.isFinite(lon)) return lon;
  // A value already in range is returned UNCHANGED rather than pushed
  // through the modulo, which is only exact in binary for some inputs:
  // 0.0005 came back as 0.0004999999999881766. The seam is the only
  // place the arithmetic is needed, so it is the only place that pays
  // for it. (Semantics adopted from `src/annotations/drawMode.js`.)
  if (lon >= -180 && lon < 180) return lon === 0 ? 0 : lon;
  const value = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Normalize a heading into [0, 360).
 * @param {number} value Heading in degrees.
 * @returns {number} The equivalent heading in [0, 360); 0 for non-finite input.
 */
export function normalizeHeading(value) {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

/**
 * Signed shortest-arc difference from one angle to another, in [-180, 180).
 * Positive means `toDeg` is clockwise (increasing angle) from `fromDeg`.
 * The 180 tie resolves to -180, matching the inline
 * `((x + 540) % 360) - 180` copies this replaces. Non-finite input
 * propagates as NaN (unlike `cockpitMath.relativeBearing`, which returns
 * null — callers that need null should map it).
 * @param {number} fromDeg Start angle in degrees.
 * @param {number} toDeg End angle in degrees.
 * @returns {number} Shortest signed difference in [-180, 180).
 */
export function angularDifference(fromDeg, toDeg) {
  return wrapLongitude(toDeg - fromDeg);
}
