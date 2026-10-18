import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMIT,
  FINDING_CLASSES,
  STRICT_CLASSES,
  analyzeFiles,
  analyzeSource,
  filterFindingsByFiles,
  formatErrorSwallowingReport,
  isNoopHandler,
  limitFindings,
  lineAt,
  matchBraces,
  matchParens,
  parseCliArgs,
  rankOffenders,
  splitTopLevelArgs,
  summarizeResults,
} from '../../scripts/errorSwallowing.mjs';

test('finds empty catch blocks (bare and with param)', () => {
  const findings = analyzeSource(
    ['try { work(); } catch {}', 'try { work(); } catch (e) {}'].join('\n'),
    'src/a.js',
  );
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.class === 'empty-catch'));
  assert.ok(findings.every((f) => f.severity === 'error'));
  assert.deepEqual(
    findings.map((f) => f.line),
    [1, 2],
  );
});

test('comment-only catch body still counts as empty', () => {
  const findings = analyzeSource(
    'try { work(); } catch (e) { /* deliberately ignored */ }',
    'src/a.js',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].class, 'empty-catch');
});

test('catch that rethrows is not a finding (negative control)', () => {
  const findings = analyzeSource(
    'try { work(); } catch (e) { throw e; }',
    'src/a.js',
  );
  assert.deepEqual(findings, []);
});

test('catch that logs the error is not a finding (negative control)', () => {
  const findings = analyzeSource(
    'try { work(); } catch (e) { console.error("failed", e); }',
    'src/a.js',
  );
  assert.deepEqual(findings, []);
});

test('catch without a param but with statements is not a finding', () => {
  const findings = analyzeSource(
    'try { work(); } catch { cleanup(); }',
    'src/a.js',
  );
  assert.deepEqual(findings, []);
});

test('catch param never referenced is unused-catch-param', () => {
  const findings = analyzeSource(
    'try { work(); } catch (err) { retry(); }',
    'src/a.js',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].class, 'unused-catch-param');
  assert.match(findings[0].detail, /'err'/);
});

test('destructured catch param skips the unused check', () => {
  const findings = analyzeSource(
    'try { work(); } catch ({ message }) { retry(); }',
    'src/a.js',
  );
  assert.deepEqual(findings, []);
});

test('no-op promise rejection handlers are flagged', () => {
  const source = [
    'p.catch(() => {});', // 1
    'p.catch(() => undefined);', // 2
    'p.catch(() => null);', // 3
    'p.catch(function () {});', // 4
    'p.then(ok, () => {});', // 5
    'p.catch();', // 6
    'p?.catch(async () => {});', // 7
  ].join('\n');
  const findings = analyzeSource(source, 'src/a.js');
  assert.equal(findings.length, 7);
  assert.ok(findings.every((f) => f.class === 'noop-promise-catch'));
  assert.deepEqual(
    findings.map((f) => f.line),
    [1, 2, 3, 4, 5, 6, 7],
  );
});

test('real promise handlers are not flagged (negative controls)', () => {
  const source = [
    'p.catch((e) => console.error(e));',
    'p.catch(onError);',
    'p.catch(function () { log("x"); });',
    'p.then(ok, (e) => report(e));',
  ].join('\n');
  assert.deepEqual(analyzeSource(source, 'src/a.js'), []);
});

test('try-finally without catch is risky only when the body can throw', () => {
  const risky = analyzeSource(
    'try { await work(); } finally { cleanup(); }',
    'src/a.js',
  );
  assert.equal(risky.length, 1);
  assert.equal(risky[0].class, 'try-finally-no-catch');
  assert.equal(risky[0].severity, 'risky');
  assert.ok(!STRICT_CLASSES.has(risky[0].class));
});

test('try-finally with empty body or a catch is not flagged', () => {
  assert.deepEqual(analyzeSource('try {} finally {}', 'src/a.js'), []);
  assert.deepEqual(
    analyzeSource(
      'try { work(); } catch (e) { throw e; } finally { cleanup(); }',
      'src/a.js',
    ),
    [],
  );
});

test('catch inside strings and comments is ignored', () => {
  const source = [
    'const s = "catch {}";',
    '// catch (e) {}',
    'const t = `p.catch(() => {})`;',
    '/* try { x(); } catch {} */',
  ].join('\n');
  assert.deepEqual(analyzeSource(source, 'src/a.js'), []);
});

test('combined controls: finds exactly the positives', () => {
  const source = [
    'async function demo() {', // 1
    '  try {', // 2
    '    await work();', // 3
    '  } catch {', // 4 -> empty-catch
    '  }', // 5
    '  try {', // 6
    '    await work();', // 7
    '  } catch (err) {', // 8 -> unused-catch-param
    '    retry();', // 9
    '  }', // 10
    '  try {', // 11
    '    await work();', // 12
    '  } catch (e) {', // 13 -> negative control: rethrow
    '    throw e;', // 14
    '  }', // 15
    '  load().catch(() => {});', // 16 -> noop-promise-catch
    '  load().catch((e) => log(e));', // 17 -> negative control
    '  try {', // 18 -> try-finally-no-catch (risky)
    '    await work();', // 19
    '  } finally {', // 20
    '    cleanup();', // 21
    '  }', // 22
    '}', // 23
  ].join('\n');
  const findings = analyzeSource(source, 'src/demo.js');
  assert.equal(findings.length, 4);
  assert.deepEqual(
    findings.map((f) => [f.class, f.line]),
    [
      ['empty-catch', 4],
      ['unused-catch-param', 8],
      ['noop-promise-catch', 16],
      ['try-finally-no-catch', 18],
    ],
  );
  assert.deepEqual(
    findings.map((f) => f.file),
    ['src/demo.js', 'src/demo.js', 'src/demo.js', 'src/demo.js'],
  );
});

test('matchBraces / matchParens / lineAt behave', () => {
  const code = 'a { b { c } } d';
  assert.equal(matchBraces(code, 2), 12);
  assert.equal(matchBraces('a { b', 2), -1);
  assert.equal(matchParens('f(g(h))', 1), 6);
  assert.equal(matchParens('f(g(h)', 1), -1);
  assert.equal(lineAt('a\nb\nc', 0), 1);
  assert.equal(lineAt('a\nb\nc', 4), 3);
});

test('isNoopHandler unit cases', () => {
  assert.ok(isNoopHandler(''));
  assert.ok(isNoopHandler('() => {}'));
  assert.ok(isNoopHandler('async () => {}'));
  assert.ok(isNoopHandler('() => undefined'));
  assert.ok(isNoopHandler('() => null'));
  assert.ok(isNoopHandler('(e) => void 0'));
  assert.ok(isNoopHandler('function () {}'));
  assert.ok(isNoopHandler('function onFail() {}'));
  assert.ok(!isNoopHandler('() => log()'));
  assert.ok(!isNoopHandler('(e) => { throw e; }'));
  assert.ok(!isNoopHandler('onError'));
  assert.ok(!isNoopHandler('console.error'));
});

test('splitTopLevelArgs splits on top-level commas only', () => {
  assert.deepEqual(splitTopLevelArgs('a, () => {}, f(1, 2)'), [
    'a',
    ' () => {}',
    ' f(1, 2)',
  ]);
});

test('analyzeFiles aggregates counts by class with an injected reader', async () => {
  const sources = {
    'src/a.js': 'try { work(); } catch {}',
    'src/b.js': 'p.catch(() => {});',
    'src/c.js': 'try { work(); } catch (e) { throw e; }',
  };
  const { findings, stats } = await analyzeFiles(Object.keys(sources), {
    readFile: async (file) => sources[file],
  });
  assert.equal(findings.length, 2);
  assert.equal(stats.files, 3);
  assert.equal(stats.totalFindings, 2);
  assert.equal(stats.filesWithFindings, 2);
  assert.deepEqual(stats.byClass, {
    'empty-catch': 1,
    'unused-catch-param': 0,
    'noop-promise-catch': 1,
    'try-finally-no-catch': 0,
  });
  assert.deepEqual(
    Object.keys(stats.byClass).sort(),
    [...FINDING_CLASSES].sort(),
  );
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
    byClass: { 'empty-catch': 3 },
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

test('formatErrorSwallowingReport renders header and findings', () => {
  const findings = [
    {
      file: 'src/a.js',
      line: 4,
      class: 'empty-catch',
      severity: 'error',
      detail: 'catch block has no statements',
    },
  ];
  const report = formatErrorSwallowingReport(
    {
      stats: {
        files: 1,
        totalFindings: 1,
        filesWithFindings: 1,
        byClass: {
          'empty-catch': 1,
          'unused-catch-param': 0,
          'noop-promise-catch': 0,
          'try-finally-no-catch': 0,
        },
      },
      findings,
    },
    DEFAULT_LIMIT,
  );
  assert.match(report, /Error-swallowing scoreboard: 1 files scanned/);
  assert.match(report, /top offender: src\/a\.js \(1\)/);
  assert.match(report, /empty-catch\s+error\s+4\s+src\/a\.js/);
});

test('formatErrorSwallowingReport handles zero findings', () => {
  const report = formatErrorSwallowingReport(
    {
      stats: {
        files: 5,
        totalFindings: 0,
        filesWithFindings: 0,
        byClass: {
          'empty-catch': 0,
          'unused-catch-param': 0,
          'noop-promise-catch': 0,
          'try-finally-no-catch': 0,
        },
      },
      findings: [],
    },
    DEFAULT_LIMIT,
  );
  assert.match(report, /No swallowed errors found\./);
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
