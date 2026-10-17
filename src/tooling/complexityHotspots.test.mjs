import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMIT,
  STRICT_MAX_DEPTH,
  analyzeFiles,
  analyzeSource,
  blankCommentsAndStrings,
  countTodos,
  filterHotspotsByFiles,
  formatComplexityReport,
  limitHotspots,
  parseCliArgs,
  rankHotspots,
  summarizeResults,
} from './complexityHotspots.js';

test('blankCommentsAndStrings hides comments, strings, and template text', () => {
  const source = [
    '// if (x) { while (true) {} }',
    'const s = "if for while";',
    'const t = `if ${real} for`;',
    '/* case catch */',
    'if (real) {}',
  ].join('\n');
  const { code, comments } = blankCommentsAndStrings(source);
  assert.match(comments, /if \(x\)/);
  assert.match(comments, /case catch/);
  assert.doesNotMatch(code, /while \(true\)/);
  assert.doesNotMatch(code, /"if for while"/);
  assert.doesNotMatch(code, /`if /);
  assert.match(code, /if \(real\)/);
  assert.match(code, /real/);
});

test('countTodos counts markers in comments only', () => {
  assert.equal(countTodos('// TODO one\n/* FIXME two, HACK three */'), 3);
  assert.equal(countTodos('// todo lowercase counts too'), 1);
  assert.equal(countTodos('no markers here'), 0);
});

test('analyzeSource profiles an empty file as all zeros', () => {
  const profile = analyzeSource('', 'src/empty.js');
  assert.deepEqual(profile, {
    file: 'src/empty.js',
    lines: 0,
    codeLines: 0,
    functionCount: 0,
    branchCount: 0,
    complexity: 1,
    maxDepth: 0,
    longestFunctionLines: 0,
    todoCount: 0,
    hotspotScore: 1,
  });
});

test('analyzeSource counts functions, branches, and code lines', () => {
  const source = [
    'export function outer(a) {',
    '  if (a) {',
    '    return 1;',
    '  }',
    '  const inner = (b) => (b ? 2 : 3);',
    '  return inner(a);',
    '}',
    '',
  ].join('\n');
  const profile = analyzeSource(source, 'src/sample.js');
  assert.equal(profile.lines, 7);
  assert.equal(profile.codeLines, 7);
  assert.equal(profile.functionCount, 2);
  // if + ternary = 2 branches.
  assert.equal(profile.branchCount, 2);
  assert.equal(profile.complexity, 3);
  assert.equal(profile.maxDepth, 1);
  assert.equal(profile.longestFunctionLines, 7);
  assert.equal(profile.todoCount, 0);
  // 3 + 2*1 + ceil(7/25)=1 + 0 = 6.
  assert.equal(profile.hotspotScore, 6);
});

test('analyzeSource ignores branches inside strings and comments', () => {
  const source = [
    '// if for while case catch',
    'const s = "if for while ? && ||";',
    'function f() { return 1; }',
  ].join('\n');
  const profile = analyzeSource(source, 'src/clean.js');
  assert.equal(profile.branchCount, 0);
  assert.equal(profile.complexity, 1);
  assert.equal(profile.functionCount, 1);
});

test('analyzeSource counts logical and nullish operators, not optional chaining', () => {
  const source = [
    'function f(a, b) {',
    '  const x = a && b || a ?? b;',
    '  const y = a?.b;',
    '  return x ?? y;',
    '}',
  ].join('\n');
  const profile = analyzeSource(source, 'src/operators.js');
  // &&, ||, ??, ?? = 4 branches; `?.` is not a branch.
  assert.equal(profile.branchCount, 4);
  assert.equal(profile.complexity, 5);
});

test('analyzeSource measures nesting depth at branch sites', () => {
  const source = [
    'function f(a) {',
    '  if (a) {',
    '    while (a) {',
    '      if (a) {',
    '        return 1;',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const profile = analyzeSource(source, 'src/nested.js');
  assert.equal(profile.maxDepth, 3);
  assert.equal(profile.branchCount, 3);
});

test('analyzeSource measures the longest function body', () => {
  const source = [
    'function short() { return 1; }',
    'function long() {',
    '  const a = 1;',
    '  const b = 2;',
    '  const c = 3;',
    '  return a + b + c;',
    '}',
  ].join('\n');
  const profile = analyzeSource(source, 'src/lengths.js');
  assert.equal(profile.functionCount, 2);
  assert.equal(profile.longestFunctionLines, 6);
});

test('analyzeSource counts TODOs from comments, not strings', () => {
  const source = [
    '// TODO fix this',
    'const s = "TODO not a todo";',
    '/* FIXME later */ function f() {}',
  ].join('\n');
  const profile = analyzeSource(source, 'src/todos.js');
  assert.equal(profile.todoCount, 2);
});

test('analyzeSource scans template interpolations as code', () => {
  const source = 'const t = `value ${a ? 1 : 2} end`;';
  const profile = analyzeSource(source, 'src/template.js');
  assert.equal(profile.branchCount, 1);
});

test('analyzeFiles aggregates stats across files', async () => {
  const sources = new Map([
    ['src/a.js', 'function a() { if (x) { return 1; } }'],
    ['src/b.js', 'const b = 1;'],
  ]);
  const { results, stats } = await analyzeFiles([...sources.keys()], {
    readFile: (file) => Promise.resolve(sources.get(file)),
  });
  assert.equal(results.length, 2);
  assert.equal(stats.files, 2);
  assert.equal(stats.totalFunctions, 1);
  assert.equal(
    stats.totalComplexity,
    results[0].complexity + results[1].complexity,
  );
  assert.equal(stats.totalTodos, 0);
});

test('rankHotspots orders by score, then complexity, then longest function, then file', () => {
  const base = {
    lines: 10,
    codeLines: 9,
    functionCount: 1,
    branchCount: 1,
    complexity: 2,
    maxDepth: 0,
    longestFunctionLines: 5,
    todoCount: 0,
    hotspotScore: 5,
  };
  const ranked = rankHotspots([
    { ...base, file: 'src/z.js' },
    { ...base, file: 'src/a.js', hotspotScore: 9 },
    { ...base, file: 'src/m.js', hotspotScore: 5, complexity: 4 },
    { ...base, file: 'src/b.js', hotspotScore: 5, longestFunctionLines: 8 },
  ]);
  assert.deepEqual(
    ranked.map((profile) => profile.file),
    ['src/a.js', 'src/m.js', 'src/b.js', 'src/z.js'],
  );
});

test('filterHotspotsByFiles and limitHotspots narrow the list', () => {
  const profiles = [
    { file: 'src/a.js', hotspotScore: 3 },
    { file: 'src/b.js', hotspotScore: 2 },
    { file: 'src/c.js', hotspotScore: 1 },
  ];
  assert.deepEqual(
    filterHotspotsByFiles(profiles, ['src/b.js']).map((p) => p.file),
    ['src/b.js'],
  );
  assert.deepEqual(filterHotspotsByFiles(profiles, []), profiles);
  assert.deepEqual(
    limitHotspots(profiles, 2).map((p) => p.file),
    ['src/a.js', 'src/b.js'],
  );
  assert.equal(limitHotspots(profiles, 0).length, 3);
});

test('summarizeResults reports totals, top file, max score, and average', () => {
  const stats = {
    files: 2,
    totalLines: 30,
    totalCodeLines: 25,
    totalComplexity: 9,
    totalFunctions: 3,
    totalTodos: 1,
  };
  const summary = summarizeResults(stats, [
    {
      file: 'src/a.js',
      hotspotScore: 4,
      complexity: 3,
      longestFunctionLines: 5,
    },
    {
      file: 'src/b.js',
      hotspotScore: 7,
      complexity: 6,
      longestFunctionLines: 9,
    },
  ]);
  assert.equal(summary.hotspots, 2);
  assert.equal(summary.topFile, 'src/b.js');
  assert.equal(summary.maxScore, 7);
  assert.equal(summary.avgComplexity, 4.5);
});

test('summarizeResults handles zero files', () => {
  const summary = summarizeResults(
    {
      files: 0,
      totalLines: 0,
      totalCodeLines: 0,
      totalComplexity: 0,
      totalFunctions: 0,
      totalTodos: 0,
    },
    [],
  );
  assert.equal(summary.topFile, null);
  assert.equal(summary.maxScore, 0);
  assert.equal(summary.avgComplexity, 0);
});

test('formatComplexityReport renders the ranked table', () => {
  const report = formatComplexityReport(
    {
      stats: {
        files: 1,
        totalLines: 10,
        totalCodeLines: 9,
        totalComplexity: 3,
        totalFunctions: 1,
        totalTodos: 0,
      },
      hotspots: [
        {
          file: 'src/a.js',
          lines: 10,
          codeLines: 9,
          functionCount: 1,
          branchCount: 2,
          complexity: 3,
          maxDepth: 1,
          longestFunctionLines: 7,
          todoCount: 0,
          hotspotScore: 6,
        },
      ],
    },
    DEFAULT_LIMIT,
  );
  assert.match(report, /Complexity-hotspot scoreboard: 1 files/);
  assert.match(report, /src\/a\.js/);
  assert.match(report, /score/);
});

test('formatComplexityReport notes the truncation', () => {
  const profiles = [0, 1, 2].map((i) => ({
    file: `src/f${i}.js`,
    lines: 1,
    codeLines: 1,
    functionCount: 0,
    branchCount: 0,
    complexity: 1,
    maxDepth: 0,
    longestFunctionLines: 0,
    todoCount: 0,
    hotspotScore: 1,
  }));
  const report = formatComplexityReport(
    {
      stats: {
        files: 3,
        totalLines: 3,
        totalCodeLines: 3,
        totalComplexity: 3,
        totalFunctions: 0,
        totalTodos: 0,
      },
      hotspots: profiles,
    },
    2,
  );
  assert.match(report, /and 1 more file\(s\)/);
});

test('parseCliArgs accepts the documented flags', () => {
  const args = parseCliArgs(['--json', '--strict', '--limit', '3', 'src/a.js']);
  assert.equal(args.json, true);
  assert.equal(args.strict, true);
  assert.equal(args.limit, 3);
  assert.deepEqual(args.positional, ['src/a.js']);
  assert.equal(args.error, null);
  assert.equal(parseCliArgs(['--limit=0']).limit, 0);
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.equal(parseCliArgs(['-h']).help, true);
});

test('parseCliArgs rejects unknown options and bad limits', () => {
  assert.match(parseCliArgs(['--nope']).error, /unknown option/);
  assert.match(parseCliArgs(['--limit']).error, /requires a value/);
  assert.match(parseCliArgs(['--limit', '-1']).error, /non-negative integer/);
  assert.match(parseCliArgs(['--limit', 'x']).error, /non-negative integer/);
});

test('STRICT_MAX_DEPTH is the documented strict threshold', () => {
  assert.equal(STRICT_MAX_DEPTH, 6);
});
