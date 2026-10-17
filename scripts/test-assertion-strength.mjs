/**
 * Test-assertion-strength scoreboard: how many assertions each test
 * actually makes.
 *
 * Static analysis only — it parses each test file under src/, finds
 * `test(...)` / `it(...)` blocks (including `.only` / `.skip` and nested
 * `t.test(...)` subtests), and counts assertion calls inside each block:
 * `assert.*` / bare `assert(...)` from `node:assert`, `t.assert.*`, and
 * `expect(...)` (counted once; chained matchers are not double-counted).
 * Assertions outside any test block (helpers, module scope) are reported
 * separately as file-level assertions.
 *
 * The report is advisory, NOT a verdict. A zero-assertion test is a
 * candidate for review, not proof of a vacuous test: assertions can live
 * in helpers the test calls, or a test can legitimately assert only
 * through `assert.doesNotThrow`-style behaviour the counter still sees.
 * Conversely, a high assertion count does not prove a strong test.
 * `test.todo(...)` placeholders are excluded — the hygiene scoreboard
 * already owns them.
 *
 * CLI (report-only, always exit 0):
 *   node scripts/test-assertion-strength.mjs [--json] [--root <dir>]
 *
 * @module scripts/test-assertion-strength
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parsers } from 'prettier/plugins/babel.mjs';

const TEST_SUFFIX = '.test.mjs';
const TEST_FUNCTIONS = new Set(['test', 'it']);
const TEST_MODIFIERS = new Set(['only', 'skip']);

/** Whether a relative path is a test file (included in the scan). */
export function isTestFile(relativePath) {
  return relativePath.endsWith(TEST_SUFFIX);
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'tokens', 'extra'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function isFunctionNode(node) {
  return (
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression'
  );
}

function testNameFromArgs(args) {
  const first = args?.[0];
  if (first?.type === 'StringLiteral') return first.value;
  if (first?.type === 'TemplateLiteral' && first.expressions.length === 0) {
    return first.quasis[0]?.value?.cooked ?? '<anonymous>';
  }
  return '<anonymous>';
}

/**
 * Describe a `test(...)` / `it(...)` call, or null when the node is not
 * one. `test.todo(...)` returns null: placeholders belong to the hygiene
 * scoreboard, not this one.
 */
export function describeTestCall(node) {
  if (node?.type !== 'CallExpression') return null;
  const callee = node.callee;
  let isTest = false;
  if (callee?.type === 'Identifier' && TEST_FUNCTIONS.has(callee.name)) {
    isTest = true;
  } else if (callee?.type === 'MemberExpression' && !callee.computed) {
    const object = callee.object;
    const property = callee.property?.name;
    if (
      object?.type === 'Identifier' &&
      TEST_FUNCTIONS.has(object.name) &&
      TEST_MODIFIERS.has(property)
    ) {
      isTest = true;
    } else if (
      object?.type === 'Identifier' &&
      object.name === 't' &&
      TEST_FUNCTIONS.has(property)
    ) {
      isTest = true;
    }
  }
  if (!isTest) return null;
  const callback = (node.arguments ?? []).find(isFunctionNode) ?? null;
  return {
    name: testNameFromArgs(node.arguments),
    line: node.loc?.start?.line ?? 1,
    start: callback?.start ?? null,
    end: callback?.end ?? null,
  };
}

/**
 * Whether a call's callee chain bottoms out at an `expect(...)` call, i.e.
 * the call is a matcher chained off `expect(...)` (`.toBe`, `.not.toEqual`,
 * …) and must not be counted a second time.
 */
function isExpectMatcherChain(node) {
  let current = node.callee?.object;
  while (current?.type === 'MemberExpression') current = current.object;
  return (
    current?.type === 'CallExpression' &&
    current.callee?.type === 'Identifier' &&
    current.callee.name === 'expect'
  );
}

/** Whether a call expression is an assertion call. */
export function isAssertionCall(node) {
  if (node?.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee?.type === 'Identifier') {
    return callee.name === 'assert' || callee.name === 'expect';
  }
  if (callee?.type !== 'MemberExpression' || callee.computed) return false;
  if (isExpectMatcherChain(node)) return false;
  // `assert.equal(...)`, `assert.deepEqual(...)`, … — the leftmost
  // object of the callee chain is the `assert` identifier.
  let current = callee.object;
  while (current?.type === 'MemberExpression') current = current.object;
  if (current?.type === 'Identifier' && current.name === 'assert') {
    return true;
  }
  // `t.assert.equal(...)` — callee object is the `t.assert` member chain.
  const object = callee.object;
  return (
    object?.type === 'MemberExpression' &&
    !object.computed &&
    object.object?.type === 'Identifier' &&
    object.object.name === 't' &&
    object.property?.name === 'assert'
  );
}

/**
 * Analyze one test file's source.
 * @param {string} source Test file source.
 * @returns {{tests: Array<{name: string, line: number, assertions: number}>,
 *   totalTests: number, assertionsInTests: number,
 *   fileLevelAssertions: number, totalAssertions: number,
 *   zeroAssertionTests: Array<{name: string, line: number}>,
 *   assertionsPerTest: number}}
 */
export function analyzeTestFile(source) {
  const ast = parsers.babel.parse(source);
  const tests = [];
  const assertions = [];
  walk(ast, (node) => {
    const test = describeTestCall(node);
    if (test) tests.push(test);
    else if (isAssertionCall(node)) assertions.push(node);
  });
  let fileLevelAssertions = 0;
  for (const assertion of assertions) {
    const start = assertion.start ?? 0;
    let owner = null;
    for (const test of tests) {
      if (
        test.start === null ||
        test.end === null ||
        start < test.start ||
        start > test.end
      ) {
        continue;
      }
      if (owner === null || test.end - test.start < owner.end - owner.start) {
        owner = test;
      }
    }
    if (owner === null) fileLevelAssertions += 1;
    else owner.assertions = (owner.assertions ?? 0) + 1;
  }
  const entries = tests.map((test) => ({
    name: test.name,
    line: test.line,
    assertions: test.assertions ?? 0,
  }));
  const assertionsInTests = entries.reduce(
    (sum, entry) => sum + entry.assertions,
    0,
  );
  return {
    tests: entries,
    totalTests: entries.length,
    assertionsInTests,
    fileLevelAssertions,
    totalAssertions: assertionsInTests + fileLevelAssertions,
    zeroAssertionTests: entries.filter((entry) => entry.assertions === 0),
    assertionsPerTest:
      entries.length === 0 ? 0 : assertionsInTests / entries.length,
  };
}

/**
 * Analyze a set of test files.
 * @param {Map<string, string>} files Relative path -> source.
 * @returns {{totalFiles: number, totalTests: number,
 *   assertionsInTests: number, fileLevelAssertions: number,
 *   totalAssertions: number, assertionsPerTest: number,
 *   zeroAssertionTests: Array<{file: string, name: string, line: number}>,
 *   filesByStrength: Array<{file: string, tests: number,
 *   assertions: number, assertionsPerTest: number,
 *   zeroAssertionTests: number}>}}
 */
export function analyzeTestFiles(files) {
  const filesByStrength = [];
  const zeroAssertionTests = [];
  let totalTests = 0;
  let assertionsInTests = 0;
  let fileLevelAssertions = 0;
  for (const [file, source] of files) {
    const result = analyzeTestFile(source);
    totalTests += result.totalTests;
    assertionsInTests += result.assertionsInTests;
    fileLevelAssertions += result.fileLevelAssertions;
    for (const entry of result.zeroAssertionTests) {
      zeroAssertionTests.push({ file, name: entry.name, line: entry.line });
    }
    filesByStrength.push({
      file,
      tests: result.totalTests,
      assertions: result.assertionsInTests,
      assertionsPerTest: result.assertionsPerTest,
      zeroAssertionTests: result.zeroAssertionTests.length,
    });
  }
  filesByStrength.sort(
    (a, b) =>
      a.assertionsPerTest - b.assertionsPerTest ||
      b.tests - a.tests ||
      a.file.localeCompare(b.file),
  );
  zeroAssertionTests.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
  return {
    totalFiles: files.size,
    totalTests,
    assertionsInTests,
    fileLevelAssertions,
    totalAssertions: assertionsInTests + fileLevelAssertions,
    assertionsPerTest: totalTests === 0 ? 0 : assertionsInTests / totalTests,
    zeroAssertionTests,
    filesByStrength,
  };
}

/** Discover scanned test files under a root directory. */
export function discoverTestFiles(root = process.cwd()) {
  const sourceRoot = path.join(root, 'src');
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && isTestFile(entry.name)) {
        const relative = path
          .relative(root, absolute)
          .split(path.sep)
          .join('/');
        files.set(relative, readFileSync(absolute, 'utf8'));
      }
    }
  };
  visit(sourceRoot);
  return files;
}

function main(argv) {
  const args = argv.slice(2);
  const asJson = args.includes('--json');
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
  const result = analyzeTestFiles(discoverTestFiles(root));
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `Test-assertion-strength scoreboard: ${result.totalTests} tests / ` +
      `${result.assertionsInTests} assertions in tests ` +
      `(+${result.fileLevelAssertions} file-level) / ` +
      `${result.totalFiles} files`,
  );
  console.log(`Assertions per test: ${result.assertionsPerTest.toFixed(2)}`);
  console.log(`Zero-assertion tests: ${result.zeroAssertionTests.length}`);
  for (const entry of result.zeroAssertionTests) {
    console.log(`  ${entry.file}:${entry.line} ${entry.name}`);
  }
  console.log('Weakest files (lowest assertions per test):');
  for (const entry of result.filesByStrength.slice(0, 15)) {
    console.log(
      `  ${entry.file} ${entry.assertionsPerTest.toFixed(2)} ` +
        `(${entry.assertions} assertions / ${entry.tests} tests, ` +
        `${entry.zeroAssertionTests} zero-assertion)`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
