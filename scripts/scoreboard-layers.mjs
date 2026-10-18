/**
 * CLI for the per-layer test-coverage scoreboard.
 *
 * Usage:
 *   node scripts/scoreboard-layers.mjs [--json] [--strict] [--root <dir>]
 *
 * Report-only by default (exit 0). `--strict` exits 1 when any layer
 * under src/layers/ has zero `.test.mjs` files.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectLayerEntries,
  formatLayerScoreboard,
  scoreboardExitCode,
  summarizeLayerTests,
} from '../src/tooling/layerScoreboard.js';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const strict = args.includes('--strict');
const rootFlag = args.indexOf('--root');
const root =
  rootFlag === -1
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    : path.resolve(args[rootFlag + 1]);

const report = summarizeLayerTests(collectLayerEntries(root));
console.log(asJson ? JSON.stringify(report, null, 2) : formatLayerScoreboard(report));
process.exitCode = scoreboardExitCode(report, { strict });
