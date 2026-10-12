import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeAssetProvenance,
  provenanceSummary,
  verifyAssetProvenance,
} from './provenance.js';

const NOW = 1_790_000_000_000;
const RECORD = describeAssetProvenance({
  assetKey: 'files/0-frame.png',
  mimeType: 'image/png',
  sha256: 'a'.repeat(64),
  sourceLabel: 'CCTV · Austin cam 12',
  sourceUrl: 'https://example.org/cam/12/frame.png',
  capturedAtMs: NOW - 5000,
  exportedAtMs: NOW,
});

test('describeAssetProvenance normalizes a camera-frame record', () => {
  assert.equal(RECORD.assetKey, 'files/0-frame.png');
  assert.equal(RECORD.sourceLabel, 'CCTV · Austin cam 12');
  assert.equal(RECORD.capturedAtMs, NOW - 5000);
});

test('provenanceSummary is a one-line panel string', () => {
  const summary = provenanceSummary(RECORD);
  assert.match(summary, /CCTV · Austin cam 12/);
  assert.match(summary, /captured /);
  assert.match(summary, /sha256 a{12}…/);
});

test('verifyAssetProvenance passes a consistent record', () => {
  assert.deepEqual(verifyAssetProvenance(RECORD, { now: NOW }), []);
});

test('verifyAssetProvenance flags timeline impossibilities', () => {
  const issues = verifyAssetProvenance(
    { ...RECORD, capturedAtMs: NOW + 3600000 },
    { now: NOW },
  );
  assert.ok(issues.some((issue) => /future/.test(issue)));
  const backwards = verifyAssetProvenance(
    { ...RECORD, capturedAtMs: NOW, exportedAtMs: NOW - 1000 },
    { now: NOW },
  );
  assert.ok(backwards.some((issue) => /captured after/.test(issue)));
});

test('verifyAssetProvenance flags bad digests and URLs, never authenticity', () => {
  const issues = verifyAssetProvenance(
    { assetKey: '', sha256: '', sourceUrl: 'not a url' },
    { now: NOW },
  );
  assert.ok(issues.includes('missing asset key'));
  assert.ok(issues.includes('missing sha256 digest'));
  assert.ok(issues.includes('unparseable source URL'));
  // The verifier says nothing about whether pixels are real.
  assert.ok(
    issues.every((issue) => !/authentic|deepfake|AI/i.test(issue)),
    'no authenticity claims',
  );
});
