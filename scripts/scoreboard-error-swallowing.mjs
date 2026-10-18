// Error-swallowing scoreboard: report where src/ code swallows errors —
// empty `catch {}` blocks, catches whose error param is never used,
// and no-op promise rejection handlers (`.catch(() => {})`, ...).
// `try {} finally {}` without catch is reported as `risky`, never as
// an error. Report-only: exit 0 even when findings exist; `--strict`
// exits 1 on any `error`-severity finding. No file writes.
//
// Usage:
//   node scripts/scoreboard-error-swallowing.mjs [--json] [--limit N] [--strict] [file ...]
//
// With no file arguments the whole `src/` tree is reported. With file
// arguments, only those files are shown (paths are root-relative,
// e.g. `src/data/foo.js`). `--limit N` caps the finding list (0 means
// all; default 10).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_LIMIT,
  STRICT_CLASSES,
  analyzeFiles,
  discoverSourceFiles,
  filterFindingsByFiles,
  formatErrorSwallowingReport,
  parseCliArgs,
  summarizeResults,
} from './errorSwallowing.mjs';

const USAGE = `Usage:
  node scripts/scoreboard-error-swallowing.mjs [--json] [--limit N] [--strict] [file ...]

Static error-swallowing scoreboard for src/. Report-only: exit 0
even when findings exist. --strict exits 1 on any error-severity
finding (empty-catch, unused-catch-param, noop-promise-catch);
try-finally-no-catch is risky and stays report-only. --limit N caps
the finding list (0 means all; default ${DEFAULT_LIMIT}). With file
arguments, only those files are shown.`;

export async function runErrorSwallowingScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-error-swallowing: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const files = await discoverSourceFiles(root);
  let analysis;
  try {
    analysis = await analyzeFiles(files, {
      readFile: (file) => readFile(path.join(root, file), 'utf8'),
    });
  } catch (error) {
    console.error(`scoreboard-error-swallowing: cannot read source: ${error}`);
    return 2;
  }
  const { findings, stats } = analysis;

  let shown = findings;
  if (args.positional.length) {
    const wanted = args.positional.map((file) => {
      const absolute = path.isAbsolute(file) ? file : path.join(root, file);
      return path.relative(root, absolute);
    });
    shown = filterFindingsByFiles(findings, wanted);
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        { summary: summarizeResults(stats, shown), findings: shown },
        null,
        2,
      ),
    );
  } else {
    console.log(
      formatErrorSwallowingReport({ stats, findings: shown }, args.limit),
    );
  }

  if (args.strict) {
    const strictHits = shown.filter((finding) =>
      STRICT_CLASSES.has(finding.class),
    );
    if (strictHits.length) {
      console.error(
        `scoreboard-error-swallowing: --strict failed on ` +
          `${strictHits.length} error-severity finding(s)`,
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
  process.exitCode = await runErrorSwallowingScoreboard(root, process.argv);
}
