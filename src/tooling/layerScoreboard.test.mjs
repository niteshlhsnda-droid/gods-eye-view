import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  collectLayerEntries,
  formatLayerScoreboard,
  scoreboardExitCode,
  summarizeLayerTests,
} from './layerScoreboard.js';

test('summarizes per-layer counts and flags test-less layers', () => {
  const report = summarizeLayerTests([
    { layer: 'b', file: 'a.js', isTest: false },
    { layer: 'b', file: 'a.test.mjs', isTest: true },
    { layer: 'a', file: 'x.js', isTest: false },
  ]);
  assert.deepEqual(
    report.layers.map((row) => row.layer),
    ['a', 'b'],
  );
  assert.deepEqual(report.layers[0], {
    layer: 'a',
    files: 1,
    tests: 0,
    testRatio: 0,
    hasTests: false,
  });
  assert.equal(report.layers[1].testRatio, 0.5);
  assert.deepEqual(report.totals, {
    layers: 2,
    files: 3,
    tests: 1,
    layersWithoutTests: ['a'],
  });
});

test('empty input yields an empty report', () => {
  assert.deepEqual(summarizeLayerTests([]), {
    layers: [],
    totals: { layers: 0, files: 0, tests: 0, layersWithoutTests: [] },
  });
});

test('collectLayerEntries walks a fixture tree', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gev-scoreboard-'));
  const layerDir = path.join(root, 'src', 'layers', 'demo', 'nested');
  mkdirSync(layerDir, { recursive: true });
  writeFileSync(path.join(layerDir, '..', 'index.js'), 'export {};\n');
  writeFileSync(path.join(layerDir, 'index.test.mjs'), 'export {};\n');
  writeFileSync(path.join(layerDir, 'helper.js'), 'export {};\n');
  writeFileSync(path.join(layerDir, 'notes.md'), '# not js\n');
  const entries = collectLayerEntries(root);
  assert.deepEqual(
    entries.map((e) => [e.file, e.isTest]).sort(),
    [
      ['index.js', false],
      ['nested/helper.js', false],
      ['nested/index.test.mjs', true],
    ].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  );
  assert.ok(entries.every((e) => e.layer === 'demo'));
});

test('format renders a table with totals and the no-test list', () => {
  const report = summarizeLayerTests([
    { layer: 'a', file: 'x.js', isTest: false },
    { layer: 'b', file: 'y.test.mjs', isTest: true },
  ]);
  const text = formatLayerScoreboard(report);
  assert.match(text, /a \| 1 \| 0 \| 0\.00 \| NO TESTS/);
  assert.match(text, /Layers without tests: a/);
  assert.match(text, /TOTAL \| 2 \| 1/);
});

test('exit code is 0 by default, 1 in strict mode with test-less layers', () => {
  const report = summarizeLayerTests([
    { layer: 'a', file: 'x.js', isTest: false },
  ]);
  assert.equal(scoreboardExitCode(report), 0);
  assert.equal(scoreboardExitCode(report, { strict: true }), 1);
  const clean = summarizeLayerTests([
    { layer: 'a', file: 'x.test.mjs', isTest: true },
  ]);
  assert.equal(scoreboardExitCode(clean, { strict: true }), 0);
});
