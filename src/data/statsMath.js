/**
 * Shared descriptive statistics: sum, mean, median, min/max, variance,
 * standard deviation, percentile, and interquartile range.
 *
 * The same tiny formulas are currently re-derived inline all over the
 * codebase, with divergent edge semantics:
 * - `median` copies in `flowMatch.js` (even count averages the two middles,
 *   `null` on empty) and `sdr/spectrum.js` (UPPER median — `floor(n / 2)`,
 *   no empty handling beyond a `-120` fallback). Same name, different
 *   answers on even-length inputs.
 * - `percentile` copies in `contactPlayback.js` (nearest-rank via
 *   `Math.ceil(n * rank) - 1`, `0` on empty — and a latent bug: it calls
 *   bare `.sort()`, which sorts NUMBERS AS STRINGS, so `[2, 10]` sorts to
 *   `[10, 2]`) and `layers/transit/qaMetrics.js` (nearest-rank with a
 *   numeric comparator, `Infinity` on empty or any non-finite value).
 * - `cctvLod.js` has a `percentile` PARAMETER (a config knob), not a
 *   percentile function — unrelated, listed here only to avoid confusion.
 *
 * Canonical semantics (one per operation, documented here so call sites
 * migrating later know exactly what changes):
 * - `percentile` uses LINEAR INTERPOLATION (type-7 / NumPy default /
 *   Excel PERCENTILE.INC), NOT the nearest-rank rule the in-base copies
 *   use. On `[0, 100]`, `percentile(..., 0.95)` is `95` here but `100`
 *   under nearest-rank. `median` is exactly `percentile(values, 0.5)`,
 *   which coincides with `flowMatch.js`'s even-average rule but differs
 *   from `spectrum.js`'s upper median.
 * - Empty input: `sum` is `0`, `min` is `+Infinity`, `max` is `-Infinity`
 *   (matching `Math.min()` / `Math.max()` with no arguments); every other
 *   function returns `NaN`. This differs from `flowMatch.js` (`null`),
 *   `contactPlayback.js` (`0`), and `qaMetrics.js` (`Infinity`).
 * - Non-finite elements (`NaN`, `+/-Infinity`) propagate as `NaN` — this
 *   module never silently invents a value or drops a sample. Callers that
 *   need to skip bad samples must filter BEFORE calling.
 * - `p` outside `[0, 1]` returns `NaN` (no clamping — a caller passing
 *   `95` for "95th percentile" is a bug, not a `0.95`).
 * - `variance` defaults to POPULATION variance (divide by `n`); pass
 *   `{ sample: true }` for the sample variance (divide by `n - 1`).
 *   Sample variance of fewer than 2 values is `NaN`.
 * - Inputs are never mutated: sorting always works on a copy.
 *
 * Pure: no DOM, no imports. All inputs/outputs are plain numbers.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in this
 * commit — migration is a separate, per-group change (adding this file to
 * every boundary group that owns an importing module), like the prior
 * idea-cycle modules.
 *
 * @module data/statsMath
 */

/**
 * Check that `values` is an array whose elements are all finite numbers.
 * @param {unknown} values
 * @returns {boolean}
 */
function isFiniteNumberArray(values) {
  return Array.isArray(values) && values.every((v) => Number.isFinite(v));
}

/**
 * Sum of the values. `0` for an empty array.
 * @param {number[]} values
 * @returns {number} Sum, or `NaN` for a non-array or any non-finite element.
 */
export function sum(values) {
  if (!Array.isArray(values)) return NaN;
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) return NaN;
    total += v;
  }
  return total;
}

/**
 * Arithmetic mean. `NaN` for an empty array, a non-array, or any
 * non-finite element.
 * @param {number[]} values
 * @returns {number}
 */
export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  const total = sum(values);
  return Number.isNaN(total) ? NaN : total / values.length;
}

/**
 * Sorted copy of the values, or `null` when the input is unusable
 * (non-array or any non-finite element). Empty arrays sort to `[]`
 * and are handled by the caller.
 * @param {number[]} values
 * @returns {number[] | null}
 */
function sortedCopy(values) {
  if (!isFiniteNumberArray(values)) return null;
  return [...values].sort((a, b) => a - b);
}

/**
 * Percentile with linear interpolation (type-7): `p = 0` is the minimum,
 * `p = 1` is the maximum, `p = 0.5` is the median. `NaN` for an empty
 * array, a non-array, any non-finite element, or `p` outside `[0, 1]`.
 * @param {number[]} values
 * @param {number} p Fraction in `[0, 1]`.
 * @returns {number}
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  if (!Number.isFinite(p) || p < 0 || p > 1) return NaN;
  const sorted = sortedCopy(values);
  if (sorted === null) return NaN;
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - h) + sorted[hi] * (h - lo);
}

/**
 * Median: the 50th percentile (linear interpolation, so an even count
 * averages the two middles). `NaN` for an empty array, a non-array, or
 * any non-finite element.
 * @param {number[]} values
 * @returns {number}
 */
export function median(values) {
  return percentile(values, 0.5);
}

/**
 * Minimum. `+Infinity` for an empty array (matching `Math.min()` with no
 * arguments); `NaN` for a non-array or any non-finite element.
 * @param {number[]} values
 * @returns {number}
 */
export function min(values) {
  if (!Array.isArray(values)) return NaN;
  if (values.length === 0) return Infinity;
  let result = Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) return NaN;
    if (v < result) result = v;
  }
  return result;
}

/**
 * Maximum. `-Infinity` for an empty array (matching `Math.max()` with no
 * arguments); `NaN` for a non-array or any non-finite element.
 * @param {number[]} values
 * @returns {number}
 */
export function max(values) {
  if (!Array.isArray(values)) return NaN;
  if (values.length === 0) return -Infinity;
  let result = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) return NaN;
    if (v > result) result = v;
  }
  return result;
}

/**
 * Variance. Population variance (divide by `n`) by default; pass
 * `{ sample: true }` for sample variance (divide by `n - 1`). `NaN` for
 * an empty array, a non-array, any non-finite element, or sample
 * variance of fewer than 2 values.
 * @param {number[]} values
 * @param {object} [options]
 * @param {boolean} [options.sample=false] Use the sample (n - 1) divisor.
 * @returns {number}
 */
export function variance(values, { sample = false } = {}) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  if (sample && values.length < 2) return NaN;
  const avg = mean(values);
  if (Number.isNaN(avg)) return NaN;
  let squared = 0;
  for (const v of values) {
    const d = v - avg;
    squared += d * d;
  }
  return squared / (values.length - (sample ? 1 : 0));
}

/**
 * Standard deviation (square root of {@link variance}). Same options and
 * `NaN` rules as `variance`.
 * @param {number[]} values
 * @param {object} [options]
 * @param {boolean} [options.sample=false] Use the sample (n - 1) divisor.
 * @returns {number}
 */
export function stdDev(values, { sample = false } = {}) {
  const v = variance(values, { sample });
  return Number.isNaN(v) ? NaN : Math.sqrt(v);
}

/**
 * Interquartile range: `percentile(values, 0.75) - percentile(values, 0.25)`.
 * `NaN` for an empty array, a non-array, or any non-finite element.
 * @param {number[]} values
 * @returns {number}
 */
export function interquartileRange(values) {
  const q3 = percentile(values, 0.75);
  if (Number.isNaN(q3)) return NaN;
  const q1 = percentile(values, 0.25);
  if (Number.isNaN(q1)) return NaN;
  return q3 - q1;
}
