// Unreachable-code scoreboard: report statements that can never
// run (after-terminator + constant-condition branches).
// Report-only: exit 0 even when unreachable code exists;
// exit 2 on usage / I/O errors. No file writes.
//
// Usage:
//   node scripts/scoreboard-unreachable-code.mjs [--json]
//     [--limit N] [file ...]
//
// With no file arguments every scanned file is reported. With
// file arguments, only those files are shown (paths are
// root-relative, e.g. `src/data/foo.js`). `--limit N` caps the
// ranked-file list (0 means all; default 10). See
// src/tooling/unreachableCodeScoreboard.js for the rules and
// the documented limits.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeFiles,
  discoverSourceFiles,
  filterByFiles,
  formatUnreachableCodeReport,
  groupByFile,
  limitFindings,
  parseCliArgs,
  summarizeResults,
} from '../src/tooling/unreachableCodeScoreboard.js';

const USAGE = `Usage:
  node scripts/scoreboard-unreachable-code.mjs [--json] [--limit N] [file ...]

Static unreachable-code scoreboard for src/ + server/ + scripts/ + tests/ + build/ + root configs.
Report-only: exit 0 even when unreachable code exists. --limit N caps the ranked-file
list (0 means all; default 10). With file arguments, only those files are shown.`;

export async function runUnreachableCodeScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-unreachable-code: ${args.error}`);
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
    });
  } catch (error) {
    console.error(`scoreboard-unreachable-code: cannot read source: ${error}`);
    return 2;
  }
  const filtered = filterByFiles(analyzed.findings, args.files);
  const summary = summarizeResults(analyzed, { findings: filtered });
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
    console.log(formatUnreachableCodeReport({ summary, ranked }, args.limit));
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runUnreachableCodeScoreboard(root, process.argv);
}
