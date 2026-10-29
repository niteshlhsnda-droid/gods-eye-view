// src/data/assetBase.js
/**
 * Resolve a public-asset path against the deploy base.
 *
 * Root-absolute public-asset references (`/mic.svg`, `/models/*.glb`) 404 on
 * the `/gods-eye-view/` subpath deployment: Vite rewrites `<img src>` in the
 * HTML it processes, but it leaves JS-injected markup and module-constant
 * URLs untouched (H-02, H-05, H-06). Every public-asset URL materialised in
 * src must go through `resolvePublicUrl` so the Vite-resolved base
 * (`import.meta.env.BASE_URL` — `/gods-eye-view/` in the Pages build, `/` in
 * dev/preview) is applied at the fork seam, without breaking root-served dev.
 *
 * Idempotency: a URL that already carries the deploy base passes through
 * unchanged, so constants resolved here may still be wrapped by an injected
 * `resolveAsset` at the render call site without double-prefixing.
 */

let baseOverride = null;

/** Test seam: pin the deploy base without running the Vite config lifecycle. */
export function setPublicBase(base) {
  baseOverride = base == null ? null : String(base);
}

/**
 * The base path the app is served from, always trailing-slash terminated.
 * `import.meta.env.BASE_URL` is statically replaced by Vite at build time; the
 * optional chain keeps plain-node test runs (where `import.meta.env` is
 * undefined) on the root base.
 */
export function publicBase() {
  const base = baseOverride ?? import.meta.env?.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Prefix a root-absolute public-asset path with the deploy base.
 * @param {string} url e.g. `/models/airplane.glb` or `mic.svg`.
 * @returns {string} e.g. `/gods-eye-view/models/airplane.glb` in the Pages
 *   build, `/models/airplane.glb` under root-served dev.
 */
export function resolvePublicUrl(url) {
  const path = String(url).replace(/^\//, '');
  const basePath = publicBase().replace(/^\//, '');
  if (basePath && path.startsWith(basePath)) return `/${path}`;
  return `/${basePath}${path}`;
}
