#!/usr/bin/env node
/**
 * Live Now feature-suite runner (server + client).
 *
 * Discovers `*.test.mjs` under `server/providers/livenow/` (DeepSeek lane:
 * ingest, GDELT client, rank, cache, /api/live-now) and `src/livenow/`
 * (Gemini lane: panel, card, tour, markers; Grok lane: integration tests)
 * and runs them with `node --test`.
 *
 * Pre-landing behavior: when no suites exist yet the runner exits 0 with a
 * note, so CI stays green until the lanes land. Once any suite lands it runs
 * and its exit code propagates — a failing landed suite fails the run.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SUITE_ROOTS = ['server/providers/livenow', 'src/livenow'];

function collectTests(relativeDir) {
  const absolute = path.join(ROOT, relativeDir);
  const found = [];
  const visit = (directory, relative) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return; // lane has not landed this tree yet
    }
    for (const entry of entries) {
      const absoluteEntry = path.join(directory, entry.name);
      const relativeEntry = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(absoluteEntry, relativeEntry);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(relativeEntry.split(path.sep).join('/'));
      }
    }
  };
  visit(absolute, relativeDir);
  return found.sort();
}

function main() {
  const files = SUITE_ROOTS.flatMap(collectTests);
  if (files.length === 0) {
    console.log(
      'live-now: no feature suites landed yet ' +
        '(DeepSeek/Gemini/Grok lanes pending) — nothing to run.',
    );
    return 0;
  }
  console.log(`live-now: running ${files.length} feature suite(s):`);
  for (const file of files) console.log(`  - ${file}`);
  const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`live-now: failed to spawn test runner: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

process.exit(main());
