// Report the test-runner coverage scoreboard: every *.test.mjs / *.spec.mjs
// file on disk mapped to the runner(s) that execute it, or flagged orphaned
// when no runner does. Report-only by default; `--strict` exits 1 when any
// test file is orphaned.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatTestRunnerCoverageReport,
  hasStrictViolation,
  scanTestFiles,
  summarizeTestRunnerCoverage,
} from '../src/tooling/testRunnerCoverage.js';

const TEST_ROOTS = ['src', 'server', 'tests'];

async function discoverTestFiles(root) {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (
          entry.isFile() &&
          (entry.name.endsWith('.test.mjs') || entry.name.endsWith('.spec.mjs'))
        ) {
          files.push(path.relative(root, absolute).split(path.sep).join('/'));
        }
      }),
    );
  };
  for (const tree of TEST_ROOTS) {
    await visit(path.join(root, tree));
  }
  return files.sort();
}

// Playwright specs are covered only when some workflow or npm script
// invokes them. Parse every `playwright test ...` invocation: a bare
// invocation (no .spec.mjs argument) runs the whole tests/ dir; otherwise
// each .spec.mjs argument is one invoked spec.
const PLAYWRIGHT_RE = /playwright\s+test\b([^\n#]*)/g;

function collectInvokedSpecsFromText(text, invoked, state) {
  for (const match of text.matchAll(PLAYWRIGHT_RE)) {
    const args = match[1] ?? '';
    const specs = args.match(/[^\s"'`]+?\.spec\.mjs/g) ?? [];
    if (specs.length === 0) {
      // No spec argument: a bare `playwright test` (flags only, or nothing)
      // runs every spec under testDir.
      state.playwrightRunsAll = true;
    } else {
      for (const spec of specs) {
        const normalized = spec.startsWith('tests/')
          ? spec
          : `tests/${path.basename(spec)}`;
        invoked.add(normalized);
      }
    }
  }
}

/** Specs invoked by workflows / npm scripts, plus bare-run detection. */
export async function collectPlaywrightInvocations(root) {
  const invoked = new Set();
  const state = { playwrightRunsAll: false };
  const workflowDir = path.join(root, '.github', 'workflows');
  let workflowFiles = [];
  try {
    const entries = await readdir(workflowDir, { withFileTypes: true });
    workflowFiles = entries
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => path.join(workflowDir, entry.name));
  } catch {
    // No workflows directory (e.g. a partial checkout): no invocations.
  }
  for (const file of workflowFiles) {
    collectInvokedSpecsFromText(await readFile(file, 'utf8'), invoked, state);
  }
  let scripts = {};
  try {
    scripts =
      JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
        .scripts ?? {};
  } catch {
    // No readable package.json: no npm-script invocations.
  }
  for (const command of Object.values(scripts)) {
    if (typeof command === 'string') {
      collectInvokedSpecsFromText(command, invoked, state);
    }
  }
  return {
    invokedSpecs: [...invoked].sort(),
    playwrightRunsAll: state.playwrightRunsAll,
  };
}

export async function runScoreboardTestRunnerCoverage(
  root,
  args = process.argv.slice(2),
) {
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const files = await discoverTestFiles(root);
  const { invokedSpecs, playwrightRunsAll } =
    await collectPlaywrightInvocations(root);
  const findings = scanTestFiles(files, { invokedSpecs, playwrightRunsAll });
  const summary = summarizeTestRunnerCoverage(findings);
  if (json) {
    console.log(
      JSON.stringify(
        { summary, findings, invokedSpecs, playwrightRunsAll },
        null,
        2,
      ),
    );
  } else {
    console.log(formatTestRunnerCoverageReport(findings, summary));
  }
  if (strict && hasStrictViolation(findings)) {
    console.error(
      'scoreboard:test-runner-coverage --strict: orphaned test files found',
    );
    return 1;
  }
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (
  invokedPath ===
  fileURLToPath(new URL('scoreboard-test-runner-coverage.mjs', import.meta.url))
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runScoreboardTestRunnerCoverage(root);
}
