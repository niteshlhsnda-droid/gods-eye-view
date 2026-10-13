/**
 * @module providers/livenow/rank
 * @description Dedupe + transparent scoring for Live Now events (spec §4.3).
 *
 * score = recency(0-40) + severity(0-30) + sourceCount(0-20) + mediaAttention(0-10)
 *   recency: linear decay, 40 at t=0 → 0 at 24h; events older than 48h drop out.
 *   severity: per-type table in severity.json (data, not code).
 *   sourceCount: 2+ independent outlets → full marks (anti-single-rumor weight).
 *   mediaAttention: GDELT 0-100 percentile for news-type events → 0-10.
 *
 * Dedupe: same type + geohash-5 + overlapping keywords within 6h → merge,
 * keep earliest startedAt, union sources, keep max severity.
 */
import severityTable from './severity.json' with { type: 'json' };

export const RANK_VERSION = 1;
export const MAX_EVENTS = 12;
export const MAX_EVENT_AGE_MS = 48 * 3600_000;
export const DEDUPE_WINDOW_MS = 6 * 3600_000;

const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode a lat/lon to a geohash string of the given precision.
 * Self-contained: no dependency, deterministic bucketing for dedupe.
 */
export function encodeGeohash(lat, lon, precision = 5) {
  let la = Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : 0;
  let lo = Number.isFinite(lon) ? ((((lon + 180) % 360) + 360) % 360) - 180 : 0;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';
  let bits = 0;
  let value = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lo >= mid) {
        value = (value << 1) | 1;
        lonMin = mid;
      } else {
        value = value << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (la >= mid) {
        value = (value << 1) | 1;
        latMin = mid;
      } else {
        value = value << 1;
        latMax = mid;
      }
    }
    even = !even;
    bits++;
    if (bits === 5) {
      hash += GEOHASH_ALPHABET[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

/** First table row whose threshold is met (tables are stored descending). */
function lookupThreshold(rows, value) {
  for (const [threshold, severity] of rows || []) {
    if (value >= threshold) return severity;
  }
  return null;
}

/**
 * Map a source signal to severity 1-5 using the severity.json data table.
 * @param {string} type LiveEvent type.
 * @param {object} [signals] e.g. {magnitude, category, hotspotCount, squawk, alertName, eventCount}.
 */
export function severityFor(type, signals = {}) {
  const table = severityTable?.[type];
  if (!table || typeof table !== 'object') return 3;
  const hit = (v) =>
    Number.isInteger(v) && v >= 1 && v <= 5 ? v : (table.default ?? 3);
  switch (type) {
    case 'quake': {
      if (Number.isFinite(signals.eventCount) && table.swarm) {
        const s = lookupThreshold(table.swarm.byEventCount, signals.eventCount);
        return hit(s ?? table.swarm.default);
      }
      if (Number.isFinite(signals.magnitude)) {
        return hit(lookupThreshold(table.byMagnitude, signals.magnitude));
      }
      return hit(table.default);
    }
    case 'cyclone': {
      if (Number.isFinite(signals.category)) {
        const s = table.byCategory?.[String(Math.floor(signals.category))];
        return hit(s);
      }
      if (signals.tropicalStorm) return hit(table.tropicalStorm);
      return hit(table.default);
    }
    case 'fire': {
      if (Number.isFinite(signals.hotspotCount)) {
        return hit(lookupThreshold(table.byHotspotCount, signals.hotspotCount));
      }
      return hit(table.default);
    }
    case 'aviation': {
      const s = table.bySquawk?.[String(signals.squawk)];
      return hit(s ?? table.default);
    }
    case 'weather': {
      const s = table.byEventName?.[signals.alertName];
      return hit(s ?? table.default);
    }
    default:
      return hit(table.default);
  }
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Transparent 0-100 score per spec §4.3.
 * @param {object} event LiveEvent.
 * @param {number} [nowMs] Defaults to Date.now().
 */
export function scoreEvent(event, nowMs = Date.now()) {
  const started = Date.parse(event?.startedAt);
  const ageMs = Number.isFinite(started) ? Math.max(0, nowMs - started) : 0;
  const recency = 40 * Math.max(0, 1 - ageMs / (24 * 3600_000));

  const severity = Number.isFinite(event?.severity)
    ? Math.max(1, Math.min(5, event.severity))
    : 1;
  const severityPoints = 30 * (severity / 5);

  const sourceCount = Array.isArray(event?.sources) ? event.sources.length : 0;
  const sourcePoints = sourceCount >= 2 ? 20 : sourceCount === 1 ? 8 : 0;

  const attention = Number.isFinite(event?.mediaAttention)
    ? Math.max(0, Math.min(100, event.mediaAttention))
    : 0;
  const attentionPoints = attention / 10;

  return clampScore(recency + severityPoints + sourcePoints + attentionPoints);
}

const CONFIDENCE_RANK = { verified: 0, reported: 1, unconfirmed: 2 };

function mergePair(a, b) {
  const sources = [...(a.sources || [])];
  const seen = new Set(sources.map((s) => s?.url).filter(Boolean));
  for (const s of b.sources || []) {
    if (s?.url && !seen.has(s.url)) {
      seen.add(s.url);
      sources.push(s);
    } else if (!s?.url) {
      sources.push(s);
    }
  }
  const keywords = [...new Set([...(a.keywords || []), ...(b.keywords || [])])];
  const links = [...(a.links || [])];
  const linkSeen = new Set(links.map((l) => l?.url).filter(Boolean));
  for (const l of b.links || []) {
    if (l?.url && !linkSeen.has(l.url)) {
      linkSeen.add(l.url);
      links.push(l);
    }
  }
  const startedAt =
    Date.parse(a.startedAt) <= Date.parse(b.startedAt)
      ? a.startedAt
      : b.startedAt;
  const updatedAt =
    Date.parse(a.updatedAt) >= Date.parse(b.updatedAt)
      ? a.updatedAt
      : b.updatedAt;
  const aConf = CONFIDENCE_RANK[a.confidence] ?? 1;
  const bConf = CONFIDENCE_RANK[b.confidence] ?? 1;
  return {
    ...a,
    id: a.id,
    startedAt,
    updatedAt,
    sources,
    links,
    keywords,
    severity: Math.max(a.severity || 1, b.severity || 1),
    confidence: aConf <= bConf ? a.confidence : b.confidence,
    title: a.title,
    summary: a.summary,
    mediaAttention:
      Math.max(a.mediaAttention ?? 0, b.mediaAttention ?? 0) || undefined,
  };
}

function keywordOverlap(a, b) {
  const set = new Set(a || []);
  let shared = 0;
  for (const k of b || []) if (set.has(k)) shared++;
  return shared;
}

/**
 * Merge duplicate reports of the same real-world event.
 * Rule: same type + same geohash-5 + ≥1 overlapping keyword within 6h of the
 * cluster's seed event → merge, keep earliest startedAt, union sources.
 * The 6h window is anchored to the seed (first event), not re-anchored on
 * every merge — otherwise hourly reports chain into one endless cluster.
 */
export function dedupeEvents(events) {
  const groups = []; // { merged, seedStartedAt }
  for (const event of events || []) {
    if (!event || typeof event !== 'object') continue;
    const bucket = encodeGeohash(event.lat, event.lon, 5);
    const started = Date.parse(event.startedAt);
    let group = null;
    for (const candidate of groups) {
      const merged = candidate.merged;
      if (merged.type !== event.type) continue;
      if (encodeGeohash(merged.lat, merged.lon, 5) !== bucket) continue;
      if (
        !Number.isFinite(started) ||
        Math.abs(started - candidate.seedStartedAt) > DEDUPE_WINDOW_MS
      )
        continue;
      if (keywordOverlap(merged.keywords, event.keywords) < 1) continue;
      group = candidate;
      break;
    }
    if (group) {
      group.merged = mergePair(group.merged, event);
    } else {
      groups.push({
        merged: { ...event },
        seedStartedAt: Number.isFinite(started) ? started : 0,
      });
    }
  }
  return groups.map((g) => g.merged);
}

/**
 * Full pipeline: drop stale/future events, dedupe, score, sort, top 12.
 * @param {Array<object>} events Raw LiveEvent[] from ingest.
 * @param {object} [options]
 * @param {number} [options.nowMs]
 */
export function rankLiveEvents(events, { nowMs = Date.now() } = {}) {
  const fresh = (events || []).filter((event) => {
    const started = Date.parse(event?.startedAt);
    if (!Number.isFinite(started)) return false;
    const age = nowMs - started;
    return age >= 0 && age <= MAX_EVENT_AGE_MS;
  });
  const deduped = dedupeEvents(fresh);
  const scored = deduped.map((event) => ({
    ...event,
    score: scoreEvent(event, nowMs),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_EVENTS);
}
