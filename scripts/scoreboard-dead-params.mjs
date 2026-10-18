// Dead-parameter scoreboard CLI. See scripts/deadParams.mjs for the full
// header (classes, usage, and documented limits).
//
//   node scripts/scoreboard-dead-params.mjs [--json] [--limit N] [--strict] [file ...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_LIMIT,
  STRICT_CLASSES,
  analyzeFiles,
  discoverSourceFiles,
  filterFindingsByFiles,
  formatDeadParamsReport,
  limitFindings,
  parseCliArgs,
  rankOffenders,
  summarizeResults,
} from './deadParams.mjs';

const USAGE = `Usage:
  node scripts/scoreboard-dead-params.mjs [--json] [--limit N] [--strict] [file ...]

Static dead-parameter scoreboard for src/ (test files excluded).
Report-only: exit 0 even when findings exist. --strict exits 1 when
any dead-trailing finding exists (trailing dead params are safe to
delete). --limit N caps the finding list (0 means all; default ${DEFAULT_LIMIT}).
With file arguments, only those files are shown (paths as given,
e.g. src/data/foo.js).`;

export async function runDeadParamsScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-dead-params: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const files = args.files.length
    ? args.files
    : await discoverSourceFiles(root);
  let results;
  try {
    results = await analyzeFiles(files, {
      readFile: (file) => readFile(path.resolve(root, file), 'utf8'),
    });
  } catch (error) {
    console.error(`scoreboard-dead-params: cannot read source: ${error}`);
    return 2;
  }
  const summary = summarizeResults(results);
  const ranked = rankOffenders(results);
  const all = limitFindings(
    results.flatMap((r) => r.findings),
    args.limit,
  );
  const filtered = filterFindingsByFiles(all, args.files);

  if (args.json) {
    console.log(
      JSON.stringify(
        { summary, ranked: ranked.slice(0, 10), findings: filtered },
        null,
        2,
      ),
    );
  } else {
    console.log(formatDeadParamsReport(results, summary, ranked, filtered));
  }

  if (
    args.strict &&
    results.some((r) => r.findings.some((f) => STRICT_CLASSES.has(f.class)))
  ) {
    return 1;
  }
  return 0;
}

const isMain =
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runDeadParamsScoreboard(root, process.argv);
}
