// Complexity-hotspot scoreboard: rank src/ files by a heuristic
// maintainability score (see scripts/complexityHotspots.mjs).
// Report-only: exit 0 even when hotspots exist; `--strict` exits 1
// when any file nests branches deeper than STRICT_MAX_DEPTH. No file
// writes.
//
// Usage:
//   node scripts/scoreboard-complexity-hotspots.mjs [--json] [--limit N] [--strict] [file ...]
//
// With no file arguments the whole `src/` tree is reported. With file
// arguments, only those files are shown (paths are root-relative,
// e.g. `src/data/foo.js`). `--limit N` caps the ranked list (0 means
// all; default 10).
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  STRICT_MAX_DEPTH,
  analyzeFiles,
  discoverSourceFiles,
  filterHotspotsByFiles,
  formatComplexityReport,
  limitHotspots,
  parseCliArgs,
  rankHotspots,
  summarizeResults,
} from './complexityHotspots.mjs';

const USAGE = `Usage:
  node scripts/scoreboard-complexity-hotspots.mjs [--json] [--limit N] [--strict] [file ...]

Static complexity-hotspot scoreboard for src/. Report-only: exit 0
even when hotspots exist. --strict exits 1 when any file nests
branches deeper than ${STRICT_MAX_DEPTH}. --limit N caps the ranked
list (0 means all; default 10). With file arguments, only those files
are shown.`;

export async function runComplexityScoreboard(root, argv = process.argv) {
  const args = parseCliArgs(argv.slice(2));
  if (args.error) {
    console.error(`scoreboard-complexity-hotspots: ${args.error}`);
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
    console.error(
      `scoreboard-complexity-hotspots: cannot read source: ${error}`,
    );
    return 2;
  }
  const { results, stats } = analysis;

  let hotspots = results;
  if (args.positional.length) {
    const wanted = args.positional.map((file) => {
      const absolute = path.isAbsolute(file) ? file : path.join(root, file);
      return path.relative(root, absolute);
    });
    hotspots = filterHotspotsByFiles(results, wanted);
  }
  const ranked = rankHotspots(hotspots);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary: summarizeResults(stats, hotspots),
          hotspots: limitHotspots(ranked, args.limit),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      formatComplexityReport({ stats, hotspots: ranked }, args.limit),
    );
  }

  if (args.strict) {
    const deep = ranked.filter(
      (profile) => profile.maxDepth > STRICT_MAX_DEPTH,
    );
    if (deep.length) {
      console.error(
        `scoreboard-complexity-hotspots: --strict failed on ` +
          `${deep.length} file(s) with branch nesting deeper than ` +
          `${STRICT_MAX_DEPTH}`,
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
  process.exitCode = await runComplexityScoreboard(root, process.argv);
}
