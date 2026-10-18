import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTestHygieneReport,
  hasStrictViolation,
  scanTestFile,
  scanTestFiles,
  summarizeTestHygiene,
} from './testHygiene.js';

const kinds = (findings) => findings.map((finding) => finding.kind);

test('clean file reports no findings', () => {
  const findings = scanTestFile(
    "test('keeps the total', () => {\n  assert.equal(1 + 1, 2);\n});\n",
    'clean.test.mjs',
  );
  assert.deepEqual(findings, []);
  assert.equal(hasStrictViolation(findings), false);
});

test('.only is a strict finding with its test name', () => {
  const findings = scanTestFile(
    "test.only('narrowed', () => {\n  assert.ok(true);\n});\n",
    'only.test.mjs',
  );
  assert.deepEqual(kinds(findings), ['only']);
  assert.equal(findings[0].name, 'narrowed');
  assert.equal(findings[0].line, 1);
  assert.equal(hasStrictViolation(findings), true);
});

test('describe.only and it.only are .only findings too', () => {
  const source = [
    "describe.only('group', () => {",
    "  it.only('case', () => { assert.ok(true); });",
    '});',
    '',
  ].join('\n');
  assert.deepEqual(kinds(scanTestFile(source, 'only2.test.mjs')), [
    'only',
    'only',
  ]);
});

test('t.skip and test.skip are report-only skips', () => {
  const source = [
    "test('conditional', async (t) => {",
    '  if (process.platform === "win32") return t.skip("no bash");',
    '  assert.ok(true);',
    '});',
    "test.skip('whole test', () => { assert.ok(true); });",
    '',
  ].join('\n');
  const findings = scanTestFile(source, 'skip.test.mjs');
  assert.deepEqual(kinds(findings), ['skip', 'skip']);
  assert.equal(findings[0].detail, 't.skip(...)');
  assert.equal(findings[1].name, 'whole test');
  assert.equal(hasStrictViolation(findings), false);
});

test('test.skip used as a conditional alias is a skip, not a name', () => {
  const findings = scanTestFile(
    'const bashTest = process.platform === "win32" ? test.skip : test;\n' +
      "bashTest('runs elsewhere', () => { assert.ok(true); });\n",
    'alias.test.mjs',
  );
  assert.deepEqual(kinds(findings), ['skip']);
  assert.equal(findings[0].name, null);
});

test('options-object { skip } is a skip with the test name', () => {
  const findings = scanTestFile(
    "test('gated', { skip: process.platform === 'win32' }, () => {\n" +
      '  assert.ok(true);\n' +
      '});\n',
    'options.test.mjs',
  );
  assert.deepEqual(kinds(findings), ['skip']);
  assert.equal(findings[0].name, 'gated');
});

test('a { skip } inside an assertion is not an options skip', () => {
  const findings = scanTestFile(
    "test('decision', () => {\n" +
      '  assert.deepEqual(decide(), { skip: true });\n' +
      '});\n',
    'assert-skip.test.mjs',
  );
  assert.deepEqual(findings, []);
});

test('nested or lookalike option keys are not findings', () => {
  const findings = scanTestFile(
    "test('lookalikes', { lonely: 1, config: { skip: true } }, () => {\n" +
      '  assert.ok(true);\n' +
      '});\n',
    'lookalike.test.mjs',
  );
  assert.deepEqual(findings, []);
});

test('test.todo is a report-only todo', () => {
  const findings = scanTestFile("test.todo('placeholder');\n", 'todo.test.mjs');
  assert.deepEqual(kinds(findings), ['todo']);
  assert.equal(findings[0].name, 'placeholder');
  assert.equal(hasStrictViolation(findings), false);
});

test('empty callback bodies are strict findings', () => {
  const source = [
    "test('empty arrow', () => {});",
    "test('empty async', async (t) => {});",
    "test('empty function', function () {});",
    "test('not empty', () => { assert.ok(true); });",
    "test('expression body', () => helper());",
    '',
  ].join('\n');
  const findings = scanTestFile(source, 'empty.test.mjs');
  assert.deepEqual(kinds(findings), ['empty', 'empty', 'empty']);
  assert.deepEqual(
    findings.map((finding) => finding.name),
    ['empty arrow', 'empty async', 'empty function'],
  );
  assert.equal(hasStrictViolation(findings), true);
});

test('a test with no callback is an empty finding', () => {
  const findings = scanTestFile("test('no callback');\n", 'nocb.test.mjs');
  assert.deepEqual(kinds(findings), ['empty']);
});

test('a test delegating to a shared function is not empty', () => {
  const findings = scanTestFile(
    "test('delegated', sharedImplementation);\n",
    'delegated.test.mjs',
  );
  assert.deepEqual(findings, []);
});

test('duplicate test names collapse to one finding per name', () => {
  const source = [
    "test('same', () => { assert.ok(true); });",
    'test("same", () => { assert.ok(true); });',
    "test('other', () => { assert.ok(true); });",
    "test('same', () => { assert.ok(true); });",
    '',
  ].join('\n');
  const findings = scanTestFile(source, 'dup.test.mjs');
  assert.deepEqual(kinds(findings), ['duplicate']);
  assert.equal(findings[0].name, 'same');
  assert.match(findings[0].detail, /3 times \(lines 1, 2, 4\)/);
  assert.equal(hasStrictViolation(findings), true);
});

test('dynamic template-literal names are not duplicate-checked', () => {
  const findings = scanTestFile(
    'test(`case ${name}`, () => { assert.ok(true); });\n' +
      'test(`case ${name}`, () => { assert.ok(true); });\n',
    'dynamic.test.mjs',
  );
  assert.deepEqual(findings, []);
});

test('astral characters (emoji) before a call do not desync masking', () => {
  const source = [
    "const label = `📻 ${'a'.repeat(2)} more`;",
    "test('after emoji', () => { assert.ok(true); });",
    '',
  ].join('\n');
  assert.deepEqual(scanTestFile(source, 'emoji.test.mjs'), []);
});

test('nested templates inside interpolation do not desync masking', () => {
  const source = [
    'const label = `outer ${`inner ${name}`} tail`;',
    "test('after nested template', () => { assert.ok(true); });",
    '',
  ].join('\n');
  assert.deepEqual(scanTestFile(source, 'nested.test.mjs'), []);
});

test('RegExp.prototype.test and receiver .test( are not test() calls', () => {
  const source = [
    "test('regex check', () => {",
    '  assert.equal(/texland/i.test(name), true);',
    '  assert.equal(result.test(value), false);',
    '});',
    '',
  ].join('\n');
  assert.deepEqual(scanTestFile(source, 'receiver.test.mjs'), []);
});

test('t.test( subtests are scanned; other receivers are not', () => {
  const findings = scanTestFile(
    "test('parent', async (t) => {\n" +
      '  await t.test("empty subtest", () => {});\n' +
      '});\n',
    'sub.test.mjs',
  );
  assert.deepEqual(kinds(findings), ['empty']);
  assert.equal(findings[0].name, 'empty subtest');
});

test('a regex character class holding / does not desync masking', () => {
  const source = [
    "test('slash class', () => {",
    '  assert.equal(/[/]/.test(path), true);',
    '});',
    "test('after slash class', () => { assert.ok(true); });",
    '',
  ].join('\n');
  assert.deepEqual(scanTestFile(source, 'slashclass.test.mjs'), []);
});

test('patterns inside comments, strings, and regexes are not findings', () => {
  const source = [
    "// test.only('in a comment', () => {});",
    '/* test.skip("in a block comment", () => {}); */',
    "const label = 'test.only and t.skip live here';",
    'const pattern = /test\\.only/;',
    "test('real', () => { assert.ok(true); });",
    '',
  ].join('\n');
  assert.deepEqual(scanTestFile(source, 'masked.test.mjs'), []);
});

test('summarize counts per kind and lists strict violations', () => {
  const findings = scanTestFiles([
    {
      file: 'a.test.mjs',
      source: "test.only('x', () => { assert.ok(true); });\n",
    },
    {
      file: 'b.test.mjs',
      source:
        "test('y', async (t) => { return t.skip('nope'); });\n" +
        "test.todo('z');\n",
    },
  ]);
  const summary = summarizeTestHygiene(findings);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.byKind, {
    only: 1,
    skip: 1,
    todo: 1,
    empty: 0,
    duplicate: 0,
  });
  assert.deepEqual(summary.files, ['a.test.mjs', 'b.test.mjs']);
  assert.equal(summary.strictViolations, 1);
  assert.match(
    formatTestHygieneReport(findings, summary),
    /total=3 only=1 skip=1 todo=1 empty=0 duplicate=0 strictViolations=1/,
  );
});
