// Todo-debt scoreboard: report where comment debt markers live
// (FIXME / XXX / HACK as debt, TODO as planned, NOTE as info).
// Report-only: exit 0 even when markers exist; `--strict` exits 1
// when any FIXME / XXX / HACK finding exists. No file writes.
//
// Usage:
//   node scripts/scoreboard-todo-debt.mjs [--json] [--limit N] [--strict] [file ...]
//
// With no file arguments the `src/`, `server/`, `scripts/`, and
// `tests/` trees are reported. With file arguments, only those
// files are shown (paths are root-relative, e.g. `src/data/foo.js`).
// `--limit N` caps the ranked-file and findings lists (0 means all;
// default 10).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeFiles,
  discoverSourceFiles,
  filterTodoDebtByFiles,
  flatFindings,
  formatTodoDebtReport,
  limitFindings,
  parseCliArgs,
  rankFiles,
  summarizeResults,
} from './todoDebtScoreboard.mjs';

const USAGE = `Usage:
  node scripts/scoreboard-todo-debt.mjs [--json] [--limit N] [--strict] [file ...]

Static todo-debt scoreboard for src/, server/, scripts/, tests/.
Report-only: exit 0 even when markers exist. --strict exits 1 when
any FIXME / XXX / HACK finding exists. --limit N caps the ranked-file
and findings lists (0 means all; default 10). With file arguments,
only those files are shown.`;

export async function runTodoDebtScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-todo-debt: ${args.error}`);
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
    console.error(`scoreboard-todo-debt: cannot read source: ${error}`);
    return 2;
  }
  const filtered = filterTodoDebtByFiles(results, args.files);
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
      formatTodoDebtReport({ summary, findings, ranked }, args.limit),
    );
  }

  if (args.strict && summary.bySeverity.debt > 0) {
    console.error(
      `scoreboard-todo-debt: --strict failed on ` +
        `${summary.bySeverity.debt} FIXME / XXX / HACK finding(s)`,
    );
    return 1;
  }
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runTodoDebtScoreboard(root, process.argv);
}
