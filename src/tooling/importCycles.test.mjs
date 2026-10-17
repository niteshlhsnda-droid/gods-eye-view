// Tests for the import-cycle scoreboard (report-only static audit).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  analyzeFiles,
  discoverSourceFiles,
  extractRelativeImports,
  filterCyclesByFiles,
  findCycles,
  formatImportCyclesReport,
  limitCycles,
  parseCliArgs,
  rankCycles,
  resolveImport,
  scanSource,
  summarizeResults,
} from './importCycles.js';

// Build an in-memory filesystem: `files` maps path -> source. Returns
// the `readFile` / `hasFile` pair analyzeFiles expects.
function memoryFs(files) {
  const store = new Map(Object.entries(files));
  return {
    readFile: async (file) => {
      if (!store.has(file)) throw new Error(`no such file: ${file}`);
      return store.get(file);
    },
    hasFile: (file) => store.has(file),
  };
}

function graphOf(entries) {
  return new Map(
    Object.entries(entries).map(([file, targets]) => [file, new Set(targets)]),
  );
}

// Every consecutive pair of a reported path must be a real graph edge,
// and the path must close on its start node.
function assertValidCyclePath(graph, cycle) {
  const { path: cyclePath } = cycle;
  assert.ok(cyclePath.length >= 2, 'path closes a loop');
  assert.equal(cyclePath[0], cyclePath[cyclePath.length - 1]);
  for (let i = 0; i < cyclePath.length - 1; i += 1) {
    assert.ok(
      (graph.get(cyclePath[i]) ?? new Set()).has(cyclePath[i + 1]),
      `${cyclePath[i]} -> ${cyclePath[i + 1]} must be an edge`,
    );
  }
  for (const member of cyclePath) {
    assert.ok(cycle.members.includes(member), `${member} must be a member`);
  }
}

test('extractRelativeImports covers static, side-effect, re-export, dynamic', () => {
  const specs = extractRelativeImports(`
    import def, { a, b as c } from './def.js';
    import * as ns from './ns.mjs';
    import './side-effect.js';
    export { x } from './re.js';
    export * from './star.js';
    export * as all from './star-ns.js';
    const lazy = await import('./lazy.js');
    import data from './data.json';
  `);
  assert.deepEqual(specs, [
    './def.js',
    './ns.mjs',
    './side-effect.js',
    './data.json',
    './re.js',
    './star.js',
    './star-ns.js',
    './lazy.js',
  ]);
});

test('extractRelativeImports ignores bare, node:, and import.meta', () => {
  const specs = extractRelativeImports(`
    import React from 'react';
    import fs from 'node:fs';
    const url = import.meta.url;
    const lazy = await import('some-package');
  `);
  assert.deepEqual(specs, []);
});

test('extractRelativeImports ignores comments, strings, regexes, template text', () => {
  const specs = extractRelativeImports(`
    // import gone from './comment.js';
    /* export * from './block.js'; */
    const a = "import x from './string.js'";
    const b = 'export * from "./string2.js"';
    const re = /import y from '.\\/regex.js'/;
    const t = \`import z from './template.js'\`;
    import real from './real.js';
  `);
  assert.deepEqual(specs, ['./real.js']);
});

test('extractRelativeImports keeps a side-effect import before a re-export', () => {
  // The static-import pattern must not span the `;` into the next
  // statement and swallow the side-effect import.
  const specs = extractRelativeImports(
    `import './first.js'; export { x } from './second.js';`,
  );
  assert.deepEqual(specs, ['./first.js', './second.js']);
});

test('extractRelativeImports scans a dynamic import inside ${} interpolation', () => {
  const specs = extractRelativeImports(
    "const t = `prefix ${await import('./interp.js')} suffix`;",
  );
  assert.deepEqual(specs, ['./interp.js']);
});

test('extractRelativeImports tolerates a regex holding // and a later import', () => {
  // A `//` inside a regex literal must not start a line comment that
  // swallows the real import on the next line.
  const specs = extractRelativeImports(`
    const re = /^https?:\\/\\//;
    import after from './after.js';
  `);
  assert.deepEqual(specs, ['./after.js']);
});

test('extractRelativeImports tolerates division before an import', () => {
  const specs = extractRelativeImports(`
    const half = total / 2;
    import after from './after.js';
  `);
  assert.deepEqual(specs, ['./after.js']);
});

test('scanSource records string and regex spans for filtering', () => {
  const { stringSpans, regexSpans } = scanSource(
    `const s = 'hi'; const re = /x\\/y/g;`,
  );
  assert.equal(stringSpans.length, 1);
  assert.equal(regexSpans.length, 1);
});

test('resolveImport resolves exact, extensionless, and index candidates', () => {
  const hasFile = (file) =>
    new Set([
      'src/exact.js',
      'src/ext.js',
      'src/dir/index.mjs',
      'src/data.json',
    ]).has(file);
  assert.deepEqual(resolveImport('src/a.js', './exact.js', hasFile), {
    status: 'module',
    target: 'src/exact.js',
  });
  assert.deepEqual(resolveImport('src/a.js', './ext', hasFile), {
    status: 'module',
    target: 'src/ext.js',
  });
  assert.deepEqual(resolveImport('src/a.js', './dir', hasFile), {
    status: 'module',
    target: 'src/dir/index.mjs',
  });
  assert.deepEqual(resolveImport('src/a.js', './data.json', hasFile), {
    status: 'non-module',
    target: 'src/data.json',
  });
  assert.deepEqual(resolveImport('src/a.js', './missing.js', hasFile), {
    status: 'unresolved',
    target: null,
  });
  assert.deepEqual(resolveImport('src/a.js', 'react', hasFile), {
    status: 'external',
    target: null,
  });
});

test('findCycles returns no cycles for a diamond', () => {
  const graph = graphOf({
    'src/a.js': ['src/b.js', 'src/c.js'],
    'src/b.js': ['src/d.js'],
    'src/c.js': ['src/d.js'],
    'src/d.js': [],
  });
  assert.deepEqual(findCycles(graph), []);
});

test('findCycles reports a two-file cycle with a valid path', () => {
  const graph = graphOf({
    'src/a.js': ['src/b.js'],
    'src/b.js': ['src/a.js'],
    'src/c.js': [],
  });
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].members, ['src/a.js', 'src/b.js']);
  assert.equal(cycles[0].edges.length, 2);
  assertValidCyclePath(graph, cycles[0]);
});

test('findCycles reports a self-loop', () => {
  const graph = graphOf({ 'src/a.js': ['src/a.js'] });
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].members, ['src/a.js']);
  assert.deepEqual(cycles[0].path, ['src/a.js', 'src/a.js']);
});

test('findCycles reports a chorded cycle once with one concrete path', () => {
  const graph = graphOf({
    'src/a.js': ['src/b.js', 'src/c.js'],
    'src/b.js': ['src/a.js'],
    'src/c.js': ['src/a.js'],
  });
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].members, ['src/a.js', 'src/b.js', 'src/c.js']);
  assert.equal(cycles[0].edges.length, 4);
  assertValidCyclePath(graph, cycles[0]);
});

test('findCycles ranks by members, then edges, then first member', () => {
  const cycles = rankCycles([
    { members: ['a'], edges: [['a', 'a']], path: ['a', 'a'] },
    { members: ['b', 'c'], edges: [['b', 'c']], path: ['b', 'c', 'b'] },
    {
      members: ['d', 'e'],
      edges: [
        ['d', 'e'],
        ['e', 'd'],
      ],
      path: ['d', 'e', 'd'],
    },
  ]);
  assert.deepEqual(
    cycles.map((cycle) => cycle.members),
    [['d', 'e'], ['b', 'c'], ['a']],
  );
});

test('filterCyclesByFiles keeps only cycles touching a listed file', () => {
  const cycles = [
    { members: ['a', 'b'], edges: [], path: [] },
    { members: ['c', 'd'], edges: [], path: [] },
  ];
  assert.deepEqual(filterCyclesByFiles(cycles, []), cycles);
  assert.deepEqual(filterCyclesByFiles(cycles, ['b']), [cycles[0]]);
  assert.deepEqual(filterCyclesByFiles(cycles, ['zzz']), []);
});

test('analyzeFiles builds the graph and counts non-module and unresolved', async () => {
  const fs = memoryFs({
    'src/a.js': `import b from './b.js'; import data from './data.json';`,
    'src/b.js': `import a from './a.js'; import gone from './gone.js';`,
    'src/data.json': '{}',
  });
  const { graph, stats, nonModuleImports, unresolvedImports } =
    await analyzeFiles(['src/a.js', 'src/b.js'], fs);
  assert.deepEqual([...graph.get('src/a.js')], ['src/b.js']);
  assert.deepEqual([...graph.get('src/b.js')], ['src/a.js']);
  assert.deepEqual(stats, {
    files: 2,
    edges: 2,
    nonModule: 1,
    unresolved: 1,
  });
  assert.deepEqual(nonModuleImports, [
    { file: 'src/a.js', spec: './data.json', target: 'src/data.json' },
  ]);
  assert.deepEqual(unresolvedImports, [
    { file: 'src/b.js', spec: './gone.js' },
  ]);
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assertValidCyclePath(graph, cycles[0]);
});

test('summarizeResults counts distinct files in cycles', () => {
  const summary = summarizeResults(
    { files: 5, edges: 6, nonModule: 1, unresolved: 0 },
    [
      { members: ['a', 'b'], edges: [], path: [] },
      { members: ['b', 'c'], edges: [], path: [] },
    ],
  );
  assert.deepEqual(summary, {
    files: 5,
    edges: 6,
    nonModule: 1,
    unresolved: 0,
    cycles: 2,
    filesInCycles: 3,
  });
});

test('formatImportCyclesReport renders empty and cycle states', () => {
  const empty = formatImportCyclesReport(
    {
      stats: { files: 2, edges: 1, nonModule: 0, unresolved: 0 },
      cycles: [],
    },
    10,
  );
  assert.match(empty, /Import-cycle scoreboard: 2 files, 1 edges, 0 cycle/);
  assert.match(empty, /No import cycles found\./);

  const withCycle = formatImportCyclesReport(
    {
      stats: { files: 2, edges: 2, nonModule: 1, unresolved: 1 },
      cycles: [
        {
          members: ['src/a.js', 'src/b.js'],
          edges: [
            ['src/a.js', 'src/b.js'],
            ['src/b.js', 'src/a.js'],
          ],
          path: ['src/a.js', 'src/b.js', 'src/a.js'],
        },
      ],
      nonModuleImports: [
        { file: 'src/a.js', spec: './data.json', target: 'src/data.json' },
      ],
      unresolvedImports: [{ file: 'src/b.js', spec: './gone.js' }],
    },
    10,
  );
  assert.match(withCycle, /Cycle 1 \(2 files, 2 edges\):/);
  assert.match(withCycle, /src\/a\.js -> src\/b\.js -> src\/a\.js/);
  assert.match(withCycle, /Non-module imports \(1\):/);
  assert.match(withCycle, /Unresolved imports \(1\):/);
});

test('formatImportCyclesReport honors the limit and notes the remainder', () => {
  const cycles = [
    { members: ['a', 'b'], edges: [], path: ['a', 'b', 'a'] },
    { members: ['c', 'd'], edges: [], path: ['c', 'd', 'c'] },
  ];
  const report = formatImportCyclesReport(
    { stats: { files: 4, edges: 4, nonModule: 0, unresolved: 0 }, cycles },
    1,
  );
  assert.match(report, /Cycle 1/);
  assert.doesNotMatch(report, /Cycle 2/);
  assert.match(report, /\.\.\. and 1 more cycle\(s\)/);
  assert.deepEqual(limitCycles(cycles, 0), cycles);
  assert.deepEqual(limitCycles(cycles, 1), [cycles[0]]);
});

test('parseCliArgs parses flags, --limit=, and positionals', () => {
  assert.deepEqual(parseCliArgs([]), {
    json: false,
    limit: 10,
    strict: false,
    help: false,
    positional: [],
    error: null,
  });
  const parsed = parseCliArgs(['--json', '--strict', '--limit=3', 'src/a.js']);
  assert.equal(parsed.json, true);
  assert.equal(parsed.strict, true);
  assert.equal(parsed.limit, 3);
  assert.deepEqual(parsed.positional, ['src/a.js']);
  assert.equal(parseCliArgs(['--limit', '0']).limit, 0);
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.equal(parseCliArgs(['-h']).help, true);
});

test('parseCliArgs rejects unknown options and bad limits', () => {
  assert.match(parseCliArgs(['--bogus']).error, /unknown option/);
  assert.match(parseCliArgs(['--limit']).error, /requires a value/);
  assert.match(parseCliArgs(['--limit', '-1']).error, /non-negative/);
  assert.match(parseCliArgs(['--limit', 'x']).error, /non-negative/);
  assert.match(parseCliArgs(['--limit=1.5']).error, /non-negative/);
});

test('discoverSourceFiles finds js/mjs, skips tests and node_modules', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'import-cycles-'));
  try {
    await mkdir(path.join(root, 'src', 'sub'), { recursive: true });
    await mkdir(path.join(root, 'src', 'node_modules', 'dep'), {
      recursive: true,
    });
    await writeFile(path.join(root, 'src', 'a.js'), '');
    await writeFile(path.join(root, 'src', 'b.mjs'), '');
    await writeFile(path.join(root, 'src', 'c.test.mjs'), '');
    await writeFile(path.join(root, 'src', 'sub', 'd.js'), '');
    await writeFile(path.join(root, 'src', 'node_modules', 'dep', 'e.js'), '');
    assert.deepEqual(await discoverSourceFiles(root), [
      'src/a.js',
      'src/b.mjs',
      'src/sub/d.js',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
