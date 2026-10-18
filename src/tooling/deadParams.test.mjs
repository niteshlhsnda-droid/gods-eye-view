import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LIMIT,
  FINDING_CLASSES,
  STRICT_CLASSES,
  analyzeSource,
  filterFindingsByFiles,
  formatDeadParamsReport,
  limitFindings,
  lineAt,
  maskCode,
  matchBraces,
  matchParens,
  parseCliArgs,
  parsePattern,
  rankOffenders,
  splitTopLevel,
  summarizeResults,
} from '../../scripts/deadParams.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const CLI = path.join(ROOT, 'scripts', 'scoreboard-dead-params.mjs');

function classes(source) {
  return analyzeSource(source, 'src/a.js').map(
    (f) => `${f.fn}:${f.param}:${f.class}`,
  );
}

test('trailing dead params are dead-trailing, live params untouched', () => {
  assert.deepEqual(
    classes('function f(a, b, dead1, dead2) { return a + b; }'),
    ['f:dead1:dead-trailing', 'f:dead2:dead-trailing'],
  );
});

test('dead param before a live param is dead-positional', () => {
  assert.deepEqual(classes('function f(dead, live) { return live * 2; }'), [
    'f:dead:dead-positional',
  ]);
});

test('fully used function reports nothing', () => {
  assert.deepEqual(classes('function f(a, b) { return a + b; }'), []);
});

test('param read via another param default counts as read', () => {
  assert.deepEqual(classes('function f(a, b = a * 2) { return b; }'), []);
});

test('nested function rebinding the name still leaves the outer dead', () => {
  assert.deepEqual(classes('function f(a) { function g(a) { return a; } }'), [
    'f:a:dead-trailing',
  ]);
});

test('nested use of the outer param counts as a read', () => {
  assert.deepEqual(
    classes('function f(a) { return function g() { return a + 1; }; }'),
    [],
  );
});

test('arrows: expression body reads count; dead arrow params flagged', () => {
  assert.deepEqual(classes('const f = (x) => x + 1;'), []);
  assert.deepEqual(classes('const f = (p, q) => p;'), [
    '<anonymous>:q:dead-trailing',
  ]);
  assert.deepEqual(classes('const f = (x) => { return x; };'), []);
});

test('methods, class methods, and object methods are scanned', () => {
  assert.deepEqual(classes('class K { m(live, dead) { return live; } }'), [
    'm:dead:dead-trailing',
  ]);
  assert.deepEqual(classes('const o = { m(a, b) { return b; } };'), [
    'm:a:dead-positional',
  ]);
  assert.deepEqual(classes('function* g(a, b) { yield b; }'), [
    'g:a:dead-positional',
  ]);
});

test('property access and object keys are not reads; shorthand and ternary are', () => {
  assert.deepEqual(classes('function f(name) { return obj.name; }'), [
    'f:name:dead-trailing',
  ]);
  assert.deepEqual(classes('function f(name) { return {name: 1}; }'), [
    'f:name:dead-trailing',
  ]);
  assert.deepEqual(classes('function f(name) { return {name}; }'), []);
  assert.deepEqual(classes('function f(c, a, b) { return c ? a : b; }'), []);
});

test('strings, comments, and regex literals do not fake reads', () => {
  assert.deepEqual(classes('function f(a) { return "a"; /* a */ }'), [
    'f:a:dead-trailing',
  ]);
  assert.deepEqual(classes('function f(a) { return /a/.test("x"); }'), [
    'f:a:dead-trailing',
  ]);
});

test('template ${} expressions are real code and count as reads', () => {
  assert.deepEqual(classes('function f(name) { return `${name}!`; }'), []);
});

test('arguments object suppresses the whole function', () => {
  assert.deepEqual(classes('function f(a, b) { return arguments[0]; }'), []);
});

test('_-prefixed params are intentionally unused', () => {
  assert.deepEqual(classes('function f(_ignored, x) { return x; }'), []);
});

test('destructured params: each bound name judged separately', () => {
  assert.deepEqual(classes('function f({a, b}, [c, d]) { return a + c; }'), [
    'f:b:dead-positional',
    'f:d:dead-trailing',
  ]);
  assert.deepEqual(classes('function f({x: y}) { return y; }'), []);
  assert.deepEqual(classes('function f({x: y}) { return x; }'), [
    'f:y:dead-trailing',
  ]);
});

test('rest params follow the same read rules', () => {
  assert.deepEqual(classes('function f(a, ...rest) { return a; }'), [
    'f:rest:dead-trailing',
  ]);
  assert.deepEqual(classes('function f(a, ...rest) { return rest.length; }'), [
    'f:a:dead-positional',
  ]);
});

test('callback-style unused params in calls are still reported', () => {
  assert.deepEqual(classes('list.map((item, index) => item);'), [
    '<anonymous>:index:dead-trailing',
  ]);
});

test('spread reads count: (...args) => f(...args) is not dead', () => {
  assert.deepEqual(classes('const f = (...args) => this.g(...args);'), []);
  assert.deepEqual(classes('function f(a, b = [...a]) { return b; }'), []);
  // Optional chaining is still property access, not a read.
  assert.deepEqual(classes('function f(name) { return obj?.name; }'), [
    'f:name:dead-trailing',
  ]);
});

test('maskCode preserves newlines so line numbers stay aligned', () => {
  const source = 'function f(\n  a, // keep me\n  b\n) {\n  return a;\n}';
  const masked = maskCode(source);
  assert.equal(masked.split('\n').length, source.split('\n').length);
  const found = analyzeSource(source, 'src/a.js');
  assert.equal(found.length, 1);
  assert.equal(found[0].param, 'b');
  assert.equal(found[0].line, 3);
});

test('matchParens / matchBraces / lineAt / splitTopLevel behave', () => {
  assert.equal(matchParens('f(g(h))', 1), 6);
  assert.equal(matchParens('f(g(h)', 1), -1);
  assert.equal(matchBraces('a { b { c } } d', 2), 12);
  assert.equal(matchBraces('a { b', 2), -1);
  assert.equal(lineAt('a\nb\nc', 0), 1);
  assert.equal(lineAt('a\nb\nc', 4), 3);
  assert.deepEqual(splitTopLevel('a, f(b, c), [d]', ','), [
    'a',
    ' f(b, c)',
    ' [d]',
  ]);
});

test('parsePattern binds destructured names and records default reads', () => {
  assert.deepEqual(parsePattern('a'), { bound: ['a'], reads: [] });
  assert.deepEqual(parsePattern('a = 1'), { bound: ['a'], reads: [] });
  assert.deepEqual(parsePattern('a = b'), { bound: ['a'], reads: ['b'] });
  assert.deepEqual(parsePattern('...rest'), { bound: ['rest'], reads: [] });
  const d = parsePattern('{x, y: z}');
  assert.deepEqual(d.bound, ['x', 'z']);
  assert.deepEqual(parsePattern('[p, q = r]').bound, ['p', 'q']);
});

test('parseCliArgs handles flags and rejects bad input', () => {
  assert.deepEqual(parseCliArgs([]).files, []);
  assert.equal(parseCliArgs([]).limit, DEFAULT_LIMIT);
  assert.equal(parseCliArgs(['--json']).json, true);
  assert.equal(parseCliArgs(['--strict']).strict, true);
  assert.equal(parseCliArgs(['--limit', '5']).limit, 5);
  assert.equal(parseCliArgs(['--limit=0']).limit, 0);
  assert.ok(parseCliArgs(['--limit', '-1']).error);
  assert.ok(parseCliArgs(['--bogus']).error);
  assert.deepEqual(parseCliArgs(['src/a.js']).files, ['src/a.js']);
});

test('limitFindings / filterFindingsByFiles / summarizeResults / rankOffenders', () => {
  const results = [
    {
      file: 'src/a.js',
      functions: 2,
      findings: [
        { file: 'src/a.js', class: 'dead-trailing', param: 'x' },
        { file: 'src/a.js', class: 'dead-positional', param: 'y' },
      ],
    },
    { file: 'src/b.js', functions: 1, findings: [] },
  ];
  const summary = summarizeResults(results);
  assert.equal(summary.files, 2);
  assert.equal(summary.functions, 3);
  assert.equal(summary.findings, 2);
  assert.equal(summary.byClass['dead-trailing'], 1);
  assert.equal(summary.byClass['dead-positional'], 1);
  assert.equal(summary.filesWithFindings, 1);
  assert.deepEqual(rankOffenders(results), [{ file: 'src/a.js', findings: 2 }]);
  assert.equal(
    filterFindingsByFiles(
      results.flatMap((r) => r.findings),
      ['src/a.js'],
    ).length,
    2,
  );
  assert.equal(
    filterFindingsByFiles(
      results.flatMap((r) => r.findings),
      ['src/b.js'],
    ).length,
    0,
  );
  assert.equal(limitFindings([1, 2, 3], 2).length, 2);
  assert.equal(limitFindings([1, 2, 3], 0).length, 3);
  const report = formatDeadParamsReport(
    results,
    summary,
    rankOffenders(results),
    results[0].findings,
  );
  assert.ok(report.includes('Dead-parameter scoreboard'));
  assert.ok(report.includes('src/a.js'));
});

test('FINDING_CLASSES documents the class set; strict covers dead-trailing only', () => {
  assert.deepEqual(FINDING_CLASSES, ['dead-trailing', 'dead-positional']);
  assert.ok(STRICT_CLASSES.has('dead-trailing'));
  assert.ok(!STRICT_CLASSES.has('dead-positional'));
});

// Positive control: the real CLI, run against a temp tree with planted
// findings, must catch them in both human and JSON output.
test('real CLI catches planted dead params (positive control)', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gev-dead-params-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  const planted = path.join(dir, 'src', 'planted.js');
  await writeFile(
    planted,
    [
      'export function widget(name, color, unusedOpt) {',
      '  return `${name}:${color}`;',
      '}',
      'export function keeper(first, second) {',
      '  return first + second;',
      '}',
      '',
    ].join('\n'),
  );
  const json = execFileSync(process.execPath, [CLI, '--json', planted], {
    encoding: 'utf8',
  });
  const report = JSON.parse(json);
  assert.equal(report.summary.findings, 1);
  assert.equal(report.findings[0].param, 'unusedOpt');
  assert.equal(report.findings[0].class, 'dead-trailing');
  assert.equal(report.findings[0].line, 1);
  assert.equal(report.findings[0].fn, 'widget');

  const text = execFileSync(process.execPath, [CLI, planted], {
    encoding: 'utf8',
  });
  assert.ok(text.includes('Dead-parameter scoreboard'));
  assert.ok(text.includes('unusedOpt'));
  assert.ok(text.includes('dead-trailing'));
});

// The CLI is report-only by default (exit 0) and --strict fails on
// dead-trailing findings only.
test('real CLI exit codes: report-only default, strict on dead-trailing', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gev-dead-params-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  const trailing = path.join(dir, 'src', 'trailing.js');
  await writeFile(trailing, 'export function f(a, dead) { return a; }\n');
  const positional = path.join(dir, 'src', 'positional.js');
  await writeFile(positional, 'export function g(dead, a) { return a; }\n');

  // Default: exit 0 even with findings.
  execFileSync(process.execPath, [CLI, trailing], { encoding: 'utf8' });

  // --strict: dead-trailing fails...
  assert.throws(
    () => execFileSync(process.execPath, [CLI, '--strict', trailing]),
    (e) => e.status === 1,
  );
  // ...but dead-positional stays report-only.
  execFileSync(process.execPath, [CLI, '--strict', positional], {
    encoding: 'utf8',
  });
});
