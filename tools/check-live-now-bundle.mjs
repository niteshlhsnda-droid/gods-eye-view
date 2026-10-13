#!/usr/bin/env node
/**
 * Live Now bundle-budget check (spec §6.4: the Live Now panel addition must be
 * ≤ 60 KB gz over the current baseline).
 *
 * BASELINE (measured 2026-10-13, feat/live-now @ 86c9042, BEFORE any livenow
 * client code landed — the Gemini lane had not started):
 *   BASELINE_GZ_BYTES = 3852717
 *   = gzip bytes of every JS file under dist/assets (sourcemaps excluded) from
 *     a clean `npm run build` (vite build, ~38s).
 *   Largest chunks then: egm96-universal 1,849,987 B gz; app entry
 *   index-*.js 878,454 B gz; second index chunk 382,252 B gz.
 *
 * The check rebuilds the client (the same command as `npm run build`),
 * re-measures, and fails when (current - BASELINE_GZ_BYTES) > 60 * 1024.
 *
 * Baseline-staleness rule: unrelated build changes (dependency bumps, other
 * lanes' chunks) shift the total legitimately. Re-baseline ONLY by rebuilding
 * on a commit with no livenow client changes and recording the new number,
 * commit, and reason here — never raise the baseline to hide Live Now growth.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASELINE_GZ_BYTES = 3852717;
const BUDGET_BYTES = 60 * 1024;

function collectJs(directory) {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (
        entry.isFile() &&
        entry.name.endsWith('.js') &&
        !entry.name.endsWith('.js.map')
      ) {
        found.push(absolute);
      }
    }
  };
  visit(directory);
  return found;
}

function main() {
  console.log('live-now bundle: rebuilding client (npm run build)…');
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    console.error('live-now bundle: build failed.');
    console.error((build.stderr || build.stdout || '').slice(-4000));
    return 1;
  }
  const assets = path.join(ROOT, 'dist', 'assets');
  const files = collectJs(assets);
  let total = 0;
  for (const file of files) total += gzipSync(readFileSync(file)).length;
  const delta = total - BASELINE_GZ_BYTES;
  console.log(
    `live-now bundle: ${files.length} js files, ${total} gz bytes ` +
      `(baseline ${BASELINE_GZ_BYTES}, delta ${delta >= 0 ? '+' : ''}${delta})`,
  );
  if (delta > BUDGET_BYTES) {
    console.error(
      `live-now bundle: OVER BUDGET by ${delta - BUDGET_BYTES} gz bytes ` +
        `(delta ${delta} > allowance ${BUDGET_BYTES}). ` +
        `The Live Now panel must add ≤ 60 KB gz over baseline.`,
    );
    return 1;
  }
  console.log('live-now bundle: within budget ✓');
  return 0;
}

process.exit(main());
