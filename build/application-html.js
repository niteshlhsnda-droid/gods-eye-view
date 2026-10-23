import { readFileSync } from 'node:fs';

export const APPLICATION_TEMPLATES = Object.freeze([
  'scene-chrome',
  'cockpit',
  'display-controls',
  'command-dock',
  'layer-panels',
  'context',
  'welcome',
  'provider-settings',
  'hud-loading',
]);
const allowed = new Set(APPLICATION_TEMPLATES);

/**
 * Build base captured from the resolved Vite config (`vite build
 * --base=/gods-eye-view/` in production, `/` in dev/preview). `data-*`
 * attributes are NOT rewritten by Vite's HTML asset pass — only `<img src>`
 * etc. are — so template data attributes that name public assets must be
 * rebased here (H-02: `data-logo-src="/logo.svg"` 404'd on the deployed
 * subpath, silently killing the gaze-animated logo install).
 */
let resolvedBase = '/';

/** Test seam: pin the base without running the Vite config lifecycle. */
export function setApplicationHtmlBase(base) {
  resolvedBase = base || '/';
}

/** Expand only known component templates; markers cannot name filesystem paths. */
export function expandApplicationHtml(html, { base } = {}) {
  const useBase = base || resolvedBase;
  const expanded = html.replace(
    /^[ \t]*<!-- gev:template ([^\s]+) -->\r?\n?/gm,
    (_, name) => {
      if (!allowed.has(name))
        throw new Error(`Unknown application template: ${name}`);
      return readFileSync(
        new URL(`../src/ui/templates/${name}.html`, import.meta.url),
        'utf8',
      );
    },
  );
  // Rebase public-asset references in data attributes (Vite leaves these
  // untouched). The trailing-slash normalization keeps `//` out of URLs.
  const prefix = useBase.endsWith('/') ? useBase : `${useBase}/`;
  return expanded.replace(
    /data-logo-src="\/([^"]*)"/g,
    (_, asset) => `data-logo-src="${prefix}${asset}"`,
  );
}

/** Assemble static application markup before Vite processes scripts and assets. */
export function applicationHtmlPlugin() {
  return {
    name: 'application-component-templates',
    configResolved(config) {
      resolvedBase = config.base || '/';
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => expandApplicationHtml(html),
    },
  };
}
