import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_ROOTS,
  TEST_INFRASTRUCTURE_DIRS,
  coLocatedTestFor,
  formatUntestedSourcesReport,
  hasStrictViolation,
  isSourceFile,
  isTestFile,
  resolveImportSpecifier,
  scanUntestedSources,
  summarizeUntestedSources,
  testLinkedSources,
} from './untestedSources.js';

test('co-located test names follow the .test.mjs convention', () => {
  assert.equal(coLocatedTestFor('src/foo.js'), 'src/foo.test.mjs');
  assert.equal(coLocatedTestFor('src/foo.mjs'), 'src/foo.test.mjs');
  assert.equal(
    coLocatedTestFor('server/providers/deep/nested.js'),
    'server/providers/deep/nested.test.mjs',
  );
});

test('test files are linkers, not sources', () => {
  assert.equal(isTestFile('src/foo.test.mjs'), true);
  assert.equal(isTestFile('tests/smoke.spec.mjs'), true);
  assert.equal(isTestFile('src/foo.js'), false);
  assert.equal(isSourceFile('src/foo.test.mjs'), false);
  assert.equal(isSourceFile('tests/smoke.spec.mjs'), false);
});

test('source files are production modules under src/ + server/', () => {
  assert.deepEqual(SOURCE_ROOTS, ['src', 'server']);
  assert.equal(isSourceFile('src/foo.js'), true);
  assert.equal(isSourceFile('src/foo.mjs'), true);
  assert.equal(isSourceFile('server/providers/bar.js'), true);
  assert.equal(isSourceFile('scripts/build.mjs'), false);
  assert.equal(isSourceFile('src/data.json'), false);
});

test('test infrastructure, fixtures and workers are not sources', () => {
  assert.deepEqual(TEST_INFRASTRUCTURE_DIRS, [
    'src/tooling/',
    'src/testSupport/',
  ]);
  assert.equal(isSourceFile('src/tooling/helper.js'), false);
  assert.equal(isSourceFile('src/testSupport/fixture.js'), false);
  assert.equal(isSourceFile('src/data/fixtures/sample.js'), false);
  assert.equal(isSourceFile('src/data/__fixtures__/sample.js'), false);
  assert.equal(isSourceFile('src/overlays/worker.worker.mjs'), false);
  assert.equal(isSourceFile('src/data/real.js'), true);
});

test('import specifiers resolve relative to the importing test', () => {
  const known = new Set([
    'src/foo.js',
    'src/bar.mjs',
    'src/deep/index.js',
    'src/sibling.js',
  ]);
  assert.equal(
    resolveImportSpecifier('src/other.test.mjs', './foo.js', known),
    'src/foo.js',
  );
  assert.equal(
    resolveImportSpecifier('src/nested/other.test.mjs', '../foo.js', known),
    'src/foo.js',
  );
  // Extensionless specifiers try .js, then .mjs, then index.js / index.mjs.
  assert.equal(
    resolveImportSpecifier('src/other.test.mjs', './foo', known),
    'src/foo.js',
  );
  assert.equal(
    resolveImportSpecifier('src/other.test.mjs', './bar', known),
    'src/bar.mjs',
  );
  assert.equal(
    resolveImportSpecifier('src/other.test.mjs', './deep', known),
    'src/deep/index.js',
  );
  // Bare and absolute specifiers never resolve to a repo module.
  assert.equal(
    resolveImportSpecifier('src/other.test.mjs', 'cesium', known),
    null,
  );
  assert.equal(
    resolveImportSpecifier('src/other.test.mjs', 'node:fs', known),
    null,
  );
  assert.equal(
    resolveImportSpecifier('src/other.test.mjs', './missing.js', known),
    null,
  );
});

test('test links cover from-imports, dynamic imports and side-effect imports', () => {
  const known = new Set([
    'src/a.js',
    'src/b.js',
    'src/c.js',
    'src/d.js',
    'src/t.test.mjs',
  ]);
  const content = [
    "import { a } from './a.js';",
    "import './b.js';",
    "const c = await import('./c.js');",
    "export { d } from './d.js';",
    "import { x } from 'cesium';",
    "import { y } from './missing.js';",
  ].join('\n');
  assert.deepEqual(
    [...testLinkedSources('src/t.test.mjs', content, known)].sort(),
    ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'],
  );
});

test('scan classifies co-located, import, both and untested modules', () => {
  const files = [
    'src/co.js',
    'src/co.test.mjs',
    'src/imp.js',
    'src/both.js',
    'src/both.test.mjs',
    'src/none.js',
    'src/other.test.mjs',
    'src/user.test.mjs',
  ];
  const contents = new Map([
    ['src/co.test.mjs', ''],
    ['src/both.test.mjs', "import { both } from './both.js';"],
    ['src/other.test.mjs', "import { both } from './both.js';"],
    ['src/user.test.mjs', "import { imp } from './imp.js';"],
  ]);
  const findings = scanUntestedSources(files, contents);
  const byFile = Object.fromEntries(
    findings.map((finding) => [finding.file, finding]),
  );
  assert.deepEqual(
    findings.map((finding) => finding.file),
    ['src/both.js', 'src/co.js', 'src/imp.js', 'src/none.js'],
  );
  assert.deepEqual(byFile['src/co.js'], {
    file: 'src/co.js',
    tested: true,
    linkKind: 'co-located',
    linkedBy: ['src/co.test.mjs'],
  });
  assert.deepEqual(byFile['src/imp.js'], {
    file: 'src/imp.js',
    tested: true,
    linkKind: 'import',
    linkedBy: ['src/user.test.mjs'],
  });
  assert.deepEqual(byFile['src/both.js'], {
    file: 'src/both.js',
    tested: true,
    linkKind: 'both',
    linkedBy: ['src/both.test.mjs', 'src/other.test.mjs'],
  });
  assert.deepEqual(byFile['src/none.js'], {
    file: 'src/none.js',
    tested: false,
    linkKind: null,
    linkedBy: [],
  });
});

test('scan ignores test files and counts only direct links', () => {
  // src/a.js is imported by a test; src/b.js is imported only by src/a.js
  // (transitive reach). Direct linkage counts a.js tested, b.js untested.
  const findings = scanUntestedSources(
    ['src/a.js', 'src/b.js', 'src/a.test.mjs'],
    new Map([['src/a.test.mjs', "import { a } from './a.js';"]]),
  );
  const byFile = Object.fromEntries(
    findings.map((finding) => [finding.file, finding]),
  );
  assert.equal(byFile['src/a.js'].tested, true);
  assert.equal(byFile['src/b.js'].tested, false);
});

test('summary totals, per-directory counts and link-kind counts', () => {
  const findings = scanUntestedSources(
    [
      'src/alpha/one.js',
      'src/alpha/one.test.mjs',
      'src/alpha/two.js',
      'src/beta/three.js',
      'src/beta/three.test.mjs',
      'src/beta/four.test.mjs',
    ],
    new Map([
      ['src/alpha/one.test.mjs', ''],
      ['src/beta/three.test.mjs', ''],
      ['src/beta/four.test.mjs', "import { t } from './three.js';"],
    ]),
  );
  const summary = summarizeUntestedSources(findings);
  assert.equal(summary.total, 3);
  assert.equal(summary.tested, 2);
  assert.equal(summary.untested, 1);
  assert.deepEqual(summary.untestedFiles, ['src/alpha/two.js']);
  assert.deepEqual(summary.byLinkKind, {
    'co-located': 1,
    import: 0,
    both: 1,
  });
  assert.deepEqual(summary.byDirectory, [
    { directory: 'src/alpha', total: 2, tested: 1, untested: 1 },
    { directory: 'src/beta', total: 1, tested: 1, untested: 0 },
  ]);
});

test('strict fails on any untested module and passes when all are linked', () => {
  assert.equal(hasStrictViolation([{ tested: true }, { tested: false }]), true);
  assert.equal(hasStrictViolation([{ tested: true }]), false);
  assert.equal(hasStrictViolation([]), false);
});

test('report lists untested modules with per-directory counts', () => {
  const findings = scanUntestedSources(
    ['src/a.js', 'src/b.js', 'src/a.test.mjs'],
    new Map([['src/a.test.mjs', '']]),
  );
  const report = formatUntestedSourcesReport(
    findings,
    summarizeUntestedSources(findings),
  );
  assert.match(report, /UNTESTED: 1 of 2 production module/);
  assert.match(report, /src: 1 untested \/ 2 total \(1 tested\)/);
  assert.match(report, /- src\/b\.js/);
  assert.match(report, /tested: 1\/2 \(co-located: 1, import: 0, both: 0\)/);
});

test('report says OK when nothing is untested', () => {
  const findings = scanUntestedSources(
    ['src/a.js', 'src/a.test.mjs'],
    new Map([['src/a.test.mjs', '']]),
  );
  const report = formatUntestedSourcesReport(
    findings,
    summarizeUntestedSources(findings),
  );
  assert.match(report, /OK: all 1 production module/);
  assert.doesNotMatch(report, /UNTESTED/);
});

test('drift guard: import-directions still treats tooling as tests', async () => {
  // The src/tooling/ + src/testSupport/ exclusions above mirror the
  // tests() classification in check-import-directions.mjs. If that
  // classification moves, this scoreboard's source set silently changes.
  const checker = await readFile(
    fileURLToPath(
      new URL('../../scripts/check-import-directions.mjs', import.meta.url),
    ),
    'utf8',
  );
  assert.match(checker, /src\/tooling\//);
  assert.match(checker, /src\/testSupport\//);
});
