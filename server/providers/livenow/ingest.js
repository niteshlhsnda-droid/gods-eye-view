/**
 * @module providers/livenow/ingest
 * @description Live Now ingest pipeline: pulls each source, normalizes to
 * LiveEvent[], and reports per-source health into the feed-health contract.
 *
 * Sources (each wrapped so one dead upstream degrades the panel instead of
 * killing the view):
 *   quakes    USGS earthquake feed (M≥5.5 singles + quakeSwarm detector)
 *   cyclones  NOAA NHC CurrentStorms.json (via shared parseCycloneStatus)
 *   fires     NASA FIRMS VIIRS hotspots (needs FIRMS_MAP_KEY; keyless → unavailable)
 *   weather   NWS active alerts (US coverage)
 *   news      Google News RSS world top stories → keyword clusters → GDELT
 *             timelinevol attention; GDELT artlist fallback
 *   aviation  adsb.lol military feed → emergency-squawk detector
 *   maritime  in-process AIS store → AIS dark-gap detector
 *
 * `runIngestCycle()` is the 10-minute cron entry point (see plugin.js and
 * scripts/live-now-cron.mjs). All network access is injectable via
 * `fetchImpl` so tests never hit the wire.
 */
import { readResponseTextCapped } from '../common/http.js';
import { normalizeRssArticles } from '../regional/news.js';
import { parseCycloneStatus } from '../cyclones.js';
import {
  filterTrailing24h,
  parseFirmsCsv,
} from '../../../src/data/firmsCsv.js';
import { detectAisDarkGaps } from '../../../src/anomaly/aisDarkGaps.js';
import { detectEmergencySquawks } from '../../../src/anomaly/squawk.js';
import { detectQuakeSwarms } from '../../../src/anomaly/quakeSwarm.js';
import { aisStreamRows } from '../vessels/ais-store.js';
import {
  createFeedEntry,
  createFeedSnapshot,
} from '../../../src/metrics/feedHealthContract.js';
import { encodeGeohash, rankLiveEvents, severityFor } from './rank.js';
import { fetchArticleList, fetchTimelineVolume } from './gdelt.js';

const UA = 'GodsEyeView/0.1';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;

/** Adapter ids, stable for feed-health badges. */
export const SOURCE_IDS = Object.freeze([
  'quakes',
  'cyclones',
  'fires',
  'weather',
  'news',
  'aviation',
  'maritime',
]);

/** Coarse gazetteer for news-cluster geocoding (name → centroid). */
const GAZETTEER = Object.freeze([
  ['india', 21, 78],
  ['pakistan', 30, 70],
  ['bangladesh', 23.7, 90.4],
  ['china', 35, 104],
  ['japan', 36, 138],
  ['taiwan', 23.7, 121],
  ['philippines', 13, 122],
  ['indonesia', -2, 118],
  ['thailand', 15.9, 101],
  ['myanmar', 21.9, 96],
  ['nepal', 28.4, 84],
  ['sri lanka', 7.9, 80.8],
  ['afghanistan', 33.9, 67.7],
  ['iran', 32.4, 53.7],
  ['iraq', 33, 44],
  ['saudi arabia', 24, 45],
  ['israel', 31, 34.8],
  ['gaza', 31.5, 34.5],
  ['ukraine', 48.4, 31.2],
  ['russia', 60, 90],
  ['turkey', 38.9, 35.2],
  ['egypt', 26.8, 30.8],
  ['nigeria', 9.1, 8.7],
  ['kenya', 0.5, 37.9],
  ['south africa', -29, 25],
  ['united states', 39.8, -98.6],
  ['usa', 39.8, -98.6],
  ['canada', 56.1, -106.3],
  ['mexico', 23.6, -102.5],
  ['brazil', -14.2, -51.9],
  ['argentina', -38.4, -63.6],
  ['united kingdom', 55.4, -3.4],
  ['uk', 55.4, -3.4],
  ['france', 46.6, 2.5],
  ['germany', 51.2, 10.4],
  ['italy', 41.9, 12.6],
  ['spain', 40.3, -3.7],
  ['greece', 39.1, 22],
  ['australia', -25.3, 133.8],
  ['new zealand', -41, 174],
  ['papua new guinea', -6.3, 147],
  ['west bengal', 22.9, 87.9],
  ['bihar', 25.6, 85.7],
  ['patna', 25.6, 85.1],
  ['delhi', 28.6, 77.2],
  ['mumbai', 19.1, 72.9],
  ['kolkata', 22.6, 88.4],
  ['texas', 31, -100],
  ['california', 36.8, -119.4],
  ['florida', 27.7, -81.4],
  ['europe', 50, 10],
  ['asia', 34, 100],
  ['africa', 0, 20],
  ['atlantic', 25, -40],
  ['pacific', 0, -150],
  ['bay of bengal', 15, 88],
  ['arabian sea', 14, 63],
  ['mediterranean', 36, 18],
]);

const STOPWORDS = new Set(
  'a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,into,over,after,before,while,when,where,which,who,whom,whose,what,that,this,these,those,is,are,was,were,be,been,being,has,have,had,do,does,did,will,would,can,could,should,may,might,must,shall,not,no,yes,so,such,than,too,very,just,more,most,other,some,any,all,each,every,both,few,many,own,same,its,it,he,she,they,we,you,i,him,her,them,us,my,your,his,our,their,says,said,say,told,tell,new,old,big,small,high,low,top,breaking,live,update,updates,amid,among,between,through,during,about,against,across,aftermath,makes,make,made,takes,take,took,gets,get,got,gives,given,shows,show,seen,sees,look,looks,one,two,three,first,last,next,also,even,still,back,up,out,off,down,away,here,there,now,today,yesterday'.split(
    ',',
  ),
);

/**
 * Extract significant keywords from a headline (public feed text only).
 * Lowercase tokens, stopword + length filter, capped at 8.
 */
export function extractKeywords(title) {
  if (!title || typeof title !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= 8) break;
  }
  return out;
}

function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable event id: `${type}:${geohash5}:${keywordHash}` per spec §4.1. */
export function stableEventId(type, lat, lon, keywords) {
  const keys = [...new Set(keywords || [])].sort().join('|');
  const digest = fnv1a(`${type}|${keys}`).toString(16).padStart(8, '0');
  return `${type}:${encodeGeohash(lat, lon, 5)}:${digest}`;
}

function cleanText(value, max) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function gazetteerCentroid(text) {
  const lower = String(text || '').toLowerCase();
  for (const [name, lat, lon] of GAZETTEER) {
    if (lower.includes(name)) return { lat, lon, matched: name };
  }
  return null;
}

function truncate(value, max) {
  const s = String(value || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Capped fetch with timeout; throws on any failure. */
async function fetchRaw(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS, headers } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': UA, ...(headers || {}) },
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`http_${response?.status ?? 'unknown'}`);
    // readResponseTextCapped returns text, throws on over-cap bodies.
    return await readResponseTextCapped(response, MAX_BYTES);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonCapped(url, options = {}) {
  const text = await fetchRaw(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  return JSON.parse(text);
}

async function fetchTextCapped(url, options) {
  return fetchRaw(url, options);
}

function healthOf(
  id,
  label,
  state,
  { messageCount = null, note = null, lastUpdate = null } = {},
) {
  return createFeedEntry({ id, label, state, messageCount, note, lastUpdate });
}

function failedHealth(id, label, note) {
  return healthOf(id, label, 'unavailable', { note });
}

/* ---------------- quakes ---------------- */

const USGS_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';

export async function pullQuakes({ fetchImpl, nowMs = Date.now() } = {}) {
  const label = 'Earthquakes (USGS)';
  try {
    const payload = await fetchJsonCapped(USGS_URL, { fetchImpl });
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const quakes = [];
    for (const f of features) {
      const [lon, lat] = f?.geometry?.coordinates || [];
      const p = f?.properties || {};
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        !Number.isFinite(p.mag) ||
        !Number.isFinite(p.time)
      )
        continue;
      quakes.push({
        id: f.id,
        mag: p.mag,
        timeMs: p.time,
        lat,
        lon,
        place: p.place,
        url: p.url,
      });
    }
    const events = [];
    for (const q of quakes) {
      if (q.mag < 5.5) continue;
      const keywords = ['earthquake', ...extractKeywords(q.place)];
      events.push({
        id: stableEventId('quake', q.lat, q.lon, keywords),
        type: 'quake',
        title: truncate(
          `M${q.mag.toFixed(1)} earthquake — ${cleanText(q.place, 60) || 'unknown location'}`,
          90,
        ),
        summary: truncate(
          `Magnitude ${q.mag.toFixed(1)} earthquake ${cleanText(q.place, 120)}. Reported by USGS.`,
          200,
        ),
        lat: q.lat,
        lon: q.lon,
        severity: severityFor('quake', { magnitude: q.mag }),
        startedAt: new Date(q.timeMs).toISOString(),
        updatedAt: new Date(q.timeMs).toISOString(),
        sources: [
          { name: 'USGS', url: q.url || 'https://earthquake.usgs.gov' },
        ],
        confidence: 'verified',
        links: [
          {
            label: 'USGS event page',
            url: q.url || 'https://earthquake.usgs.gov',
          },
        ],
        keywords,
      });
    }
    for (const swarm of detectQuakeSwarms(quakes, { now: nowMs })) {
      const { count, maxMag, centroidLat, centroidLon } = swarm.ref;
      const place = cleanText(
        String(swarm.title).replace(/^Quake swarm — \d+ events near /, ''),
        60,
      );
      const keywords = ['earthquake', 'swarm', ...extractKeywords(place)];
      events.push({
        id: stableEventId('quake', centroidLat, centroidLon, [
          'swarm',
          ...keywords,
        ]),
        type: 'quake',
        title: truncate(
          `Earthquake swarm — ${count} events near ${place || 'unknown area'}`,
          90,
        ),
        summary: truncate(
          `${count} earthquakes within 50 km over 24h, largest M${maxMag.toFixed(1)}. Detected by USGS feed.`,
          200,
        ),
        lat: centroidLat,
        lon: centroidLon,
        severity: severityFor('quake', { eventCount: count }),
        startedAt: new Date(nowMs - 24 * 3600_000).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        sources: [{ name: 'USGS', url: 'https://earthquake.usgs.gov' }],
        confidence: 'reported',
        links: [
          { label: 'USGS earthquakes', url: 'https://earthquake.usgs.gov' },
        ],
        keywords,
      });
    }
    return {
      events,
      health: healthOf('quakes', label, 'nominal', {
        messageCount: quakes.length,
        lastUpdate: new Date(nowMs).toISOString(),
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: failedHealth(
        'quakes',
        label,
        `USGS unreachable: ${error.message}`,
      ),
    };
  }
}

/* ---------------- cyclones ---------------- */

const NHC_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';

function saffirSimpson(windKt) {
  if (!Number.isFinite(windKt)) return 0;
  if (windKt >= 137) return 5;
  if (windKt >= 113) return 4;
  if (windKt >= 96) return 3;
  if (windKt >= 83) return 2;
  if (windKt >= 64) return 1;
  return 0;
}

const BASIN_NAMES = {
  AL: 'Atlantic',
  EP: 'Eastern Pacific',
  CP: 'Central Pacific',
};

export async function pullCyclones({ fetchImpl, nowMs = Date.now() } = {}) {
  const label = 'Cyclones (NOAA NHC)';
  try {
    const payload = await fetchJsonCapped(NHC_URL, { fetchImpl });
    const storms = parseCycloneStatus(payload, nowMs);
    const events = storms.map((storm) => {
      const category = saffirSimpson(storm.windKt);
      const name = storm.name.charAt(0) + storm.name.slice(1).toLowerCase();
      const basin = BASIN_NAMES[storm.basin] || storm.basin;
      const keywords = [
        'cyclone',
        'storm',
        ...extractKeywords(`${name} ${basin}`),
      ];
      const catLabel = category > 0 ? `Category ${category}` : 'Tropical storm';
      const lat = storm.position.latitude;
      const lon = storm.position.longitude;
      return {
        id: stableEventId('cyclone', lat, lon, [
          name.toLowerCase(),
          basin.toLowerCase(),
        ]),
        type: 'cyclone',
        title: truncate(`${name} — ${catLabel}, ${basin}`, 90),
        summary: truncate(
          `${storm.classification} ${name}: ${storm.windKt ?? '?'} kt winds, moving at ${storm.movement.speedKt ?? '?'} kt. Advisory ${storm.advisoryNumber || '—'} from NOAA NHC.`,
          200,
        ),
        lat,
        lon,
        severity: severityFor('cyclone', { category }),
        startedAt: storm.positionAt || new Date(nowMs).toISOString(),
        updatedAt: storm.issuedAt || new Date(nowMs).toISOString(),
        sources: [
          {
            name: 'NOAA NHC',
            url: storm.advisoryUrl || 'https://www.nhc.noaa.gov',
          },
        ],
        confidence: 'verified',
        links: [
          {
            label: 'NHC advisory',
            url: storm.advisoryUrl || 'https://www.nhc.noaa.gov',
          },
          { label: 'Tropical outlook', url: storm.outlookUrl },
        ].filter((l) => l.url),
        keywords,
      };
    });
    return {
      events,
      health: healthOf('cyclones', label, 'nominal', {
        messageCount: storms.length,
        lastUpdate: new Date(nowMs).toISOString(),
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: failedHealth(
        'cyclones',
        label,
        `NHC unreachable: ${error.message}`,
      ),
    };
  }
}

/* ---------------- fires (FIRMS) ---------------- */

function clusterHotspots(records) {
  const cells = new Map();
  for (const r of records) {
    const key = `${Math.floor(r.lat * 2) / 2},${Math.floor(r.lon * 2) / 2}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { count: 0, latSum: 0, lonSum: 0 };
      cells.set(key, cell);
    }
    cell.count++;
    cell.latSum += r.lat;
    cell.lonSum += r.lon;
  }
  return [...cells.values()]
    .filter((c) => c.count >= 10)
    .map((c) => ({
      count: c.count,
      lat: c.latSum / c.count,
      lon: c.lonSum / c.count,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function pullFires({
  fetchImpl,
  nowMs = Date.now(),
  mapKey = process.env.FIRMS_MAP_KEY,
} = {}) {
  const label = 'Fires (NASA FIRMS)';
  if (!mapKey) {
    return {
      events: [],
      health: failedHealth('fires', label, 'no FIRMS_MAP_KEY configured'),
    };
  }
  try {
    const csv = await fetchTextCapped(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_NOAA20_NRT/world/2`,
      { fetchImpl },
    );
    const parsed = parseFirmsCsv(csv) || [];
    const recent = filterTrailing24h(parsed, nowMs);
    const events = clusterHotspots(recent).map((cluster) => {
      const keywords = ['fire', 'wildfire', 'hotspots'];
      return {
        id: stableEventId('fire', cluster.lat, cluster.lon, keywords),
        type: 'fire',
        title: truncate(
          `Fire cluster — ${cluster.count} hotspots detected`,
          90,
        ),
        summary: truncate(
          `${cluster.count} active-fire hotspots within ~55 km in the last 24h (VIIRS). Satellite detection — verify on the ground.`,
          200,
        ),
        lat: cluster.lat,
        lon: cluster.lon,
        severity: severityFor('fire', { hotspotCount: cluster.count }),
        startedAt: new Date(nowMs - 24 * 3600_000).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        sources: [
          { name: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov' },
        ],
        confidence: 'reported',
        links: [
          {
            label: 'FIRMS fire map',
            url: 'https://firms.modaps.eosdis.nasa.gov/map',
          },
        ],
        keywords,
      };
    });
    return {
      events,
      health: healthOf('fires', label, 'nominal', {
        messageCount: recent.length,
        lastUpdate: new Date(nowMs).toISOString(),
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: failedHealth(
        'fires',
        label,
        `FIRMS unreachable: ${error.message}`,
      ),
    };
  }
}

/* ---------------- weather (NWS alerts) ---------------- */

const NWS_URL = 'https://api.weather.gov/alerts/active';

export async function pullWeather({ fetchImpl, nowMs = Date.now() } = {}) {
  const label = 'Weather alerts (NWS)';
  try {
    const payload = await fetchJsonCapped(NWS_URL, {
      fetchImpl,
      headers: { Accept: 'application/geo+json' },
    });
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const groups = new Map();
    for (const f of features) {
      const p = f?.properties || {};
      const eventName = p.event;
      if (typeof eventName !== 'string') continue;
      // Only severe alert types become Live Now events.
      if (severityFor('weather', { alertName: eventName }) < 3) continue;
      const coords = f?.geometry?.coordinates;
      let lat = null;
      let lon = null;
      if (
        Array.isArray(coords) &&
        Number.isFinite(coords[1]) &&
        Number.isFinite(coords[0])
      ) {
        [lon, lat] = coords;
      } else if (
        f?.geometry?.type === 'Polygon' &&
        Array.isArray(coords?.[0]?.[0])
      ) {
        [lon, lat] = coords[0][0];
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const key = `${eventName}|${encodeGeohash(lat, lon, 5)}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          eventName,
          lat,
          lon,
          count: 0,
          area: p.areaDesc,
          effective: p.effective,
          certainty: p.certainty,
        };
        groups.set(key, group);
      }
      group.count++;
    }
    const events = [...groups.values()].map((g) => {
      const keywords = ['weather', 'alert', ...extractKeywords(g.eventName)];
      const alertId = `nws-${encodeGeohash(g.lat, g.lon, 5)}`;
      return {
        id: stableEventId('weather', g.lat, g.lon, [
          g.eventName.toLowerCase(),
          ...keywords,
        ]),
        type: 'weather',
        title: truncate(`${g.eventName} — ${cleanText(g.area, 60)}`, 90),
        summary: truncate(
          `${g.eventName} affecting ${cleanText(g.area, 120)} (${g.count} zone${g.count === 1 ? '' : 's'}). US National Weather Service.`,
          200,
        ),
        lat: g.lat,
        lon: g.lon,
        severity: severityFor('weather', { alertName: g.eventName }),
        startedAt:
          g.effective && !Number.isNaN(Date.parse(g.effective))
            ? new Date(g.effective).toISOString()
            : new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        sources: [{ name: 'NWS', url: 'https://www.weather.gov' }],
        confidence: g.certainty === 'Observed' ? 'verified' : 'reported',
        links: [{ label: 'NWS alerts', url: 'https://alerts.weather.gov' }],
        keywords,
      };
    });
    return {
      events,
      health: healthOf('weather', label, 'nominal', {
        messageCount: events.length,
        note: 'US coverage only',
        lastUpdate: new Date(nowMs).toISOString(),
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: failedHealth(
        'weather',
        label,
        `NWS unreachable: ${error.message}`,
      ),
    };
  }
}

/* ---------------- news clusters ---------------- */

const GOOGLE_NEWS_RSS = 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';

function clusterArticles(articles) {
  const remaining = [...articles];
  const clusters = [];
  while (remaining.length && clusters.length < 5) {
    const seed = remaining.shift();
    const seedKeys = new Set(extractKeywords(seed.title));
    const members = [seed];
    for (let i = remaining.length - 1; i >= 0; i--) {
      const keys = extractKeywords(remaining[i].title);
      const shared = keys.filter((k) => seedKeys.has(k)).length;
      if (shared >= 2) {
        members.push(remaining[i]);
        remaining.splice(i, 1);
      }
    }
    clusters.push(members);
  }
  return clusters;
}

export async function pullNews({
  fetchImpl,
  nowMs = Date.now(),
  attentionImpl = (keywords) =>
    fetchTimelineVolume(keywords, { timeoutMs: 8000 }).then((r) => r.attention),
} = {}) {
  const label = 'News clusters (Google News RSS)';
  let articles = [];
  let degraded = null;
  try {
    const xml = await fetchTextCapped(GOOGLE_NEWS_RSS, { fetchImpl });
    articles = normalizeRssArticles(xml, 25);
    if (!articles.length) throw new Error('empty rss');
  } catch {
    try {
      const fallback = await fetchArticleList(['world', 'news'], { fetchImpl });
      articles = fallback.articles;
      degraded = 'Google News RSS failed; GDELT artlist fallback';
    } catch (error) {
      return {
        events: [],
        health: failedHealth(
          'news',
          label,
          `news sources unreachable: ${error.message}`,
        ),
      };
    }
  }
  if (!articles.length) {
    return {
      events: [],
      // The fallback path ran but yielded nothing: the badge must not claim
      // nominal health. (Grok QA: news health mislabel in total-outage case.)
      health: healthOf('news', label, degraded ? 'degraded' : 'nominal', {
        messageCount: 0,
        note: degraded || 'no headlines right now',
        lastUpdate: new Date(nowMs).toISOString(),
      }),
    };
  }
  const clusters = [];
  for (const members of clusterArticles(articles)) {
    const seed = members[0];
    const keywords = extractKeywords(seed.title);
    if (!keywords.length) continue;
    clusters.push({ members, seed, keywords });
  }
  // GDELT attention queries run in parallel (rate-limited upstream; each has
  // its own short timeout and a zero fallback).
  const attentions = await Promise.all(
    clusters.map(({ keywords }) =>
      Promise.resolve()
        .then(() => attentionImpl(keywords.slice(0, 3)))
        .catch(() => 0),
    ),
  );
  const events = clusters.map(({ members, seed, keywords }, index) => {
    const geoText = members.map((m) => m.title).join(' ');
    const geo = gazetteerCentroid(geoText);
    const lat = geo?.lat ?? 20;
    const lon = geo?.lon ?? 0;
    const startedAt = members
      .map((m) => Date.parse(m.publishedAt))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    const sources = members
      .slice(0, 5)
      .map((m) => ({ name: m.domain, url: m.url }));
    return {
      id: stableEventId('news', lat, lon, keywords),
      type: 'news',
      title: truncate(seed.title, 90),
      summary: truncate(
        `${members.length} outlet${members.length === 1 ? '' : 's'} reporting: ${seed.title}`,
        200,
      ),
      lat,
      lon,
      severity: severityFor('news', {}),
      startedAt: Number.isFinite(startedAt)
        ? new Date(startedAt).toISOString()
        : new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
      sources,
      confidence: 'reported',
      mediaAttention: Number.isFinite(attentions[index])
        ? attentions[index]
        : 0,
      links: sources.map((s) => ({ label: s.name, url: s.url })),
      keywords,
    };
  });
  return {
    events,
    health: healthOf('news', label, degraded ? 'degraded' : 'nominal', {
      messageCount: articles.length,
      note: degraded,
      lastUpdate: new Date(nowMs).toISOString(),
    }),
  };
}

/* ---------------- aviation (squawk) ---------------- */

const ADSB_LOL_MIL = 'https://api.adsb.lol/v2/mil';

export async function pullAviation({ fetchImpl, nowMs = Date.now() } = {}) {
  const label = 'Aviation (adsb.lol)';
  try {
    const payload = await fetchJsonCapped(ADSB_LOL_MIL, { fetchImpl });
    const aircraft = (Array.isArray(payload?.ac) ? payload.ac : []).map(
      (a) => ({
        icao24: a?.hex,
        callsign: typeof a?.flight === 'string' ? a.flight.trim() : null,
        squawk: a?.squawk,
        lat: a?.lat,
        lon: a?.lon,
        altFt: a?.alt_baro,
      }),
    );
    const events = detectEmergencySquawks(aircraft, { now: nowMs }).map(
      (hit) => {
        const { squawk, callsign, lat, lon } = hit.ref;
        const labelText =
          {
            7700: 'general emergency',
            7600: 'radio failure',
            7500: 'unlawful interference',
          }[squawk] || 'emergency';
        const keywords = ['aviation', 'squawk', squawk];
        return {
          id: stableEventId('aviation', lat ?? 0, lon ?? 0, [
            'squawk',
            squawk,
            hit.ref.icao24,
          ]),
          type: 'aviation',
          title: truncate(
            `Squawk ${squawk} — ${labelText}${callsign ? ` · ${callsign}` : ''}`,
            90,
          ),
          // Never speculate on casualties (spec §4.5).
          summary: truncate(
            `Aircraft${callsign ? ` ${callsign}` : ''} broadcasting emergency squawk ${squawk} (${labelText}). Verify against official sources.`,
            200,
          ),
          lat: Number.isFinite(lat) ? lat : 0,
          lon: Number.isFinite(lon) ? lon : 0,
          severity: severityFor('aviation', { squawk }),
          startedAt: new Date(hit.detectedAtMs).toISOString(),
          updatedAt: new Date(nowMs).toISOString(),
          sources: [{ name: 'adsb.lol', url: 'https://adsb.lol' }],
          confidence: 'reported',
          links: [{ label: 'adsb.lol', url: 'https://adsb.lol' }],
          keywords,
        };
      },
    );
    return {
      events,
      health: healthOf('aviation', label, 'nominal', {
        messageCount: aircraft.length,
        note: 'military feed sample',
        lastUpdate: new Date(nowMs).toISOString(),
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: failedHealth(
        'aviation',
        label,
        `adsb.lol unreachable: ${error.message}`,
      ),
    };
  }
}

/* ---------------- maritime (AIS dark gaps) ---------------- */

export async function pullMaritime({ nowMs = Date.now() } = {}) {
  const label = 'Maritime (AIS)';
  try {
    const rows = aisStreamRows(5000);
    if (!rows.length) {
      return {
        events: [],
        health: healthOf('maritime', label, 'unavailable', {
          note: 'no AIS traffic in this process (vessel layer not streaming)',
        }),
      };
    }
    const vessels = rows.map((r) => ({
      mmsi: r.mmsi,
      name: r.name,
      lastSeenMs: Number.isFinite(r.last_position_epoch)
        ? r.last_position_epoch * 1000
        : null,
      trackedBefore: true,
      lastLat: r.lat,
      lastLon: r.lon,
    }));
    const events = detectAisDarkGaps(vessels, { now: nowMs }).map((hit) => {
      const { mmsi, name, gapMs, lastLat, lastLon } = hit.ref;
      const hours = (gapMs / 3600_000).toFixed(1);
      const keywords = ['maritime', 'ais', 'dark-gap'];
      return {
        id: stableEventId('maritime', lastLat ?? 0, lastLon ?? 0, [
          'dark-gap',
          String(mmsi),
        ]),
        type: 'maritime',
        title: truncate(
          `AIS dark gap — ${name || `MMSI ${mmsi}`} silent ${hours}h`,
          90,
        ),
        summary: truncate(
          `Vessel ${name || `MMSI ${mmsi}`} stopped broadcasting AIS ${hours} hours ago after regular reporting. Possible disablement or signal loss.`,
          200,
        ),
        lat: Number.isFinite(lastLat) ? lastLat : 0,
        lon: Number.isFinite(lastLon) ? lastLon : 0,
        severity: severityFor('maritime', {}),
        startedAt: new Date(hit.ref.lastSeenMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        sources: [{ name: 'AIS stream', url: 'https://www.aishub.net' }],
        confidence: 'reported',
        links: [{ label: 'AISHub', url: 'https://www.aishub.net' }],
        keywords,
      };
    });
    return {
      events,
      health: healthOf('maritime', label, 'nominal', {
        messageCount: rows.length,
        lastUpdate: new Date(nowMs).toISOString(),
      }),
    };
  } catch (error) {
    return {
      events: [],
      health: failedHealth(
        'maritime',
        label,
        `AIS store unreadable: ${error.message}`,
      ),
    };
  }
}

/* ---------------- cycle ---------------- */

const ADAPTERS = Object.freeze([
  ['quakes', pullQuakes],
  ['cyclones', pullCyclones],
  ['fires', pullFires],
  ['weather', pullWeather],
  ['news', pullNews],
  ['aviation', pullAviation],
  ['maritime', pullMaritime],
]);

/**
 * Run one full ingest cycle: pull every source (failures isolated per
 * source), dedupe + rank, and assemble the feed-health snapshot.
 * Never rejects — a total failure still returns an empty payload with
 * per-source health.
 */
export async function runIngestCycle({
  nowMs = Date.now(),
  mapKey,
  fetchImpl,
  attentionImpl,
} = {}) {
  const options = { nowMs, fetchImpl, attentionImpl };
  if (mapKey !== undefined) options.mapKey = mapKey;
  const settled = await Promise.allSettled(
    ADAPTERS.map(([, pull]) => pull(options)),
  );
  const events = [];
  const feeds = [];
  const staleSources = [];
  ADAPTERS.forEach(([id], index) => {
    const result = settled[index];
    if (result.status === 'fulfilled' && result.value) {
      events.push(...(result.value.events || []));
      feeds.push(result.value.health);
      if (
        ['stale', 'degraded', 'unavailable'].includes(
          result.value.health?.state,
        )
      ) {
        staleSources.push(id);
      }
    } else {
      feeds.push(
        createFeedEntry({
          id,
          label: id,
          state: 'unavailable',
          note: 'adapter threw; isolated from the rest of the cycle',
        }),
      );
      staleSources.push(id);
    }
  });
  const ranked = rankLiveEvents(events, { nowMs });
  return {
    schema: 'gev/live-now',
    version: 1,
    generatedAt: new Date(nowMs).toISOString(),
    events: ranked,
    feedHealth: createFeedSnapshot(feeds, {
      generatedAt: new Date(nowMs).toISOString(),
      source: 'livenow-ingest',
    }),
    staleSources,
  };
}
