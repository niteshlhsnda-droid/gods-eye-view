import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverUnitTestFiles } from '../../scripts/run-unit-tests.mjs';
import { collectPlaywrightInvocations } from '../../scripts/scoreboard-test-runner-coverage.mjs';
import {
  RUNNER_FEATURES,
  RUNNER_PLAYWRIGHT,
  RUNNER_UNIT,
  formatTestRunnerCoverageReport,
  hasStrictViolation,
  runnersForFile,
  scanTestFiles,
  summarizeTestRunnerCoverage,
} from './testRunnerCoverage.js';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('npm test covers src tests only', () => {
  assert.deepEqual(runnersForFile('src/data/manager.test.mjs'), [RUNNER_UNIT]);
  assert.deepEqual(runnersForFile('src/livenow/panel.test.mjs'), [
    RUNNER_UNIT,
    RUNNER_FEATURES,
  ]);
  // A server test outside the livenow tree is invisible to npm test.
  assert.deepEqual(
    runnersForFile('server/providers/transitHistory.test.mjs'),
    [],
  );
});

test('test:features covers the two livenow trees', () => {
  assert.deepEqual(runnersForFile('server/providers/livenow/rank.test.mjs'), [
    RUNNER_FEATURES,
  ]);
  assert.deepEqual(runnersForFile('src/livenow/service.test.mjs'), [
    RUNNER_UNIT,
    RUNNER_FEATURES,
  ]);
  // A src test outside livenow gets npm test only, not test:features.
  assert.deepEqual(runnersForFile('src/data/flights.test.mjs'), [RUNNER_UNIT]);
});

test('playwright specs are covered only when invoked', () => {
  assert.deepEqual(
    runnersForFile('tests/smoke.spec.mjs', {
      invokedSpecs: ['tests/smoke.spec.mjs'],
    }),
    [RUNNER_PLAYWRIGHT],
  );
  // A spec no workflow or npm script invokes is orphaned, even though a
  // bare `npx playwright test` would pick it up.
  assert.deepEqual(
    runnersForFile('tests/live-now-carousel.spec.mjs', {
      invokedSpecs: ['tests/smoke.spec.mjs'],
    }),
    [],
  );
  // A bare `playwright test` invocation covers every spec.
  assert.deepEqual(
    runnersForFile('tests/live-now-carousel.spec.mjs', {
      playwrightRunsAll: true,
    }),
    [RUNNER_PLAYWRIGHT],
  );
});

test('non-test paths get no runner', () => {
  assert.deepEqual(runnersForFile('src/data/manager.js'), []);
  assert.deepEqual(runnersForFile('server/providers/transitHistory.js'), []);
});

test('scan/summarize/format report orphans and counts', () => {
  const findings = scanTestFiles([
    'src/data/manager.test.mjs',
    'server/providers/transitHistory.test.mjs',
    'tests/smoke.spec.mjs',
  ]);
  const summary = summarizeTestRunnerCoverage(findings);
  assert.equal(summary.total, 3);
  assert.equal(summary.covered, 1);
  assert.equal(summary.orphaned, 2);
  assert.deepEqual(summary.orphans, [
    'server/providers/transitHistory.test.mjs',
    'tests/smoke.spec.mjs',
  ]);
  assert.equal(summary.byRunner[RUNNER_UNIT], 1);
  assert.equal(summary.byRunner[RUNNER_FEATURES], 0);
  assert.equal(summary.byRunner[RUNNER_PLAYWRIGHT], 0);
  assert.equal(hasStrictViolation(findings), true);
  assert.equal(
    hasStrictViolation(findings.filter((finding) => !finding.orphan)),
    false,
  );
  const report = formatTestRunnerCoverageReport(findings, summary);
  assert.match(report, /ORPHANED: 2 of 3/);
  assert.match(report, /server\/providers\/transitHistory\.test\.mjs/);
  assert.match(report, /covered: 1\/3/);
});

test('drift guard: scanner npm-test rule agrees with discoverUnitTestFiles', () => {
  const discovered = discoverUnitTestFiles(root);
  assert.ok(discovered.length > 500, 'expected hundreds of src unit tests');
  for (const file of discovered) {
    assert.ok(
      runnersForFile(file).includes(RUNNER_UNIT),
      `${file} discovered by npm test but not classified as covered by it`,
    );
  }
});

test('drift guard: runner wiring still matches the documented rules', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.test, 'node scripts/run-unit-tests.mjs');
  assert.equal(
    pkg.scripts['test:features'],
    'node tools/run-live-now-tests.mjs',
  );
  // test:features suite roots.
  const liveNowRunner = read('tools/run-live-now-tests.mjs');
  assert.match(liveNowRunner, /server\/providers\/livenow/);
  assert.match(liveNowRunner, /src\/livenow/);
  // Playwright spec root.
  assert.match(read('playwright.config.mjs'), /testDir:\s*['"]tests['"]/);
  // npm-test discovery root.
  assert.match(
    read('scripts/run-unit-tests.mjs'),
    /path\.join\(root,\s*['"]src['"]\)/,
  );
});

test('live repo: the two known orphans are the only orphans', async () => {
  const { invokedSpecs, playwrightRunsAll } =
    await collectPlaywrightInvocations(root);
  assert.equal(playwrightRunsAll, false);
  assert.ok(invokedSpecs.includes('tests/smoke.spec.mjs'));
  assert.ok(invokedSpecs.includes('tests/axe-audit.spec.mjs'));
  assert.ok(invokedSpecs.includes('tests/post-deploy-smoke.spec.mjs'));
  assert.equal(
    invokedSpecs.includes('tests/live-now-carousel.spec.mjs'),
    false,
  );
  const findings = scanTestFiles(
    discoverUnitTestFiles(root).concat([
      'server/providers/livenow/cache.test.mjs',
      'server/providers/livenow/gdelt.test.mjs',
      'server/providers/livenow/ingest.test.mjs',
      'server/providers/livenow/rank.test.mjs',
      'server/providers/transitHistory.test.mjs',
      'tests/smoke.spec.mjs',
      'tests/axe-audit.spec.mjs',
      'tests/post-deploy-smoke.spec.mjs',
      'tests/live-now-carousel.spec.mjs',
    ]),
    { invokedSpecs, playwrightRunsAll },
  );
  // NOTE: the server/tests lists above are the full inventory at landing;
  // if a test file is added, extend them (the CLI discovers from disk).
  const summary = summarizeTestRunnerCoverage(findings);
  assert.deepEqual(summary.orphans, [
    'server/providers/transitHistory.test.mjs',
    'tests/live-now-carousel.spec.mjs',
  ]);
});
