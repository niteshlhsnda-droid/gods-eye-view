/**
 * Build the static CCTV camera snapshot for static hosting.
 *
 * The dev proxy (server/providers/cctv.js, a Vite plugin) serves
 * /api/cctv/sources from live open-data packs — but GitHub Pages serves no
 * /api routes, so the live demo's camera layer silently falls back to
 * pose-only seeds and no feed ever loads. This script runs the SAME server
 * catalog loaders at build time and writes the merged catalog to
 * public/data/cctv-sources.json, which the client (src/layers/cctv/source.js)
 * falls back to when the proxy answers 404. Vite copies public/ verbatim, so
 * the snapshot ships at <base>/data/cctv-sources.json.
 *
 * Usage (from the repo root):
 *   node scripts/build-cctv-snapshot.mjs [--out <path>]
 *
 * The snapshot goes stale: upstream URLs rot and packs change shape. Regenerate
 * it as part of the deploy pipeline (or by hand before a release); the script
 * refuses to overwrite a good snapshot with an empty one, and exits non-zero
 * when every pack fails. Per-pack counts print to stdout for the run log.
 * Ground heights are dropped: the client re-samples them at runtime, and they
 * would roughly double the file.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCctvCatalog } from '../server/providers/cctv/catalog.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_OUT = path.join(ROOT, 'public', 'data', 'cctv-sources.json');

/** Fields the client catalog builder reads, plus the direct feed URLs. */
const SNAPSHOT_FIELDS = [
  'id',
  'name',
  'city',
  'cityId',
  'provider',
  'lat',
  'lon',
  'headingDeg',
  'headingConfidence',
  'pitchDeg',
  'fovDeg',
  'rangeM',
  'mountHeightM',
  'groundElevationM',
  'feedType',
  'url',
  'snapshotUrl',
  'license',
  'credit',
  'code',
  'sourceKind',
  'poseSource',
];

function trimSource(item) {
  const out = {};
  for (const key of SNAPSHOT_FIELDS) {
    if (item[key] !== undefined) out[key] = item[key];
  }
  return out;
}

function parseArgs(argv) {
  const out = { outPath: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out.outPath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

async function main() {
  const { outPath } = parseArgs(process.argv.slice(2));
  const getCctvSources = createCctvCatalog({ sourceRoot: ROOT });
  const sources = await getCctvSources();
  if (!Array.isArray(sources) || sources.length === 0) {
    console.error(
      '[cctv-snapshot] refusing to write an empty snapshot: all packs failed',
    );
    process.exitCode = 1;
    return;
  }
  const trimmed = sources
    .filter((item) => item && typeof item.id === 'string' && item.id)
    .map(trimSource);
  // Never replace a good snapshot with a catastrophically smaller one: a
  // run where most upstream packs time out (saturated network, proxy
  // outage) must not silently delete thousands of working cameras. Empty
  // is refused above; under half the previous count is refused here.
  try {
    const previous = JSON.parse(await readFile(outPath, 'utf8'));
    const previousCount = Array.isArray(previous?.sources)
      ? previous.sources.length
      : 0;
    if (previousCount > 0 && trimmed.length < previousCount / 2) {
      console.error(
        `[cctv-snapshot] refusing to shrink ${previousCount} -> ${trimmed.length}: ` +
          'most packs failed this run; keeping the previous snapshot',
      );
      process.exitCode = 1;
      return;
    }
  } catch {
    // No previous snapshot (first build) or an unreadable one: proceed.
  }
  const byPack = new Map();
  for (const item of sources) {
    if (!item || typeof item !== 'object') continue;
    const pack = item.pack || 'unknown';
    byPack.set(pack, (byPack.get(pack) || 0) + 1);
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-cctv-snapshot.mjs',
    count: trimmed.length,
    packs: Object.fromEntries(byPack),
    sources: trimmed,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload)}\n`, 'utf8');
  console.log(
    `[cctv-snapshot] wrote ${trimmed.length} cameras to ${outPath}`,
  );
  for (const [pack, count] of [...byPack.entries()].sort()) {
    console.log(`[cctv-snapshot]   ${pack}: ${count}`);
  }
}

await main();
