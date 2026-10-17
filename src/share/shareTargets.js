/**
 * Share targets — WhatsApp-first share row.
 *
 * Builds per-channel share URLs with pre-filled text and UTM-tagged links:
 * `utm_source=<channel>&utm_medium=share&utm_campaign=share-a-scene`.
 * UTM tags ride in the QUERY STRING (before the `#` scene hash) so the
 * sharelink parser — which only reads hash params — is unaffected.
 */

export const SHARE_UTM_MEDIUM = 'share';
export const SHARE_UTM_CAMPAIGN = 'share-a-scene';

/**
 * Append UTM tags to a share URL, preserving any existing query and the hash.
 * @param {string} url
 * @param {string} source Channel token, e.g. 'whatsapp'.
 * @returns {string} The tagged URL (unchanged input when unparseable).
 */
export function withUtmTags(url, source) {
  if (typeof url !== 'string' || !url) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('utm_source', source);
    parsed.searchParams.set('utm_medium', SHARE_UTM_MEDIUM);
    parsed.searchParams.set('utm_campaign', SHARE_UTM_CAMPAIGN);
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Default pre-filled share text. Short, human, with a follow nudge.
 * @param {object} [input]
 * @param {string} [input.sceneLabel] e.g. "the Bay of Bengal".
 * @returns {string}
 */
export function defaultShareText({ sceneLabel = '' } = {}) {
  const where = sceneLabel ? ` — ${sceneLabel}` : '';
  return `Look at this on God's Eye View${where} 🌍 Earth intelligence from live, snapshot and simulated feeds.`;
}

/**
 * Build the share-target list. WhatsApp is FIRST (owner standing rule:
 * WhatsApp-first share loop on every property).
 * @param {object} input
 * @param {string} input.url Canonical (untagged) share URL.
 * @param {string} [input.text] Pre-filled message.
 * @returns {Array<{id: string, label: string, href: string|null, kind: 'link'|'copy'}>}
 */
export function buildShareTargets({ url, text = defaultShareText() }) {
  const encodedText = encodeURIComponent(text);
  const tagged = (source) => encodeURIComponent(withUtmTags(url, source));
  return [
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      kind: 'link',
      href: `https://wa.me/?text=${encodedText}%20${tagged('whatsapp')}`,
    },
    {
      id: 'x',
      label: 'X',
      kind: 'link',
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${tagged('x')}`,
    },
    {
      id: 'facebook',
      label: 'Facebook',
      kind: 'link',
      href: `https://www.facebook.com/sharer/sharer.php?u=${tagged('facebook')}&quote=${encodedText}`,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      kind: 'link',
      href: `https://t.me/share/url?url=${tagged('telegram')}&text=${encodedText}`,
    },
    {
      id: 'copy',
      label: 'Copy link',
      kind: 'copy',
      href: null,
    },
  ];
}
