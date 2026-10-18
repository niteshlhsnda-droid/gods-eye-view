// Suppression scoreboard: report where the repo opts out of its own
// checks (eslint-disable, @ts-ignore, istanbul/c8 ignore,
// prettier-ignore). Report-only: exit 0 even when suppressions exist;
// `--strict` exits 1 when any BLANKET eslint-disable or any
// `istanbul ignore file` is found. No file writes.
//
// Usage:
//   node scripts/scoreboard-suppressions.mjs [--json] [--limit N] [--strict] [file ...]
//
// With no file arguments the `src/`, `server/`, and `scripts/` trees
// are reported. With file arguments, only those files are shown
// (paths are root-relative, e.g. `src/data/foo.js`). `--limit N` caps
// the ranked-file and findings lists (0 means all; default 10).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeFiles,
  discoverSourceFiles,
  filterSuppressionsByFiles,
  flatFindings,
  formatSuppressionReport,
  limitFindings,
  parseCliArgs,
  rankFiles,
  summarizeResults,
} from '../src/tooling/suppressionScoreboard.js';

const USAGE = `Usage:
  node scripts/scoreboard-suppressions.mjs [--json] [--limit N] [--strict] [file ...]

Static suppression scoreboard for src/, server/, scripts/. Report-only:
exit 0 even when suppressions exist. --strict exits 1 when any BLANKET
eslint-disable or any \`istanbul ignore file\` is found. --limit N caps
the ranked-file and findings lists (0 means all; default 10). With file
arguments, only those files are shown.`;

export async function runSuppressionScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-suppressions: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const files = await discoverSourceFiles(root);
  let results;
  try {
    results = await analyzeFiles(files, {
      readFile: (file) => readFile(path.join(root, file), 'utf8'),
    });
  } catch (error) {
    console.error(`scoreboard-suppressions: cannot read source: ${error}`);
    return 2;
  }
  const filtered = filterSuppressionsByFiles(results, args.files);
  const summary = summarizeResults(filtered);
  const ranked = rankFiles(filtered);
  const findings = flatFindings(filtered);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary,
          ranked: limitFindings(ranked, args.limit),
          findings: limitFindings(findings, args.limit),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      formatSuppressionReport({ summary, findings, ranked }, args.limit),
    );
  }

  if (args.strict) {
    if (summary.blanketEslintDisables > 0 || summary.istanbulIgnoreFile > 0) {
      console.error(
        `scoreboard-suppressions: --strict failed on ` +
          `${summary.blanketEslintDisables} blanket eslint-disable(s) and ` +
          `${summary.istanbulIgnoreFile} istanbul ignore file(s)`,
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
  process.exitCode = await runSuppressionScoreboard(root, process.argv);
}
