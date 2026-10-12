/**
 * Privacy redaction policy for scene-share bundles.
 *
 * The detection itself is delegated to the MIT-licensed `deface` tool
 * (ORB-HD/deface), which runs outside this browser bundle as an explicit
 * pre-export pass — deface is a Python/ONNX/ffmpeg tool and cannot run in the
 * client tonight. This module is the policy gate: in `faces` mode every
 * image/video asset must carry a deface attestation before the bundle is
 * allowed out, and a bundle can never be labeled "redacted" unless the pass
 * actually completed. No fake redaction claims, ever.
 *
 * Bundle envelope shape after this module:
 *   redaction: { mode: 'faces', tool: 'deface', attestations: { [assetKey]: { tool, toolVersion, mode, redactedAtMs, note } } }
 */

import { fail } from '../documentFields.js';

/** Redaction modes the share flow understands. */
export const REDACTION_MODES = Object.freeze(['none', 'faces']);

/** The external tool delegated to do actual face detection. */
export const REDACTION_TOOL = 'deface';

const VISUAL_MIME_PREFIXES = ['image/', 'video/'];

function isVisualAsset(asset) {
  return VISUAL_MIME_PREFIXES.some((prefix) =>
    String(asset?.mimeType || '').startsWith(prefix),
  );
}

function assetKeyOf(asset) {
  return String(asset?.path || asset?.assetKey || '');
}

/**
 * Which bundled assets require a redaction pass under the given mode.
 * `faces` mode: every image/video asset. `none`: nothing.
 */
export function assetsRequiringRedaction(assets = [], mode = 'none') {
  if (mode !== 'faces') return [];
  return (assets || []).filter(isVisualAsset);
}

/**
 * Record a deface attestation for one asset. This is the receipt from the
 * out-of-band deface pass: the bundle gate trusts it only as a record, and
 * verifies the required fields are present.
 */
export function attestRedaction(
  asset,
  { tool = REDACTION_TOOL, toolVersion, redactedAtMs, note } = {},
) {
  const key = assetKeyOf(asset);
  if (!key) fail('assets', 'cannot attest redaction for an unnamed asset');
  if (String(tool).trim() !== REDACTION_TOOL)
    fail('assets', `unsupported redaction tool: ${tool}`);
  if (!String(toolVersion || '').trim())
    fail('assets', 'redaction attestation requires the deface version');
  if (!Number.isFinite(redactedAtMs))
    fail('assets', 'redaction attestation requires a timestamp');
  return {
    [key]: {
      tool,
      toolVersion: String(toolVersion).trim(),
      mode: 'faces',
      redactedAtMs,
      note: String(note || '').trim() || null,
    },
  };
}

/**
 * Enforce the redaction gate: in `faces` mode every visual asset must have
 * an attestation, otherwise bundle creation fails. Returns the envelope
 * block to store on the bundle, or null when mode is 'none'.
 */
export function checkRedactionGate(
  assets = [],
  { mode = 'none', attestations = {}, toolVersion } = {},
) {
  if (!REDACTION_MODES.includes(mode))
    fail('assets', `unknown redaction mode: ${mode}`);
  if (mode === 'none') return null;
  const required = assetsRequiringRedaction(assets, mode);
  const missing = required
    .map(assetKeyOf)
    .filter((key) => !Object.hasOwn(attestations || {}, key));
  if (missing.length)
    fail(
      'assets',
      `face redaction required but missing for ${missing.length} asset(s): ` +
        missing.slice(0, 3).join(', ') +
        '. Run the deface pass before sharing.',
    );
  const block = {
    mode,
    tool: REDACTION_TOOL,
    attestations: {},
  };
  for (const key of required.map(assetKeyOf))
    block.attestations[key] = attestations[key];
  if (toolVersion) block.toolVersion = String(toolVersion);
  return block;
}

/**
 * Validate an imported bundle's redaction block against its actual assets.
 * A block claiming `faces` mode without attestations for every visual asset
 * is rejected — tampering with the block cannot fake a redacted share.
 */
export function validateRedactionBlock(block, assets = []) {
  if (block == null) return;
  if (typeof block !== 'object' || Array.isArray(block))
    fail('redaction', 'invalid redaction block');
  if (block.tool !== REDACTION_TOOL)
    fail('redaction', `unsupported redaction tool: ${block.tool}`);
  if (!REDACTION_MODES.includes(block.mode))
    fail('redaction', `unknown redaction mode: ${block.mode}`);
  const attestations =
    block.attestations != null && typeof block.attestations === 'object'
      ? block.attestations
      : {};
  const required = assetsRequiringRedaction(assets, block.mode);
  const missing = required
    .map(assetKeyOf)
    .filter((key) => !Object.hasOwn(attestations, key));
  if (missing.length)
    fail(
      'redaction',
      `bundle claims face redaction but ${missing.length} asset(s) lack attestations`,
    );
  for (const [key, attestation] of Object.entries(attestations)) {
    if (
      !attestation ||
      typeof attestation !== 'object' ||
      attestation.tool !== REDACTION_TOOL ||
      attestation.mode !== 'faces' ||
      !String(attestation.toolVersion || '').trim() ||
      !Number.isFinite(attestation.redactedAtMs)
    )
      fail('redaction', `invalid redaction attestation for ${key}`);
  }
}
