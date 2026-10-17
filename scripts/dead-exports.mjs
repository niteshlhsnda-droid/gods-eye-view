/**
 * Dead-export scoreboard: report exported names no other module imports.
 *
 * Static analysis only — it parses each module and follows static
 * `import` / `export ... from` / `export * from` / literal dynamic
 * `import()` edges. A name is a candidate when no other module imports
 * it. The report is advisory, NOT a verdict: false positives include
 * entry points loaded via `<script>` or non-literal dynamic imports,
 * names reached through string-based access, and exports consumed by
 * tooling outside `src/`. Review a candidate before deleting it.
 *
 * Conservative by design: `export * from`, namespace imports, and
 * literal dynamic imports mark every export of their target as used.
 * Self-imports never mark anything used.
 *
 * CLI (report-only, always exit 0):
 *   node scripts/dead-exports.mjs [--json] [--root <dir>]
 *
 * @module scripts/dead-exports
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parsers } from 'prettier/plugins/babel.mjs';

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs']);
const TEST_SUFFIXES = ['.test.mjs', '.analyst.test.mjs'];

/** Whether a relative path is a test file (excluded from the scan). */
export function isTestFile(relativePath) {
  return TEST_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'tokens', 'extra'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

/** Collect a module's exports and import edges from its source. */
export function describeModule(source) {
  const exports = new Map();
  const imports = [];
  const ast = parsers.babel.parse(source);
  walk(ast, (node) => {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.type === 'VariableDeclaration') {
        for (const declarator of node.declaration.declarations) {
          if (declarator.id?.type === 'Identifier') {
            exports.set(declarator.id.name, 'named');
          }
        }
      } else if (
        node.declaration?.type === 'FunctionDeclaration' ||
        node.declaration?.type === 'ClassDeclaration'
      ) {
        if (node.declaration.id?.type === 'Identifier') {
          exports.set(node.declaration.id.name, 'named');
        }
      }
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type === 'ExportSpecifier') {
          exports.set(specifier.exported.name, 'named');
          if (node.source?.type === 'StringLiteral') {
            imports.push({
              source: node.source.value,
              imported: specifier.local.name,
              reExport: true,
            });
          }
        }
      }
      if (
        node.source?.type === 'StringLiteral' &&
        node.specifiers?.length === 0
      ) {
        // `export {} from './x'` — a side-effect edge, no names.
        imports.push({
          source: node.source.value,
          imported: null,
          reExport: true,
        });
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      exports.set('default', 'default');
    } else if (node.type === 'ExportAllDeclaration') {
      if (node.source?.type === 'StringLiteral') {
        imports.push({
          source: node.source.value,
          imported: '*',
          reExport: true,
        });
      }
    } else if (node.type === 'ImportDeclaration') {
      if (node.source?.type === 'StringLiteral') {
        for (const specifier of node.specifiers ?? []) {
          if (specifier.type === 'ImportSpecifier') {
            imports.push({
              source: node.source.value,
              imported: specifier.imported.name,
              reExport: false,
            });
          } else if (specifier.type === 'ImportDefaultSpecifier') {
            imports.push({
              source: node.source.value,
              imported: 'default',
              reExport: false,
            });
          } else if (specifier.type === 'ImportNamespaceSpecifier') {
            imports.push({
              source: node.source.value,
              imported: '*',
              reExport: false,
            });
          }
        }
        if ((node.specifiers ?? []).length === 0) {
          imports.push({
            source: node.source.value,
            imported: null,
            reExport: false,
          });
        }
      }
    } else if (
      node.type === 'ImportExpression' &&
      node.source?.type === 'StringLiteral'
    ) {
      imports.push({
        source: node.source.value,
        imported: '*',
        reExport: false,
      });
    }
  });
  return { exports, imports };
}

/**
 * Resolve a relative import specifier to a scanned file, or null when
 * it points outside the scanned set (external package, asset, …).
 */
export function resolveImport(fromFile, specifier, knownFiles) {
  if (!specifier.startsWith('.')) return null;
  const fromDir = path.posix.dirname(fromFile);
  const base = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}/index.js`,
    `${base}/index.mjs`,
  ];
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

/**
 * Find dead-export candidates across a set of modules.
 * @param {Map<string, string>} files Relative path -> source.
 * @returns {{totalModules: number, totalExports: number,
 *   candidates: Array<{file: string, name: string, kind: string,
 *   importedBy: number}>, orphanModules: string[]}}
 */
export function analyzeDeadExports(files) {
  const descriptions = new Map();
  for (const [file, source] of files) {
    descriptions.set(file, describeModule(source));
  }
  const used = new Map();
  const importedBy = new Map();
  const markUsed = (file, name) => {
    if (!used.has(file)) used.set(file, new Set());
    used.get(file).add(name);
  };
  const markAllUsed = (file) => {
    for (const name of descriptions.get(file)?.exports.keys() ?? []) {
      markUsed(file, name);
    }
  };
  for (const [file, { imports }] of descriptions) {
    for (const edge of imports) {
      const target = resolveImport(file, edge.source, descriptions);
      if (target === null || target === file) continue;
      if (!importedBy.has(target)) importedBy.set(target, new Set());
      importedBy.get(target).add(file);
      if (edge.imported === '*') markAllUsed(target);
      else if (edge.imported !== null) markUsed(target, edge.imported);
    }
  }
  const candidates = [];
  const orphanModules = [];
  for (const [file, { exports }] of descriptions) {
    const importers = importedBy.get(file)?.size ?? 0;
    if (importers === 0 && exports.size > 0) orphanModules.push(file);
    for (const [name, kind] of exports) {
      if (!used.get(file)?.has(name)) {
        candidates.push({ file, name, kind, importedBy: importers });
      }
    }
  }
  candidates.sort(
    (a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name),
  );
  orphanModules.sort();
  return {
    totalModules: descriptions.size,
    totalExports: [...descriptions.values()].reduce(
      (sum, { exports }) => sum + exports.size,
      0,
    ),
    candidates,
    orphanModules,
  };
}

/** Discover scanned source files under a root directory. */
export function discoverSourceFiles(root = process.cwd()) {
  const sourceRoot = path.join(root, 'src');
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(path.extname(entry.name))
      ) {
        const relative = path
          .relative(root, absolute)
          .split(path.sep)
          .join('/');
        if (!isTestFile(relative))
          files.set(relative, readFileSync(absolute, 'utf8'));
      }
    }
  };
  visit(sourceRoot);
  return files;
}

function main(argv) {
  const args = argv.slice(2);
  const asJson = args.includes('--json');
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
  const result = analyzeDeadExports(discoverSourceFiles(root));
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `Dead-export scoreboard: ${result.candidates.length} candidates / ` +
      `${result.totalExports} exports / ${result.totalModules} modules`,
  );
  console.log(
    `Orphan modules (never imported): ${result.orphanModules.length}`,
  );
  for (const candidate of result.candidates) {
    console.log(
      `  ${candidate.file} :: ${candidate.name} (${candidate.kind}, imported by ${candidate.importedBy})`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
