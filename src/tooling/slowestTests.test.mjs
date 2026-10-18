import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDurationMs,
  formatSlowestTestsReport,
  makeEmptyFileResult,
  mergeParsedResults,
  parseCliArgs,
  parseTap,
  rankSlowestFiles,
  rankSlowestTests,
} from './slowestTests.js';

const tap = (lines) => lines.join('\n');

const flatTap = tap([
  'TAP version 13',
  '# Subtest: grouped',
  '    # Subtest: nested fast',
  '    ok 1 - nested fast',
  '      ---',
  '      duration_ms: 1.233781',
  "      type: 'test'",
  '      ...',
  '    # Subtest: nested slow',
  '    ok 2 - nested slow',
  '      ---',
  '      duration_ms: 60.069817',
  "      type: 'test'",
  '      ...',
  '    1..2',
  'ok 1 - grouped',
  '  ---',
  '  duration_ms: 63.53679',
  "  type: 'suite'",
  '  ...',
  '# Subtest: skipped one',
  'ok 2 - skipped one # SKIP',
  '  ---',
  '  duration_ms: 0.236706',
  "  type: 'test'",
  '  ...',
  '# Subtest: fast one',
  'ok 3 - fast one',
  '  ---',
  '  duration_ms: 1.061253',
  "  type: 'test'",
  '  ...',
  '1..3',
  '# tests 4',
  '# suites 1',
  '# pass 3',
  '# fail 0',
  '# cancelled 0',
  '# skipped 1',
  '# todo 0',
  '# duration_ms 296.324446',
]);

test('flat single-file stream uses the summary as the file total', () => {
  const parsed = parseTap(flatTap, { label: 'sample.test.mjs' });
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.streams, 1);
  assert.equal(parsed.unparseableLines, 0);
  const [file] = parsed.files;
  assert.equal(file.file, 'sample.test.mjs');
  assert.equal(file.durationMs, 296.324446);
  assert.equal(file.testCount, 4);
  assert.equal(file.passedCount, 3);
  assert.equal(file.skippedCount, 1);
  assert.equal(file.failedCount, 0);
  assert.equal(file.suiteCount, 1);
  assert.equal(parsed.totalTests, 4);
  assert.equal(parsed.totalDurationMs, 296.324446);
});

test('suites are excluded from tests and nested names carry the suite', () => {
  const parsed = parseTap(flatTap, { label: 'sample.test.mjs' });
  const names = parsed.files[0].tests.map((entry) => entry.name);
  assert.deepEqual(names, [
    'grouped > nested fast',
    'grouped > nested slow',
    'skipped one',
    'fast one',
  ]);
  const skipped = parsed.files[0].tests.find(
    (entry) => entry.name === 'skipped one',
  );
  assert.equal(skipped.passed, false);
  assert.equal(skipped.skipped, true);
});

test('failing tests count as failed and keep their location', () => {
  const parsed = parseTap(
    tap([
      'TAP version 13',
      '# Subtest: failing one',
      'not ok 1 - failing one',
      '  ---',
      '  duration_ms: 2.5',
      "  type: 'test'",
      "  location: '/tmp/x/sample.test.mjs:13:1'",
      '  ...',
      '1..1',
      '# duration_ms 9',
    ]),
    { label: 'sample.test.mjs' },
  );
  const [entry] = parsed.files[0].tests;
  assert.equal(entry.passed, false);
  assert.equal(entry.location, '/tmp/x/sample.test.mjs:13:1');
  assert.equal(entry.locationFile, '/tmp/x/sample.test.mjs');
  assert.equal(parsed.files[0].failedCount, 1);
});

test('nested TAP file wrappers attribute tests to their file', () => {
  const parsed = parseTap(
    tap([
      'TAP version 13',
      '# Subtest: src/a.test.mjs',
      '    ok 1 - first',
      '      ---',
      '      duration_ms: 10',
      "      type: 'test'",
      '      ...',
      '    1..1',
      'ok 1 - src/a.test.mjs',
      '  ---',
      '  duration_ms: 55.5',
      "  type: 'test'",
      '  ...',
      '# Subtest: src/b.test.mjs',
      '    ok 1 - only',
      '      ---',
      '      duration_ms: 200',
      "      type: 'test'",
      '      ...',
      '    1..1',
      'ok 2 - src/b.test.mjs',
      '  ---',
      '  duration_ms: 300',
      "  type: 'test'",
      '  ...',
      '1..2',
      '# duration_ms 400',
    ]),
  );
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].file, 'src/a.test.mjs');
  assert.equal(parsed.files[0].durationMs, 55.5);
  assert.deepEqual(
    parsed.files[0].tests.map((entry) => entry.name),
    ['first'],
  );
  assert.equal(parsed.files[1].file, 'src/b.test.mjs');
  assert.equal(parsed.files[1].durationMs, 300);
  assert.equal(parsed.totalDurationMs, 355.5);
});

test('concatenated streams become separate files', () => {
  const parsed = parseTap(
    tap([
      'TAP version 13',
      'ok 1 - one',
      '  ---',
      '  duration_ms: 5',
      "  type: 'test'",
      '  ...',
      '1..1',
      '# duration_ms 10',
      'TAP version 13',
      'ok 1 - two',
      '  ---',
      '  duration_ms: 7',
      "  type: 'test'",
      '  ...',
      '1..1',
      '# duration_ms 20',
    ]),
  );
  assert.equal(parsed.streams, 2);
  assert.deepEqual(
    parsed.files.map((file) => [file.file, file.durationMs]),
    [
      ['stdin-1', 10],
      ['stdin-2', 20],
    ],
  );
});

test('a single stream without a header still parses, labelled by option', () => {
  const parsed = parseTap(
    tap([
      'ok 1 - one',
      '  ---',
      '  duration_ms: 5',
      "  type: 'test'",
      '  ...',
      '1..1',
      '# duration_ms 10',
    ]),
    { label: 'only.test.mjs' },
  );
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].file, 'only.test.mjs');
  assert.equal(parsed.files[0].durationMs, 10);
});

test('unparseable lines are skipped and counted, never thrown on', () => {
  const parsed = parseTap(
    tap([
      'TAP version 13',
      'this line is not TAP at all',
      'ok 1 - real',
      '  ---',
      '  duration_ms: not-a-number',
      "  type: 'test'",
      '  ...',
      'garbage after',
      '1..1',
      '# duration_ms 9',
    ]),
    { label: 'x.test.mjs' },
  );
  assert.equal(parsed.unparseableLines, 2);
  assert.equal(parsed.files[0].tests[0].name, 'real');
  assert.equal(parsed.files[0].tests[0].durationMs, 0);
  assert.equal(parsed.files[0].durationMs, 9);
});

test('a truncated YAML block still keeps the parsed duration', () => {
  const parsed = parseTap(
    tap(['ok 1 - cut', '  ---', '  duration_ms: 42', "  type: 'test'"]),
    { label: 'x.test.mjs' },
  );
  assert.equal(parsed.files[0].tests[0].durationMs, 42);
  assert.equal(parsed.files[0].durationMs, 42);
});

test('results without YAML default to zero-duration tests', () => {
  const parsed = parseTap(tap(['ok 1 - plain', 'ok 2 - also plain']), {
    label: 'x.test.mjs',
  });
  assert.equal(parsed.files[0].testCount, 2);
  assert.equal(parsed.files[0].durationMs, 0);
  assert.equal(parsed.files[0].passedCount, 2);
});

test('empty input yields no files and no unparseable lines', () => {
  const parsed = parseTap('');
  assert.deepEqual(parsed.files, []);
  assert.equal(parsed.totalTests, 0);
  assert.equal(parsed.totalDurationMs, 0);
  assert.equal(parsed.unparseableLines, 0);
});

test('rankSlowestFiles sorts by duration with a name tie-break', () => {
  const files = [
    { file: 'b.test.mjs', durationMs: 10 },
    { file: 'a.test.mjs', durationMs: 10 },
    { file: 'c.test.mjs', durationMs: 99 },
  ];
  assert.deepEqual(
    rankSlowestFiles(files).map((file) => file.file),
    ['c.test.mjs', 'a.test.mjs', 'b.test.mjs'],
  );
  assert.equal(rankSlowestFiles(files, 1).length, 1);
  assert.equal(rankSlowestFiles(files, 0).length, 3);
});

test('rankSlowestTests flattens across files, slowest first', () => {
  const parsed = parseTap(flatTap, { label: 'sample.test.mjs' });
  const slowest = rankSlowestTests(parsed.files, 2);
  assert.deepEqual(
    slowest.map((entry) => entry.name),
    ['grouped > nested slow', 'grouped > nested fast'],
  );
  assert.equal(slowest[0].file, 'sample.test.mjs');
  assert.equal(rankSlowestTests(parsed.files, 0).length, 4);
});

test('formatDurationMs switches units at one second', () => {
  assert.equal(formatDurationMs(0), '0.0ms');
  assert.equal(formatDurationMs(60.069817), '60.1ms');
  assert.equal(formatDurationMs(1000), '1.00s');
  assert.equal(formatDurationMs(296.324446), '296.3ms');
  assert.equal(formatDurationMs(Number.NaN), '0.0ms');
});

test('human report lists files and tests, and notes skipped lines', () => {
  const report = formatSlowestTestsReport(parseTap(flatTap), 2);
  assert.match(report, /Slowest-test scoreboard: 1 files \/ 4 tests/);
  assert.match(report, /Slowest files \(top 1\):/);
  assert.match(report, /grouped > nested slow/);
  const empty = formatSlowestTestsReport(parseTap(''));
  assert.match(empty, /No tests found in TAP input\./);
  const withSkips = formatSlowestTestsReport(parseTap('garbage\nok 1 - x\n'));
  assert.match(withSkips, /Unparseable lines skipped: 1/);
});

test('parseCliArgs handles flags, = values, and bad input', () => {
  assert.deepEqual(parseCliArgs(['--json', '--limit', '5', 'in.tap']), {
    json: true,
    limit: 5,
    label: null,
    run: false,
    help: false,
    positional: ['in.tap'],
    error: null,
  });
  assert.equal(parseCliArgs(['--limit=0']).limit, 0);
  assert.equal(parseCliArgs(['--label', 'f.test.mjs']).label, 'f.test.mjs');
  assert.equal(parseCliArgs(['--label=f.test.mjs']).label, 'f.test.mjs');
  assert.equal(parseCliArgs(['--run']).run, true);
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.match(parseCliArgs(['--limit', 'abc']).error, /Invalid --limit/);
  assert.match(parseCliArgs(['--limit']).error, /Missing value/);
  assert.match(parseCliArgs(['--bogus']).error, /Unknown option/);
});

test('mergeParsedResults sums totals across per-file parses', () => {
  const merged = mergeParsedResults([
    parseTap(flatTap, { label: 'a.test.mjs' }),
    parseTap('garbage\nok 1 - x\n', { label: 'b.test.mjs' }),
  ]);
  assert.equal(merged.files.length, 2);
  assert.equal(merged.totalTests, 5);
  assert.equal(merged.unparseableLines, 1);
  assert.equal(merged.streams, 2);
});

test('makeEmptyFileResult marks crashed runs', () => {
  const crashed = makeEmptyFileResult('x.test.mjs', { crashed: true });
  assert.equal(crashed.crashed, true);
  assert.equal(crashed.durationMs, 0);
  assert.equal(crashed.testCount, 0);
  assert.equal(makeEmptyFileResult('x.test.mjs').crashed, undefined);
});
