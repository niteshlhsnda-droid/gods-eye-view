import { COLORS as SHARED_COLORS, PROVIDER_COLORS } from '../../policy.js';

export { NEAREST_RADIUS_M } from '../../policy.js';

/** Identity and tuning for the Mapillary street-level provider. */
export const MAPILLARY_PROVIDER_ID = 'mapillary';
export const MAPILLARY_NAME = 'Mapillary';
export const MAPILLARY_LABEL = 'MAPILLARY';
export const MAPILLARY_KEY_ID = 'mapillary';
export const MAPILLARY_GRAPH_HOST = 'https://graph.mapillary.com';

/** Methods a source (./source.js or a stand-in) must have for the provider. */
export const MAPILLARY_SOURCE_METHODS = Object.freeze([
  'getStatus',
  'getTile',
  'getSequenceImages',
  'nearestImages',
]);

/** Stable id prefixes for picked primitives; every one starts with `mly:`. */
export const PICK_PREFIX = Object.freeze({
  root: 'mly:',
  sequence: 'mly:seq:',
  image: 'mly:img:',
});

/** Mapillary green for lines, points and cones; GEV cyan for selection. */
export const COLORS = Object.freeze({
  coverage: PROVIDER_COLORS.mapillary,
  selected: SHARED_COLORS.selected,
});

/** Camera-driven coverage refresh. */
export const COVERAGE_MOVE_DEBOUNCE_MS = 320;
export const COVERAGE_MAX_TILES = 9;
/** Overview (z0–5) coverage points seen from orbit. */
export const COVERAGE_OVERVIEW_MAX_TILES = 16;
/** Shown when Mapillary refuses the server's token (401/403). */
export const KEY_REJECTED_MESSAGE =
  'Mapillary rejected MAPILLARY_CLIENT_TOKEN — replace it in Provider Settings';
/** Shown while Mapillary rate-limits tile requests (429). */
export const RATE_LIMITED_MESSAGE =
  'Coverage requests are being rate-limited — they resume on their own';
/**
 * Street-zoom coverage reaches this far from the camera: camera height times
 * the factor, never below the floor, even when a tilted view sees further.
 */
export const SEQUENCE_VIEW_RANGE_MIN_M = 2_500;
export const SEQUENCE_VIEW_RANGE_PER_HEIGHT = 10;
/** Ground always covered around the camera at street zooms, in metres. */
export const SEQUENCE_VIEW_NEAR_M = 1_000;
export const COVERAGE_OVERVIEW_POINT_PX = 2.5;
export const COVERAGE_MAX_SEQUENCES = 6000;
export const COVERAGE_LINE_WIDTH_PX = 2.5;

/** Per-sequence image cones after a sequence is selected. */
export const SEQUENCE_IMAGES_LIMIT = 2000;
export const IMAGE_CONE_SIZE_PX = 26;
export const IMAGE_CONE_MIN_SPACING_M = 3;

/** Images asked for in a nearest-image search (radius: NEAREST_RADIUS_M). */
export const NEAREST_LIMIT = 8;

/**
 * How much farther a 360° pano may be than the nearest flat photo and
 * still win the nearest-image pick: twice its distance. A pano lets the
 * viewer look around the whole junction instead of one fixed direction,
 * so a pano a few steps away beats the flat shot at the kerb — but a pano
 * halfway down the street does not beat the flat shot of the doorway
 * asked about. The imagery filter still decides first: with a flat-only
 * filter no pano is ever a candidate.
 */
export const NEAREST_PANO_REACH = 2;

/**
 * The nearest-image pick with a pano preference: the nearest entry wins,
 * unless it is flat and a pano lies within `NEAREST_PANO_REACH` times its
 * distance — then the nearest such pano wins. Entries without a finite
 * distance are ignored (the caller keeps them as last-resort API-order
 * hits); an empty set picks nothing.
 * @param {Array<{isPano: boolean, metres: number}>} entries
 */
export function preferPano(entries) {
  const placed = entries.filter(({ metres }) => Number.isFinite(metres));
  if (!placed.length) return undefined;
  const byDistance = [...placed].sort((a, b) => a.metres - b.metres);
  const nearest = byDistance[0];
  if (nearest.isPano) return nearest;
  return (
    byDistance.find(
      (entry) =>
        entry.isPano && entry.metres <= nearest.metres * NEAREST_PANO_REACH,
    ) || nearest
  );
}

/** On-globe credit: Mapillary imagery is CC BY-SA 4.0 and needs attribution. */
export const MAPILLARY_CREDIT_HTML =
  'Street Level: imagery © <a href="https://www.mapillary.com" target="_blank" rel="noopener">Mapillary</a> contributors, CC BY-SA 4.0';

/** Deep link to an image on mapillary.com, as the web app shares them. */
export function mapillaryImageUrl(imageId) {
  const id = String(imageId || '').trim();
  if (!id) return 'https://www.mapillary.com/app/';
  return `https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}&focus=photo`;
}

/** Fields requested from the graph API. */
export const IMAGE_FIELDS =
  'id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,computed_altitude,is_pano,sequence,thumb_256_url,creator,quality_score';
export const SEQUENCE_IMAGE_FIELDS =
  'id,captured_at,compass_angle,geometry,is_pano,computed_altitude';
