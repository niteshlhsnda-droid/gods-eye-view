/**
 * Base-map imagery vintage disclosure.
 *
 * The base map is the one surface every view shares, and the only one with
 * no observation time anywhere: the tile responses this app consumes carry
 * no per-tile capture date (see docs/basemap-imagery-vintage.md). The base
 * map therefore gets no freshness label — a freshness label would be a lie,
 * because there is no observation time to report — and instead carries this
 * standing VINTAGE UNKNOWN disclosure. Single source of truth for the
 * wording: `src/data/dataCredits.js` registers it in the Data attribution
 * popover, and DATA_SOURCES.md states it on the Google and Esri rows.
 */

/** Shared body of the vintage disclosure, after the subject. */
const VINTAGE_BODY =
  'capture date not provided — age varies by area and may be years old. ' +
  'Do not read buildings, roads, or landscape as current.';

/** Canonical base-map vintage disclosure. */
export const BASEMAP_VINTAGE_DISCLOSURE = `Base map imagery: ${VINTAGE_BODY}`;

/**
 * Provider-named variant of the vintage disclosure.
 * @param {string} [provider] — e.g. 'Google Photorealistic 3D Tiles' or
 * 'Esri World Imagery'. A trailing 'Imagery' is not doubled.
 * @returns {string} The disclosure naming `provider`, or the canonical
 * generic disclosure when no provider is given.
 */
export function basemapVintageNote(provider) {
  const name = String(provider ?? '')
    .trim()
    .replace(/\s+imagery$/i, '');
  if (!name) return BASEMAP_VINTAGE_DISCLOSURE;
  return `${name} imagery: ${VINTAGE_BODY}`;
}
