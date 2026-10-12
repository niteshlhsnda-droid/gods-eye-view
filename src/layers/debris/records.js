import { parseTleText, tleCatalogNumber } from '../../sources/tle.js';
import { tleIsStale } from '../../sources/tle.js';

/**
 * Normalize one debris group's TLE catalog text into records.
 * Invalid satrecs are filtered by the caller (twoline2satrec error check);
 * malformed three-line sets are skipped here. Dedupe is by NORAD catalog
 * number, first group wins (callers concatenate groups in priority order).
 */
export function normalizeDebrisCatalog(text, { group } = {}) {
  const entries = parseTleText(text);
  const records = [];
  for (const entry of entries) {
    const noradId = tleCatalogNumber(entry.line1);
    if (!Number.isInteger(noradId)) continue;
    records.push({
      noradId,
      name: entry.name,
      line1: entry.line1,
      line2: entry.line2,
      group: group ?? null,
    });
  }
  return records;
}

/** Dedupe debris records by NORAD id; first record wins. */
export function dedupeDebrisRecords(records) {
  const seen = new Set();
  const out = [];
  for (const record of records) {
    if (seen.has(record.noradId)) continue;
    seen.add(record.noradId);
    out.push(record);
  }
  return out;
}

/** Staleness rollup for one debris group's parsed records. */
export function debrisFreshness(
  records,
  { maxAgeMs, nowMs = Date.now() } = {},
) {
  let stale = 0;
  for (const record of records) {
    if (tleIsStale(record.line1, { maxAgeMs, nowMs })) stale += 1;
  }
  return {
    stale,
    total: records.length,
    staleRatio: records.length ? stale / records.length : 0,
  };
}
