#!/usr/bin/env node
/**
 * Write a small build-metadata file recording which source commit and which
 * Live Now snapshot a Pages deployment was built from.
 *
 * Reads the validated snapshot for its `generatedAt` (the data generation
 * time) and takes the source commit / workflow run from the environment
 * (`GITHUB_SHA`, `GITHUB_REF`, `GITHUB_WORKFLOW`, `GITHUB_RUN_ID`,
 * `GITHUB_RUN_NUMBER`; falls back to `git rev-parse HEAD` and `local` when
 * run outside GitHub Actions).
 *
 * Usage: node scripts/write-build-metadata.mjs <snapshot-path> <output-path>
 * Exit 0 on success, 1 when the snapshot is missing or unparsable.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function resolveCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Build the metadata object from a snapshot file and the environment.
 * @returns {{sourceCommit: string, sourceRef: string, dataGeneratedAt: string|null, builtAt: string, workflow: string, runId: string|null, runNumber: string|null}}
 */
export function buildMetadata(snapshotPath, { nowMs = Date.now() } = {}) {
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch {
    throw new Error(`cannot read snapshot file: ${snapshotPath}`);
  }
  const dataGeneratedAt =
    typeof snapshot?.generatedAt === 'string' &&
    !Number.isNaN(Date.parse(snapshot.generatedAt))
      ? snapshot.generatedAt
      : null;
  return {
    sourceCommit: resolveCommit(),
    sourceRef: process.env.GITHUB_REF || 'local',
    dataGeneratedAt,
    builtAt: new Date(nowMs).toISOString(),
    workflow: process.env.GITHUB_WORKFLOW || 'local',
    runId: process.env.GITHUB_RUN_ID || null,
    runNumber: process.env.GITHUB_RUN_NUMBER || null,
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (import.meta.url === invokedPath) {
  const [snapshotPath, outputPath] = process.argv.slice(2);
  if (!snapshotPath || !outputPath) {
    console.error(
      'Usage: node scripts/write-build-metadata.mjs <snapshot-path> <output-path>',
    );
    process.exitCode = 1;
  } else {
    try {
      const metadata = buildMetadata(snapshotPath);
      if (!metadata.dataGeneratedAt) {
        console.error(
          'Snapshot has no valid generatedAt; refusing to write build metadata.',
        );
        process.exitCode = 1;
      } else {
        mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
        writeFileSync(
          outputPath,
          `${JSON.stringify(metadata, null, 2)}\n`,
          'utf8',
        );
        console.log(
          `Build metadata: commit=${metadata.sourceCommit} dataGeneratedAt=${metadata.dataGeneratedAt} -> ${outputPath}`,
        );
      }
    } catch (error) {
      console.error(`write-build-metadata failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
