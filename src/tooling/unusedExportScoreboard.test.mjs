import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_LIMIT,
  analyzeFiles,
  bindingNames,
  discoverSourceFiles,
  filterByFiles,
  findUnused,
  formatUnusedExportReport,
  groupByFile,
  isTestFile,
  limitFindings,
  parseCliArgs,
  parseExports,
  parseImports,
  publicFilesFromExports,
  resolveSpecifier,
  stripCommentsAndStrings,
  summarizeResults,
} from './unusedExportScoreboard.js';

function exportsOf(source) {
  const { code, strings } = stripCommentsAndStrings(source);
  return parseExports(code, strings);
}

function importsOf(source) {
  const { code, strings } = stripCommentsAndStrings(source);
  return parseImports(code, strings);
}

async function analyze(map, options = {}) {
  const files = [...map.keys()].sort();
  return analyzeFiles(files, {
    readFile: async (file) => map.get(file),
    ...options,
  });
}

function unusedNames(results, options) {
  return findUnused(results, options).map((entry) => entry.name);
}

test('strips comments, strings, and template text before parsing', () => {
  const found = exportsOf(
    '// export const fake = 1;\n' +
      '/* export const fake2 = 1; */\n' +
      "const s = 'export const fake3 = 1';\n" +
      'const t = `export const fake4 = 1`;\n' +
      'const u = `kept ${exported} code`;\n' +
      'export const real = 1;\n',
  );
  assert.deepEqual(
    found.map((entry) => entry.name),
    ['real'],
  );
});

test('keeps import specifiers through the string placeholder', () => {
  const { imports } = importsOf(
    "import { used } from './a.js';\nimport './side.js';\n",
  );
  assert.deepEqual(
    imports.map((entry) => entry.specifier),
    ['./a.js'],
  );
  assert.deepEqual([...imports[0].names], ['used']);
});

test('bindingNames handles shorthand, rename, rest, defaults, nesting', () => {
  assert.deepEqual(bindingNames('{ a, b: c, ...rest }'), ['a', 'c', 'rest']);
  assert.deepEqual(bindingNames('{ a = 1, b: { c } }'), ['a', 'c']);
  assert.deepEqual(bindingNames('[x, [y], ...z]'), ['x', 'y', 'z']);
  assert.deepEqual(bindingNames('plain'), ['plain']);
});

test('parses every export form', () => {
  const found = exportsOf(
    'export function fn() {}\n' +
      'export async function afn() {}\n' +
      'export class Klass {}\n' +
      'export const foo = 1, bar = 2;\n' +
      'export let single;\n' +
      'export const { a, b: c } = obj;\n' +
      'export const [x, [y]] = arr;\n' +
      'export { local as alias, other };\n' +
      'export default 42;\n' +
      'export interface Iface {}\n' +
      'export type Alias = string;\n' +
      'export { re } from "./other.js";\n' +
      'export * as ns from "./ns.js";\n' +
      'exports.cjsOne = 1;\n' +
      'module.exports.cjsTwo = 2;\n',
  );
  assert.deepEqual(
    found.map((entry) => entry.name).sort(),
    [
      'Alias',
      'Iface',
      'Klass',
      'a',
      'afn',
      'alias',
      'bar',
      'c',
      'cjsOne',
      'cjsTwo',
      'default',
      'fn',
      'foo',
      'ns',
      'other',
      're',
      'single',
      'x',
      'y',
    ].sort(),
  );
  const byName = new Map(found.map((entry) => [entry.name, entry.kind]));
  assert.equal(byName.get('fn'), 'function');
  assert.equal(byName.get('Klass'), 'class');
  assert.equal(byName.get('foo'), 'variable');
  assert.equal(byName.get('alias'), 'named-list');
  assert.equal(byName.get('default'), 'default');
  assert.equal(byName.get('re'), 'named-reexport');
  assert.equal(byName.get('ns'), 'namespace-reexport');
  assert.equal(byName.get('cjsOne'), 'cjs');
  // `export { x as default }` (no `export default` in the same file)
  // creates a `default` export of kind named-list.
  assert.deepEqual(exportsOf('const x = 1;\nexport { x as default };\n'), [
    { name: 'default', kind: 'named-list', line: 2 },
  ]);
});

test('parses import forms including alias, namespace, side-effect', () => {
  const { imports, sideEffectImports } = importsOf(
    "import def, { a, b as c, default as d } from './a.js';\n" +
      "import * as ns from './b.js';\n" +
      "import './side.js';\n" +
      'export { e } from "./c.js";\n' +
      "export * from './d.js';\n",
  );
  assert.deepEqual(
    sideEffectImports.map((entry) => entry.specifier),
    ['./side.js'],
  );
  const bySpecifier = new Map(imports.map((entry) => [entry.specifier, entry]));
  assert.deepEqual([...bySpecifier.get('./a.js').names].sort(), [
    'a',
    'b',
    'default',
  ]);
  assert.equal(bySpecifier.get('./b.js').names, '*');
  assert.deepEqual([...bySpecifier.get('./c.js').names], ['e']);
  assert.equal(bySpecifier.get('./d.js').names, '*');
});

test('parses dynamic import and require forms', () => {
  const { imports } = importsOf(
    'const { a, b: c } = await import("./a.js");\n' +
      'await import("./b.js");\n' +
      'const mod = await import("./c.js");\n' +
      'const { d } = require("./e.js");\n',
  );
  const bySpecifier = new Map(imports.map((entry) => [entry.specifier, entry]));
  assert.deepEqual([...bySpecifier.get('./a.js').names].sort(), ['a', 'b']);
  assert.equal(bySpecifier.get('./b.js').names, '*');
  assert.equal(bySpecifier.get('./c.js').names, '*');
  assert.deepEqual([...bySpecifier.get('./e.js').names], ['d']);
  assert.equal(bySpecifier.get('./e.js').kind, 'require');
});

test('distinguishes used from unused exports', async () => {
  const results = await analyze(
    new Map([
      [
        'src/a.js',
        'export const used = 1;\nexport const unused = 2;\nexport function helper() {}\n',
      ],
      ['src/b.js', "import { used } from './a.js';\nconsole.log(used);\n"],
    ]),
  );
  assert.deepEqual(unusedNames(results).sort(), ['helper', 'unused']);
});

test('namespace and bare dynamic imports mark every export used', async () => {
  const source = 'export const one = 1;\nexport const two = 2;\n';
  const viaNamespace = await analyze(
    new Map([
      ['src/a.js', source],
      ['src/b.js', "import * as ns from './a.js';\nconsole.log(ns);\n"],
    ]),
  );
  assert.deepEqual(unusedNames(viaNamespace), []);
  const viaDynamic = await analyze(
    new Map([
      ['src/a.js', source],
      ['src/b.js', "await import('./a.js');\n"],
    ]),
  );
  assert.deepEqual(unusedNames(viaDynamic), []);
});

test('side-effect imports do not count as named usage', async () => {
  const results = await analyze(
    new Map([
      ['src/a.js', 'export const only = 1;\n'],
      ['src/b.js', "import './a.js';\n"],
    ]),
  );
  assert.deepEqual(unusedNames(results), ['only']);
});

test('self-imports do not count', async () => {
  const results = await analyze(
    new Map([
      [
        'src/a.js',
        "import { only } from './a.js';\nexport const only = 1;\nconsole.log(only);\n",
      ],
    ]),
  );
  assert.deepEqual(unusedNames(results), ['only']);
});

test('star re-exports shield their target, named re-exports count', async () => {
  const results = await analyze(
    new Map([
      ['src/a.js', 'export const one = 1;\nexport const two = 2;\n'],
      ['src/barrel.js', "export * from './a.js';\n"],
      ['src/c.js', "export { one } from './a.js';\n"],
      ['src/d.js', "import { one } from './c.js';\nconsole.log(one);\n"],
    ]),
  );
  // `one` is used via the named re-export chain (d <- c <- a);
  // `two` via the star re-export (barrel <- a).
  assert.deepEqual(unusedNames(results), []);
  const starOnly = await analyze(
    new Map([
      ['src/a.js', 'export const one = 1;\n'],
      ['src/barrel.js', "export * from './a.js';\n"],
    ]),
  );
  assert.deepEqual(unusedNames(starOnly), []);
});

test('test-only usage is used, not unused', async () => {
  const results = await analyze(
    new Map([
      ['src/a.js', 'export const checked = 1;\nexport const free = 2;\n'],
      ['src/a.test.mjs', "import { checked } from './a.js';\n"],
    ]),
  );
  assert.deepEqual(unusedNames(results), ['free']);
  const summary = summarizeResults(results, {
    unused: findUnused(results),
  });
  assert.equal(summary.testOnly, 1);
  assert.equal(summary.unused, 1);
});

test('test files export nothing reportable but count as importers', async () => {
  const results = await analyze(
    new Map([
      ['src/a.test.mjs', 'export const helper = 1;\n'],
      ['src/b.test.mjs', "import { helper } from './a.test.mjs';\n"],
    ]),
  );
  assert.deepEqual(unusedNames(results), []);
  assert.equal(results.filter((result) => result.exports.length > 0).length, 0);
});

test('public-API exports are excluded unless includePublic is set', async () => {
  const options = { publicFiles: new Set(['src/a.js']) };
  const results = await analyze(
    new Map([['src/a.js', 'export const pub = 1;\n']]),
    options,
  );
  assert.deepEqual(unusedNames(results), []);
  assert.deepEqual(
    findUnused(results, { includePublic: true }).map((entry) => entry.name),
    ['pub'],
  );
  assert.equal(findUnused(results, { includePublic: true })[0].public, true);
  const summary = summarizeResults(results, { unused: findUnused(results) });
  assert.equal(summary.public, 1);
  assert.equal(summary.publicUnused, 1);
});

test('package self-references resolve through package.json exports', async () => {
  const results = await analyze(
    new Map([
      ['src/a.js', 'export const used = 1;\nexport const spare = 2;\n'],
      [
        'src/b.js',
        "import { used } from 'gods-eye-view/a';\nconsole.log(used);\n",
      ],
    ]),
    {
      packageName: 'gods-eye-view',
      packageExports: { './a': './src/a.js' },
    },
  );
  assert.deepEqual(unusedNames(results), ['spare']);
});

test('external and unresolvable imports are ignored', async () => {
  const results = await analyze(
    new Map([
      ['src/a.js', 'export const only = 1;\n'],
      [
        'src/b.js',
        "import x from 'some-external-pkg';\nimport { y } from './missing.js';\n",
      ],
    ]),
  );
  assert.deepEqual(unusedNames(results), ['only']);
});

test('default exports match default imports and default re-exports', async () => {
  const results = await analyze(
    new Map([
      ['src/a.js', 'export default function main() {}\n'],
      ['src/b.js', "import main from './a.js';\nconsole.log(main);\n"],
      ['src/c.js', "export { default } from './a.js';\n"],
      ['src/d.js', "import def from './c.js';\nconsole.log(def);\n"],
    ]),
  );
  assert.deepEqual(unusedNames(results), []);
});

test('resolveSpecifier handles extensions, index files, and bare names', () => {
  const fileSet = new Set(['src/a.js', 'src/dir/index.js', 'src/dir/b.ts']);
  assert.equal(resolveSpecifier('src/x.js', './a', { fileSet }), 'src/a.js');
  assert.equal(
    resolveSpecifier('src/x.js', './dir', { fileSet }),
    'src/dir/index.js',
  );
  assert.equal(
    resolveSpecifier('src/x.js', './dir/b.js', { fileSet }),
    'src/dir/b.ts',
  );
  assert.equal(resolveSpecifier('src/x.js', 'node:fs', { fileSet }), null);
  assert.equal(resolveSpecifier('src/x.js', 'react', { fileSet }), null);
  assert.equal(resolveSpecifier('src/x.js', './missing', { fileSet }), null);
});

test('publicFilesFromExports reads string and node-condition targets', () => {
  assert.deepEqual(
    [
      ...publicFilesFromExports({
        './a': './src/a.js',
        './b': { node: './build/b.js' },
        './c': { default: './src/c.js' },
      }),
    ].sort(),
    ['build/b.js', 'src/a.js', 'src/c.js'],
  );
});

test('discoverSourceFiles walks scan roots plus root files only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'unused-export-'));
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
  await mkdir(path.join(root, 'wt-idea-other', 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await writeFile(
    path.join(root, 'src', 'nested', 'b.mjs'),
    'export const b = 1;\n',
  );
  await writeFile(path.join(root, 'scripts', 'c.mjs'), '');
  await writeFile(path.join(root, 'node_modules', 'dep', 'x.js'), '');
  await writeFile(path.join(root, 'wt-idea-other', 'src', 'leak.js'), '');
  await writeFile(path.join(root, 'src', 'notes.txt'), '');
  await writeFile(path.join(root, 'vite.config.js'), '');
  const found = await discoverSourceFiles(root);
  assert.deepEqual(found, [
    'scripts/c.mjs',
    'src/a.js',
    'src/nested/b.mjs',
    'vite.config.js',
  ]);
});

test('groupByFile ranks by count desc then file asc, limit caps', () => {
  const unused = [
    { file: 'src/b.js', name: 'one', kind: 'variable', line: 1 },
    { file: 'src/a.js', name: 'two', kind: 'variable', line: 1 },
    { file: 'src/a.js', name: 'three', kind: 'variable', line: 2 },
  ];
  const groups = groupByFile(unused);
  assert.deepEqual(
    groups.map((group) => group.file),
    ['src/a.js', 'src/b.js'],
  );
  assert.equal(groups[0].unusedCount, 2);
  assert.deepEqual(
    limitFindings(groups, 1).map((g) => g.file),
    ['src/a.js'],
  );
  assert.equal(limitFindings(groups, 0).length, 2);
  assert.deepEqual(
    filterByFiles(unused, ['src/b.js']).map((entry) => entry.name),
    ['one'],
  );
  assert.equal(filterByFiles(unused, []).length, 3);
});

test('formatUnusedExportReport renders summary and ranked files', async () => {
  const results = await analyze(
    new Map([
      ['src/a.js', 'export const used = 1;\nexport const stale = 2;\n'],
      ['src/b.js', "import { used } from './a.js';\n"],
    ]),
  );
  const unused = findUnused(results);
  const summary = summarizeResults(results, { unused });
  const groups = groupByFile(unused);
  const report = formatUnusedExportReport(
    { summary, ranked: limitFindings(groups, DEFAULT_LIMIT) },
    DEFAULT_LIMIT,
  );
  assert.match(report, /exports: 2 · unused: 1/);
  assert.match(report, /src\/a\.js — 1 unused/);
  assert.match(report, /stale \(variable, line 2\)/);
  const empty = formatUnusedExportReport(
    {
      summary: { ...summary, unused: 0 },
      ranked: [],
    },
    DEFAULT_LIMIT,
  );
  assert.match(empty, /No unused exports found\./);
});

test('isTestFile recognises test, spec, tests dir, and testSupport', () => {
  assert.equal(isTestFile('src/a.test.mjs'), true);
  assert.equal(isTestFile('tests/smoke.spec.mjs'), true);
  assert.equal(isTestFile('src/testSupport/helper.js'), true);
  assert.equal(isTestFile('src/a.js'), false);
});

test('parseCliArgs handles flags, files, and errors', () => {
  assert.deepEqual(parseCliArgs([]), {
    json: false,
    limit: DEFAULT_LIMIT,
    includePublic: false,
    files: [],
    help: false,
    error: null,
  });
  const parsed = parseCliArgs([
    '--json',
    '--limit',
    '3',
    '--include-public',
    'src/a.js',
  ]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.limit, 3);
  assert.equal(parsed.includePublic, true);
  assert.deepEqual(parsed.files, ['src/a.js']);
  assert.equal(parseCliArgs(['--limit=0']).limit, 0);
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.match(parseCliArgs(['--limit', 'x']).error, /non-negative integer/);
  assert.match(parseCliArgs(['--limit']).error, /non-negative integer/);
  assert.match(parseCliArgs(['--bogus']).error, /unknown flag/);
});
