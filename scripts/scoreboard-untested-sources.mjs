// Report the untested-source scoreboard: every production module under
// src/ + server/ mapped to the test(s) linked to it, or flagged untested
// when it has no co-located test and no test imports it. Report-only by
// default; `--strict` exits 1 when any module is untested. `--json` prints
// the machine-readable summary + findings instead of the human report.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_ROOTS,
  formatUntestedSourcesReport,
  hasStrictViolation,
  isTestFile,
  scanUntestedSources,
  summarizeUntestedSources,
} from '../src/tooling/untestedSources.js';

const WALK_ROOTS = [...SOURCE_ROOTS, 'tests'];

async function discoverJsFiles(root) {
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
          files.push(path.relative(root, absolute).split(path.sep).join('/'));
        }
      }),
    );
  };
  for (const tree of WALK_ROOTS) {
    await visit(path.join(root, tree));
  }
  return files.sort();
}

export async function runScoreboardUntestedSources(
  root,
  args = process.argv.slice(2),
) {
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const files = await discoverJsFiles(root);
  const testContents = new Map();
  await Promise.all(
    files
      .filter((file) => isTestFile(file))
      .map(async (file) => {
        testContents.set(file, await readFile(path.join(root, file), 'utf8'));
      }),
  );
  const findings = scanUntestedSources(files, testContents);
  const summary = summarizeUntestedSources(findings);
  if (json) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
  } else {
    console.log(formatUntestedSourcesReport(findings, summary));
  }
  if (strict && hasStrictViolation(findings)) {
    console.error(
      'scoreboard:untested-sources --strict: untested production modules found',
    );
    return 1;
  }
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (
  invokedPath ===
  fileURLToPath(new URL('scoreboard-untested-sources.mjs', import.meta.url))
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runScoreboardUntestedSources(root);
}
