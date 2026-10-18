// Duplicate-string-literal scoreboard: report repeated long string
// literals across src/ + server/ as shared-constant candidates.
// Report-only: exit 0 even when groups exist; exit 2 on usage /
// I/O errors. No file writes.
//
// Usage:
//   node scripts/scoreboard-duplicate-literals.mjs [--json]
//     [--limit N] [--min-length N] [--min-occurrences N]
//     [--min-files N] [file ...]
//
// With no file arguments the `src/` and `server/` trees are
// reported (test files excluded). With file arguments, only those
// files are shown (paths are root-relative, e.g. `src/data/foo.js`).
// `--limit N` caps the ranked-group list (0 means all;
// default 10). See src/tooling/duplicateLiteralScoreboard.js for
// the grouping rules and the documented limits.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeFiles,
  discoverSourceFiles,
  filterByFiles,
  formatDuplicateLiteralReport,
  groupLiterals,
  limitFindings,
  parseCliArgs,
  summarizeResults,
} from './duplicateLiteralScoreboard.mjs';

const USAGE = `Usage:
  node scripts/scoreboard-duplicate-literals.mjs [--json] [--limit N] [--min-length N] [--min-occurrences N] [--min-files N] [file ...]

Static duplicate-string-literal scoreboard for src/ + server/ (test files excluded).
Report-only: exit 0 even when groups exist. --limit N caps the ranked-group
list (0 means all; default 10). Group thresholds: --min-length (default 12),
--min-occurrences (default 3), --min-files (default 2). With file arguments,
only those files are shown.`;

export async function runDuplicateLiteralScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-duplicate-literals: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const files = await discoverSourceFiles(root);
  let analyzed;
  try {
    analyzed = await analyzeFiles(files, {
      readFile: (file) => readFile(path.join(root, file), 'utf8'),
      minLength: args.minLength,
      minOccurrences: args.minOccurrences,
      minFiles: args.minFiles,
    });
  } catch (error) {
    console.error(
      `scoreboard-duplicate-literals: cannot read source: ${error}`,
    );
    return 2;
  }
  const filtered = filterByFiles(analyzed.results, args.files);
  const { groups, literalsFound, distinctValues } = groupLiterals(filtered, {
    minLength: args.minLength,
    minOccurrences: args.minOccurrences,
    minFiles: args.minFiles,
  });
  const summary = summarizeResults(filtered, {
    groups,
    literalsFound,
    distinctValues,
  });
  const ranked = limitFindings(groups, args.limit);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary,
          groups: ranked,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      formatDuplicateLiteralReport({ summary, groups, ranked }, args.limit),
    );
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runDuplicateLiteralScoreboard(root, process.argv);
}
