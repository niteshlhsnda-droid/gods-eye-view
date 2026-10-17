// Untested-source scoreboard: every production module under src/ + server/
// mapped to the test(s) linked to it — or flagged untested when none are.
//
// The inverse of the test-runner coverage scoreboard (which asks "does a
// runner execute every test file?"): this asks "does any test touch every
// production module?" A green suite can hide untested behaviour a third way:
// a module may have no test at all — no co-located test file and no test
// that imports it. This scanner guards that failure. It is static (no test
// execution): a module counts as tested when either link exists:
//
// - co-located: `src/foo.js` / `src/foo.mjs` has `src/foo.test.mjs` beside
//   it — the repo's dominant convention.
// - import: some test file's static import, side-effect import, dynamic
//   `import()`, or `export ... from` resolves to the module.
//
// Linkage is DIRECT only: a module exercised transitively (a test imports
// A, A imports B) still shows as untested. That is deliberate — the
// scoreboard measures explicit test ownership, not transitive reach, so a
// refactor that drops the only test importing a module is visible instead
// of being masked by an indirect path.
//
// Exclusions (all deliberate, all documented here):
// - Test files themselves (`*.test.mjs`, `*.spec.mjs`) are the linkers,
//   not the linked.
// - `src/tooling/` and `src/testSupport/` are test infrastructure, not
//   production code — `check-import-directions.mjs` classifies both as
//   tests, and the unit tests drift-guard that agreement.
// - Fixture trees (`fixtures/` / `__fixtures__` segments) are data, not
//   modules under test.
// - `*.worker.mjs` entries are loaded by the runtime via `new Worker`,
//   never imported — the same reason import-directions exempts the one
//   worker in the tree.
//
// Live repo state at landing: 1044 source modules, 609 test files,
// 682 linked, 362 untested — concentrated in `src/ui`, `src/app/layers`
// and per-layer renderers, i.e. browser-only code with no unit-test
// harness. Report-only by default; `--strict` fails on any untested
// module. The number is a starting line for triage, not a gate target:
// UI-only modules may need e2e/smoke coverage rather than unit tests.

export const SOURCE_ROOTS = Object.freeze(['src', 'server']);

const TEST_SUFFIXES = Object.freeze(['.test.mjs', '.spec.mjs']);

const SOURCE_SUFFIXES = Object.freeze(['.js', '.mjs']);

/** Directories whose files are test infrastructure, not production code. */
export const TEST_INFRASTRUCTURE_DIRS = Object.freeze([
  'src/tooling/',
  'src/testSupport/',
]);

const FIXTURE_SEGMENTS = Object.freeze(['fixtures', '__fixtures__']);

/** True for a repo-relative, posix-style test file path. */
export function isTestFile(file) {
  return TEST_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

/** True for a repo-relative, posix-style production module path. */
export function isSourceFile(file) {
  if (!SOURCE_ROOTS.some((root) => file.startsWith(`${root}/`))) {
    return false;
  }
  if (isTestFile(file)) return false;
  if (file.endsWith('.worker.mjs')) return false;
  if (
    TEST_INFRASTRUCTURE_DIRS.some((directory) => file.startsWith(directory))
  ) {
    return false;
  }
  if (file.split('/').some((segment) => FIXTURE_SEGMENTS.includes(segment))) {
    return false;
  }
  return SOURCE_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

/** The co-located test path for a source module, e.g. `src/foo.test.mjs`. */
export function coLocatedTestFor(sourceFile) {
  const slash = sourceFile.lastIndexOf('/');
  const directory = slash === -1 ? '' : sourceFile.slice(0, slash + 1);
  const basename = sourceFile.slice(slash + 1);
  const stem = basename.replace(/\.(?:m?js)$/, '');
  return `${directory}${stem}.test.mjs`;
}

const IMPORT_RE =
  /(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"])/g;

function normalizePosix(value) {
  const parts = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/**
 * Resolve one import specifier from a test file to a repo-relative path.
 * Returns null for bare specifiers (`node:fs`, `cesium`) and for
 * specifiers that resolve to no known file. Extensionless specifiers try
 * `.js`, then `.mjs`, then directory `index.js` / `index.mjs`.
 */
export function resolveImportSpecifier(testFile, specifier, knownFiles) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return null;
  }
  const directory = testFile.slice(0, testFile.lastIndexOf('/') + 1);
  const resolved = normalizePosix(`${directory}${specifier}`);
  if (knownFiles.has(resolved)) return resolved;
  if (!/\.(?:m?js)$/.test(resolved)) {
    for (const candidate of [
      `${resolved}.js`,
      `${resolved}.mjs`,
      `${resolved}/index.js`,
      `${resolved}/index.mjs`,
    ]) {
      if (knownFiles.has(candidate)) return candidate;
    }
  }
  return null;
}

/** Source modules one test file links to via its import specifiers. */
export function testLinkedSources(testFile, content, knownFiles) {
  const linked = new Set();
  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    const resolved = resolveImportSpecifier(testFile, specifier, knownFiles);
    if (resolved !== null) linked.add(resolved);
  }
  return linked;
}

/**
 * Map every source module to its test links.
 *
 * @param {Iterable<string>} files - repo-relative posix paths on disk.
 * @param {Map<string, string>} testContents - test file path -> content.
 * @returns {Array<{file, tested, linkKind, linkedBy}>} sorted by file, with
 *   linkKind `co-located` | `import` | `both` | null and linkedBy the
 *   test files that link to the module (co-located test first).
 */
export function scanUntestedSources(files, testContents) {
  const sorted = [...new Set(files)].sort();
  const knownFiles = new Set(sorted);
  const sources = sorted.filter((file) => isSourceFile(file));
  const linkedBy = new Map(sources.map((file) => [file, new Set()]));
  const coLocated = new Map();
  for (const source of sources) {
    const test = coLocatedTestFor(source);
    coLocated.set(source, knownFiles.has(test));
    if (knownFiles.has(test)) linkedBy.get(source).add(test);
  }
  for (const [testFile, content] of testContents) {
    for (const source of testLinkedSources(testFile, content, knownFiles)) {
      if (linkedBy.has(source)) linkedBy.get(source).add(testFile);
    }
  }
  return sources.map((source) => {
    const tests = [...linkedBy.get(source)].sort();
    const hasCoLocated = coLocated.get(source);
    const hasImport = tests.some((test) => test !== coLocatedTestFor(source));
    const linkKind =
      hasCoLocated && hasImport
        ? 'both'
        : hasCoLocated
          ? 'co-located'
          : hasImport
            ? 'import'
            : null;
    return {
      file: source,
      tested: linkKind !== null,
      linkKind,
      linkedBy: tests,
    };
  });
}

/** Aggregate findings into totals, per-directory counts, and the list. */
export function summarizeUntestedSources(findings) {
  const byDirectory = new Map();
  for (const finding of findings) {
    const directory = finding.file.slice(0, finding.file.lastIndexOf('/'));
    const entry = byDirectory.get(directory) ?? {
      directory,
      total: 0,
      tested: 0,
      untested: 0,
    };
    entry.total += 1;
    if (finding.tested) entry.tested += 1;
    else entry.untested += 1;
    byDirectory.set(directory, entry);
  }
  const directories = [...byDirectory.values()].sort(
    (a, b) => b.untested - a.untested || a.directory.localeCompare(b.directory),
  );
  const byLinkKind = { 'co-located': 0, import: 0, both: 0 };
  for (const finding of findings) {
    if (finding.linkKind !== null) byLinkKind[finding.linkKind] += 1;
  }
  const untested = findings.filter((finding) => !finding.tested);
  return {
    total: findings.length,
    tested: findings.length - untested.length,
    untested: untested.length,
    untestedFiles: untested.map((finding) => finding.file),
    byDirectory: directories,
    byLinkKind,
  };
}

/** True when any module is untested (the `--strict` failure condition). */
export function hasStrictViolation(findings) {
  return findings.some((finding) => !finding.tested);
}

/** Human-readable report: per-directory table, then the untested list. */
export function formatUntestedSourcesReport(findings, summary) {
  const lines = ['Untested-source scoreboard'];
  if (summary.untested === 0) {
    lines.push(
      `OK: all ${summary.total} production module(s) are linked to at least one test.`,
    );
  } else {
    lines.push(
      `UNTESTED: ${summary.untested} of ${summary.total} production module(s) have no co-located test and are imported by no test:`,
    );
    for (const { directory, total, tested, untested } of summary.byDirectory) {
      if (untested > 0) {
        lines.push(
          `  ${directory}: ${untested} untested / ${total} total (${tested} tested)`,
        );
      }
    }
    for (const file of summary.untestedFiles) lines.push(`  - ${file}`);
  }
  lines.push(
    `tested: ${summary.tested}/${summary.total} ` +
      `(co-located: ${summary.byLinkKind['co-located']}, ` +
      `import: ${summary.byLinkKind.import}, both: ${summary.byLinkKind.both})`,
  );
  return `${lines.join('\n')}\n`;
}
