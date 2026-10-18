/**
 * Photo-card license attribution for Street Level imagery.
 *
 * Every rendered photo card must carry its provider's required attribution:
 * Mapillary and KartaView imagery are CC BY-SA 4.0, Google Street View needs
 * its own credit. The on-globe Cesium credit (credits.js) goes away with the
 * imagery and the viewer embeds have their own widgets; the photo card in
 * the panel had no attribution line at all. This module resolves the card's
 * line and audits rendered photo cards so a missing line is never silent:
 * when a provider supplies nothing, the card shows an explicit fallback
 * instead of quietly dropping the license.
 */

/** Where a photo card's attribution line came from. */
export const PHOTO_ATTRIBUTION_SOURCES = Object.freeze({
  /** The provider's viewer adapter supplied per-image attribution. */
  PER_PHOTO: 'per-photo',
  /** The provider definition's own credit line. */
  PROVIDER: 'provider',
  /** No attribution available: the card says so explicitly. */
  FALLBACK: 'fallback',
});

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Which source a provider's photo-card attribution resolves from, without
 * the fallback's rendered text. Providers name their card-specific line in
 * `photoAttribution.html`; otherwise the on-globe `credit.html` covers it.
 */
export function attributionSourceOf(provider) {
  if (textOf(provider?.photoAttribution?.html))
    return PHOTO_ATTRIBUTION_SOURCES.PROVIDER;
  if (textOf(provider?.credit?.html)) return PHOTO_ATTRIBUTION_SOURCES.PROVIDER;
  return PHOTO_ATTRIBUTION_SOURCES.FALLBACK;
}

/**
 * Resolve the photo card's attribution line for one open photo.
 * Precedence: the pose's own attribution (a viewer adapter that knows
 * per-image licensing), then the provider definition's line, then an
 * explicit fallback that names the provider and says the license line is
 * missing — never a silently unattributed card.
 * @param {{provider?: object|null, pose?: object|null}} args
 * @returns {{html: string, source: 'per-photo'|'provider'|'fallback'}}
 */
export function photoCardAttribution({ provider, pose } = {}) {
  const perPhoto = textOf(pose?.attributionHtml);
  if (perPhoto)
    return { html: perPhoto, source: PHOTO_ATTRIBUTION_SOURCES.PER_PHOTO };
  const providerHtml =
    textOf(provider?.photoAttribution?.html) || textOf(provider?.credit?.html);
  if (providerHtml)
    return { html: providerHtml, source: PHOTO_ATTRIBUTION_SOURCES.PROVIDER };
  const name = textOf(provider?.name) || 'Street-level imagery';
  return {
    html: `${escapeHtml(name)} · contributor attribution unavailable`,
    source: PHOTO_ATTRIBUTION_SOURCES.FALLBACK,
  };
}

/**
 * Audit a rendered Street Level panel: every open photo card must carry its
 * license attribution line. The resolver above guarantees a line whenever
 * the plumbing is wired; this audit catches the wiring breaking (a card
 * rendered without `captionAttribution`) rather than a provider lacking a
 * credit, which `validateProviders` already rejects.
 * @param {object} view the `presentStreetLevelPanel` output
 * @returns {Array<string>} issue strings, empty when the card is attributed
 */
export function auditRenderedAttribution(view) {
  if (view?.viewer?.open && !textOf(view.viewer.captionAttribution))
    return ['Street Level photo card is open with no license attribution line'];
  return [];
}
