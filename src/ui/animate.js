/**
 * Micro-animations — anime.js (MIT) with a CSS-transition fallback.
 *
 * The animejs package is loaded lazily and cached; every helper resolves even
 * when the package (or the DOM) is unavailable, so UI code can `await` these
 * unconditionally. `prefers-reduced-motion` short-circuits all motion.
 *
 * anime.js v4 API: `import { animate } from 'animejs'`.
 */

let cachedAnimate = null;
let loadAttempted = false;

/** Lazy-load anime.js; resolves to the `animate` function or null. */
export async function loadAnime() {
  if (cachedAnimate || loadAttempted) return cachedAnimate;
  loadAttempted = true;
  try {
    const module = await import('animejs');
    const animate =
      module?.animate ?? module?.default?.animate ?? module?.default;
    if (typeof animate === 'function') cachedAnimate = animate;
  } catch {
    cachedAnimate = null;
  }
  return cachedAnimate;
}

/** Test seam: inject or clear the animator without touching the module loader. */
export function __setAnimateForTests(animate) {
  cachedAnimate = typeof animate === 'function' ? animate : null;
  loadAttempted = animate !== undefined;
}

/**
 * @param {object} [matchMediaRef]
 * @returns {boolean}
 */
export function prefersReducedMotion(matchMediaRef = globalThis.matchMedia) {
  try {
    return Boolean(
      matchMediaRef?.('(prefers-reduced-motion: reduce)')?.matches,
    );
  } catch {
    return false;
  }
}

function asElement(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    try {
      return globalThis.document?.querySelector(target) ?? null;
    } catch {
      return null;
    }
  }
  return typeof target?.style === 'object' ? target : null;
}

/**
 * Run one animation with the CSS fallback.
 * @param {Element|string} target
 * @param {object} keyframes CSS property map, e.g. { opacity: [0, 1] }.
 * @param {object} [options] { duration, easing, delay }
 * @returns {Promise<void>} Always resolves.
 */
export async function animateElement(
  target,
  keyframes,
  { duration = 250, easing = 'easeOutQuad', delay = 0 } = {},
) {
  const el = asElement(target);
  if (!el) return;
  if (prefersReducedMotion()) return;
  const animate = cachedAnimate ?? (await loadAnime());
  if (animate) {
    try {
      const params = { duration, delay, ease: easing };
      for (const [property, value] of Object.entries(keyframes)) {
        params[property] = value;
      }
      const animation = animate(el, params);
      await animation?.finished?.catch?.(() => {});
      return;
    } catch {
      /* Fall through to the CSS path. */
    }
  }
  // CSS fallback: transition between first and last keyframe values.
  await new Promise((resolve) => {
    try {
      const entries = Object.entries(keyframes);
      if (!entries.length) return resolve();
      const from = {};
      const to = {};
      for (const [property, value] of entries) {
        const stops = Array.isArray(value) ? value : [value];
        from[property] = stops[0];
        to[property] = stops[stops.length - 1];
      }
      const style = el.style;
      const previousTransition = style.transition;
      const setProps = (values) => {
        for (const [property, value] of Object.entries(values)) {
          style[property] = typeof value === 'number' ? String(value) : value;
        }
      };
      setProps(from);
      style.transition = `all ${duration}ms ease`;
      const finish = () => {
        style.transition = previousTransition;
        resolve();
      };
      const start = () => {
        setProps(to);
        setTimeout(finish, duration + 30);
      };
      if (delay > 0) setTimeout(start, delay);
      else requestAnimationFrameSafe(start);
    } catch {
      resolve();
    }
  });
}

function requestAnimationFrameSafe(fn) {
  try {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => fn());
      return;
    }
  } catch {
    /* Fall through. */
  }
  setTimeout(fn, 16);
}

/** Fade + slight rise, for toasts and panels appearing. */
export function fadeIn(target, options) {
  return animateElement(
    target,
    { opacity: [0, 1], translateY: [8, 0] },
    options,
  );
}

/** Fade out, for dismissals. */
export function fadeOut(target, options) {
  return animateElement(target, { opacity: [1, 0] }, options);
}

/** Sheet entrance: fade with a downward settle. */
export function slideDown(target, options) {
  return animateElement(
    target,
    { opacity: [0, 1], translateY: [-10, 0] },
    options,
  );
}
