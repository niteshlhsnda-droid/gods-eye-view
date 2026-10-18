// Test-runner coverage scoreboard: every test file on disk mapped to the
// runner(s) that execute it — or flagged orphaned when no runner does.
//
// A green suite can hide untested behaviour twice over: once when a test is
// skipped (see the test-hygiene scoreboard), and again when a test file
// exists on disk but no runner ever executes it. This scanner guards the
// second failure. It is static (no test execution): it maps repo-relative
// test paths to runners by the rules the runners themselves use:
//
// - `npm test` runs `src/**/*.test.mjs` — `discoverUnitTestFiles` in
//   scripts/run-unit-tests.mjs walks only `src/`. A `*.test.mjs` anywhere
//   else is invisible to it.
// - `npm run test:features` runs `*.test.mjs` under
//   `server/providers/livenow/` and `src/livenow/` — the SUITE_ROOTS in
//   tools/run-live-now-tests.mjs. Nothing else under `server/` is covered.
// - Playwright runs `tests/**/*.spec.mjs` (testDir `tests` in
//   playwright.config.mjs), but CI invokes it per-file
//   (`npx playwright test tests/<file>.spec.mjs`) — a spec no workflow or
//   npm script invokes never runs, even though a bare `npx playwright test`
//   would pick it up. The CLI therefore passes the invoked-spec set (parsed
//   from .github/workflows/*.yml and package.json scripts) in as
//   `invokedSpecs`; a bare `playwright test` invocation sets
//   `playwrightRunsAll` and covers every spec.
//
// Live repo state at landing: 608 test files, 2 orphans —
// `server/providers/transitHistory.test.mjs` (8 passing tests, verified by
// `node --test` standalone, executed by no runner) and
// `tests/live-now-carousel.spec.mjs` (invoked by no workflow). Both are
// report-only findings until the suite owner wires them into a runner;
// `--strict` fails on any orphan.
//
// Drift guards: the unit tests assert these rules still agree with the real
// runner sources (discoverUnitTestFiles, SUITE_ROOTS, testDir, package.json
// script wiring), so a runner change that invalidates a rule fails the
// suite instead of silently desyncing this scoreboard.

export const RUNNER_UNIT = 'npm test';
export const RUNNER_FEATURES = 'npm run test:features';
export const RUNNER_PLAYWRIGHT = 'playwright';

export const RUNNER_IDS = Object.freeze([
  RUNNER_UNIT,
  RUNNER_FEATURES,
  RUNNER_PLAYWRIGHT,
]);

const TEST_SUFFIX = '.test.mjs';
const SPEC_SUFFIX = '.spec.mjs';

/** Runners that execute one repo-relative, posix-style test path. */
export function runnersForFile(
  file,
  { invokedSpecs = [], playwrightRunsAll = false } = {},
) {
  const runners = [];
  if (file.startsWith('src/') && file.endsWith(TEST_SUFFIX)) {
    runners.push(RUNNER_UNIT);
  }
  if (
    file.endsWith(TEST_SUFFIX) &&
    (file.startsWith('server/providers/livenow/') ||
      file.startsWith('src/livenow/'))
  ) {
    runners.push(RUNNER_FEATURES);
  }
  if (
    file.startsWith('tests/') &&
    file.endsWith(SPEC_SUFFIX) &&
    (playwrightRunsAll || invokedSpecs.includes(file))
  ) {
    runners.push(RUNNER_PLAYWRIGHT);
  }
  return runners;
}

/** Map test paths to their runners; `orphan` means no runner executes it. */
export function scanTestFiles(files, options = {}) {
  return [...files].sort().map((file) => {
    const runners = runnersForFile(file, options);
    return { file, runners, orphan: runners.length === 0 };
  });
}

/** Aggregate findings into totals, per-runner counts, and the orphan list. */
export function summarizeTestRunnerCoverage(findings) {
  const byRunner = Object.fromEntries(RUNNER_IDS.map((id) => [id, 0]));
  for (const finding of findings) {
    for (const runner of finding.runners) byRunner[runner] += 1;
  }
  return {
    total: findings.length,
    covered: findings.filter((finding) => !finding.orphan).length,
    orphaned: findings.filter((finding) => finding.orphan).length,
    orphans: findings
      .filter((finding) => finding.orphan)
      .map((finding) => finding.file),
    byRunner,
  };
}

/** True when any finding is orphaned (the `--strict` failure condition). */
export function hasStrictViolation(findings) {
  return findings.some((finding) => finding.orphan);
}

/** Human-readable report: one line per orphan, then the summary. */
export function formatTestRunnerCoverageReport(findings, summary) {
  const lines = ['Test-runner coverage scoreboard'];
  if (summary.orphaned === 0) {
    lines.push(
      `OK: all ${summary.total} test file(s) are executed by at least one runner.`,
    );
  } else {
    lines.push(
      `ORPHANED: ${summary.orphaned} of ${summary.total} test file(s) are executed by no runner:`,
    );
    for (const file of summary.orphans) lines.push(`  - ${file}`);
  }
  lines.push(
    `covered: ${summary.covered}/${summary.total} ` +
      `(npm test: ${summary.byRunner[RUNNER_UNIT]}, ` +
      `npm run test:features: ${summary.byRunner[RUNNER_FEATURES]}, ` +
      `playwright: ${summary.byRunner[RUNNER_PLAYWRIGHT]})`,
  );
  return `${lines.join('\n')}\n`;
}
