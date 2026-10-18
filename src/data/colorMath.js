/**
 * Shared color math — canonical hex / RGB / HSL parsing, mixing, and
 * WCAG contrast helpers.
 *
 * Why this module exists: the codebase parses hex colors in at least four
 * divergent places, each with different edge-case behaviour:
 * - `src/layers/wind/fields.js` + `src/layers/wind/model.js`:
 *   `color.match(/\w\w/g).map((v) => parseInt(v, 16))` — accepts garbage
 *   (non-hex pairs become NaN), no 3-digit support, no alpha, no
 *   validation.
 * - `src/overlays/worldOverlayDraw.js` (`colorWithAlpha`): strict 6-digit
 *   hex regex + a bare `r,g,b` triplet form, silently returns the input
 *   unchanged when neither matches.
 * - `src/livenow/markers.js` (`hexToRgba`): 3-digit expansion, but falls
 *   back to a hardcoded gray `[200, 200, 200, 230]` on bad input.
 * No shared module existed, and nothing computed luminance or contrast
 * (only CSS `contrast(...)` filter strings and unrelated uses).
 *
 * Canonical edge-case semantics (standalone — no call sites re-pointed):
 * - Every function returns `null` on invalid input. Never a fallback
 *   color, never NaN, never a throw. Call sites keep their own fallbacks
 *   (e.g. the markers gray) and decide them explicitly.
 * - `parseHexColor` accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbcc`,
 *   with or without the leading `#`, case-insensitive, surrounding
 *   whitespace trimmed. It does NOT accept named colors, `rgb(...)`
 *   strings, or bare `r,g,b` triplet strings.
 * - 8-digit hex is RRGGBBAA (CSS convention). Alpha is 0..1 everywhere;
 *   omitted alpha means fully opaque (`a: 1`).
 * - Channel values must be finite numbers in 0..255; fractional channels
 *   are `Math.round`ed. Out-of-range channels are invalid (`null`),
 *   not clamped — clamping would silently change the caller's color.
 * - `mixColors` lerps per channel in sRGB, matching the two wind palette
 *   copies (not gamma-correct linear-light blending). `t` is clamped to
 *   0..1; a non-finite `t` is invalid.
 * - `relativeLuminance` is WCAG 2.x relative luminance (sRGB linearization
 *   + 0.2126 / 0.7152 / 0.0722 weights). It IGNORES alpha: WCAG luminance
 *   is defined for opaque colors, so callers must composite translucent
 *   colors over their background first.
 * - `rgbToHsl` returns achromatic colors with `h: 0` (hue undefined for
 *   gray; 0 is the documented stand-in). `hslToRgb` wraps `h` mod 360,
 *   so negative / >360 hues are valid.
 */

/** Clamp a number into [low, high]. */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** True when `value` is a finite number. */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Parse a hex color string into `{ r, g, b, a }` (channels 0..255
 * integers, `a` 0..1). Returns `null` for anything that is not a
 * 3/4/6/8-digit hex color.
 */
export function parseHexColor(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().replace(/^#/, '');
  if (
    !/^[0-9a-fA-F]{3}$/.test(text) &&
    !/^[0-9a-fA-F]{4}$/.test(text) &&
    !/^[0-9a-fA-F]{6}$/.test(text) &&
    !/^[0-9a-fA-F]{8}$/.test(text)
  ) {
    return null;
  }
  const expanded =
    text.length <= 4 ? [...text].map((c) => c + c).join('') : text;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  const a =
    expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

/**
 * Normalize a color input into `{ r, g, b, a }`. Accepts a hex string
 * (see `parseHexColor`) or an `{ r, g, b, a? }` object. Returns `null`
 * for anything else, for non-finite / out-of-range channels, or for an
 * out-of-range alpha. Fractional channels are rounded.
 */
export function normalizeColor(input) {
  if (typeof input === 'string') return parseHexColor(input);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const { r, g, b, a = 1 } = input;
  if (![r, g, b, a].every(isFiniteNumber)) return null;
  if ([r, g, b].some((v) => v < 0 || v > 255)) return null;
  if (a < 0 || a > 1) return null;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
}

/**
 * Format a color as a hex string: `#rrggbb`, or `#rrggbbcc` when an
 * alpha below 1 is present. Returns `null` for invalid input.
 */
export function rgbToHex(input) {
  const color = normalizeColor(input);
  if (color === null) return null;
  const byte = (v) => v.toString(16).padStart(2, '0');
  const hex = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
  if (color.a >= 1) return hex;
  return `${hex}${byte(Math.round(color.a * 255))}`;
}

/**
 * Convert a color to HSL: `{ h, s, l }` with `h` in [0, 360) and
 * `s` / `l` in [0, 1]. Achromatic colors return `h: 0`. Alpha is
 * dropped. Returns `null` for invalid input.
 */
export function rgbToHsl(input) {
  const color = normalizeColor(input);
  if (color === null) return null;
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/**
 * Convert HSL to `{ r, g, b }` (channels 0..255 integers). `h` wraps
 * mod 360; `s` / `l` must be in [0, 1]. Returns `null` for invalid input.
 */
export function hslToRgb(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const { h, s, l } = input;
  if (![h, s, l].every(isFiniteNumber)) return null;
  if (s < 0 || s > 1 || l < 0 || l > 1) return null;
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hue / 360 + 1 / 3) * 255),
    g: Math.round(channel(hue / 360) * 255),
    b: Math.round(channel(hue / 360 - 1 / 3) * 255),
  };
}

/**
 * Linearly interpolate between two colors in sRGB space. `t` is clamped
 * to [0, 1]; `t: 0` returns `a`, `t: 1` returns `b`. Returns
 * `{ r, g, b, a }` or `null` for invalid input / non-finite `t`.
 */
export function mixColors(a, b, t) {
  const from = normalizeColor(a);
  const to = normalizeColor(b);
  if (from === null || to === null || !isFiniteNumber(t)) return null;
  const k = clamp(t, 0, 1);
  const lerp = (x, y) => Math.round(x + (y - x) * k);
  return {
    r: lerp(from.r, to.r),
    g: lerp(from.g, to.g),
    b: lerp(from.b, to.b),
    a: from.a + (to.a - from.a) * k,
  };
}

/**
 * WCAG 2.x relative luminance (0 for black, 1 for white). Alpha is
 * ignored — composite translucent colors first. Returns `null` for
 * invalid input.
 */
export function relativeLuminance(input) {
  const color = normalizeColor(input);
  if (color === null) return null;
  const linear = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(color.r) +
    0.7152 * linear(color.g) +
    0.0722 * linear(color.b)
  );
}

/**
 * WCAG contrast ratio between two colors, in [1, 21]. Returns `null`
 * for invalid input. Order-independent.
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const CONTRAST_THRESHOLDS = Object.freeze({
  AA: 4.5,
  'AA-large': 3,
  AAA: 7,
  'AAA-large': 4.5,
});

/**
 * Whether the contrast between two colors meets a WCAG level:
 * `'AA'` (4.5), `'AA-large'` (3), `'AAA'` (7), `'AAA-large'` (4.5).
 * Returns `null` for invalid colors or an unknown level.
 */
export function meetsContrast(a, b, level) {
  const threshold = CONTRAST_THRESHOLDS[level];
  if (threshold === undefined) return null;
  const ratio = contrastRatio(a, b);
  if (ratio === null) return null;
  return ratio >= threshold;
}

/**
 * Format a color as an `rgba(r, g, b, alpha)` CSS string with the given
 * alpha (0..1), replacing any alpha the color itself carries. Returns
 * `null` for an invalid color or an out-of-range / non-finite alpha.
 */
export function withAlpha(input, alpha) {
  const color = normalizeColor(input);
  if (color === null || !isFiniteNumber(alpha)) return null;
  if (alpha < 0 || alpha > 1) return null;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}
