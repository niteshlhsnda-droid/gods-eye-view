/**
 * Photo-freshness staleness labels for Street Level imagery.
 *
 * A street photo card must never imply a years-old photo is current.
 * This module classifies a photo's age from its capture date (falling
 * back to the upload date, and saying so) and renders an honest display
 * label: `fresh` under 1 year, `aging` from 1 to 3 years, `stale` past
 * 3 years, and `unknown` when there is no usable date. The stale and
 * unknown labels explicitly warn that the photo may not reflect the
 * current street — a 5-year-old photo is never presented as live.
 *
 * Pure function: no provider wiring, no network, no DOM.
 */

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
const AGING_MAX_MS = 3 * YEAR_MS;

/** Staleness buckets a street photo falls into. */
export const PHOTO_STALENESS = Object.freeze({
  /** Captured/uploaded less than 1 year ago. */
  FRESH: 'fresh',
  /** 1 to 3 years old: worth a glance, not a guarantee. */
  AGING: 'aging',
  /** Over 3 years old: do not treat as the current street. */
  STALE: 'stale',
  /** No usable date: say so, never default to "current". */
  UNKNOWN: 'unknown',
});

/** Which date the staleness judgement rests on. */
export const STALENESS_DATE_KIND = Object.freeze({
  /** The provider reported a real capture time. */
  CAPTURED: 'captured',
  /** No capture time; the upload time is the best we have. */
  UPLOADED: 'uploaded',
  /** No usable date at all. */
  NONE: 'none',
});

const monthYear = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function toMs(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return Number.NaN;
    return Date.parse(trimmed);
  }
  if (value instanceof Date) return value.getTime();
  return Number.NaN;
}

/**
 * The best usable date for a photo: capture time first (Cycle 14
 * capture-date honesty), upload time as a labelled fallback.
 * @param {{capturedAt?: unknown, uploadedAt?: unknown}|null|undefined} record
 * @returns {{dateMs: number|null, dateKind: 'captured'|'uploaded'|'none'}}
 */
export function photoDateOf(record) {
  const captured = toMs(record?.capturedAt);
  if (Number.isFinite(captured))
    return { dateMs: captured, dateKind: STALENESS_DATE_KIND.CAPTURED };
  const uploaded = toMs(record?.uploadedAt);
  if (Number.isFinite(uploaded))
    return { dateMs: uploaded, dateKind: STALENESS_DATE_KIND.UPLOADED };
  return { dateMs: null, dateKind: STALENESS_DATE_KIND.NONE };
}

/**
 * Classify a street photo's staleness.
 * @param {{capturedAt?: unknown, uploadedAt?: unknown}|null|undefined} record
 * @param {number} [now] epoch ms; injected for deterministic tests
 * @returns {{staleness: 'fresh'|'aging'|'stale'|'unknown',
 *   dateKind: 'captured'|'uploaded'|'none', dateMs: number|null,
 *   ageMs: number|null}}
 */
export function photoStalenessOf(record, now = Date.now()) {
  const { dateMs, dateKind } = photoDateOf(record);
  if (dateMs === null || !Number.isFinite(now)) {
    return {
      staleness: PHOTO_STALENESS.UNKNOWN,
      dateKind,
      dateMs,
      ageMs: null,
    };
  }
  const ageMs = now - dateMs;
  if (ageMs < 0) {
    // A capture date in the future is bogus data: unknown, never "fresh".
    return {
      staleness: PHOTO_STALENESS.UNKNOWN,
      dateKind,
      dateMs,
      ageMs: null,
    };
  }
  const staleness =
    ageMs < YEAR_MS
      ? PHOTO_STALENESS.FRESH
      : ageMs <= AGING_MAX_MS
        ? PHOTO_STALENESS.AGING
        : PHOTO_STALENESS.STALE;
  return { staleness, dateKind, dateMs, ageMs };
}

function verbOf(dateKind) {
  return dateKind === STALENESS_DATE_KIND.UPLOADED ? 'uploaded' : 'taken';
}

function agePhrase(ageMs) {
  const years = Math.floor(ageMs / YEAR_MS);
  if (years < 1) return 'less than a year old';
  return years === 1 ? 'about 1 year old' : `about ${years} years old`;
}

/**
 * Honest display label for a staleness classification. Fresh photos say
 * their age; stale and unknown photos explicitly warn they may not show
 * the current street, so old imagery is never presented as live.
 * @param {{staleness: string, dateKind: string, dateMs: number|null,
 *   ageMs: number|null}|null|undefined} result
 * @returns {string}
 */
export function stalenessLabel(result) {
  const staleness = result?.staleness;
  if (
    result &&
    result.dateMs !== null &&
    Number.isFinite(result.dateMs) &&
    Number.isFinite(result.ageMs) &&
    staleness !== PHOTO_STALENESS.UNKNOWN
  ) {
    const when = `Photo ${verbOf(result.dateKind)} ${monthYear.format(result.dateMs)}`;
    if (staleness === PHOTO_STALENESS.STALE) {
      return `${when} · ${agePhrase(result.ageMs)} — may not reflect the current street`;
    }
    return `${when} · ${agePhrase(result.ageMs)}`;
  }
  return 'Photo date unknown — treat as possibly outdated';
}
