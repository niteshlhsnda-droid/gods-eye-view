// Report the test-hygiene scoreboard: `.only` / skips / todos / empty /
// duplicate test names across src/**/*.test.mjs. Report-only by default;
// `--strict` exits 1 on `.only`, empty, or duplicate findings (never
// intentional in a committed suite). Skips and todos are always report-only.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatTestHygieneReport,
  hasStrictViolation,
  scanTestFiles,
  summarizeTestHygiene,
} from '../src/tooling/testHygiene.js';

async function discoverTestFiles(root) {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
          files.push(path.relative(root, absolute).split(path.sep).join('/'));
        }
      }),
    );
  };
  await visit(path.join(root, 'src'));
  return files.sort();
}

export async function runScoreboardTestHygiene(
  root,
  args = process.argv.slice(2),
) {
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const files = await discoverTestFiles(root);
  const entries = await Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(path.join(root, file), 'utf8'),
    })),
  );
  const findings = scanTestFiles(entries);
  const summary = summarizeTestHygiene(findings);
  if (json) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
  } else {
    console.log(formatTestHygieneReport(findings, summary));
  }
  if (strict && hasStrictViolation(findings)) {
    console.error('scoreboard:test-hygiene --strict: strict violations found');
    return 1;
  }
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (
  invokedPath ===
  fileURLToPath(new URL('scoreboard-test-hygiene.mjs', import.meta.url))
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runScoreboardTestHygiene(root);
}
