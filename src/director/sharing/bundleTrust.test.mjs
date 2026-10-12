import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneBundle, parseSceneShare, BUNDLE_SOURCE } from './bundle.js';
import { selectSceneDocument } from '../authoring.js';

const NOW = 1_790_000_000_000;
// Minimal 1x1 PNG bytes (valid PNG signature + IHDR + IEND).
const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 8,
  215, 99, 248, 15, 4, 0, 9, 251, 3, 253, 160, 155, 166, 17, 0, 0, 0, 0, 73, 69,
  78, 68, 174, 66, 96, 130,
]);

const fixture = () => ({
  version: 6,
  scenes: [
    {
      id: 'one',
      title: 'Example',
      dataPacks: [
        {
          id: 'frame',
          version: 1,
          format: 'image',
          source: { adapter: 'assets', path: 'test/frame.png' },
          attribution: {
            text: 'Example CCTV',
            license: 'CC0-1.0',
            url: 'https://example.org/source',
          },
          placement: {
            bounds: [-10, -10, 10, 10],
            height: 100,
            altitudeReference: 'ellipsoid',
          },
        },
      ],
      shots: [
        {
          id: 'shot',
          title: 'Original',
          durationSec: 3,
          holdSec: 2,
          camera: { lat: 1, lon: 2, alt: 300, pitch: -60 },
          layers: { traffic: false },
          dataPackIds: ['frame'],
        },
      ],
    },
  ],
});

const imageAsset = () => ({ bytes: PNG.slice(), mimeType: 'image/png' });

test('faces-mode bundles attach provenance and require deface attestations', async () => {
  const text = await createSceneBundle(
    selectSceneDocument(fixture(), 'one'),
    () => imageAsset(),
    {
      provenanceFor: (pack) => ({
        sourceLabel: 'CCTV · Austin cam 12',
        sourceUrl: 'https://example.org/cam/12/frame.png',
        capturedAtMs: NOW - 5000,
        exportedAtMs: NOW,
      }),
      redaction: {
        mode: 'faces',
        attestations: {
          'files/0-frame.png': {
            tool: 'deface',
            toolVersion: '1.0.0',
            mode: 'faces',
            redactedAtMs: NOW,
            note: null,
          },
        },
      },
    },
  );
  const envelope = JSON.parse(text);
  const [asset] = envelope.assets;
  assert.equal(asset.provenance.sourceLabel, 'CCTV · Austin cam 12');
  assert.equal(asset.provenance.sha256, asset.sha256);
  assert.equal(envelope.redaction.mode, 'faces');
  assert.equal(envelope.redaction.tool, 'deface');
  assert.ok(envelope.redaction.attestations['files/0-frame.png']);
  // The same bundle imports cleanly: provenance and redaction survive.
  const parsed = await parseSceneShare(text);
  const pack = parsed.project.scenes[0].dataPacks[0];
  assert.equal(pack.source.adapter, BUNDLE_SOURCE);
  assert.deepEqual(parsed.assets.get(pack.source.path).bytes, PNG);
});

test('faces-mode export fails without a deface attestation', async () => {
  await assert.rejects(
    createSceneBundle(
      selectSceneDocument(fixture(), 'one'),
      () => imageAsset(),
      {
        redaction: { mode: 'faces', attestations: {} },
      },
    ),
    /face redaction required/,
  );
});

test('a tampered redaction block is rejected on import', async () => {
  const text = await createSceneBundle(
    selectSceneDocument(fixture(), 'one'),
    () => imageAsset(),
    {
      redaction: {
        mode: 'faces',
        attestations: {
          'files/0-frame.png': {
            tool: 'deface',
            toolVersion: '1.0.0',
            mode: 'faces',
            redactedAtMs: NOW,
            note: null,
          },
        },
      },
    },
  );
  const envelope = JSON.parse(text);
  envelope.redaction.attestations = {};
  await assert.rejects(
    parseSceneShare(JSON.stringify(envelope)),
    /lack attestations/,
  );
  envelope.redaction = { mode: 'faces', tool: 'fake-blur', attestations: {} };
  await assert.rejects(
    parseSceneShare(JSON.stringify(envelope)),
    /unsupported redaction tool/,
  );
});

test('none-mode bundles carry no redaction block and import as before', async () => {
  const text = await createSceneBundle(
    selectSceneDocument(fixture(), 'one'),
    () => imageAsset(),
  );
  const envelope = JSON.parse(text);
  assert.equal(envelope.redaction, undefined);
  const parsed = await parseSceneShare(text);
  assert.ok(parsed.assets.has('files/0-frame.png'));
});
