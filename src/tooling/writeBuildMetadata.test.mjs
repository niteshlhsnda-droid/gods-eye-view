import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMetadata } from '../../scripts/write-build-metadata.mjs';

test('buildMetadata records commit and snapshot generatedAt', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'build-meta-'));
  try {
    const snapshotPath = path.join(dir, 'live-now.json');
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        generatedAt: '2026-10-15T09:55:00.000Z',
        events: [],
      }),
      'utf8',
    );
    const metadata = buildMetadata(snapshotPath, {
      nowMs: Date.parse('2026-10-15T10:00:00.000Z'),
    });
    assert.equal(metadata.dataGeneratedAt, '2026-10-15T09:55:00.000Z');
    assert.equal(metadata.builtAt, '2026-10-15T10:00:00.000Z');
    assert.ok(
      typeof metadata.sourceCommit === 'string' &&
        metadata.sourceCommit.length > 0,
    );
    assert.ok('workflow' in metadata);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMetadata throws on a missing snapshot', () => {
  assert.throws(
    () => buildMetadata('/definitely/not/here/live-now.json'),
    /cannot read snapshot/,
  );
});

test('buildMetadata records null dataGeneratedAt for a bad timestamp', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'build-meta-'));
  try {
    const snapshotPath = path.join(dir, 'live-now.json');
    writeFileSync(
      snapshotPath,
      JSON.stringify({ generatedAt: 'not-a-date' }),
      'utf8',
    );
    const metadata = buildMetadata(snapshotPath);
    assert.equal(metadata.dataGeneratedAt, null);
    assert.equal(
      readFileSync(snapshotPath, 'utf8').includes('not-a-date'),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
