/**
 * Shared interpolation math: clamping, linear interpolation, smoothstep,
 * smootherstep, and the one cubic easing the director uses.
 *
 * The same tiny formulas are currently re-derived inline all over the
 * codebase, with divergent edge semantics:
 * - `clamp` copies in `bloom.js`, `celestialRing.js`,
 *   `aircraftRecession.js`, `focusDeemphasis.js`, and `cyberSonar.js`;
 *   `clamp01` copies in `director/clock.js` and `director/timeline.js`;
 *   a `clampInt` (floor-then-clamp) copy in `labelArbiter.js`.
 * - `smoothstep(from, to, value)` copies in `bhoteKoshiEvent.js` and
 *   `bhoteKoshiLocator.js` (identical, including the degenerate-range
 *   step fallback); normalized-form `t * t * (3 - 2 * t)` copies in
 *   `cameraVerbs.js` (route speed profile), `cctvCards.js`, and
 *   `aircraftRecession.js`.
 * - `lerp` lambdas in `director/camera.js` and `director/timeline.js`.
 * - The cubic ease-in-out `t < 0.5 ? 4t^3 : 1 - (-2t + 2)^3 / 2` written
 *   out identically in `director/camera.js` and `director/timeline.js`.
 * Cesium also ships `Cesium.Math.lerp` / `Cesium.Math.clamp`, but those
 * drag in the whole Cesium bundle; this module is dependency-free, so
 * Node/server/test code can use it too.
 *
 * Canonical semantics (one per operation, documented here so call sites
 * migrating later know exactly what changes):
 * - `clamp` follows nested `Math.min` / `Math.max` (and therefore
 *   `Cesium.Math.clamp`): endpoints inclusive, exact in-range passthrough,
 *   `-0` normalizes to `+0`, `+Infinity` clamps to `max`, `-Infinity` to
 *   `min`, and a reversed range (`min > max`) returns `min`. `NaN`
 *   propagates as `NaN` — this module never silently invents a value;
 *   callers that need a safe default (e.g. bhoteKoshi's `Number(x) || 0`)
 *   must sanitize BEFORE calling.
 * - `lerp` does NOT clamp `t`: out-of-range `t` extrapolates. Use
 *   `lerpClamped` when `t` must stay on the segment.
 * - `inverseLerp` is unclamped (the inverse of `lerp`) and returns `0`
 *   for a degenerate (`from === to`) range instead of `NaN`/`Infinity`.
 * - `smoothstep(from, to, value)` keeps the bhoteKoshi degenerate-range
 *   behaviour: `to <= from` is a step (`value >= to ? 1 : 0`).
 * - Every easing / normalized helper clamps its input to `[0, 1]` first,
 *   so out-of-range progress can never overshoot.
 * - `motionModel.js`'s `lerpAngleDeg` is angle-aware (shortest arc) and
 *   is deliberately NOT replaced by `lerp` here: plain `lerp` on angles
 *   takes the long way around through 0/360.
 *
 * Pure: no DOM, no imports. All inputs/outputs are plain numbers.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in this
 * commit — migration is a separate, per-group change (adding this file to
 * every boundary group that owns an importing module), like the prior
 * idea-cycle modules.
 *
 * @module data/interpMath
 */

/**
 * Clamp `value` into `[min, max]`. See the module header for edge semantics.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp `value` into `[0, 1]`.
 * @param {number} value
 * @returns {number}
 */
export function clamp01(value) {
  return clamp(value, 0, 1);
}

/**
 * Floor `value` to an integer, then clamp it into `[min, max]`.
 * Matches the `labelArbiter.js` copy (`floor` first, so 2.9 -> 2, and
 * -0.5 -> -1 -> clamped to `min`).
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampInt(value, min, max) {
  return clamp(Math.floor(value), min, max);
}

/**
 * Linear interpolation. `t = 0` gives `from`, `t = 1` gives `to`;
 * out-of-range `t` extrapolates past the endpoints.
 * @param {number} from
 * @param {number} to
 * @param {number} t
 * @returns {number}
 */
export function lerp(from, to, t) {
  return from + (to - from) * t;
}

/**
 * Linear interpolation with `t` clamped to `[0, 1]` first, so the result
 * always lies on the `from -> to` segment.
 * @param {number} from
 * @param {number} to
 * @param {number} t
 * @returns {number}
 */
export function lerpClamped(from, to, t) {
  return lerp(from, to, clamp01(t));
}

/**
 * Inverse of `lerp`: the `t` such that `lerp(from, to, t) === value`.
 * Unclamped (out-of-range values give `t` outside `[0, 1]`); a
 * degenerate range (`from === to`) returns `0`.
 * @param {number} from
 * @param {number} to
 * @param {number} value
 * @returns {number}
 */
export function inverseLerp(from, to, value) {
  if (from === to) return 0;
  return (value - from) / (to - from);
}

/**
 * Smoothstep over `[from, to]`: 0 below `from`, 1 above `to`, and the
 * cubic `t * t * (3 - 2 * t)` in between (zero slope at both ends, so no
 * visible kink where it joins constant segments). A degenerate range
 * (`to <= from`) is a step: `value >= to ? 1 : 0`.
 * @param {number} from
 * @param {number} to
 * @param {number} value
 * @returns {number}
 */
export function smoothstep(from, to, value) {
  if (to <= from) return value >= to ? 1 : 0;
  return smoothstep01((value - from) / (to - from));
}

/**
 * Smoothstep for an already-normalized `t`: clamp to `[0, 1]`, then
 * `t * t * (3 - 2 * t)`.
 * @param {number} t
 * @returns {number}
 */
export function smoothstep01(t) {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Smootherstep (quintic) for an already-normalized `t`: clamp to
 * `[0, 1]`, then `t^3 * (t * (t * 6 - 15) + 10)`. Zero first AND second
 * derivatives at both ends, so it joins constant segments even more
 * smoothly than `smoothstep01` — use it where a C1 join is still visibly
 * abrupt (e.g. slow camera eases), not as a drop-in for existing
 * smoothstep call sites.
 * @param {number} t
 * @returns {number}
 */
export function smootherstep01(t) {
  const clamped = clamp01(t);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

/**
 * Cubic ease-in-out for normalized progress: slow at both ends, fastest
 * at the midpoint. Identical to the formula in `director/camera.js` and
 * `director/timeline.js`. Input is clamped to `[0, 1]`.
 * @param {number} t
 * @returns {number}
 */
export function easeInOutCubic(t) {
  const clamped = clamp01(t);
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}
