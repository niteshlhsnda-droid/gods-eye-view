import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDACTION_MODES,
  REDACTION_TOOL,
  assetsRequiringRedaction,
  attestRedaction,
  checkRedactionGate,
  validateRedactionBlock,
} from './redaction.js';

const NOW = 1_790_000_000_000;
const IMAGE = { path: 'files/0-frame.png', mimeType: 'image/png' };
const VIDEO = { path: 'files/1-clip.mp4', mimeType: 'video/mp4' };
const GEOJSON = {
  path: 'files/2-data.geojson',
  mimeType: 'application/geo+json',
};

test('only visual assets require redaction in faces mode', () => {
  assert.deepEqual(assetsRequiringRedaction([IMAGE, VIDEO, GEOJSON], 'faces'), [
    IMAGE,
    VIDEO,
  ]);
  assert.deepEqual(
    assetsRequiringRedaction([IMAGE, VIDEO, GEOJSON], 'none'),
    [],
  );
});

test('the redaction tool is deface, the permissive-licensed option', () => {
  assert.equal(REDACTION_TOOL, 'deface');
  assert.deepEqual([...REDACTION_MODES], ['none', 'faces']);
});

test('attestRedaction records a deface receipt and rejects anything else', () => {
  const attestation = attestRedaction(IMAGE, {
    toolVersion: '1.0.0',
    redactedAtMs: NOW,
  });
  assert.deepEqual(attestation, {
    'files/0-frame.png': {
      tool: 'deface',
      toolVersion: '1.0.0',
      mode: 'faces',
      redactedAtMs: NOW,
      note: null,
    },
  });
  assert.throws(
    () =>
      attestRedaction(IMAGE, {
        tool: 'fake-blur',
        toolVersion: '1',
        redactedAtMs: NOW,
      }),
    /unsupported redaction tool/,
  );
  assert.throws(
    () => attestRedaction(IMAGE, { toolVersion: '', redactedAtMs: NOW }),
    /requires the deface version/,
  );
});

test('checkRedactionGate refuses a faces-mode bundle with missing attestations', () => {
  const attestations = attestRedaction(IMAGE, {
    toolVersion: '1.0.0',
    redactedAtMs: NOW,
  });
  assert.throws(
    () => checkRedactionGate([IMAGE, VIDEO], { mode: 'faces', attestations }),
    /missing for 1 asset/,
  );
  const block = checkRedactionGate([IMAGE, VIDEO, GEOJSON], {
    mode: 'faces',
    attestations: {
      ...attestations,
      ...attestRedaction(VIDEO, { toolVersion: '1.0.0', redactedAtMs: NOW }),
    },
  });
  assert.equal(block.mode, 'faces');
  assert.equal(block.tool, 'deface');
  assert.equal(Object.keys(block.attestations).length, 2);
  assert.equal(checkRedactionGate([IMAGE], { mode: 'none' }), null);
});

test('validateRedactionBlock rejects tampered import blocks', () => {
  const good = checkRedactionGate([IMAGE], {
    mode: 'faces',
    attestations: attestRedaction(IMAGE, {
      toolVersion: '1.0.0',
      redactedAtMs: NOW,
    }),
  });
  validateRedactionBlock(good, [IMAGE]);
  assert.throws(
    () => validateRedactionBlock({ ...good, attestations: {} }, [IMAGE]),
    /lack attestations/,
  );
  assert.throws(
    () => validateRedactionBlock({ ...good, tool: 'fake-blur' }, [IMAGE]),
    /unsupported redaction tool/,
  );
  validateRedactionBlock(null, [IMAGE]);
  validateRedactionBlock(undefined, [IMAGE]);
});
