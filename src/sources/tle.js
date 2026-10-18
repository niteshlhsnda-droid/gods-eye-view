/**
 * Parse three-line TLE catalog text into `{ name, line1, line2 }` entries.
 * Malformed sets are skipped without dropping the valid sets that follow.
 */
export function parseTleText(text) {
  const lines = String(text)
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const result = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (line1.startsWith('1 ') && line2.startsWith('2 ')) {
      result.push({ name, line1, line2 });
      i += 2;
    }
  }
  return result;
}

/** The NORAD catalog number from TLE line 1, or null. */
export function tleCatalogNumber(line1) {
  const number = Number.parseInt(String(line1).slice(2, 7), 10);
  return Number.isInteger(number) ? number : null;
}

/**
 * The TLE epoch (line 1, columns 19-32: 2-digit year + day-of-year) as
 * milliseconds since the Unix epoch, or null when the epoch field is
 * malformed. Follows the TLE year convention: 57-99 -> 19xx, 00-56 -> 20xx.
 */
export function tleEpochMs(line1) {
  const token = String(line1).slice(18, 32).trim();
  const match = /^(\d{2})(\d{3}\.\d+)$/.exec(token);
  if (!match) return null;
  let year = Number(match[1]);
  year += year < 57 ? 2000 : 1900;
  const dayOfYear = Number(match[2]);
  if (!Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear > 367)
    return null;
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000;
}

/**
 * Milliseconds between the TLE epoch and `nowMs` (positive = TLE is old).
 * Returns null when the epoch field is malformed.
 */
export function tleAgeMs(line1, nowMs = Date.now()) {
  const epoch = tleEpochMs(line1);
  return epoch == null ? null : nowMs - epoch;
}

/**
 * Canonical TLE staleness threshold: element sets older than this are stale
 * (SGP4 error grows with epoch age). Single source of truth — the satellite
 * and debris layer policies re-export this constant instead of restating
 * the 72 h literal, so the threshold cannot drift between layers.
 */
export const TLE_MAX_AGE_MS = 72 * 3600_000;

/**
 * Whether a TLE set should be treated as stale for refresh scheduling.
 * Malformed epochs count as stale (they cannot be trusted for propagation).
 * Future-dated epochs (negative age from clock skew or bad data) also count
 * as stale — a TLE from the future is not fresher, it is untrustworthy.
 */
export function tleIsStale(
  line1,
  { maxAgeMs = TLE_MAX_AGE_MS, nowMs = Date.now() } = {},
) {
  const age = tleAgeMs(line1, nowMs);
  return age == null || age < 0 ? true : age > maxAgeMs;
}

/**
 * Compact age for a TLE epoch age in ms: minutes below an hour, whole
 * hours below two days, whole days above that. Non-finite/negative ages
 * are not an age at all — callers must handle them before formatting.
 */
export function formatTleAge(ageMs) {
  if (ageMs < 3600_000) return `${Math.floor(ageMs / 60000)} min`;
  if (ageMs < 48 * 3600_000) return `${Math.floor(ageMs / 3600_000)} h`;
  return `${Math.floor(ageMs / 86400_000)} d`;
}

/**
 * User-facing honesty label for a satellite position derived from a TLE.
 *
 * Satellite dots are SGP4 predictions propagated from the TLE epoch, not
 * live observations of the satellite — so every position carries PREDICTED
 * plus the age of the element set it was propagated from. A fresh fetch of
 * a stale TLE still propagates a stale prediction, which is why the label
 * reports the epoch age, never the fetch time. Element sets older than
 * TLE_MAX_AGE_MS get an explicit STALE qualifier (SGP4 error grows with
 * epoch age); a missing, malformed, or future epoch reports unknown rather
 * than inventing an age.
 */
export function satellitePredictionLabel(line1, { nowMs = Date.now() } = {}) {
  const age = tleAgeMs(line1, nowMs);
  if (age == null || age < 0) return 'PREDICTED · TLE age unknown';
  const ageText = formatTleAge(age);
  if (age > TLE_MAX_AGE_MS) return `PREDICTED · TLE ${ageText} old · STALE`;
  return `PREDICTED · TLE ${ageText} old`;
}
