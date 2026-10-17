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
 * A nearest-image candidate below this predicted visual quality is passed
 * over for a decent one nearby: Mapillary's `quality_score` runs [0, 1]
 * (nullable), the mean of a sequence's per-image scores on coverage tiles,
 * so below 0.25 is the bottom quartile — visibly poor (blurry, dark,
 * occluded) rather than a fine judgement. Unscored images stay eligible:
 * a missing score is not a bad photo.
 */
export const NEAREST_LOW_QUALITY_SCORE = 0.25;
/**
 * How much farther the decent replacement for a low-quality nearest image
 * may be: twice its distance. Quality never sends the viewer across the
 * radius for a marginally sharper photo, and a low-quality nearest image
 * still wins when every decent one is far away.
 */
export const NEAREST_QUALITY_REACH = 2;

/**
 * Whether a Mapillary `quality_score` is low enough to pass over: a finite
 * number below the floor. Missing, null, empty and non-numeric scores are
 * not low — unscored imagery is never penalised for lacking a score.
 * @param {number|string|null|undefined} score
 */
export function isLowQuality(score) {
  if (score == null || score === '') return false;
  const value = Number(score);
  return Number.isFinite(value) && value < NEAREST_LOW_QUALITY_SCORE;
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
