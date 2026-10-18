// No-op-promise scoreboard CLI: report where src/ promise handlers
// silently swallow errors or discard results — `.catch(() => {})`,
// `.catch(noop)`, `.then(() => {})`, and friends. The strict-policy
// companion to the error-swallowing scoreboard: every class is
// error-severity, so `--strict` exits 1 on any finding. Report-only:
// exit 0 otherwise; no file writes.
//
// Usage:
//   node scripts/scoreboard-no-op-promise.mjs [--json] [--limit N] [--strict] [file ...]
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
  formatNoOpPromiseReport,
  parseCliArgs,
  summarizeResults,
} from './noOpPromise.mjs';

const USAGE = `Usage:
  node scripts/scoreboard-no-op-promise.mjs [--json] [--limit N] [--strict] [file ...]

Static no-op-promise scoreboard for src/. Report-only: exit 0 even
when findings exist. --strict exits 1 on any finding
(noop-catch-anonymous, noop-catch-named, noop-then-fulfillment).
--limit N caps the finding list (0 means all; default ${DEFAULT_LIMIT}).
With file arguments, only those files are shown.`;

export async function runNoOpPromiseScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-no-op-promise: ${args.error}`);
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
    console.error(`scoreboard-no-op-promise: cannot read source: ${error}`);
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
      formatNoOpPromiseReport({ stats, findings: shown }, args.limit),
    );
  }

  if (args.strict) {
    const strictHits = shown.filter((finding) =>
      STRICT_CLASSES.has(finding.class),
    );
    if (strictHits.length) {
      console.error(
        `scoreboard-no-op-promise: --strict failed on ` +
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
  process.exitCode = await runNoOpPromiseScoreboard(root, process.argv);
}
