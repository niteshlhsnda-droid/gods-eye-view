// Import-cycle scoreboard: rank strongly connected components of the
// src/ import graph (see src/tooling/importCycles.js). Report-only:
// exit 0 even when cycles exist; `--strict` exits 1 when any cycle is
// found. No file writes.
//
// Usage:
//   node scripts/scoreboard-import-cycles.mjs [--json] [--limit N] [--strict] [file ...]
//
// With no file arguments the whole `src/` graph is reported. With file
// arguments, only cycles containing at least one listed file are shown
// (the full graph is still scanned — a cycle needs its whole graph).
// `--limit N` caps the ranked list (0 means all; default 10).
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeFiles,
  discoverSourceFiles,
  filterCyclesByFiles,
  findCycles,
  formatImportCyclesReport,
  limitCycles,
  parseCliArgs,
  summarizeResults,
} from '../src/tooling/importCycles.js';

const USAGE = `Usage:
  node scripts/scoreboard-import-cycles.mjs [--json] [--limit N] [--strict] [file ...]

Static import-cycle scoreboard for src/. Report-only: exit 0 even when
cycles exist. --strict exits 1 when any cycle is found. --limit N caps
the ranked list (0 means all; default 10). With file arguments, only
cycles containing at least one listed file are shown.`;

export async function runImportCyclesScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-import-cycles: ${args.error}`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const files = await discoverSourceFiles(root);
  const hasFile = (file) => {
    try {
      return statSync(path.join(root, file)).isFile();
    } catch {
      return false;
    }
  };
  let analysis;
  try {
    analysis = await analyzeFiles(files, {
      readFile: (file) => readFile(path.join(root, file), 'utf8'),
      hasFile,
    });
  } catch (error) {
    console.error(`scoreboard-import-cycles: cannot read source: ${error}`);
    return 2;
  }
  const { graph, stats, nonModuleImports, unresolvedImports } = analysis;

  let cycles = findCycles(graph);
  if (args.positional.length) {
    const wanted = args.positional.map((file) => {
      const absolute = path.isAbsolute(file) ? file : path.join(root, file);
      return path.relative(root, absolute);
    });
    cycles = filterCyclesByFiles(cycles, wanted);
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary: summarizeResults(stats, cycles),
          cycles: limitCycles(cycles, args.limit),
          nonModuleImports,
          unresolvedImports,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      formatImportCyclesReport(
        { stats, cycles, nonModuleImports, unresolvedImports },
        args.limit,
      ),
    );
  }

  if (args.strict && cycles.length) {
    console.error(
      `scoreboard-import-cycles: --strict failed on ${cycles.length} ` +
        `import cycle(s)`,
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
  process.exitCode = await runImportCyclesScoreboard(root, process.argv);
}
