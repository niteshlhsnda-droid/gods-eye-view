/**
 * Per-layer test-coverage scoreboard.
 *
 * Copilot lane: the repo has ~6,800 unit tests but no single view of
 * *where* they are. A layer can quietly ship with zero tests while the
 * suite stays green (the suite only runs tests that exist). This module
 * counts, per `src/layers/<name>/`, how many `.js` files exist and how
 * many of them are `.test.mjs` files, and flags layers with no tests at
 * all. Report-only by default; `--strict` turns "a layer has zero tests"
 * into a failing exit code for CI gating.
 *
 * The counting logic is pure (`summarizeLayerTests`); only
 * `collectLayerEntries` touches the filesystem, so tests can feed
 * synthetic entries. The CLI lives in `./scoreboard-layers.mjs`.
 *
 * @module scripts/layerScoreboard
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Summarize per-layer test coverage from a flat entry list.
 * @param {{layer:string, file:string, isTest:boolean}[]} entries
 * @returns {{layers:{layer:string, files:number, tests:number,
 *   testRatio:number, hasTests:boolean}[], totals:{layers:number,
 *   files:number, tests:number, layersWithoutTests:string[]}}}
 */
export function summarizeLayerTests(entries) {
  const byLayer = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.layer !== 'string' || !entry.layer) continue;
    const row = byLayer.get(entry.layer) || {
      layer: entry.layer,
      files: 0,
      tests: 0,
    };
    row.files += 1;
    if (entry.isTest) row.tests += 1;
    byLayer.set(entry.layer, row);
  }
  const layers = [...byLayer.values()]
    .map((row) => ({
      ...row,
      testRatio: row.files === 0 ? 0 : row.tests / row.files,
      hasTests: row.tests > 0,
    }))
    .sort((a, b) => (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0));
  return {
    layers,
    totals: {
      layers: layers.length,
      files: layers.reduce((sum, row) => sum + row.files, 0),
      tests: layers.reduce((sum, row) => sum + row.tests, 0),
      layersWithoutTests: layers
        .filter((row) => !row.hasTests)
        .map((row) => row.layer),
    },
  };
}

/**
 * Collect `{layer, file, isTest}` entries for every `.js`/`.mjs` file under
 * `<root>/src/layers/<layer>/` (recursive, one layer level deep).
 * @param {string} root - Repository root.
 * @returns {{layer:string, file:string, isTest:boolean}[]}
 */
export function collectLayerEntries(root) {
  const layersDir = path.join(root, 'src', 'layers');
  const entries = [];
  const visit = (directory, layer, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(absolute, layer, relative);
      else if (
        entry.isFile() &&
        (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))
      ) {
        entries.push({
          layer,
          file: relative,
          isTest: entry.name.endsWith('.test.mjs'),
        });
      }
    }
  };
  for (const entry of readdirSync(layersDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      visit(path.join(layersDir, entry.name), entry.name, '');
    }
  }
  return entries;
}

/** Render a report as a human-readable table. */
export function formatLayerScoreboard(report) {
  const lines = [
    'layer | files | tests | test ratio | status',
    '--- | ---: | ---: | ---: | ---',
  ];
  for (const row of report.layers) {
    lines.push(
      `${row.layer} | ${row.files} | ${row.tests} | ${row.testRatio.toFixed(2)} | ${row.hasTests ? 'ok' : 'NO TESTS'}`,
    );
  }
  lines.push(
    `TOTAL | ${report.totals.files} | ${report.totals.tests} | - | ${report.totals.layers} layers, ${report.totals.layersWithoutTests.length} without tests`,
  );
  if (report.totals.layersWithoutTests.length) {
    lines.push(
      `Layers without tests: ${report.totals.layersWithoutTests.join(', ')}`,
    );
  }
  return lines.join('\n');
}

/**
 * Exit code for a report: 0 normally, 1 in strict mode when any layer
 * has zero tests.
 */
export function scoreboardExitCode(report, { strict = false } = {}) {
  return strict && report.totals.layersWithoutTests.length > 0 ? 1 : 0;
}
