/** Resolve the actual ordered local CSS imports used by the application entry. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve an @import specifier found in `fromFile`. Relative specifiers resolve
 * against the importing file's directory (unchanged behavior); bare package
 * specifiers (e.g. '@knight-lab/timelinejs/dist/css/timeline.css') resolve via
 * node_modules, mirroring how Vite/Node resolve them for the real build.
 */
function resolveImport(fromFile, specifier) {
  const baseDir = path.dirname(fromFile);
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    return path.resolve(baseDir, specifier);
  }
  let dir = baseDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', specifier);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to relative resolution so a genuinely missing file still
  // produces the familiar ENOENT at the expected path.
  return path.resolve(baseDir, specifier);
}

export function readStylesheet(file, ancestors = new Set()) {
  const resolved = path.resolve(
    file instanceof URL ? fileURLToPath(file) : file,
  );
  if (ancestors.has(resolved)) throw new Error('Circular stylesheet import');
  const next = new Set(ancestors).add(resolved);
  return readFileSync(resolved, 'utf8').replace(
    /@import ['"]([^'"]+)['"];\s*/g,
    (_, imported) => readStylesheet(resolveImport(resolved, imported), next),
  );
}
