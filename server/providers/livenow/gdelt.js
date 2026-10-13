/**
 * @module providers/livenow/gdelt
 * @description GDELT 2.0 DOC API client (timelinevol + artlist modes) as a
 * direct HTTPS wrapper — no Python sidecar: the repo has no established
 * Node/Python sidecar pattern and the DOC API is a simple keyless REST API.
 *
 * Used ONLY as an attention meter (article-volume timelines per topic) to
 * rank news clusters. Runs server-side only — nothing in here is bundled to
 * the client, and no API key is involved.
 *
 * SAFETY: stores counts + links, never article text (see artlist use below).
 */
import { normalizeRegionalArticles } from '../../../src/data/regionalModel.js';
import { readCappedResponseText } from '../common/http.js';

const DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const USER_AGENT = 'GodsEyeView/0.1';
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_BYTES = 512 * 1024;

/** Reference volume that maps to attention 100 (tunable). */
export const ATTENTION_SATURATION_VOLUME = 1000;

/**
 * Map a peak daily article volume to a 0-100 attention score.
 * Log scale: 10/day → ~33, 100/day → ~67, 1000/day → 100.
 */
export function attentionFromPeak(peak) {
  const p = Number.isFinite(peak) ? Math.max(0, peak) : 0;
  if (p <= 0) return 0;
  const score =
    (100 * Math.log10(1 + p)) / Math.log10(1 + ATTENTION_SATURATION_VOLUME);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Defensive parse of a DOC timelinevol JSON payload into a volume series.
 * Accepts value/volume/count key variants; skips malformed rows.
 * @returns {Array<{date: string, volume: number}>}
 */
export function parseTimelinePayload(payload) {
  const out = [];
  const blocks = Array.isArray(payload) ? payload : [];
  for (const block of blocks) {
    const rows = Array.isArray(block?.data) ? block.data : [];
    for (const row of rows) {
      const date = typeof row?.date === 'string' ? row.date : null;
      const volume = Number(row?.value ?? row?.volume ?? row?.count);
      if (!date || !Number.isFinite(volume)) continue;
      out.push({ date, volume: Math.max(0, Math.round(volume)) });
    }
  }
  return out;
}

async function fetchDoc(
  params,
  { fetchImpl = globalThis.fetch, timeoutMs } = {},
) {
  const url = `${DOC_API}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response?.ok)
      throw new Error(`gdelt_http_${response?.status ?? 'unknown'}`);
    const { tooLarge, text } = await readCappedResponseText(
      response,
      MAX_BYTES,
    );
    if (tooLarge) throw new Error('gdelt_response_too_large');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function gdeltQuery(keywords) {
  // DOC API query language: quoted phrases, OR-joined. Keep it simple.
  const terms = (Array.isArray(keywords) ? keywords : [keywords])
    .filter((k) => typeof k === 'string' && k.trim().length > 1)
    .slice(0, 4)
    .map((k) => (/[\s]/.test(k.trim()) ? `"${k.trim()}"` : k.trim()));
  return terms.join(' OR ') || 'news';
}

/**
 * Fetch an article-volume timeline for a keyword query.
 * @returns {Promise<{query, peak, series, attention}>} Zeroed on any failure.
 */
export async function fetchTimelineVolume(
  keywords,
  { timespan = '7d', fetchImpl, timeoutMs } = {},
) {
  const query = gdeltQuery(keywords);
  const params = new URLSearchParams({
    query,
    mode: 'timelinevol',
    format: 'json',
    timespan,
  });
  try {
    const series = parseTimelinePayload(
      await fetchDoc(params, { fetchImpl, timeoutMs }),
    );
    const peak = series.reduce((m, s) => Math.max(m, s.volume), 0);
    return { query, peak, series, attention: attentionFromPeak(peak) };
  } catch {
    return { query, peak: 0, series: [], attention: 0 };
  }
}

/**
 * Fetch a headline list for a keyword query (fallback news-cluster source).
 * Returns normalized {title, url, domain, publishedAt} rows only — no text.
 * @returns {Promise<{query, articles}>} Empty articles on any failure.
 */
export async function fetchArticleList(
  keywords,
  { maxRecords = 25, timespan = '48h', fetchImpl, timeoutMs } = {},
) {
  const query = gdeltQuery(keywords);
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(Math.max(1, Math.min(250, maxRecords))),
    sort: 'datedesc',
    timespan,
  });
  try {
    const payload = await fetchDoc(params, { fetchImpl, timeoutMs });
    return { query, articles: normalizeRegionalArticles(payload, maxRecords) };
  } catch {
    return { query, articles: [] };
  }
}
