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
 * Whether a TLE set should be treated as stale for refresh scheduling.
 * Malformed epochs count as stale (they cannot be trusted for propagation).
 */
export function tleIsStale(
  line1,
  { maxAgeMs = 72 * 3600_000, nowMs = Date.now() } = {},
) {
  const age = tleAgeMs(line1, nowMs);
  return age == null ? true : age > maxAgeMs;
}
