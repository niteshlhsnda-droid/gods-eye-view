/**
 * Community-mapped OpenStreetMap ALPR locations, via hourly US/Canada detail
 * tiles. OSM data remains ODbL, separate from the application code. These are
 * mapped locations, not footage, plate records or evidence of current activity.
 */

import { isStaticHosting } from '../../sources/staticHosting.js';

export const LAYER_ID = 'alpr-cameras';

export const OVERPASS_URL = '/api/overpass';

/**
 * Direct public Overpass API endpoint. Used on static hosting, where the
 * same-origin /api/overpass proxy does not exist. The POST uses
 * application/x-www-form-urlencoded (a CORS-safelisted content type), so no
 * preflight is needed.
 */
export const OVERPASS_DIRECT_URL = 'https://overpass-api.de/api/interpreter';

/** Mirror fallback when the main instance sheds load (verified CORS-open). */
export const OVERPASS_MIRROR_URL =
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

/**
 * OSM wiki fair-use rule: pause this long before retrying after an
 * HTTP 429 or 406 from the Overpass API.
 */
export const OVERPASS_RETRY_PAUSE_MS = 30_000;

/**
 * Resolve the Overpass endpoint for this page: the keyless direct endpoint
 * on static hosting, the same-origin proxy on the desktop server.
 * Read at request time — the static-hosting probe may resolve after module
 * load.
 */
export function resolveOverpassUrl() {
  return isStaticHosting() ? OVERPASS_DIRECT_URL : OVERPASS_URL;
}

export const REQUEST_DEBOUNCE_MS = 300;

/** Keep camera acquisition city-scale, never globe-wide. */
export const MAX_VIEWPORT_DEGREES = 3;

/** Camera record cap; reaching it reports limited coverage. */
export const QUERY_LIMIT = 1500;

/**
 * The extract carries full camera attributes from z9 (z0-8 are geometry-only
 * heat tiles). Each view uses the finest zoom from z12 down to z9 that fits
 * DETAIL_MAX_TILES, so a whole city loads from a few z9/z10 tiles and a
 * neighbourhood from z12 (about 2 m position precision).
 */
export const DETAIL_MIN_ZOOM = 9;
export const DETAIL_MAX_ZOOM = 12;
export const DETAIL_MAX_TILES = 16;

/** Decoded records kept per accepted tile coverage (memory bound, not a render cap). */
export const SOURCE_RECORD_LIMIT = 6000;

/** Best-precision coordinates remembered per camera across zoom changes. */
export const PRECISION_CACHE_LIMIT = 20000;

/** Render cap. Kept at or above QUERY_LIMIT on purpose: if it ever sat below
 * it, cameras between the two would be silently dropped while `saturated`
 * stayed false and `count` still reported them — a lie about coverage. */
export const MAX_RENDERED = 1500;

/** Meters — illustrative facing wedge depth, when a camera reports a bearing. */
export const DIRECTION_CONE_M = 90;
export const DIRECTION_CONE_HALF_ANGLE_DEG = 20;

export const EARTH_MEAN_RADIUS_M = 6371008.8;

/** Query boxes are snapped outward to this grid so nearby camera moves reuse
 * one accepted viewport snapshot rather than rebuilding records on every pan. */
export const QUERY_SNAP_DEGREES = 0.05;

/** A view still fully inside the last snapped query box reuses those records
 * for this long before selecting tiles again. */
export const QUERY_REUSE_MS = 10 * 60 * 1000;

/** Vendor-neutral camera badge palette, with coral selection. */
export const ALPR_COLOR = '#52d4ff';
export const ALPR_SELECTED_COLOR = '#ff6474';
export const MARKER_ICON_SIZE = 38;
/** Badge scale by camera distance (near m, scale, far m, scale), shared by
 * native badges and overlay glyphs so both shrink alike in city-wide views. */
export const MARKER_SCALE_BY_DISTANCE = Object.freeze([
  500, 1.15, 40_000, 0.45,
]);
export const SELECTED_MARKER_ICON_SIZE = 60;
export const MAX_CANVAS_FRUSTUMS = 64;

/** Metres a floor-placed marker sits above its resolved ground cell. */
export const MARKER_FLOOR_LIFT_M = 1.5;

/** Rendered-surface samples one overlay paint may take (each is a depth render). */
export const ANCHOR_SAMPLES_PER_PAINT = 4;

/** Accepted rendered-surface window around a floor cell (a cut or an embankment
 * sits within it; a rooftop or an unstreamed tile usually does not). */
export const SURFACE_BELOW_FLOOR_M = 30;
/** Rendered-surface refinements per paint while the camera is still. */
export const SURFACE_SAMPLES_PER_PAINT = 2;
export const SURFACE_ABOVE_FLOOR_M = 40;

/** OSM attribution may collapse after five seconds; full credit stays in Data attribution. */
export const CREDIT_DISPLAY_MS = 5000;
