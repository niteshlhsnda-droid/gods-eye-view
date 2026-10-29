/**
 * Shape-only analysis of an OpenTrafficCamMap cameras file: counts entries
 * by mappability reason WITHOUT verifying any camera URL. Used to explain
 * a high unusable count in the importer run report.
 *
 * Usage: node scripts/analyze-opentraffic-shape.mjs <file-or-url>
 * (a local path is read directly; an http(s) URL is downloaded once).
 */
import { readFile } from 'node:fs/promises';
import { classifyUnusable, flattenOpentrafficFile } from './import-opentrafficcammap.mjs';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/analyze-opentraffic-shape.mjs <file-or-url>');
  process.exitCode = 2;
} else {
  const text = target.startsWith('http')
    ? await (await fetch(target)).text()
    : await readFile(target, 'utf8');
  const data = JSON.parse(text);
  const counts = {};
  const formatCounts = {};
  const samples = {};
  let total = 0;
  for (const [state, areas] of Object.entries(data)) {
    if (!areas || typeof areas !== 'object') continue;
    for (const [area, cameras] of Object.entries(areas)) {
      if (!Array.isArray(cameras)) continue;
      for (const entry of cameras) {
        total += 1;
        const reason = classifyUnusable(entry);
        counts[reason || 'mappable'] = (counts[reason || 'mappable'] || 0) + 1;
        const format = String(entry?.format || '(missing)');
        formatCounts[format] = (formatCounts[format] || 0) + 1;
        if (reason && !samples[reason]) {
          samples[reason] = { state, area, entry };
        }
      }
    }
  }
  console.log(JSON.stringify({ total, counts, formatCounts, samples }, null, 1));
  // Cross-check against the flatten path used by the importer.
  const flat = flattenOpentrafficFile(data);
  console.log(
    `flatten: ${flat.length} rows, ${flat.filter((e) => e.mapped).length} mappable`,
  );
}
