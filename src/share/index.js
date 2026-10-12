/**
 * Share sheet — the share-a-scene flow's WhatsApp-first share row.
 *
 * Opens next to the top-center share button with one row per channel
 * (WhatsApp first, then X / Facebook / Telegram / Copy link), each carrying
 * pre-filled text and a UTM-tagged link. The "Copy link" action reuses the
 * existing ShareLinkManager.copyLink() so the canonical link format stays in
 * exactly one place.
 */
import {
  buildShareTargets,
  defaultShareText,
  withUtmTags,
} from './shareTargets.js';
import { fadeIn, fadeOut, slideDown } from '../ui/animate.js';

const SHEET_ID = 'gev-share-sheet';

/**
 * @param {object} input
 * @param {Document} [input.documentRef]
 * @param {HTMLElement} [input.anchorEl] The share button (positions the sheet).
 * @param {() => string|null} input.getShareUrl Canonical scene URL.
 * @param {() => Promise<boolean>} input.copyLink Existing clipboard copy.
 * @param {(message: string) => void} [input.onToast]
 * @param {(key: string) => string} [input.t]
 * @param {() => string} [input.getSceneLabel] For pre-filled text.
 * @returns {{close: () => void, element: HTMLElement|null}}
 */
export function openShareSheet({
  documentRef = globalThis.document,
  anchorEl = null,
  getShareUrl,
  copyLink,
  onToast = () => {},
  t = (key) => key,
  getSceneLabel = () => '',
} = {}) {
  const existing = documentRef.getElementById(SHEET_ID);
  if (existing) {
    existing.remove();
  }
  const url = getShareUrl?.();
  if (typeof url !== 'string' || !url) {
    onToast(
      t('share.noUrl') !== 'share.noUrl'
        ? t('share.noUrl')
        : 'Could not build the share link',
    );
    return { close: () => {}, element: null };
  }

  const text = defaultShareText({ sceneLabel: getSceneLabel() });
  const targets = buildShareTargets({ url, text });
  const tr = (key, fallback) => {
    const value = t(key);
    return typeof value === 'string' && value !== key ? value : fallback;
  };

  const backdrop = documentRef.createElement('div');
  backdrop.className = 'gev-share-backdrop';
  const sheet = documentRef.createElement('div');
  sheet.id = SHEET_ID;
  sheet.className = 'gev-share-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', tr('share.title', 'Share this scene'));

  const heading = documentRef.createElement('p');
  heading.className = 'gev-share-heading';
  heading.textContent = tr('share.title', 'Share this scene');
  sheet.appendChild(heading);

  const row = documentRef.createElement('div');
  row.className = 'gev-share-row';
  row.setAttribute('role', 'list');
  for (const target of targets) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = `gev-share-target gev-share-${target.id}`;
    button.setAttribute('role', 'listitem');
    button.setAttribute(
      'aria-label',
      `${tr('share.via', 'Share via')} ${target.label}`,
    );
    button.title = `${tr('share.via', 'Share via')} ${target.label}`;
    const glyph = documentRef.createElement('span');
    glyph.className = 'gev-share-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = shareGlyph(target.id);
    const label = documentRef.createElement('span');
    label.className = 'gev-share-label';
    label.textContent = target.label;
    button.append(glyph, label);
    if (target.kind === 'copy') {
      button.addEventListener('click', async () => {
        const ok = await copyLink?.();
        onToast(
          ok
            ? tr('share.copied', 'Link copied!')
            : tr('share.copyFailed', 'Copy failed'),
        );
        close();
      });
    } else {
      button.addEventListener('click', () => {
        // UTM-tagged per-channel URL is baked into the href already.
        globalThis.open?.(target.href, '_blank', 'noopener,noreferrer');
        close();
      });
    }
    row.appendChild(button);
  }
  sheet.appendChild(row);

  const hint = documentRef.createElement('p');
  hint.className = 'gev-share-hint';
  hint.textContent = tr(
    'share.hint',
    'Links carry your exact camera, layers and style.',
  );
  sheet.appendChild(hint);

  // Position: under the anchor button when measurable, else top-center.
  const rect = anchorEl?.getBoundingClientRect?.();
  if (rect && rect.width > 0) {
    sheet.style.left = `${Math.max(8, rect.left + rect.width / 2 - 190)}px`;
    sheet.style.top = `${rect.bottom + 10}px`;
  } else {
    sheet.style.left = '50%';
    sheet.style.top = '64px';
    sheet.style.transform = 'translateX(-50%)';
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    documentRef.removeEventListener('keydown', onKeyDown, true);
    const done = () => {
      sheet.remove();
      backdrop.remove();
    };
    void fadeOut(sheet, { duration: 160 }).then(done, done);
    anchorEl?.focus?.({ preventScroll: true });
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  documentRef.addEventListener('keydown', onKeyDown, true);
  backdrop.addEventListener('click', close);

  documentRef.body.append(backdrop, sheet);
  void fadeIn(backdrop, { duration: 160 });
  void slideDown(sheet, { duration: 220 });
  sheet.querySelector('button')?.focus?.({ preventScroll: true });

  return { close, element: sheet };
}

/** Text glyphs keep the row dependency-free (no icon font needed). */
function shareGlyph(id) {
  switch (id) {
    case 'whatsapp':
      return '✆';
    case 'x':
      return '𝕏';
    case 'facebook':
      return 'f';
    case 'telegram':
      return '✈';
    case 'copy':
      return '⧉';
    default:
      return '↗';
  }
}

export { withUtmTags, buildShareTargets, defaultShareText };
