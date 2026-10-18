/**
 * Shared vector math: canonical N-dimensional vector operations on plain
 * arrays (`[x, y]` or `[x, y, z]`, and in general any fixed length).
 *
 * Why this module exists: the codebase does ad-hoc vector arithmetic in
 * several places (camera offsets, marker/screen deltas, track headings,
 * wind components) with no canonical representation — every call site
 * re-derives `Math.hypot(...)`, normalisation, and dot products with its
 * own edge-case behaviour (zero vectors, dimension mismatches, mutation
 * of the caller's array). A shared module pins one set of semantics.
 *
 * Canonical semantics (standalone — no call sites re-pointed):
 * - Pure: no DOM, no imports. Vectors are plain arrays of finite
 *   numbers; every function returns a NEW array and never mutates its
 *   inputs.
 * - Dimension rule: operands to a binary operation must have the same
 *   length, and every vector must have at least one component. A
 *   mismatch or an invalid vector is an error value, never a throw and
 *   never a silent truncation to the shorter length.
 * - Error values: vector-returning functions return `null` on invalid
 *   input; scalar-returning functions return `NaN`; `equals` returns
 *   `false`. This matches the `null`-for-invalid convention of
 *   colorMath (vector results have no numeric sentinel) while scalar
 *   results follow the `NaN` convention of windMath / signalMath.
 * - Invalid means: not an array, empty, any component not a finite
 *   number (including `NaN`, `±Infinity`, strings, `null`), or — for
 *   binary operations — mismatched lengths. Scalars must be finite
 *   numbers.
 * - Zero vector: `normalize` of the zero vector returns `null` (there
 *   is no direction to normalise to); `angleBetween` involving a zero
 *   vector returns `NaN`; `project` onto the zero vector returns
 *   `null`.
 * - `cross` is defined only in 3D: both operands must be length 3, and
 *   the result follows the right-hand rule
 *   `(a2*b3 - a3*b2, a3*b1 - a1*b3, a1*b2 - a2*b1)`.
 * - `angleBetween` returns radians in `[0, PI]`; the cosine is clamped
 *   to `[-1, 1]` before `acos` so floating-point rounding on nearly
 *   parallel vectors cannot produce `NaN`.
 * - `lerp` does NOT clamp `t`: `t = 0` is `a`, `t = 1` is `b`, and
 *   values outside `[0, 1]` extrapolate along the same line.
 * - `equals` uses an absolute tolerance (`epsilon`, default `1e-9`);
 *   it compares component-wise, so it is scale-absolute, not relative.
 *   Callers comparing very large magnitudes should pass their own
 *   epsilon.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in this
 * commit — migration is a separate, per-group change, like the prior
 * idea-cycle modules.
 *
 * @module data/vectorMath
 */

/** True when `value` is a finite number. */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * True when `value` is a usable vector: a non-empty array whose every
 * component is a finite number.
 */
export function isVector(value) {
  return (
    Array.isArray(value) && value.length > 0 && value.every(isFiniteNumber)
  );
}

/** True when `a` and `b` are both vectors of the same length. */
function isSameLengthPair(a, b) {
  return isVector(a) && isVector(b) && a.length === b.length;
}

/**
 * Component-wise sum. Returns `null` on invalid input or a dimension
 * mismatch. Inputs are never mutated.
 */
export function add(a, b) {
  if (!isSameLengthPair(a, b)) return null;
  return a.map((component, index) => component + b[index]);
}

/**
 * Component-wise difference (`a - b`). Returns `null` on invalid
 * input or a dimension mismatch. Inputs are never mutated.
 */
export function subtract(a, b) {
  if (!isSameLengthPair(a, b)) return null;
  return a.map((component, index) => component - b[index]);
}

/**
 * Negation (`-v`). Returns `null` on invalid input. Inputs are never
 * mutated.
 */
export function negate(v) {
  if (!isVector(v)) return null;
  return v.map((component) => -component);
}

/**
 * Scalar multiplication. Returns `null` on invalid input or a
 * non-finite scalar. Inputs are never mutated.
 */
export function scale(v, scalar) {
  if (!isVector(v) || !isFiniteNumber(scalar)) return null;
  return v.map((component) => component * scalar);
}

/**
 * Dot (scalar) product. Returns `NaN` on invalid input or a dimension
 * mismatch.
 */
export function dot(a, b) {
  if (!isSameLengthPair(a, b)) return NaN;
  return a.reduce((sum, component, index) => sum + component * b[index], 0);
}

/**
 * Squared magnitude (`dot(v, v)`). Prefer this over `magnitude` when
 * only a comparison is needed — it avoids a square root. Returns `NaN`
 * on invalid input.
 */
export function magnitudeSquared(v) {
  if (!isVector(v)) return NaN;
  return v.reduce((sum, component) => sum + component * component, 0);
}

/**
 * Magnitude (Euclidean norm, `Math.hypot(...)`). Returns `NaN` on
 * invalid input.
 */
export function magnitude(v) {
  if (!isVector(v)) return NaN;
  return Math.hypot(...v);
}

/**
 * Unit vector in the direction of `v` (same length, magnitude 1).
 * Returns `null` for the zero vector or invalid input. Inputs are
 * never mutated.
 */
export function normalize(v) {
  if (!isVector(v)) return null;
  const length = Math.hypot(...v);
  if (length === 0) return null;
  return v.map((component) => component / length);
}

/**
 * Euclidean distance between `a` and `b`. Returns `NaN` on invalid
 * input or a dimension mismatch.
 */
export function distance(a, b) {
  if (!isSameLengthPair(a, b)) return NaN;
  return Math.hypot(...a.map((component, index) => component - b[index]));
}

/**
 * Squared Euclidean distance between `a` and `b`. Prefer this over
 * `distance` when only a comparison is needed. Returns `NaN` on
 * invalid input or a dimension mismatch.
 */
export function distanceSquared(a, b) {
  if (!isSameLengthPair(a, b)) return NaN;
  return a.reduce(
    (sum, component, index) => sum + (component - b[index]) ** 2,
    0,
  );
}

/**
 * 3D cross product, right-hand rule. Returns `null` unless both
 * operands are valid 3-component vectors.
 */
export function cross(a, b) {
  if (!isSameLengthPair(a, b) || a.length !== 3) return null;
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Angle between `a` and `b` in radians, in `[0, PI]`. Returns `NaN`
 * when either vector is zero or the input is invalid / mismatched.
 */
export function angleBetween(a, b) {
  if (!isSameLengthPair(a, b)) return NaN;
  const magnitudeA = Math.hypot(...a);
  const magnitudeB = Math.hypot(...b);
  if (magnitudeA === 0 || magnitudeB === 0) return NaN;
  const cosine = dot(a, b) / (magnitudeA * magnitudeB);
  return Math.acos(Math.min(1, Math.max(-1, cosine)));
}

/**
 * Linear interpolation: `a + (b - a) * t`. `t` is NOT clamped, so
 * values outside `[0, 1]` extrapolate. Returns `null` on invalid
 * input, a dimension mismatch, or a non-finite `t`.
 */
export function lerp(a, b, t) {
  if (!isSameLengthPair(a, b) || !isFiniteNumber(t)) return null;
  return a.map((component, index) => component + (b[index] - component) * t);
}

/**
 * Orthogonal projection of `a` onto `onto`:
 * `(dot(a, onto) / dot(onto, onto)) * onto`. Returns `null` when
 * `onto` is the zero vector or the input is invalid / mismatched.
 */
export function project(a, onto) {
  if (!isSameLengthPair(a, onto)) return null;
  const ontoSquared = dot(onto, onto);
  if (ontoSquared === 0) return null;
  return scale(onto, dot(a, onto) / ontoSquared);
}

/**
 * Component-wise approximate equality within absolute `epsilon`
 * (default `1e-9`). Returns `false` on invalid input, a dimension
 * mismatch, or a non-finite / negative `epsilon`.
 */
export function equals(a, b, epsilon = 1e-9) {
  if (!isSameLengthPair(a, b)) return false;
  if (!isFiniteNumber(epsilon) || epsilon < 0) return false;
  return a.every(
    (component, index) => Math.abs(component - b[index]) <= epsilon,
  );
}

/**
 * Zero vector of the given dimension. Returns `null` for a
 * non-integer dimension or a dimension below 1. `dim` defaults to 3.
 */
export function zeroVector(dim = 3) {
  if (!Number.isInteger(dim) || dim < 1) return null;
  return Array(dim).fill(0);
}
