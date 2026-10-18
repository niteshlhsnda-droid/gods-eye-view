import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LIMIT,
  FINDING_CLASSES,
  STRICT_CLASSES,
  analyzeFiles,
  analyzeSource,
  filterFindingsByFiles,
  formatNoOpPromiseReport,
  isNamedNoopHandler,
  limitFindings,
  parseCliArgs,
  rankOffenders,
  summarizeResults,
} from '../../scripts/noOpPromise.mjs';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'fixtures',
  'no-op-promise',
  'positive.js',
);

test('anonymous no-op rejection handlers are flagged (positive controls)', () => {
  const source = [
    'p.catch(() => {});', // 1
    'p.catch((e) => {});', // 2
    'p.catch(() => undefined);', // 3
    'p.catch(() => null);', // 4
    'p.catch(() => void 0);', // 5
    'p.catch(function () {});', // 6
    'p.catch();', // 7
    'p?.catch(async () => {});', // 8
    'p.then(ok, () => {});', // 9
    'p.then(ok, (e) => undefined);', // 10
  ].join('\n');
  const findings = analyzeSource(source, 'src/a.js');
  assert.equal(findings.length, 10);
  assert.ok(findings.every((f) => f.class === 'noop-catch-anonymous'));
  assert.ok(findings.every((f) => f.severity === 'error'));
  assert.deepEqual(
    findings.map((f) => f.line),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test('named no-op rejection handlers are flagged (positive controls)', () => {
  const source = [
    'p.catch(noop);', // 1
    'p.catch(NOOP);', // 2
    'p.catch(_noop);', // 3
    'p.catch(ignoreErrors);', // 4
    'p.catch(util.noop);', // 5
    'p.then(ok, noop);', // 6
    'p.then(ok, swallowError);', // 7
  ].join('\n');
  const findings = analyzeSource(source, 'src/a.js');
  assert.equal(findings.length, 7);
  assert.ok(findings.every((f) => f.class === 'noop-catch-named'));
  assert.deepEqual(
    findings.map((f) => f.line),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.match(findings[0].detail, /'noop'/);
  assert.match(findings[4].detail, /'util\.noop'/);
});

test('no-op fulfillment handlers are flagged (positive controls)', () => {
  const source = [
    'p.then(() => {});', // 1
    'p.then(() => undefined);', // 2
    'p.then(() => null);', // 3
    'p.then(noop);', // 4
    'p.then();', // 5
    'p?.then(async () => {});', // 6
  ].join('\n');
  const findings = analyzeSource(source, 'src/a.js');
  assert.equal(findings.length, 6);
  assert.ok(findings.every((f) => f.class === 'noop-then-fulfillment'));
  assert.deepEqual(
    findings.map((f) => f.line),
    [1, 2, 3, 4, 5, 6],
  );
  assert.match(findings[3].detail, /'noop'/);
});

test('real handlers are not flagged (negative controls)', () => {
  const source = [
    'p.catch((e) => console.error(e));',
    'p.catch(onError);',
    'p.catch(console.error);',
    'p.catch(logger.warn);',
    'p.catch(function () { retry(); });',
    'p.catch(() => { attempt++; });',
    'p.then(ok, (e) => report(e));',
    'p.then((value) => use(value));',
    'p.then(process);',
    'p.then(ok);',
    'p.then(f, g);',
    'p.catch(noop());',
    'p.catch(() => noop());',
  ].join('\n');
  assert.deepEqual(analyzeSource(source, 'src/a.js'), []);
});

test('handlers inside strings and comments are ignored', () => {
  const source = [
    'const s = "p.catch(() => {})";',
    '// p.catch(noop);',
    'const t = `p.then(() => {})`;',
    '/* p.catch(() => {}); */',
  ].join('\n');
  assert.deepEqual(analyzeSource(source, 'src/a.js'), []);
});

test('trailing comma with no rejection handler is not a finding', () => {
  assert.deepEqual(analyzeSource('p.then(ok,);', 'src/a.js'), []);
});

test('bare catch/try blocks are out of scope (error-swallowing territory)', () => {
  assert.deepEqual(analyzeSource('try { work(); } catch {}', 'src/a.js'), []);
});

test('isNamedNoopHandler unit cases', () => {
  for (const name of [
    'noop',
    'NOOP',
    '_noop',
    'noop1',
    'noopFn',
    'ignore',
    'ignoreError',
    'ignoreErrors',
    'ignoreErr',
    'swallow',
    'swallowError',
    'discard',
    'discarded',
    'util.noop',
    'this.ignoreErrors',
  ]) {
    assert.ok(isNamedNoopHandler(name), `expected noop: ${name}`);
  }
  for (const name of [
    'onError',
    'console.error',
    'logger.warn',
    'report',
    'handle',
    'handler',
    'noop2x',
    'myNoop',
    'ignored',
    '',
  ]) {
    assert.ok(!isNamedNoopHandler(name), `expected not noop: ${name}`);
  }
});

test('planted fixture yields exactly the documented findings', async () => {
  const source = await readFile(FIXTURE, 'utf8');
  const findings = analyzeSource(
    source,
    'scripts/fixtures/no-op-promise/positive.js',
  );
  assert.deepEqual(
    findings.map((f) => [f.class, f.line]),
    [
      ['noop-catch-anonymous', 18],
      ['noop-catch-anonymous', 19],
      ['noop-catch-named', 20],
      ['noop-then-fulfillment', 21],
      ['noop-catch-named', 22],
      ['noop-then-fulfillment', 23],
    ],
  );
});

test('combined controls: finds exactly the positives', () => {
  const source = [
    'async function demo() {', // 1
    '  load().catch(() => {});', // 2 -> noop-catch-anonymous
    '  load().catch(noop);', // 3 -> noop-catch-named
    '  load().then(() => {});', // 4 -> noop-then-fulfillment
    '  load().catch((e) => log(e));', // 5 -> negative control
    '  load().then(render, noop);', // 6 -> noop-catch-named
    '  load().then(noop, noop);', // 7 -> noop-then-fulfillment + noop-catch-named
    '}', // 8
  ].join('\n');
  const findings = analyzeSource(source, 'src/demo.js');
  assert.equal(findings.length, 6);
  assert.deepEqual(
    findings.map((f) => [f.class, f.line]),
    [
      ['noop-catch-anonymous', 2],
      ['noop-catch-named', 3],
      ['noop-then-fulfillment', 4],
      ['noop-catch-named', 6],
      ['noop-then-fulfillment', 7],
      ['noop-catch-named', 7],
    ],
  );
});

test('analyzeFiles aggregates counts by class with an injected reader', async () => {
  const sources = {
    'src/a.js': 'p.catch(() => {});',
    'src/b.js': 'p.catch(noop);',
    'src/c.js': 'p.then(() => {});',
    'src/d.js': 'p.catch((e) => log(e));',
  };
  const { findings, stats } = await analyzeFiles(Object.keys(sources), {
    readFile: async (file) => sources[file],
  });
  assert.equal(findings.length, 3);
  assert.equal(stats.files, 4);
  assert.equal(stats.totalFindings, 3);
  assert.equal(stats.filesWithFindings, 3);
  assert.deepEqual(stats.byClass, {
    'noop-catch-anonymous': 1,
    'noop-catch-named': 1,
    'noop-then-fulfillment': 1,
  });
  assert.deepEqual(
    Object.keys(stats.byClass).sort(),
    [...FINDING_CLASSES].sort(),
  );
});

test('every class is strict: --strict fails on any finding', () => {
  assert.deepEqual([...STRICT_CLASSES].sort(), [...FINDING_CLASSES].sort());
});

test('rankOffenders sorts by count desc then file asc', () => {
  const findings = [
    { file: 'src/b.js' },
    { file: 'src/a.js' },
    { file: 'src/b.js' },
    { file: 'src/c.js' },
  ];
  assert.deepEqual(rankOffenders(findings), [
    { file: 'src/b.js', count: 2 },
    { file: 'src/a.js', count: 1 },
    { file: 'src/c.js', count: 1 },
  ]);
});

test('filterFindingsByFiles keeps only wanted files', () => {
  const findings = [{ file: 'src/a.js' }, { file: 'src/b.js' }];
  assert.deepEqual(filterFindingsByFiles(findings, []), findings);
  assert.deepEqual(filterFindingsByFiles(findings, ['src/b.js']), [
    { file: 'src/b.js' },
  ]);
});

test('limitFindings caps, 0 means all', () => {
  assert.deepEqual(limitFindings([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(limitFindings([1, 2, 3], 0), [1, 2, 3]);
});

test('summarizeResults names the top offender', () => {
  const stats = {
    files: 2,
    totalFindings: 3,
    filesWithFindings: 2,
    byClass: { 'noop-catch-anonymous': 3 },
  };
  const findings = [
    { file: 'src/b.js' },
    { file: 'src/a.js' },
    { file: 'src/a.js' },
  ];
  const summary = summarizeResults(stats, findings);
  assert.equal(summary.topFile, 'src/a.js');
  assert.equal(summary.topFileCount, 2);
});

test('formatNoOpPromiseReport renders header and findings', () => {
  const findings = [
    {
      file: 'src/a.js',
      line: 4,
      class: 'noop-catch-named',
      severity: 'error',
      detail: "named no-op rejection handler 'noop' discards the error",
    },
  ];
  const report = formatNoOpPromiseReport(
    {
      stats: {
        files: 1,
        totalFindings: 1,
        filesWithFindings: 1,
        byClass: {
          'noop-catch-anonymous': 0,
          'noop-catch-named': 1,
          'noop-then-fulfillment': 0,
        },
      },
      findings,
    },
    DEFAULT_LIMIT,
  );
  assert.match(report, /No-op-promise scoreboard: 1 files scanned/);
  assert.match(report, /top offender: src\/a\.js \(1\)/);
  assert.match(report, /noop-catch-named\s+error\s+4\s+src\/a\.js/);
});

test('formatNoOpPromiseReport handles zero findings', () => {
  const report = formatNoOpPromiseReport(
    {
      stats: {
        files: 5,
        totalFindings: 0,
        filesWithFindings: 0,
        byClass: {
          'noop-catch-anonymous': 0,
          'noop-catch-named': 0,
          'noop-then-fulfillment': 0,
        },
      },
      findings: [],
    },
    DEFAULT_LIMIT,
  );
  assert.match(report, /No no-op promise handlers found\./);
});

test('parseCliArgs parses flags and rejects bad input', () => {
  const ok = parseCliArgs(['--json', '--strict', '--limit', '3', 'src/a.js']);
  assert.equal(ok.json, true);
  assert.equal(ok.strict, true);
  assert.equal(ok.limit, 3);
  assert.deepEqual(ok.positional, ['src/a.js']);
  assert.equal(ok.error, null);

  const eq = parseCliArgs(['--limit=0']);
  assert.equal(eq.limit, 0);

  assert.match(parseCliArgs(['--bogus']).error, /unknown option/);
  assert.match(parseCliArgs(['--limit', 'x']).error, /non-negative integer/);
  assert.match(parseCliArgs(['--limit']).error, /requires a value/);
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.equal(parseCliArgs([]).limit, DEFAULT_LIMIT);
});
