/**
 * Import OpenTrafficCamMap static camera files into the CCTV layer.
 *
 * OpenTrafficCamMap (github.com/AidanWelch/OpenTrafficCamMap) publishes
 * large static JSON files of traffic cameras aggregated from DOT sources,
 * shaped as { State: { Area: [{ description, latitude, longitude,
 * direction, url, encoding, format }] }}. No key is required. The files go
 * stale as upstream DOT feeds move, so this importer is re-runnable: every
 * run re-downloads, re-verifies, and rewrites the output from scratch.
 *
 * Liveness rule: EVERY camera URL is checked before it enters the catalog
 * (HEAD, falling back to GET on servers that refuse HEAD). Dead URLs are
 * dropped, counted by reason, and reported — never shipped as phantom
 * cameras. A responding playlist is "live" only in the sense that the URL
 * answers; a DOT HLS stream is a live stream by construction, but the
 * importer cannot prove a playlist is live rather than looped, and says so.
 *
 * Provenance: the upstream file carries no per-camera agency field, so each
 * camera records provider 'OpenTrafficCamMap' plus its state and area
 * (e.g. "Alabama / Mobile") and the upstream URL host in sourceDetail.
 * Do not invent a DOT agency name the file does not state.
 *
 * Output (public/data/cctv-opentraffic.json) uses the same source shape as
 * scripts/build-cctv-snapshot.mjs output, so the client
 * (src/layers/cctv/source.js) merges it with the base snapshot at load.
 * Windy cameras are NOT in this file: their tokenised URLs expire in
 * minutes and must be fetched per page load instead.
 *
 * Usage (from the repo root):
 *   node scripts/import-opentrafficcammap.mjs [--files USA] [--out <path>]
 *     [--concurrency 25] [--timeout-ms 8000] [--max-per-file 0]
 *     [--verify-only] [--offline <path-to-local-json>]
 *
 * --verify-only prints counts without writing. --offline reads a local copy
 * of a cameras file instead of downloading (for tests and re-runs).
 * The script refuses to overwrite a good import with an empty one.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_OUT = path.join(ROOT, 'public', 'data', 'cctv-opentraffic.json');
const UPSTREAM_BASE =
  'https://raw.githubusercontent.com/AidanWelch/OpenTrafficCamMap/master/cameras';

const DIRECTION_HEADING = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function cleanDescription(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** Stable id: a hash of the camera's own fields, not its file position. */
export function opentrafficId(state, area, entry) {
  const hash = createHash('sha1')
    .update(
      [state, area, cleanDescription(entry.description), entry.latitude, entry.longitude]
        .join('|'),
    )
    .digest('hex')
    .slice(0, 12);
  return `otcm-${slug(state)}-${slug(area)}-${hash}`;
}

/** Map the upstream format field to the client's feed-type vocabulary. */
export function opentrafficFeedType(format) {
  const normalized = String(format || '').toUpperCase();
  if (normalized === 'M3U8') return 'hls';
  if (normalized === 'JPEG' || normalized === 'JPG') return 'image';
  // IMAGE_STREAM is the file's vocabulary for a refreshing JPEG snapshot
  // (encoding JPEG, snapshot.jpg URLs) — a CONTINUOUS image feed, not video.
  if (normalized === 'IMAGE_STREAM') return 'image';
  if (normalized === 'MJPEG') return 'mjpeg';
  if (normalized === 'MP4') return 'mp4';
  return '';
}

/**
 * Map one upstream entry to the catalog source shape, or null when the
 * entry is unusable (bad coordinates, no URL, unknown format). Liveness is
 * checked separately by verifyUrl; this function only shapes the record.
 */
export function mapOpentrafficEntry(state, area, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const lat = Number(entry.latitude);
  const lon = Number(entry.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const url = String(entry.url || '').trim();
  if (!url.startsWith('http')) return null;
  const feedType = opentrafficFeedType(entry.format);
  if (!feedType) return null;
  const name = cleanDescription(entry.description);
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }
  const heading = DIRECTION_HEADING[String(entry.direction || '').toUpperCase()];
  const out = {
    id: opentrafficId(state, area, entry),
    name: name || `Traffic camera ${area}`,
    city: `${area}, ${state}`,
    cityId: '',
    provider: 'OpenTrafficCamMap',
    lat,
    lon,
    feedType,
    url,
    snapshotUrl: feedType === 'image' ? url : '',
    license: '',
    credit: 'OpenTrafficCamMap',
    code: '',
    sourceKind: 'opentrafficcammap',
    poseSource: 'opentrafficcammap',
    sourceDetail: `${state} / ${area}${host ? ` via ${host}` : ''}`,
  };
  if (heading !== undefined) {
    out.headingDeg = heading;
    out.headingConfidence = 'medium';
  }
  return out;
}

/**
 * Why an entry did not map (for the run report — a high unusable count
 * must be explained, never silently swallowed). Returns '' when mappable.
 */
export function classifyUnusable(entry) {
  if (!entry || typeof entry !== 'object') return 'not-an-object';
  const lat = Number(entry.latitude);
  const lon = Number(entry.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'bad-coords';
  const url = String(entry.url || '').trim();
  if (!url.startsWith('http')) return 'bad-url';
  if (!opentrafficFeedType(entry.format)) return 'unknown-format';
  return '';
}

/** Flatten one cameras file into mapped entries (unverified). */
export function flattenOpentrafficFile(data) {
  const entries = [];
  if (!data || typeof data !== 'object') return entries;
  for (const [state, areas] of Object.entries(data)) {
    if (!areas || typeof areas !== 'object') continue;
    for (const [area, cameras] of Object.entries(areas)) {
      if (!Array.isArray(cameras)) continue;
      for (const entry of cameras) {
        const mapped = mapOpentrafficEntry(state, area, entry);
        entries.push({ mapped, state, area });
      }
    }
  }
  return entries;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Liveness check: HEAD first; on 405/501 (or a HEAD failure) retry with
 * GET and abort the body immediately. Any 2xx/3xx answer counts as alive.
 * Returns { alive, reason } where reason is '' when alive.
 */
export async function verifyUrl(url, { timeoutMs = 8000 } = {}) {
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs);
    if (head.ok || (head.status >= 300 && head.status < 400))
      return { alive: true, reason: '' };
    if (head.status === 405 || head.status === 501) {
      const get = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
      // Drain nothing: abort the body by cancelling the reader if present.
      try {
        await get.body?.cancel();
      } catch {
        // Body already consumed or non-cancellable; the status is the signal.
      }
      if (get.ok || (get.status >= 300 && get.status < 400))
        return { alive: true, reason: '' };
      return { alive: false, reason: `http-${get.status}` };
    }
    return { alive: false, reason: `http-${head.status}` };
  } catch (error) {
    if (error?.name === 'AbortError') return { alive: false, reason: 'timeout' };
    return { alive: false, reason: 'network' };
  }
}

/** Verify entries with bounded concurrency; returns { alive, dropped }. */
export async function verifyEntries(entries, { concurrency = 25, timeoutMs = 8000 } = {}) {
  const alive = [];
  const dropped = [];
  let index = 0;
  async function worker() {
    while (index < entries.length) {
      const current = entries[index];
      index += 1;
      if (!current.mapped) {
        dropped.push({ reason: 'unusable-entry', state: current.state, area: current.area });
        continue;
      }
      const check = await verifyUrl(current.mapped.url, { timeoutMs });
      if (check.alive) alive.push(current.mapped);
      else
        dropped.push({
          reason: check.reason,
          id: current.mapped.id,
          url: current.mapped.url,
        });
    }
  }
  const workers = [];
  for (let i = 0; i < Math.max(1, concurrency); i += 1) workers.push(worker());
  await Promise.all(workers);
  return { alive, dropped };
}

function parseArgs(argv) {
  const out = {
    files: ['USA'],
    outPath: DEFAULT_OUT,
    concurrency: 25,
    timeoutMs: 8000,
    maxPerFile: 0,
    verifyOnly: false,
    offline: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--files' && argv[i + 1]) {
      out.files = argv[i + 1].split(',').map((f) => f.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--out' && argv[i + 1]) {
      out.outPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--concurrency' && argv[i + 1]) {
      out.concurrency = Math.max(1, Number(argv[i + 1]) || 25);
      i += 1;
    } else if (arg === '--timeout-ms' && argv[i + 1]) {
      out.timeoutMs = Math.max(1000, Number(argv[i + 1]) || 8000);
      i += 1;
    } else if (arg === '--max-per-file' && argv[i + 1]) {
      out.maxPerFile = Math.max(0, Number(argv[i + 1]) || 0);
      i += 1;
    } else if (arg === '--verify-only') {
      out.verifyOnly = true;
    } else if (arg === '--offline' && argv[i + 1]) {
      out.offline = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function loadFile(file, offline) {
  if (offline) {
    const text = await readFile(offline, 'utf8');
    return JSON.parse(text);
  }
  const response = await fetch(`${UPSTREAM_BASE}/${file}.json`, {
    headers: { 'User-Agent': 'gods-eye-view-cctv-import' },
  });
  if (!response.ok)
    throw new Error(`OpenTrafficCamMap ${file}.json HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const allAlive = [];
  const counts = { total: 0, verified: 0, dropped: 0 };
  const droppedByReason = {};
  const filesMeta = {};
  for (const file of opts.files) {
    const data = await loadFile(file, opts.offline);
    let flat = flattenOpentrafficFile(data);
    const unusable = flat.filter((entry) => !entry.mapped).length;
    flat = flat.filter((entry) => entry.mapped);
    if (opts.maxPerFile > 0) flat = flat.slice(0, opts.maxPerFile);
    console.log(
      `[otcm] ${file}: ${flat.length} mappable entries (${unusable} unusable skipped)`,
    );
    const { alive, dropped } = await verifyEntries(flat, {
      concurrency: opts.concurrency,
      timeoutMs: opts.timeoutMs,
    });
    counts.total += flat.length + unusable;
    counts.verified += alive.length;
    counts.dropped += dropped.length + unusable;
    for (const entry of dropped) {
      droppedByReason[entry.reason] = (droppedByReason[entry.reason] || 0) + 1;
    }
    if (unusable) {
      droppedByReason['unusable-entry'] =
        (droppedByReason['unusable-entry'] || 0) + unusable;
    }
    filesMeta[file] = {
      mappable: flat.length,
      verified: alive.length,
      dropped: dropped.length + unusable,
    };
    allAlive.push(...alive);
    console.log(
      `[otcm] ${file}: verified ${alive.length}, dropped ${dropped.length + unusable}`,
    );
  }
  console.log(
    `[otcm] total=${counts.total} verified=${counts.verified} dropped=${counts.dropped}`,
  );
  console.log(`[otcm] dropped by reason: ${JSON.stringify(droppedByReason)}`);
  if (opts.verifyOnly) return;
  if (allAlive.length === 0) {
    console.error(
      '[otcm] refusing to write an empty import: no camera URL verified alive',
    );
    process.exitCode = 1;
    return;
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/import-opentrafficcammap.mjs',
    source: 'OpenTrafficCamMap',
    files: filesMeta,
    counts,
    droppedByReason,
    count: allAlive.length,
    sources: allAlive,
  };
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  await writeFile(opts.outPath, `${JSON.stringify(payload)}\n`, 'utf8');
  console.log(`[otcm] wrote ${allAlive.length} cameras to ${opts.outPath}`);
}

// Only run as a script; importing this module (for its mapping helpers)
// must not start a download + verification run.
import { pathToFileURL } from 'node:url';
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
