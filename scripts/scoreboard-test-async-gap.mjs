// Async-gap scoreboard: rank test files by async work they never wait for
// (async callbacks with no await, fire-and-forget promises, unhandled
// .then chains, async Promise executors). Report-only: exit 0 even when
// findings exist; `--strict` exits 1 only on `fire-and-forget` findings
// (a floating promise in a test can never verify anything, so it is never
// intentional). No test changes, no file writes.
//
// Usage:
//   node scripts/scoreboard-test-async-gap.mjs [--json] [--limit N] [--strict] [test-file ...]
//
// With no file arguments the repo's unit tests are discovered the same
// way scripts/run-unit-tests.mjs does (src/**/*.test.mjs).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeTestFile,
  formatAsyncGapReport,
  parseCliArgs,
  rankAsyncGapFiles,
  STRICT_KINDS,
  summarizeResults,
} from '../src/tooling/testAsyncGap.js';
import { discoverUnitTestFiles } from './run-unit-tests.mjs';

const USAGE = `Usage:
  node scripts/scoreboard-test-async-gap.mjs [--json] [--limit N] [--strict] [test-file ...]

Static async-gap scoreboard for the unit suite. Report-only: exit 0
even when findings exist. --strict exits 1 on any fire-and-forget
finding (a floating promise in a test). --limit N caps the ranked list
(0 means all; default 10).`;

export async function runAsyncGapScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-test-async-gap: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const files = args.positional.length
    ? args.positional
    : discoverUnitTestFiles(root);
  const results = [];
  for (const file of files) {
    const resolved = path.isAbsolute(file) ? file : path.join(root, file);
    let source;
    try {
      source = await readFile(resolved, 'utf8');
    } catch {
      console.error(`scoreboard-test-async-gap: cannot read ${file}`);
      return 2;
    }
    results.push(analyzeTestFile(file, source));
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary: summarizeResults(results),
          files: rankAsyncGapFiles(results, args.limit),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatAsyncGapReport(results, args.limit));
  }

  if (args.strict) {
    const strictHits = results.flatMap((result) =>
      result.findings.filter((finding) => STRICT_KINDS.includes(finding.kind)),
    );
    if (strictHits.length) {
      console.error(
        `scoreboard-test-async-gap: --strict failed on ${strictHits.length} ` +
          `fire-and-forget finding(s)`,
      );
      return 1;
    }
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runAsyncGapScoreboard(root, process.argv);
}
