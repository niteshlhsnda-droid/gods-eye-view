import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  analyzeTestFile,
  analyzeTestFiles,
  describeTestCall,
  discoverTestFiles,
  isAssertionCall,
  isTestFile,
} from '../../scripts/test-assertion-strength.mjs';

const source = (lines) => lines.join('\n');

test('isTestFile matches only the .test.mjs suffix', () => {
  assert.equal(isTestFile('src/foo.test.mjs'), true);
  assert.equal(isTestFile('src/foo.mjs'), false);
  assert.equal(isTestFile('src/foo.test.js'), false);
});

test('analyzeTestFile counts assertions per test and flags zero-assertion tests', () => {
  const result = analyzeTestFile(
    source([
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('one', () => {",
      '  assert.equal(1, 1);',
      '  assert.ok(true);',
      '});',
      "test('two', () => {});",
    ]),
  );
  assert.deepEqual(result.tests, [
    { name: 'one', line: 3, assertions: 2 },
    { name: 'two', line: 7, assertions: 0 },
  ]);
  assert.equal(result.totalTests, 2);
  assert.equal(result.assertionsInTests, 2);
  assert.equal(result.fileLevelAssertions, 0);
  assert.equal(result.totalAssertions, 2);
  assert.equal(result.assertionsPerTest, 1);
  assert.deepEqual(result.zeroAssertionTests, [
    { name: 'two', line: 7, assertions: 0 },
  ]);
});

test('analyzeTestFile counts each expect call once, not its chained matchers', () => {
  const result = analyzeTestFile(
    source([
      "import { test } from 'node:test';",
      "test('expects', () => {",
      '  expect(value).toBe(1);',
      '  expect(other).not.toEqual(2);',
      '});',
    ]),
  );
  assert.deepEqual(result.tests, [{ name: 'expects', line: 2, assertions: 2 }]);
  assert.equal(result.assertionsInTests, 2);
});

test('analyzeTestFile attributes t.assert to the enclosing test and t.test as its own test', () => {
  const result = analyzeTestFile(
    source([
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('outer', (t) => {",
      '  t.assert.equal(1, 1);',
      "  t.test('inner', () => {",
      '    assert.ok(true);',
      '  });',
      '});',
    ]),
  );
  assert.deepEqual(result.tests, [
    { name: 'outer', line: 3, assertions: 1 },
    { name: 'inner', line: 5, assertions: 1 },
  ]);
  assert.equal(result.assertionsInTests, 2);
});

test('analyzeTestFile counts test.only / test.skip but excludes test.todo', () => {
  const result = analyzeTestFile(
    source([
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test.only('only', () => {",
      '  assert.ok(true);',
      '});',
      "test.skip('skipped', () => {});",
      "test.todo('later');",
    ]),
  );
  assert.deepEqual(result.tests, [
    { name: 'only', line: 3, assertions: 1 },
    { name: 'skipped', line: 6, assertions: 0 },
  ]);
  assert.equal(result.totalTests, 2);
  assert.equal(result.assertionsInTests, 1);
  assert.deepEqual(result.zeroAssertionTests, [
    { name: 'skipped', line: 6, assertions: 0 },
  ]);
});

test('analyzeTestFile counts it(...) blocks', () => {
  const result = analyzeTestFile(
    source(["it('works', () => {", '  assert.ok(true);', '});']),
  );
  assert.deepEqual(result.tests, [{ name: 'works', line: 1, assertions: 1 }]);
});

test('analyzeTestFile reports helper and module-scope assertions as file-level', () => {
  const result = analyzeTestFile(
    source([
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      'assert.equal(1, 1);',
      'function helper() {',
      '  assert.ok(true);',
      '}',
      "test('uses helper', () => {",
      '  helper();',
      '});',
    ]),
  );
  assert.equal(result.fileLevelAssertions, 2);
  assert.equal(result.assertionsInTests, 0);
  assert.equal(result.totalAssertions, 2);
  assert.deepEqual(result.zeroAssertionTests, [
    { name: 'uses helper', line: 7, assertions: 0 },
  ]);
});

test('analyzeTestFile counts only bare assert(...) among lookalike calls', () => {
  const result = analyzeTestFile(
    source([
      "import { test } from 'node:test';",
      "test('mixed', () => {",
      '  assert(1 === 1);',
      '  foo.assert.equal(1, 1);',
      "  console.log('hi');",
      '});',
    ]),
  );
  assert.deepEqual(result.tests, [{ name: 'mixed', line: 2, assertions: 1 }]);
});

test('analyzeTestFile attributes assertions to the innermost enclosing test', () => {
  const result = analyzeTestFile(
    source([
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('outer', () => {",
      '  assert.ok(true);',
      "  test('inner', () => {",
      '    assert.ok(true);',
      '    assert.ok(true);',
      '  });',
      '});',
    ]),
  );
  assert.deepEqual(result.tests, [
    { name: 'outer', line: 3, assertions: 1 },
    { name: 'inner', line: 5, assertions: 2 },
  ]);
});

test('analyzeTestFile names template-literal tests and tolerates missing callbacks', () => {
  const result = analyzeTestFile(
    source([
      "import { test } from 'node:test';",
      'test(`plain name`, () => {});',
      'test(`with ${name}`, () => {});',
      "test('no callback');",
    ]),
  );
  assert.deepEqual(result.tests, [
    { name: 'plain name', line: 2, assertions: 0 },
    { name: '<anonymous>', line: 3, assertions: 0 },
    { name: 'no callback', line: 4, assertions: 0 },
  ]);
  assert.equal(result.totalTests, 3);
});

test('analyzeTestFiles aggregates totals and ranks weakest files first', () => {
  const result = analyzeTestFiles(
    new Map([
      ['src/a.test.mjs', "test('a', () => {});"],
      [
        'src/b.test.mjs',
        "test('b', () => { assert.ok(true); assert.ok(true); assert.ok(true); });",
      ],
    ]),
  );
  assert.equal(result.totalFiles, 2);
  assert.equal(result.totalTests, 2);
  assert.equal(result.assertionsInTests, 3);
  assert.equal(result.fileLevelAssertions, 0);
  assert.equal(result.totalAssertions, 3);
  assert.equal(result.assertionsPerTest, 1.5);
  assert.deepEqual(result.zeroAssertionTests, [
    { file: 'src/a.test.mjs', name: 'a', line: 1 },
  ]);
  assert.deepEqual(
    result.filesByStrength.map((entry) => entry.file),
    ['src/a.test.mjs', 'src/b.test.mjs'],
  );
  assert.equal(result.filesByStrength[0].assertionsPerTest, 0);
  assert.equal(result.filesByStrength[1].assertionsPerTest, 3);
});

test('describeTestCall identifies test calls and rejects todo and non-calls', () => {
  assert.deepEqual(
    describeTestCall({
      type: 'CallExpression',
      callee: { type: 'Identifier', name: 'test' },
      arguments: [
        { type: 'StringLiteral', value: 'named' },
        { type: 'ArrowFunctionExpression', start: 10, end: 20 },
      ],
      loc: { start: { line: 3 } },
    }),
    { name: 'named', line: 3, start: 10, end: 20 },
  );
  assert.deepEqual(
    describeTestCall({
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        computed: false,
        object: { type: 'Identifier', name: 't' },
        property: { name: 'test' },
      },
      arguments: [{ type: 'StringLiteral', value: 'sub' }],
    }),
    { name: 'sub', line: 1, start: null, end: null },
  );
  assert.equal(
    describeTestCall({
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        computed: false,
        object: { type: 'Identifier', name: 'test' },
        property: { name: 'todo' },
      },
      arguments: [{ type: 'StringLiteral', value: 'later' }],
    }),
    null,
  );
  assert.equal(describeTestCall({ type: 'Identifier', name: 'test' }), null);
});

test('isAssertionCall distinguishes assertions from matcher chains and lookalikes', () => {
  const bare = (name) => ({
    type: 'CallExpression',
    callee: { type: 'Identifier', name },
  });
  const member = (object, property) => ({
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: false,
      object,
      property: { name: property },
    },
  });
  assert.equal(isAssertionCall(bare('assert')), true);
  assert.equal(isAssertionCall(bare('expect')), true);
  assert.equal(isAssertionCall(bare('console')), false);
  assert.equal(
    isAssertionCall(member({ type: 'Identifier', name: 'assert' }, 'equal')),
    true,
  );
  assert.equal(
    isAssertionCall(
      member(
        {
          type: 'MemberExpression',
          computed: false,
          object: { type: 'Identifier', name: 't' },
          property: { name: 'assert' },
        },
        'equal',
      ),
    ),
    true,
  );
  assert.equal(
    isAssertionCall(
      member(
        {
          type: 'MemberExpression',
          computed: false,
          object: { type: 'Identifier', name: 'foo' },
          property: { name: 'assert' },
        },
        'equal',
      ),
    ),
    false,
  );
  assert.equal(
    isAssertionCall(member({ type: 'Identifier', name: 'console' }, 'log')),
    false,
  );
  assert.equal(isAssertionCall(member(bare('expect'), 'toBe')), false);
  assert.equal(isAssertionCall({ type: 'Identifier', name: 'assert' }), false);
});

test('discoverTestFiles finds only .test.mjs files under src/', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gev-assertion-strength-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/nested'), { recursive: true });
  await writeFile(path.join(root, 'src/a.test.mjs'), "test('a', () => {});");
  await writeFile(
    path.join(root, 'src/nested/b.test.mjs'),
    "test('b', () => {});",
  );
  await writeFile(path.join(root, 'src/c.mjs'), 'export const value = 1;');
  const files = discoverTestFiles(root);
  assert.deepEqual([...files.keys()].sort(), [
    'src/a.test.mjs',
    'src/nested/b.test.mjs',
  ]);
});
