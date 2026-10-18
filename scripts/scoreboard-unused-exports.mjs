// Unused-export scoreboard: report exported symbols with zero
// importers across the repo, ranked by file. Report-only: exit 0
// even when unused exports exist; exit 2 on usage / I/O errors.
// No file writes.
//
// Usage:
//   node scripts/scoreboard-unused-exports.mjs [--json]
//     [--limit N] [--include-public] [file ...]
//
// With no file arguments every scanned file is reported (test
// files excluded as exporters, counted as importers). With file
// arguments, only those files are shown (paths are root-relative,
// e.g. `src/data/foo.js`). `--limit N` caps the ranked-file list
// (0 means all; default 10). `--include-public` also lists
// unused exports of package.json `exports` targets (public API),
// which are excluded by default. See
// src/tooling/unusedExportScoreboard.js for the usage rules and
// the documented limits.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeFiles,
  discoverSourceFiles,
  filterByFiles,
  findUnused,
  formatUnusedExportReport,
  groupByFile,
  limitFindings,
  parseCliArgs,
  publicFilesFromExports,
  summarizeResults,
} from '../src/tooling/unusedExportScoreboard.js';

const USAGE = `Usage:
  node scripts/scoreboard-unused-exports.mjs [--json] [--limit N] [--include-public] [file ...]

Static unused-export scoreboard for src/ + server/ + scripts/ + tests/ + build/ + root configs (test files excluded as exporters, counted as importers).
Report-only: exit 0 even when unused exports exist. --limit N caps the ranked-file
list (0 means all; default 10). --include-public also lists unused exports of
package.json exports targets. With file arguments, only those files are shown.`;

export async function runUnusedExportScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-unused-exports: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const files = await discoverSourceFiles(root);
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    pkg = {};
  }
  const packageName = typeof pkg.name === 'string' ? pkg.name : null;
  const packageExports =
    pkg.exports && typeof pkg.exports === 'object' ? pkg.exports : {};
  let analyzed;
  try {
    analyzed = await analyzeFiles(files, {
      readFile: (file) => readFile(path.join(root, file), 'utf8'),
      packageName,
      packageExports,
      publicFiles: publicFilesFromExports(packageExports),
    });
  } catch (error) {
    console.error(`scoreboard-unused-exports: cannot read source: ${error}`);
    return 2;
  }
  const unused = findUnused(analyzed, {
    includePublic: args.includePublic,
  });
  const filtered = filterByFiles(unused, args.files);
  const summary = summarizeResults(analyzed, { unused: filtered });
  const groups = groupByFile(filtered);
  const ranked = limitFindings(groups, args.limit);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary,
          byFile: ranked,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatUnusedExportReport({ summary, ranked }, args.limit));
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runUnusedExportScoreboard(root, process.argv);
}
