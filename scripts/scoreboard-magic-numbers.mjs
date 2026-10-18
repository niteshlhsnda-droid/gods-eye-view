// Report the magic-number scoreboard: every numeric literal in src/
// production code that is not obviously fine (0/1/-1), not a named
// constant initializer, and not inside a string or comment — ranked by
// file so the worst offenders get reviewed first. Report-only; always
// exits 0. `--json` prints the machine-readable summary + findings,
// `--limit N` caps the files shown in the human report (default 20).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatMagicNumbersReport,
  isScannedFile,
  scanMagicNumbers,
  summarizeMagicNumbers,
} from '../src/tooling/magicNumbers.js';

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

function parseLimit(args) {
  const at = args.indexOf('--limit');
  if (at === -1) return 20;
  const parsed = Number.parseInt(args[at + 1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

export async function runScoreboardMagicNumbers(
  root,
  args = process.argv.slice(2),
) {
  const json = args.includes('--json');
  const limit = parseLimit(args);
  const files = await discoverSourceFiles(root);
  const entries = await Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(path.join(root, file), 'utf8'),
    })),
  );
  const findings = scanMagicNumbers(entries);
  const summary = summarizeMagicNumbers(findings);
  if (json) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
  } else {
    console.log(formatMagicNumbersReport(findings, summary, { limit }));
  }
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (
  invokedPath ===
  fileURLToPath(new URL('scoreboard-magic-numbers.mjs', import.meta.url))
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runScoreboardMagicNumbers(root);
}
