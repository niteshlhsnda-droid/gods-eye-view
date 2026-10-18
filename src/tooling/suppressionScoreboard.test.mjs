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
  filterSuppressionsByFiles,
  flatFindings,
  formatSuppressionReport,
  limitFindings,
  parseCliArgs,
  rankFiles,
  summarizeResults,
} from './suppressionScoreboard.js';

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
  assert.equal(comments[0].block, false);
});

test('analyzeSource reports a line directive with its rule list', () => {
  const { findings } = analyzeSource(
    '// eslint-disable-next-line no-console\nfoo();',
    'src/a.js',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'src/a.js');
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].kind, 'eslint-disable-next-line');
  assert.deepEqual(findings[0].rules, ['no-console']);
  assert.equal(findings[0].blanket, false);
  assert.equal(findings[0].reason, '');
  assert.equal(findings[0].text, 'eslint-disable-next-line no-console');
});

test('analyzeSource flags a bare line directive as blanket', () => {
  const { findings } = analyzeSource(
    'foo(); // eslint-disable-next-line\n',
    'src/a.js',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'eslint-disable-next-line');
  assert.deepEqual(findings[0].rules, []);
  assert.equal(findings[0].blanket, true);
  assert.equal(findings[0].line, 1);
});

test('analyzeSource parses block disables with rules and a reason', () => {
  const { findings } = analyzeSource(
    '/* eslint-disable no-console, no-alert -- legacy file */',
    'src/a.js',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'eslint-disable');
  assert.deepEqual(findings[0].rules, ['no-console', 'no-alert']);
  assert.equal(findings[0].blanket, false);
  assert.equal(findings[0].reason, 'legacy file');
});

test('analyzeSource flags a bare block disable as blanket', () => {
  const { findings } = analyzeSource('/* eslint-disable */', 'src/a.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'eslint-disable');
  assert.equal(findings[0].blanket, true);
});

test('analyzeSource handles an unterminated block comment at EOF', () => {
  const { findings } = analyzeSource('/* eslint-disable', 'src/a.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'eslint-disable');
  assert.equal(findings[0].blanket, true);
});

test('analyzeSource parses line directives with several rules', () => {
  const { findings } = analyzeSource(
    '// eslint-disable-line no-console, no-await-in-loop',
    'src/a.js',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'eslint-disable-line');
  assert.deepEqual(findings[0].rules, ['no-console', 'no-await-in-loop']);
});

test('analyzeSource ignores prose mentions and markers in code', () => {
  const source = [
    '// see the disable docs for details',
    'const s = "// eslint-disable-next-line no-console";',
    'const t = `/* eslint-disable */`;',
  ].join('\n');
  assert.equal(analyzeSource(source, 'src/a.js').findings.length, 0);
});

test('analyzeSource ignores a directive buried mid-comment', () => {
  const source = '/* note: eslint-disable-next-line no-console */';
  assert.equal(analyzeSource(source, 'src/a.js').findings.length, 0);
});

test('analyzeSource parses istanbul scopes', () => {
  const cases = [
    ['/* istanbul ignore next */', 'next'],
    ['/* istanbul ignore file */', 'file'],
    ['/* istanbul ignore else */', 'else'],
    ['/* istanbul ignore if */', 'if'],
    ['/* istanbul ignore */', 'statement'],
  ];
  for (const [source, scope] of cases) {
    const { findings } = analyzeSource(source, 'src/a.js');
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].kind, 'istanbul-ignore');
    assert.equal(findings[0].scope, scope);
  }
});

test('analyzeSource parses c8 scopes', () => {
  const cases = [
    ['/* c8 ignore next */', 'next'],
    ['/* c8 ignore line */', 'line'],
    ['/* c8 ignore start */', 'start'],
    ['/* c8 ignore stop */', 'stop'],
    ['/* c8 ignore */', 'statement'],
  ];
  for (const [source, scope] of cases) {
    const { findings } = analyzeSource(source, 'src/a.js');
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].kind, 'c8-ignore');
    assert.equal(findings[0].scope, scope);
  }
});

test('analyzeSource reports prettier and ts directives', () => {
  const source = [
    '// prettier-ignore',
    '// @ts-ignore',
    '// @ts-expect-error',
    '// @ts-nocheck',
  ].join('\n');
  const { findings } = analyzeSource(source, 'src/a.js');
  assert.deepEqual(
    findings.map((finding) => finding.kind),
    ['prettier-ignore', 'ts-ignore', 'ts-expect-error', 'ts-nocheck'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.line),
    [1, 2, 3, 4],
  );
});

test('analyzeSource finds a directive on a starred block-comment line', () => {
  const source = ['/*', ' * eslint-disable-next-line no-console', ' */'].join(
    '\n',
  );
  const { findings } = analyzeSource(source, 'src/a.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
  assert.equal(findings[0].kind, 'eslint-disable-next-line');
});

test('analyzeSource finds two directives in one block comment', () => {
  const source = [
    '/* eslint-disable no-console',
    '   eslint-disable-next-line no-alert */',
  ].join('\n');
  const { findings } = analyzeSource(source, 'src/a.js');
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((finding) => finding.kind),
    ['eslint-disable', 'eslint-disable-next-line'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.line),
    [1, 2],
  );
});

test('analyzeSource profiles an empty file as zero findings', () => {
  assert.deepEqual(analyzeSource('', 'src/empty.js'), {
    file: 'src/empty.js',
    findings: [],
  });
});

test('summarizeResults counts kinds, blankets, and directories', () => {
  const summary = summarizeResults([
    {
      file: 'src/a.js',
      findings: [
        { kind: 'eslint-disable-next-line', blanket: false },
        { kind: 'eslint-disable', blanket: true },
      ],
    },
    {
      file: 'server/b.js',
      findings: [{ kind: 'istanbul-ignore', scope: 'file' }],
    },
    { file: 'src/c.test.mjs', findings: [{ kind: 'prettier-ignore' }] },
    { file: 'src/empty.js', findings: [] },
  ]);
  assert.equal(summary.filesScanned, 4);
  assert.equal(summary.filesWithSuppressions, 3);
  assert.equal(summary.totalSuppressions, 4);
  assert.equal(summary.blanketEslintDisables, 1);
  assert.equal(summary.istanbulIgnoreFile, 1);
  assert.equal(summary.testFileSuppressions, 1);
  assert.deepEqual(summary.byKind, {
    'eslint-disable': 1,
    'eslint-disable-next-line': 1,
    'istanbul-ignore': 1,
    'prettier-ignore': 1,
  });
  assert.deepEqual(summary.byDirectory, { src: 3, server: 1 });
});

test('rankFiles orders by count desc then file asc', () => {
  const ranked = rankFiles([
    { file: 'src/b.js', findings: [{}, {}] },
    { file: 'src/a.js', findings: [{}, {}] },
    { file: 'src/c.js', findings: [{}] },
    { file: 'src/d.js', findings: [] },
  ]);
  assert.deepEqual(
    ranked.map((entry) => entry.file),
    ['src/a.js', 'src/b.js', 'src/c.js'],
  );
  assert.deepEqual(
    ranked.map((entry) => entry.total),
    [2, 2, 1],
  );
});

test('filterSuppressionsByFiles keeps only listed files', () => {
  const results = [
    { file: 'src/a.js', findings: [{}] },
    { file: 'src/b.js', findings: [{}] },
  ];
  assert.deepEqual(filterSuppressionsByFiles(results, []), results);
  assert.deepEqual(filterSuppressionsByFiles(results, ['src/b.js']), [
    { file: 'src/b.js', findings: [{}] },
  ]);
});

test('flatFindings sorts by file then line', () => {
  const flat = flatFindings([
    { file: 'src/b.js', findings: [{ file: 'src/b.js', line: 2 }] },
    {
      file: 'src/a.js',
      findings: [
        { file: 'src/a.js', line: 5 },
        { file: 'src/a.js', line: 1 },
      ],
    },
  ]);
  assert.deepEqual(
    flat.map((finding) => `${finding.file}:${finding.line}`),
    ['src/a.js:1', 'src/a.js:5', 'src/b.js:2'],
  );
});

test('limitFindings caps the list and 0 means all', () => {
  assert.deepEqual(limitFindings([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(limitFindings([1, 2, 3], 0), [1, 2, 3]);
});

test('parseCliArgs handles flags, limits, and errors', () => {
  assert.deepEqual(parseCliArgs([]), {
    json: false,
    strict: false,
    help: false,
    limit: DEFAULT_LIMIT,
    files: [],
  });
  assert.equal(parseCliArgs(['--json']).json, true);
  assert.equal(parseCliArgs(['--strict']).strict, true);
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.equal(parseCliArgs(['--limit', '5']).limit, 5);
  assert.equal(parseCliArgs(['--limit=7']).limit, 7);
  assert.equal(parseCliArgs(['--limit', '0']).limit, 0);
  assert.deepEqual(parseCliArgs(['src/a.js']).files, ['src/a.js']);
  assert.match(parseCliArgs(['--limit', 'x']).error, /--limit/);
  assert.match(parseCliArgs(['--limit=']).error, /--limit/);
  assert.match(parseCliArgs(['--limit', '-1']).error, /--limit/);
  assert.match(parseCliArgs(['--bogus']).error, /unknown flag/);
});

test('formatSuppressionReport shows totals and caps findings', () => {
  const report = formatSuppressionReport(
    {
      summary: {
        filesScanned: 3,
        filesWithSuppressions: 1,
        totalSuppressions: 2,
        testFileSuppressions: 0,
        blanketEslintDisables: 1,
        istanbulIgnoreFile: 0,
        byKind: { 'eslint-disable': 1, 'eslint-disable-line': 1 },
        byDirectory: { src: 2 },
      },
      findings: [
        {
          file: 'src/a.js',
          line: 1,
          kind: 'eslint-disable',
          rules: [],
          blanket: true,
          reason: '',
          text: 'eslint-disable',
        },
        {
          file: 'src/a.js',
          line: 2,
          kind: 'eslint-disable-line',
          rules: ['no-console'],
          blanket: false,
          reason: '',
          text: 'eslint-disable-line no-console',
        },
      ],
      ranked: [{ file: 'src/a.js', total: 2, byKind: {} }],
    },
    1,
  );
  assert.match(report, /2 suppression\(s\) in 1 file\(s\)/);
  assert.match(report, /Blanket eslint-disable: 1/);
  assert.match(report, /src\/a\.js:1 \[eslint-disable\] \[BLANKET/);
  assert.match(report, /and 1 more/);
});

test('analyzeFiles reads through the injected reader', async () => {
  const results = await analyzeFiles(['src/a.js'], {
    readFile: async () => '/* istanbul ignore file */',
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].findings[0].kind, 'istanbul-ignore');
});

test('discoverSourceFiles walks the three scan roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'suppressions-'));
  try {
    await mkdir(path.join(root, 'src', 'sub'), { recursive: true });
    await mkdir(path.join(root, 'server'), { recursive: true });
    await mkdir(path.join(root, 'scripts', 'node_modules'), {
      recursive: true,
    });
    await mkdir(path.join(root, 'other'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.js'), '');
    await writeFile(path.join(root, 'src', 'sub', 'b.mjs'), '');
    await writeFile(path.join(root, 'src', 'skip.txt'), '');
    await writeFile(path.join(root, 'server', 's.js'), '');
    await writeFile(path.join(root, 'scripts', 'node_modules', 'x.js'), '');
    await writeFile(path.join(root, 'other', 'c.js'), '');
    const files = await discoverSourceFiles(root);
    assert.deepEqual(files, ['server/s.js', 'src/a.js', 'src/sub/b.mjs']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
