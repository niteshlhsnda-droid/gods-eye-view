// Report the long-parameter-list scoreboard: functions and methods in src/
// production code with more than N parameters (default 5), worst offenders
// first. Report-only; always exits 0. `--json` prints the machine-readable
// summary + findings, `--threshold N` sets the flag cutoff, `--limit N`
// caps the functions shown in the human report (default 20).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LIMIT,
  DEFAULT_THRESHOLD,
  formatLongParamsReport,
  isScannedFile,
  scanLongParams,
  summarizeLongParams,
} from '../src/tooling/longParams.js';

async function discoverSourceFiles(root) {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (
          entry.isFile() &&
          (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))
        ) {
          const relative = path
            .relative(root, absolute)
            .split(path.sep)
            .join('/');
          if (isScannedFile(relative)) files.push(relative);
        }
      }),
    );
  };
  await visit(path.join(root, 'src'));
  return files.sort();
}

function parseOption(args, flag, fallback) {
  const at = args.indexOf(flag);
  if (at === -1) return fallback;
  const parsed = Number.parseInt(args[at + 1], 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function runScoreboardLongParams(
  root,
  args = process.argv.slice(2),
) {
  const json = args.includes('--json');
  const threshold = parseOption(args, '--threshold', DEFAULT_THRESHOLD);
  const limit = parseOption(args, '--limit', DEFAULT_LIMIT);
  const files = await discoverSourceFiles(root);
  const entries = await Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(path.join(root, file), 'utf8'),
    })),
  );
  const { findings, stats } = scanLongParams(entries, { threshold });
  const summary = summarizeLongParams(findings, stats, { threshold });
  if (json) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
  } else {
    console.log(formatLongParamsReport(findings, summary, { limit }));
  }
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (
  invokedPath ===
  fileURLToPath(new URL('scoreboard-long-params.mjs', import.meta.url))
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runScoreboardLongParams(root);
}
