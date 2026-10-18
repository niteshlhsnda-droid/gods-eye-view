import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDeadExports,
  describeModule,
  isTestFile,
  resolveImport,
} from '../../scripts/dead-exports.mjs';

const files = (entries) => new Map(Object.entries(entries));

test('a used export is not a candidate; an unused one is', () => {
  const result = analyzeDeadExports(
    files({
      'src/a.js': `export const used = 1;\nexport const dead = 2;\n`,
      'src/b.js': `import { used } from './a.js';\nconsole.log(used);\n`,
    }),
  );
  assert.deepEqual(result.candidates, [
    { file: 'src/a.js', name: 'dead', kind: 'named', importedBy: 1 },
  ]);
});

test('a re-export counts as usage of the original', () => {
  const result = analyzeDeadExports(
    files({
      'src/a.js': `export const value = 1;\n`,
      'src/barrel.js': `export { value } from './a.js';\n`,
    }),
  );
  assert.deepEqual(result.candidates, [
    { file: 'src/barrel.js', name: 'value', kind: 'named', importedBy: 0 },
  ]);
});

test('export * marks every source export used', () => {
  const result = analyzeDeadExports(
    files({
      'src/a.js': `export const one = 1;\nexport const two = 2;\n`,
      'src/barrel.js': `export * from './a.js';\n`,
    }),
  );
  assert.deepEqual(result.candidates, []);
});

test('a namespace import marks every export used', () => {
  const result = analyzeDeadExports(
    files({
      'src/a.js': `export const one = 1;\nexport const two = 2;\n`,
      'src/b.js': `import * as a from './a.js';\nconsole.log(a);\n`,
    }),
  );
  assert.deepEqual(result.candidates, []);
});

test('a literal dynamic import marks every export used', () => {
  const result = analyzeDeadExports(
    files({
      'src/a.js': `export const one = 1;\n`,
      'src/b.js': `const mod = await import('./a.js');\nconsole.log(mod);\n`,
    }),
  );
  assert.deepEqual(result.candidates, []);
});

test('default exports: used by a default import, flagged otherwise', () => {
  const used = analyzeDeadExports(
    files({
      'src/a.js': `export default function main() {}\n`,
      'src/b.js': `import main from './a.js';\nmain();\n`,
    }),
  );
  assert.deepEqual(used.candidates, []);
  const dead = analyzeDeadExports(
    files({
      'src/a.js': `export default function main() {}\n`,
      'src/b.js': `export const other = 1;\n`,
    }),
  );
  assert.deepEqual(dead.candidates, [
    { file: 'src/a.js', name: 'default', kind: 'default', importedBy: 0 },
    { file: 'src/b.js', name: 'other', kind: 'named', importedBy: 0 },
  ]);
});

test('self-imports never mark anything used', () => {
  const result = analyzeDeadExports(
    files({
      'src/a.js': `export const value = 1;\nimport { value } from './a.js';\nconsole.log(value);\n`,
    }),
  );
  assert.deepEqual(result.candidates, [
    { file: 'src/a.js', name: 'value', kind: 'named', importedBy: 0 },
  ]);
});

test('external and unresolved imports are ignored, never crash', () => {
  const result = analyzeDeadExports(
    files({
      'src/a.js': `import React from 'react';\nimport { missing } from './nope.js';\nexport const value = 1;\n`,
    }),
  );
  assert.equal(result.totalModules, 1);
  assert.deepEqual(result.candidates, [
    { file: 'src/a.js', name: 'value', kind: 'named', importedBy: 0 },
  ]);
});

test('orphan modules are listed separately', () => {
  const result = analyzeDeadExports(
    files({
      'src/a.js': `export const value = 1;\n`,
      'src/b.js': `import { value } from './a.js';\nconsole.log(value);\n`,
      'src/orphan.js': `export const lonely = 1;\n`,
    }),
  );
  assert.deepEqual(result.orphanModules, ['src/orphan.js']);
});

test('extensionless and directory imports resolve', () => {
  const known = new Set(['src/a.js', 'src/dir/index.js']);
  assert.equal(resolveImport('src/b.js', './a', known), 'src/a.js');
  assert.equal(resolveImport('src/b.js', './dir', known), 'src/dir/index.js');
  assert.equal(resolveImport('src/b.js', 'react', known), null);
});

test('describeModule sees declarations, defaults, and specifiers', () => {
  const { exports, imports } = describeModule(
    `export const a = 1;\nexport function b() {}\nexport default 3;\n` +
      `import { c } from './c.js';\nconsole.log(c);\n`,
  );
  assert.deepEqual([...exports.keys()], ['a', 'b', 'default']);
  assert.deepEqual(imports, [
    { source: './c.js', imported: 'c', reExport: false },
  ]);
});

test('test files are excluded by name', () => {
  assert.equal(isTestFile('src/a.test.mjs'), true);
  assert.equal(isTestFile('src/a.analyst.test.mjs'), true);
  assert.equal(isTestFile('src/a.js'), false);
});
