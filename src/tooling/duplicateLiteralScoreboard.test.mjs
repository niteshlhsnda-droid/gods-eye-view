import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_LIMIT,
  DEFAULT_MIN_FILES,
  DEFAULT_MIN_LENGTH,
  DEFAULT_MIN_OCCURRENCES,
  analyzeFiles,
  discoverSourceFiles,
  extractStringLiterals,
  filterByFiles,
  formatDuplicateLiteralReport,
  groupLiterals,
  limitFindings,
  parseCliArgs,
  summarizeResults,
} from './duplicateLiteralScoreboard.js';

const REPEATED = 'repeated literal value';

function literalsOf(source) {
  return extractStringLiterals(source).map(({ value }) => value);
}

test('extracts single-, double-quoted, and plain template literals', () => {
  const found = extractStringLiterals(
    'const a = \'single quoted\';\nconst b = "double quoted";\nconst c = `plain template`;\n',
  );
  assert.deepEqual(
    found.map(({ value }) => value),
    ['single quoted', 'double quoted', 'plain template'],
  );
  assert.deepEqual(
    found.map(({ line }) => line),
    [1, 2, 3],
  );
});

test('decodes escapes including hex, unicode, and line continuations', () => {
  const found = extractStringLiterals(
    String.raw`const a = 'a\nb\tc\\d\'e';` +
      '\n' +
      String.raw`const b = '\x41\u0042';` +
      '\n' +
      "const c = 'first\\\nsecond';\n" +
      "const d = 'after';\n",
  );
  assert.deepEqual(
    found.map(({ value }) => value),
    ["a\nb\tc\\d'e", 'AB', 'firstsecond', 'after'],
  );
  assert.equal(found[3].line, 5); // line-continuation string spans lines 3–4
});

test('skips strings inside line and block comments', () => {
  const found = extractStringLiterals(
    "// const fake = 'not a literal';\n" +
      '/* const fake = "also not"; */\n' +
      "const real = 'real literal';\n",
  );
  assert.deepEqual(literalsOf("/* 'x' */ 'kept string literal'"), [
    'kept string literal',
  ]);
  assert.deepEqual(
    found.map(({ value }) => value),
    ['real literal'],
  );
});

test('skips interpolated templates but scans strings inside interpolation', () => {
  const found = extractStringLiterals(
    'const a = `hello ${name} world`;\n' +
      "const b = `prefix ${'inner literal'} suffix`;\n" +
      'const c = `plain template literal`;\n',
  );
  assert.deepEqual(
    found.map(({ value }) => value),
    ['inner literal', 'plain template literal'],
  );
});

test('interpolation with a nested object literal does not end early', () => {
  const found = extractStringLiterals(
    'const a = `value ${JSON.stringify({ key: "nested literal" })} end`;\n' +
      'const b = `following template literal`;\n',
  );
  assert.deepEqual(
    found.map(({ value }) => value),
    ['nested literal', 'following template literal'],
  );
});

test('skips import, export, require, and dynamic-import specifiers', () => {
  const found = extractStringLiterals(
    "import foo from 'skipped-module-specifier';\n" +
      "import 'skipped-side-effect-specifier';\n" +
      "export { x } from 'skipped-export-specifier';\n" +
      "const y = require('skipped-require-specifier');\n" +
      "const z = await import('skipped-dynamic-specifier');\n" +
      "const kept = 'kept literal value here';\n",
  );
  assert.deepEqual(
    found.map(({ value }) => value),
    ['kept literal value here'],
  );
});

test('distinguishes regex literals from division', () => {
  const found = extractStringLiterals(
    'const pattern = /not a string \\/ literal/;\n' +
      'const ratio = total / divisor;\n' +
      "const after = 'kept literal after regex';\n" +
      'if (x) y = a / b;\n' +
      // A regex containing a complete quoted string: if the `/`
      // were misread as division, 'b' would leak out as a literal.
      "const slashy = /a'b'c/.source;\n" +
      'return /also a regex/;\n',
  );
  assert.deepEqual(
    found.map(({ value }) => value),
    ['kept literal after regex'],
  );
});

test('regex with a character class containing a slash is skipped', () => {
  const found = extractStringLiterals(
    'const pattern = /[/]not a string/;\n' +
      "const kept = 'kept literal value here';\n",
  );
  assert.deepEqual(
    found.map(({ value }) => value),
    ['kept literal value here'],
  );
});

test('unterminated strings are abandoned without swallowing later lines', () => {
  const found = extractStringLiterals(
    "const broken = 'never closed\n" + "const kept = 'kept literal value';\n",
  );
  assert.deepEqual(
    found.map(({ value }) => value),
    ['kept literal value'],
  );
});

test('groupLiterals applies length, occurrence, and file thresholds', async () => {
  const { results } = await analyzeFiles(['a.js', 'b.js'], {
    readFile: async (file) =>
      file === 'a.js'
        ? `const x = '${REPEATED}';\nconst y = '${REPEATED}';\nconst z = 'short';\n`
        : `const w = '${REPEATED}';\nconst v = 'only in one file value';\nconst u = 'only in one file value';\nconst t = 'only in one file value';\n`,
  });
  const { groups, literalsFound, distinctValues } = groupLiterals(results, {
    minLength: DEFAULT_MIN_LENGTH,
    minOccurrences: DEFAULT_MIN_OCCURRENCES,
    minFiles: DEFAULT_MIN_FILES,
  });
  // 'only in one file value' hits occurrences but fails minFiles.
  assert.equal(groups.length, 1);
  assert.equal(groups[0].value, REPEATED);
  assert.equal(groups[0].occurrences, 3);
  assert.deepEqual(
    groups[0].files.map(({ file }) => file),
    ['a.js', 'b.js'],
  );
  assert.equal(literalsFound, 7);
  assert.equal(distinctValues, 2);
});

test('groups sort by occurrences desc, then value asc', async () => {
  const { results } = await analyzeFiles(['a.js', 'b.js'], {
    readFile: async () =>
      "const a = 'zzz duplicate literal';\n" +
      "const b = 'aaa duplicate literal';\n" +
      "const c = 'zzz duplicate literal';\n" +
      "const d = 'aaa duplicate literal';\n",
  });
  // Both files have identical content: each value occurs 4 times.
  const { groups } = groupLiterals(results, {
    minLength: 5,
    minOccurrences: 2,
    minFiles: 2,
  });
  assert.deepEqual(
    groups.map(({ value }) => value),
    ['aaa duplicate literal', 'zzz duplicate literal'],
  );
});

test('grouping is by exact decoded value across quote styles', async () => {
  const { results } = await analyzeFiles(['a.js', 'b.js'], {
    readFile: async (file) =>
      file === 'a.js'
        ? "const a = 'same decoded value!';\nconst b = 'same decoded value!';\n"
        : 'const c = `same decoded value!`;\nconst d = "same decoded value!";\n',
  });
  const { groups } = groupLiterals(results, {
    minLength: 5,
    minOccurrences: 3,
    minFiles: 2,
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 4);
});

test('summarizeResults totals duplicate occurrences', () => {
  const summary = summarizeResults([{ file: 'a.js' }, { file: 'b.js' }], {
    groups: [
      { occurrences: 3, files: [] },
      { occurrences: 5, files: [] },
    ],
    literalsFound: 20,
    distinctValues: 9,
  });
  assert.deepEqual(summary, {
    filesScanned: 2,
    literalsFound: 20,
    distinctValues: 9,
    duplicateGroups: 2,
    totalDuplicateOccurrences: 8,
  });
});

test('filterByFiles and limitFindings behave', () => {
  const results = [{ file: 'a.js' }, { file: 'b.js' }];
  assert.deepEqual(filterByFiles(results, []), results);
  assert.deepEqual(filterByFiles(results, ['b.js']), [{ file: 'b.js' }]);
  assert.deepEqual(limitFindings([1, 2, 3], 0), [1, 2, 3]);
  assert.deepEqual(limitFindings([1, 2, 3], 2), [1, 2]);
});

test('parseCliArgs defaults and flags', () => {
  assert.deepEqual(parseCliArgs([]), {
    json: false,
    limit: DEFAULT_LIMIT,
    minLength: DEFAULT_MIN_LENGTH,
    minOccurrences: DEFAULT_MIN_OCCURRENCES,
    minFiles: DEFAULT_MIN_FILES,
    files: [],
    help: false,
  });
  const parsed = parseCliArgs([
    '--json',
    '--limit',
    '5',
    '--min-length=8',
    '--min-occurrences',
    '2',
    '--min-files',
    '3',
    'src/data/foo.js',
  ]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.limit, 5);
  assert.equal(parsed.minLength, 8);
  assert.equal(parsed.minOccurrences, 2);
  assert.equal(parsed.minFiles, 3);
  assert.deepEqual(parsed.files, ['src/data/foo.js']);
  assert.equal(parseCliArgs(['--help']).help, true);
});

test('parseCliArgs rejects bad input', () => {
  assert.match(parseCliArgs(['--limit', 'abc']).error, /--limit/);
  assert.match(parseCliArgs(['--limit=']).error, /--limit/);
  assert.match(parseCliArgs(['--limit', '-1']).error, /--limit/);
  assert.match(parseCliArgs(['--min-length', '0']).error, /--min-length/);
  assert.match(
    parseCliArgs(['--min-occurrences', '0']).error,
    /--min-occurrences/,
  );
  assert.match(parseCliArgs(['--min-files', '0']).error, /--min-files/);
  assert.match(parseCliArgs(['--bogus']).error, /unknown flag/);
  assert.match(parseCliArgs(['--limit']).error, /--limit/);
});

test('formatDuplicateLiteralReport renders groups and the empty case', () => {
  const summary = {
    filesScanned: 2,
    literalsFound: 10,
    distinctValues: 4,
    duplicateGroups: 1,
    totalDuplicateOccurrences: 3,
  };
  const groups = [
    {
      value: REPEATED,
      occurrences: 3,
      files: [
        { file: 'a.js', count: 2, lines: [1, 5] },
        { file: 'b.js', count: 1, lines: [9] },
      ],
    },
  ];
  const report = formatDuplicateLiteralReport(
    { summary, groups, ranked: groups },
    10,
  );
  assert.match(report, /repeated literal value/);
  assert.match(report, /3 occurrence\(s\) in 2 file\(s\)/);
  assert.match(report, /a\.js \(2x, lines 1, 5\)/);
  const empty = formatDuplicateLiteralReport(
    {
      summary: { ...summary, duplicateGroups: 0, totalDuplicateOccurrences: 0 },
      groups: [],
      ranked: [],
    },
    10,
  );
  assert.match(empty, /No duplicate groups/);
});

test('discoverSourceFiles walks src + server, skips tests and node_modules', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dup-literal-'));
  await mkdir(path.join(root, 'src', 'sub'), { recursive: true });
  await mkdir(path.join(root, 'server', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await mkdir(path.join(root, 'src', 'node_modules', 'pkg'), {
    recursive: true,
  });
  await writeFile(path.join(root, 'src', 'a.js'), 'x');
  await writeFile(path.join(root, 'src', 'sub', 'b.mjs'), 'x');
  await writeFile(path.join(root, 'src', 'a.test.mjs'), 'x');
  await writeFile(path.join(root, 'src', 'c.spec.js'), 'x');
  await writeFile(path.join(root, 'src', 'style.css'), 'x');
  await writeFile(path.join(root, 'src', 'node_modules', 'pkg', 'd.js'), 'x');
  await writeFile(path.join(root, 'server', 'nested', 'e.ts'), 'x');
  await writeFile(path.join(root, 'tests', 'f.js'), 'x');
  const files = await discoverSourceFiles(root);
  assert.deepEqual(files, ['server/nested/e.ts', 'src/a.js', 'src/sub/b.mjs']);
});
