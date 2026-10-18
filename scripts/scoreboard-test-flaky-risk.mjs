// Flaky-risk scoreboard: rank test files by static flakiness signals
// (real timers, real clocks, randomness, network, disk, env/global
// mutation, shared state, hardcoded ports). Report-only: exit 0 even
// when findings exist; `--strict` exits 1 only on `port` findings
// (a nonzero `.listen()` port is never intentional in this repo's
// tests — the convention is `.listen(0, …)`). No test changes, no
// file writes.
//
// Usage:
//   node scripts/scoreboard-test-flaky-risk.mjs [--json] [--limit N] [--strict] [test-file ...]
//
// With no file arguments the repo's unit tests are discovered the same
// way scripts/run-unit-tests.mjs does (src/**/*.test.mjs).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeTestFile,
  formatFlakyRiskReport,
  parseCliArgs,
  rankFlakyFiles,
  STRICT_KINDS,
  summarizeResults,
} from '../src/tooling/testFlakyRisk.js';
import { discoverUnitTestFiles } from './run-unit-tests.mjs';

const USAGE = `Usage:
  node scripts/scoreboard-test-flaky-risk.mjs [--json] [--limit N] [--strict] [test-file ...]

Static flaky-risk scoreboard for the unit suite. Report-only: exit 0
even when findings exist. --strict exits 1 on any port finding
(hardcoded nonzero .listen() port). --limit N caps the ranked list
(0 means all; default 10).`;

export async function runFlakyRiskScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-test-flaky-risk: ${args.error}`);
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
      console.error(`scoreboard-test-flaky-risk: cannot read ${file}`);
      return 2;
    }
    results.push(analyzeTestFile(file, source));
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary: summarizeResults(results),
          files: rankFlakyFiles(results, args.limit),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatFlakyRiskReport(results, args.limit));
  }

  if (args.strict) {
    const strictHits = results.flatMap((result) =>
      result.findings.filter((finding) => STRICT_KINDS.includes(finding.kind)),
    );
    if (strictHits.length) {
      console.error(
        `scoreboard-test-flaky-risk: --strict failed on ${strictHits.length} ` +
          `port finding(s)`,
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
  process.exitCode = await runFlakyRiskScoreboard(root, process.argv);
}
