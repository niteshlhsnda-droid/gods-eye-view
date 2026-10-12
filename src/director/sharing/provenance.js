/**
 * Frame/asset provenance for scene-share bundles.
 *
 * A deliberately honest substitute for an "AI detector": this module makes no
 * claim about whether pixels are real or generated — it cannot know that, and
 * pretending otherwise would be a fabrication. What it CAN record, and what
 * the share bundle now carries per asset, is provenance: where the bytes came
 * from, when they were captured, when they left the app, and the SHA-256
 * digest anchoring identity. verifyAssetProvenance() only checks that the
 * recorded timeline is internally consistent; it never produces an
 * "authenticity probability".
 */

/**
 * Build one asset provenance record.
 *
 * @param {object} asset
 * @param {string} asset.assetKey Stable asset key (bundle path).
 * @param {string} asset.mimeType Asset MIME type.
 * @param {string} asset.sha256 SHA-256 digest of the bundled bytes.
 * @param {string} [asset.sourceLabel] Human-readable source (e.g. 'CCTV · Austin cam 12').
 * @param {string} [asset.sourceUrl] Where the frame was captured from.
 * @param {number} [asset.capturedAtMs] When the frame was captured.
 * @param {number} [asset.exportedAtMs] When the bundle was built.
 */
export function describeAssetProvenance({
  assetKey,
  mimeType,
  sha256,
  sourceLabel,
  sourceUrl,
  capturedAtMs,
  exportedAtMs,
} = {}) {
  const record = {
    assetKey: String(assetKey || ''),
    mimeType: String(mimeType || ''),
    sha256: String(sha256 || ''),
    sourceLabel: String(sourceLabel || '').trim() || null,
    sourceUrl: String(sourceUrl || '').trim() || null,
    capturedAtMs: Number.isFinite(capturedAtMs) ? capturedAtMs : null,
    exportedAtMs: Number.isFinite(exportedAtMs) ? exportedAtMs : null,
  };
  return record;
}

/**
 * One-line provenance summary for panels and scene-share listings.
 */
export function provenanceSummary(record = {}) {
  const source = record.sourceLabel || record.sourceUrl || 'unknown source';
  const when = Number.isFinite(record.capturedAtMs)
    ? ` · captured ${new Date(record.capturedAtMs).toISOString()}`
    : '';
  const digest = record.sha256
    ? ` · sha256 ${String(record.sha256).slice(0, 12)}…`
    : '';
  return `${source}${when}${digest}`;
}

/**
 * Consistency checks on a provenance record. Returns a list of issue strings;
 * an empty list means the timeline is internally consistent — not that the
 * pixels are authentic.
 */
export function verifyAssetProvenance(record = {}, { now = Date.now() } = {}) {
  const issues = [];
  if (!record.assetKey) issues.push('missing asset key');
  if (!record.sha256) issues.push('missing sha256 digest');
  if (record.sourceUrl) {
    try {
      const parsed = new URL(record.sourceUrl);
      if (!['http:', 'https:'].includes(parsed.protocol))
        issues.push(`non-web source URL scheme: ${parsed.protocol}`);
    } catch {
      issues.push('unparseable source URL');
    }
  }
  const { capturedAtMs, exportedAtMs } = record;
  if (capturedAtMs != null && capturedAtMs > now + 60000)
    issues.push('capture timestamp is in the future');
  if (exportedAtMs != null && exportedAtMs > now + 60000)
    issues.push('export timestamp is in the future');
  if (
    capturedAtMs != null &&
    exportedAtMs != null &&
    capturedAtMs > exportedAtMs
  )
    issues.push('captured after it was exported');
  return issues;
}
