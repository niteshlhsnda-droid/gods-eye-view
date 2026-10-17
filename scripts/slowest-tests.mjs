// Slowest-test scoreboard: rank test files by execution time, so the
// suite's slowest files are visible. Report-only: exit 0 even when the
// tests themselves fail; no CI gating, no test changes.
//
// Usage:
//   node --test --test-reporter=tap one.test.mjs | node scripts/slowest-tests.mjs
//   node scripts/slowest-tests.mjs saved-output.tap
//   node scripts/slowest-tests.mjs --run [--json] [--limit N] [test-file ...]
//
// A whole-suite TAP stream carries no per-file markers (Node aggregates
// every file into one flat stream), so --run executes each test file in
// its own `node --test --test-reporter=tap` subprocess to give every file
// its own timing. With no file arguments --run discovers the repo's unit
// tests the same way scripts/run-unit-tests.mjs does.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  formatSlowestTestsReport,
  makeEmptyFileResult,
  mergeParsedResults,
  parseCliArgs,
  parseTap,
  rankSlowestFiles,
  rankSlowestTests,
} from '../src/tooling/slowestTests.js';
import { discoverUnitTestFiles } from './run-unit-tests.mjs';

const USAGE = `Usage:
  node scripts/slowest-tests.mjs [--json] [--limit N] [--label NAME] [tap-file]
  node scripts/slowest-tests.mjs --run [--json] [--limit N] [test-file ...]

Reads TAP output (from node --test --test-reporter=tap) on stdin or from
tap-file and ranks test files by execution time. --run executes each
test file separately with node --test --test-reporter=tap so every file
gets its own timing. Report-only: exit 0 even when tests fail.
--limit N caps both ranked lists (0 means all; default 10).`;

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function runOneFile(file, root) {
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', file],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const crashed =
    Boolean(result.error) ||
    result.status === null ||
    !/^TAP version \d+/m.test(stdout);
  if (crashed && stdout.trim() === '') {
    return {
      files: [makeEmptyFileResult(file, { crashed: true })],
      totalTests: 0,
      totalDurationMs: 0,
      unparseableLines: 0,
      streams: 0,
    };
  }
  const parsed = parseTap(stdout, { label: file });
  if (crashed) {
    return {
      ...parsed,
      files: parsed.files.map((entry) => ({ ...entry, crashed: true })),
    };
  }
  return parsed;
}

export async function runSlowestTests(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`slowest-tests: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  let parsed;
  if (args.run) {
    const files = args.positional.length
      ? args.positional
      : discoverUnitTestFiles(root);
    parsed = mergeParsedResults(files.map((file) => runOneFile(file, root)));
  } else {
    if (args.positional.length > 1) {
      console.error('slowest-tests: expected at most one TAP input file');
      console.error(USAGE);
      return 2;
    }
    let tapText;
    let label = args.label;
    if (args.positional.length === 1) {
      const input = args.positional[0];
      try {
        tapText = await readFile(input, 'utf8');
      } catch {
        console.error(`slowest-tests: cannot read ${input}`);
        return 2;
      }
      label ??= path.basename(input);
    } else {
      if (process.stdin.isTTY) {
        console.error(
          'slowest-tests: no TAP input: pipe TAP output or pass a file (or use --run)',
        );
        console.error(USAGE);
        return 2;
      }
      tapText = await readStdin();
      label ??= 'stdin';
    }
    parsed = parseTap(tapText, { label });
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary: {
            files: parsed.files.length,
            tests: parsed.totalTests,
            totalDurationMs: parsed.totalDurationMs,
            unparseableLines: parsed.unparseableLines,
            streams: parsed.streams,
          },
          files: rankSlowestFiles(parsed.files, args.limit),
          slowestTests: rankSlowestTests(parsed.files, args.limit),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatSlowestTestsReport(parsed, args.limit));
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runSlowestTests(root, process.argv);
}
