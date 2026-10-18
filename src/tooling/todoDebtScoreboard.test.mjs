import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_LIMIT,
  analyzeFiles,
  analyzeSource,
  discoverSourceFiles,
  extractComments,
  filterTodoDebtByFiles,
  flatFindings,
  formatTodoDebtReport,
  limitFindings,
  parseCliArgs,
  rankFiles,
  summarizeResults,
} from './todoDebtScoreboard.js';

test('extractComments finds line and block comments', () => {
  const source = [
    '// hello',
    'const a = 1; /* inline */',
    '/* multi',
    'line */',
  ].join('\n');
  const comments = extractComments(source);
  assert.equal(comments.length, 3);
  assert.equal(comments[0].block, false);
  assert.equal(comments[1].block, true);
  assert.equal(comments[2].block, true);
  assert.equal(comments[2].line, 3);
});

test('extractComments skips markers inside strings and templates', () => {
  const source = [
    'const s = "// not a comment";',
    "const q = '/* not a comment */';",
    'const t = `// not a comment ${1} */`;',
    'const real = 1; // real comment',
  ].join('\n');
  const comments = extractComments(source);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].block, false);
});

test('extractComments finds comments inside template interpolation', () => {
  const source = 'const t = `value ${x /* inner */ + 1} end`;';
  const comments = extractComments(source);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].block, true);
});

test('extractComments skips slashes inside regex literals', () => {
  const source = [
    'const r = /a\\/\\/b/;',
    'const s = 10 / 2; // real comment',
  ].join('\n');
  const comments = extractComments(source);
  assert.equal(comments.length, 1);
});

test('analyzeSource finds all five markers with severities', () => {
  const source = [
    '// TODO: planned work',
    '// FIXME: broken',
    '// XXX: surprising',
    '// HACK: workaround',
    '// NOTE: context',
  ].join('\n');
  const findings = analyzeSource(source, 'a.js');
  assert.deepEqual(
    findings.map((finding) => finding.marker),
    ['TODO', 'FIXME', 'XXX', 'HACK', 'NOTE'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.severity),
    ['planned', 'debt', 'debt', 'debt', 'info'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.line),
    [1, 2, 3, 4, 5],
  );
  assert.equal(findings[0].text, 'TODO: planned work');
});

test('analyzeSource ignores lowercase and mid-sentence markers', () => {
  const source = [
    '// todo: lowercase is prose',
    '// see the TODO list for details',
    '// fixme later, maybe',
    'const label = "NOTE: not a comment";',
  ].join('\n');
  assert.deepEqual(analyzeSource(source, 'a.js'), []);
});

test('analyzeSource ignores markers inside strings', () => {
  const source = [
    'const s = "// TODO: not a comment";',
    "const q = '/* FIXME: not a comment */';",
    'const t = `// HACK: not a comment`;',
  ].join('\n');
  assert.deepEqual(analyzeSource(source, 'a.js'), []);
});

test('analyzeSource handles block continuation lines and line numbers', () => {
  const source = [
    '/*',
    ' * TODO: first',
    ' * FIXME: second',
    ' * plain line',
    ' */',
    '// XXX: after',
  ].join('\n');
  const findings = analyzeSource(source, 'a.js');
  assert.deepEqual(
    findings.map((finding) => [finding.marker, finding.line]),
    [
      ['TODO', 2],
      ['FIXME', 3],
      ['XXX', 6],
    ],
  );
});

test('analyzeSource takes one finding per comment line', () => {
  const source = '// TODO: first TODO: second';
  const findings = analyzeSource(source, 'a.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].marker, 'TODO');
});

test('rankFiles orders by debt, then planned, then total, then file', () => {
  const results = [
    { file: 'b.js', findings: [{ severity: 'planned' }] },
    {
      file: 'a.js',
      findings: [{ severity: 'debt' }, { severity: 'info' }],
    },
    { file: 'c.js', findings: [{ severity: 'debt' }] },
    { file: 'd.js', findings: [] },
  ];
  const ranked = rankFiles(results);
  assert.deepEqual(
    ranked.map((entry) => entry.file),
    ['a.js', 'c.js', 'b.js', 'd.js'],
  );
  assert.equal(ranked[0].debt, 1);
  assert.equal(ranked[0].planned, 0);
  assert.equal(ranked[0].info, 1);
  assert.equal(ranked[0].total, 2);
});

test('summarizeResults counts by marker, severity, and debt total', () => {
  const results = [
    {
      file: 'a.js',
      findings: [
        { marker: 'TODO', severity: 'planned' },
        { marker: 'FIXME', severity: 'debt' },
      ],
    },
    { file: 'b.js', findings: [{ marker: 'NOTE', severity: 'info' }] },
    { file: 'c.js', findings: [] },
  ];
  const summary = summarizeResults(results);
  assert.equal(summary.filesScanned, 3);
  assert.equal(summary.filesWithFindings, 2);
  assert.equal(summary.totalFindings, 3);
  assert.equal(summary.debtTotal, 1);
  assert.deepEqual(summary.byMarker, {
    TODO: 1,
    FIXME: 1,
    XXX: 0,
    HACK: 0,
    NOTE: 1,
  });
  assert.deepEqual(summary.bySeverity, { debt: 1, planned: 1, info: 1 });
});

test('limitFindings returns all for 0 and slices otherwise', () => {
  const list = [1, 2, 3];
  assert.deepEqual(limitFindings(list, 0), [1, 2, 3]);
  assert.deepEqual(limitFindings(list, 2), [1, 2]);
  assert.equal(DEFAULT_LIMIT, 10);
});

test('parseCliArgs handles flags, files, and errors', () => {
  const parsed = parseCliArgs([
    '--json',
    '--strict',
    '--limit',
    '3',
    'src/a.js',
  ]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.strict, true);
  assert.equal(parsed.limit, 3);
  assert.deepEqual(parsed.files, ['src/a.js']);
  assert.equal(parsed.error, null);

  assert.equal(parseCliArgs(['--limit=0']).limit, 0);
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.match(parseCliArgs(['--bogus']).error, /unknown option/);
  assert.match(parseCliArgs(['--limit', '-1']).error, /non-negative/);
  assert.match(parseCliArgs(['--limit', 'x']).error, /non-negative/);
});

test('formatTodoDebtReport renders summary, ranked files, and findings', () => {
  const results = [
    {
      file: 'a.js',
      findings: [
        {
          file: 'a.js',
          line: 1,
          marker: 'FIXME',
          severity: 'debt',
          text: 'FIXME: broken',
        },
      ],
    },
  ];
  const summary = summarizeResults(results);
  const report = formatTodoDebtReport(
    {
      summary,
      findings: flatFindings(results),
      ranked: rankFiles(results),
    },
    10,
  );
  assert.match(report, /Files scanned: 1/);
  assert.match(report, /Debt \(FIXME\/XXX\/HACK\): 1/);
  assert.match(report, /a\.js — debt 1/);
  assert.match(report, /a\.js:1 \[FIXME\/debt\] FIXME: broken/);
});

test('formatTodoDebtReport reports the empty case', () => {
  const summary = summarizeResults([{ file: 'a.js', findings: [] }]);
  const report = formatTodoDebtReport(
    {
      summary,
      findings: [],
      ranked: rankFiles([{ file: 'a.js', findings: [] }]),
    },
    10,
  );
  assert.match(report, /No todo-debt markers found/);
});

test('analyzeFiles and filterTodoDebtByFiles work on real files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-todo-debt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'a.js'),
    '// TODO: planned\n// FIXME: broken\n',
  );
  await writeFile(path.join(root, 'src', 'b.js'), 'const x = 1;\n');
  const { readFile } = await import('node:fs/promises');
  const results = await analyzeFiles(['src/a.js', 'src/b.js'], {
    readFile: (file) => readFile(path.join(root, file), 'utf8'),
  });
  assert.equal(results[0].findings.length, 2);
  assert.equal(results[1].findings.length, 0);
  const filtered = filterTodoDebtByFiles(results, ['src/b.js']);
  assert.deepEqual(
    filtered.map((entry) => entry.file),
    ['src/b.js'],
  );
  assert.deepEqual(filterTodoDebtByFiles(results, []), results);
});

test('discoverSourceFiles finds code files and skips junk', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-todo-debt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'src', 'node_modules', 'dep'), {
    recursive: true,
  });
  await writeFile(path.join(root, 'src', 'a.js'), 'const a = 1;\n');
  await writeFile(path.join(root, 'src', 'nested', 'b.css'), '/* NOTE: x */\n');
  await writeFile(path.join(root, 'src', 'notes.txt'), 'TODO: ignored\n');
  await writeFile(
    path.join(root, 'src', 'node_modules', 'dep', 'c.js'),
    '// TODO: ignored\n',
  );
  const files = await discoverSourceFiles(root);
  assert.ok(files.includes('src/a.js'));
  assert.ok(files.includes('src/nested/b.css'));
  assert.ok(!files.includes('src/notes.txt'));
  assert.ok(!files.includes('src/node_modules/dep/c.js'));
});
