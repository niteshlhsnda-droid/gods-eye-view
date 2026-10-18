import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeTestFile,
  analyzeTestFiles,
  ASYNC_GAP_KINDS,
  ASYNC_GAP_WEIGHTS,
  formatAsyncGapReport,
  parseCliArgs,
  rankAsyncGapFiles,
  scoreFindings,
  STRICT_KINDS,
  stripNestedFunctions,
  summarizeResults,
} from './testAsyncGap.js';
import { runAsyncGapScoreboard } from '../../scripts/scoreboard-test-async-gap.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (lines) => lines.join('\n');

function kindsOf(src) {
  return analyzeTestFile('sample.test.mjs', src).findings.map((f) => f.kind);
}

function countKind(src, kind) {
  return kindsOf(src).filter((k) => k === kind).length;
}

// --- no-await ---------------------------------------------------------------

test('no-await: flags an async callback with zero awaits', () => {
  const src = source([
    "import { test } from 'node:test';",
    "test('does work', async () => {",
    '  doSomethingSync();',
    '});',
  ]);
  assert.equal(countKind(src, 'no-await'), 1);
});

test('no-await: ignores a synchronous callback', () => {
  const src = source(["test('sync', () => {", '  doSomethingSync();', '});']);
  assert.deepEqual(kindsOf(src), []);
});

test('no-await: ignores an async callback that awaits', () => {
  const src = source([
    "test('async', async () => {",
    '  await doSomethingAsync();',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('no-await: ignores an async callback that returns a promise', () => {
  const src = source([
    "test('returns promise', async () => {",
    '  setup();',
    '  return doSomethingAsync();',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('no-await: ignores an async arrow with an expression body', () => {
  // Implicit return: the runner awaits the returned promise.
  const src = source(["test('expr', async () => doSomethingAsync());"]);
  assert.deepEqual(kindsOf(src), []);
});

test('no-await: await inside a nested function does not count for the outer callback', () => {
  const src = source([
    "test('nested', async () => {",
    '  helper(async () => {',
    '    await work();',
    '  });',
    '});',
  ]);
  assert.equal(countKind(src, 'no-await'), 1);
});

test('no-await: await inside a nested async arrow expression body does not count', () => {
  const src = source([
    "test('nested arrow', async () => {",
    '  items.forEach(async (item) => await save(item));',
    '});',
  ]);
  assert.equal(countKind(src, 'no-await'), 1);
});

test('no-await: finding text names the test', () => {
  const src = source([
    "test('my special test', async () => {",
    '  doSomethingSync();',
    '});',
  ]);
  const finding = analyzeTestFile('sample.test.mjs', src).findings[0];
  assert.equal(finding.kind, 'no-await');
  assert.match(finding.text, /my special test/);
});

test('no-await: it() callbacks are scanned too', () => {
  const src = source([
    "it('works', async () => {",
    '  doSomethingSync();',
    '});',
  ]);
  assert.equal(countKind(src, 'no-await'), 1);
});

test('no-await: t.test() subtests are not treated as registrations', () => {
  const src = source([
    "test('outer', async (t) => {",
    "  t.test('inner', () => {",
    '    doSomethingSync();',
    '  });',
    "  await t.test('second', async () => {",
    '    await work();',
    '  });',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('no-await: async function-expression callbacks are scanned', () => {
  const src = source([
    "test('fn', async function (t) {",
    '  t.diagnostic("hi");',
    '});',
  ]);
  assert.equal(countKind(src, 'no-await'), 1);
});

// --- fire-and-forget ---------------------------------------------------------

test('fire-and-forget: flags a bare fetch() statement', () => {
  const src = source([
    "test('x', async () => {",
    "  fetch('https://example.test/ping');",
    '  await setup();',
    '});',
  ]);
  assert.equal(countKind(src, 'fire-and-forget'), 1);
});

test('fire-and-forget: flags a *Async callee', () => {
  const src = source([
    "test('x', async () => {",
    '  loadDataAsync();',
    '  await setup();',
    '});',
  ]);
  assert.equal(countKind(src, 'fire-and-forget'), 1);
});

test('fire-and-forget: flags a bare new Promise() statement', () => {
  const src = source([
    "test('x', async () => {",
    '  new Promise((resolve) => setTimeout(resolve, 10));',
    '  await setup();',
    '});',
  ]);
  assert.equal(countKind(src, 'fire-and-forget'), 1);
});

test('fire-and-forget: flags a bare Promise.all() statement', () => {
  const src = source([
    "test('x', async () => {",
    '  Promise.all([a(), b()]);',
    '  await setup();',
    '});',
  ]);
  assert.equal(countKind(src, 'fire-and-forget'), 1);
});

test('fire-and-forget: ignores an awaited promise call', () => {
  const src = source([
    "test('x', async () => {",
    "  await fetch('https://example.test/ping');",
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('fire-and-forget: ignores a returned promise call', () => {
  const src = source([
    "test('x', async () => {",
    "  return fetch('https://example.test/ping');",
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('fire-and-forget: ignores a void-marked intentional float', () => {
  const src = source([
    "test('x', async () => {",
    "  void fetch('https://example.test/ping');",
    '  await setup();',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('fire-and-forget: ignores a .catch-handled chain', () => {
  const src = source([
    "test('x', async () => {",
    "  fetch('https://example.test/ping').catch(() => {});",
    '  await setup();',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('fire-and-forget: ignores Promise.resolve / Promise.reject (not in the all/race/allSettled/any set)', () => {
  const src = source([
    "test('x', async () => {",
    '  Promise.resolve();',
    '  await setup();',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('fire-and-forget: ignores an assigned promise (may be awaited later)', () => {
  const src = source([
    "test('x', async () => {",
    "  const pending = fetch('https://example.test/ping');",
    '  await pending;',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

// --- unhandled-then -----------------------------------------------------------

test('unhandled-then: flags a .then chain with no catch', () => {
  const src = source([
    "test('x', async () => {",
    '  await setup();',
    '  getData().then((rows) => rows.length);',
    '});',
  ]);
  assert.equal(countKind(src, 'unhandled-then'), 1);
});

test('unhandled-then: ignores a .then chain with .catch', () => {
  const src = source([
    "test('x', async () => {",
    '  await setup();',
    '  getData().then((rows) => rows.length).catch(() => []);',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('unhandled-then: ignores an awaited .then chain', () => {
  const src = source([
    "test('x', async () => {",
    '  const n = await getData().then((rows) => rows.length);',
    '  assert.equal(n, 2);',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('unhandled-then: ignores a returned .then chain', () => {
  const src = source([
    "test('x', () => {",
    '  setup();',
    '  return getData().then((rows) => rows.length);',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('unhandled-then: ignores an assigned chain (may be awaited later)', () => {
  const src = source([
    "test('x', async () => {",
    '  const pending = getData().then((rows) => rows.length);',
    '  assert.equal(await pending, 2);',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('unhandled-then: two-argument .then(onFulfilled, onRejected) counts as handled', () => {
  const src = source([
    "test('x', async () => {",
    '  await setup();',
    '  getData().then((rows) => rows.length, () => 0);',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

// --- async-executor ------------------------------------------------------------

test('async-executor: flags new Promise(async ...)', () => {
  const src = source([
    "test('x', async () => {",
    '  await new Promise(async (resolve) => {',
    '    resolve(await loadValue());',
    '  });',
    '});',
  ]);
  assert.equal(countKind(src, 'async-executor'), 1);
});

test('async-executor: ignores a synchronous executor', () => {
  const src = source([
    "test('x', async () => {",
    '  await new Promise((resolve) => {',
    '    resolve(1);',
    '  });',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

// --- masking ------------------------------------------------------------------

test('masking: patterns in comments and strings are not findings', () => {
  const src = source([
    "test('x', async () => {",
    '  // fetch("https://example.test"); looks like a float but is a comment',
    '  const label = "new Promise(async (r) => r())";',
    '  await setup();',
    '});',
  ]);
  assert.deepEqual(kindsOf(src), []);
});

test('stripNestedFunctions: blanks nested bodies but keeps newlines', () => {
  const body = '{\n  helper(async () => {\n    await work();\n  });\n}';
  const stripped = stripNestedFunctions(body);
  assert.equal(stripped.split('\n').length, body.split('\n').length);
  assert.doesNotMatch(stripped, /await/);
});

// --- positive control -----------------------------------------------------------

test('positive control: the planted fixture yields all four kinds', async () => {
  const fixture = path.join(
    here,
    '..',
    '..',
    'scripts',
    'scoreboard-samples',
    'async-gap-positive.test.mjs',
  );
  const src = await readFile(fixture, 'utf8');
  const kinds = new Set(kindsOf(src));
  for (const kind of ASYNC_GAP_KINDS) {
    assert.ok(kinds.has(kind), `positive control must include ${kind}`);
  }
});

// --- scoring / ranking / reporting ----------------------------------------------

test('scoreFindings: weights sum per kind', () => {
  const { counts, score } = scoreFindings([
    { kind: 'no-await' },
    { kind: 'fire-and-forget' },
    { kind: 'fire-and-forget' },
  ]);
  assert.equal(counts['no-await'], 1);
  assert.equal(counts['fire-and-forget'], 2);
  assert.equal(
    score,
    ASYNC_GAP_WEIGHTS['no-await'] + 2 * ASYNC_GAP_WEIGHTS['fire-and-forget'],
  );
});

test('rankAsyncGapFiles: orders by score descending, drops clean files', () => {
  const ranked = rankAsyncGapFiles([
    { file: 'b.test.mjs', score: 2, findings: [{}, {}] },
    { file: 'a.test.mjs', score: 7, findings: [{}] },
    { file: 'c.test.mjs', score: 0, findings: [] },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.file),
    ['a.test.mjs', 'b.test.mjs'],
  );
});

test('summarizeResults: counts files, findings, and per-kind totals', () => {
  const summary = summarizeResults([
    {
      file: 'a.test.mjs',
      findings: [{ kind: 'no-await' }, { kind: 'no-await' }],
    },
    { file: 'b.test.mjs', findings: [] },
  ]);
  assert.equal(summary.files, 2);
  assert.equal(summary.filesWithFindings, 1);
  assert.equal(summary.findings, 2);
  assert.equal(summary.findingsByKind['no-await'], 2);
  assert.equal(summary.findingsByKind['fire-and-forget'], 0);
});

test('formatAsyncGapReport: names files, scores, and kinds', () => {
  const report = formatAsyncGapReport(
    analyzeTestFiles(
      new Map([
        [
          'a.test.mjs',
          source(["test('x', async () => {", '  doSomethingSync();', '});']),
        ],
      ]),
    ),
  );
  assert.match(report, /a\.test\.mjs/);
  assert.match(report, /no-await/);
});

test('formatAsyncGapReport: clean run reports no findings', () => {
  const report = formatAsyncGapReport([
    { file: 'a.test.mjs', findings: [], counts: {}, score: 0 },
  ]);
  assert.match(report, /No async-gap findings/);
});

// --- CLI ------------------------------------------------------------------------

test('parseCliArgs: parses flags and positional files', () => {
  const args = parseCliArgs([
    '--json',
    '--strict',
    '--limit',
    '5',
    'a.test.mjs',
  ]);
  assert.equal(args.json, true);
  assert.equal(args.strict, true);
  assert.equal(args.limit, 5);
  assert.deepEqual(args.positional, ['a.test.mjs']);
  assert.equal(args.error, null);
});

test('parseCliArgs: rejects bad --limit and unknown flags', () => {
  assert.match(parseCliArgs(['--limit', '-1']).error, /--limit/);
  assert.match(parseCliArgs(['--limit']).error, /--limit/);
  assert.match(parseCliArgs(['--nope']).error, /unknown flag/);
});

test('STRICT_KINDS: only fire-and-forget fails --strict', () => {
  assert.deepEqual([...STRICT_KINDS], ['fire-and-forget']);
});

async function captureStdout(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    const code = await fn();
    return { code, output: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

test('runAsyncGapScoreboard: --json on the positive control exits 0 with all four kinds', async () => {
  const fixture = path.join(
    here,
    '..',
    '..',
    'scripts',
    'scoreboard-samples',
    'async-gap-positive.test.mjs',
  );
  const { code, output } = await captureStdout(() =>
    runAsyncGapScoreboard(process.cwd(), [
      'node',
      'scoreboard',
      '--json',
      fixture,
    ]),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.summary.findings, 4);
  const kinds = new Set(parsed.files[0].findings.map((f) => f.kind));
  assert.deepEqual([...kinds].sort(), [...ASYNC_GAP_KINDS].sort());
});

test('runAsyncGapScoreboard: --strict fails on the positive control (fire-and-forget)', async () => {
  const fixture = path.join(
    here,
    '..',
    '..',
    'scripts',
    'scoreboard-samples',
    'async-gap-positive.test.mjs',
  );
  const errors = [];
  const original = console.error;
  console.error = (...parts) => errors.push(parts.join(' '));
  try {
    const { code } = await captureStdout(() =>
      runAsyncGapScoreboard(process.cwd(), [
        'node',
        'scoreboard',
        '--strict',
        fixture,
      ]),
    );
    assert.equal(code, 1);
  } finally {
    console.error = original;
  }
});

test('runAsyncGapScoreboard: --strict passes on a clean file', async () => {
  const { code } = await captureStdout(() =>
    runAsyncGapScoreboard(process.cwd(), [
      'node',
      'scoreboard',
      '--strict',
      path.join(here, 'testAsyncGap.test.mjs'),
    ]),
  );
  assert.equal(code, 0);
});

test('runAsyncGapScoreboard: --help exits 0', async () => {
  const { code, output } = await captureStdout(() =>
    runAsyncGapScoreboard(process.cwd(), ['node', 'scoreboard', '--help']),
  );
  assert.equal(code, 0);
  assert.match(output, /Usage/);
});
