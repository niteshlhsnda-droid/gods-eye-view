/**
 * View-cone geometry for street-level photos: the ground footprint a shot's
 * camera sees, from its position, compass heading and field of view.
 * Standalone and pure — no provider wiring, no Cesium, no DOM — so any
 * consumer (discovery ranking, coverage maps, spatial queries) can ask
 * "which photos can see this target?" instead of "which photo is nearest?".
 *
 * A flat shot's footprint is a circular sector on the ground: the apex at
 * the camera, centred on the compass heading, half-width fov/2, radius the
 * effective range. A 360° shot sees every direction, so its footprint is a
 * full disc. Street-scale only (metres): distances use the same
 * equirectangular approximation as `metresBetween` in view.js.
 */

import { normalizeHeading } from './providers/mapillary/facing.js';
import { wrapLon } from './tileMath.js';
import { metresBetween } from './view.js';

/** IUGG mean earth radius, for the horizon-distance cap. */
const EARTH_RADIUS_M = 6_371_000;

/**
 * Default visible range: how far a street photo usefully sees. Kept
 * deliberately short — facades and signs stay legible, and a footprint this
 * size stays meaningful in a dense city grid.
 */
export const VIEW_CONE_DEFAULT_RANGE_M = 60;
/** Default camera height: a dashcam/windshield mount above the road. */
export const VIEW_CONE_DEFAULT_HEIGHT_M = 1.6;
/**
 * Points sampling the cone's far arc; fixed so footprints are deterministic.
 * Odd, so a vertex always lands exactly on the heading's centre line.
 */
export const VIEW_CONE_ARC_SEGMENTS = 25;
/** Boundary slack: points this close to an edge count as inside. */
const VIEW_CONE_EDGE_SLACK_M = 0.001;

/**
 * @typedef {object} ViewCone  A photo's visible ground footprint.
 * @property {{lon: number, lat: number}} apex   Camera position.
 * @property {number} heading                    Normalised to [0, 360).
 * @property {number} fovDeg                     Horizontal field of view, (0, 360].
 * @property {number} radiusM                    Effective range, horizon-capped.
 * @property {boolean} isPano                   True for a 360° disc footprint.
 * @property {Array<{lon: number, lat: number}>} vertices
 *   Apex first, then the far arc in bearing order (a full ring for a pano).
 */

/** Horizon distance (m) from `heightM` above a smooth earth. */
function horizonDistanceM(heightM) {
  return Math.sqrt(2 * EARTH_RADIUS_M * heightM);
}

/** Point `metres` from `point` along `bearingDeg` (clockwise from north). */
function offsetPoint(point, bearingDeg, metres) {
  const bearing = (bearingDeg * Math.PI) / 180;
  const latRad = (point.lat * Math.PI) / 180;
  // Guard the poles: no longitude change where meridians meet.
  const cosLat = Math.cos(latRad);
  return {
    lon:
      Math.abs(cosLat) < 1e-9
        ? point.lon
        : wrapLon(
            point.lon + (metres * Math.sin(bearing)) / (111_320 * cosLat),
          ),
    lat: point.lat + (metres * Math.cos(bearing)) / 110_540,
  };
}

/**
 * A photo's visible ground footprint. `heading` is degrees clockwise from
 * north (0 is north, and counts); `fovDeg` the horizontal field of view —
 * pass `isPano: true` (or fovDeg >= 360) for a 360° shot. `rangeM` caps how
 * far the camera usefully sees; `heightM` additionally caps the radius at
 * the geometric horizon from that height. Returns null for an unusable
 * position, heading, field of view or range.
 *
 * @param {object} shot
 * @param {number} shot.lat
 * @param {number} shot.lon
 * @param {number} [shot.heading]
 * @param {number} [shot.fovDeg]
 * @param {boolean} [shot.isPano]
 * @param {number} [shot.rangeM]
 * @param {number} [shot.heightM]
 * @returns {ViewCone|null}
 */
export function viewCone({
  lat,
  lon,
  heading,
  fovDeg = null,
  isPano = false,
  rangeM = VIEW_CONE_DEFAULT_RANGE_M,
  heightM = VIEW_CONE_DEFAULT_HEIGHT_M,
} = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  const compass = normalizeHeading(heading);
  if (compass === null) return null;
  if (!Number.isFinite(rangeM) || rangeM <= 0) return null;
  if (heightM !== null && heightM !== undefined) {
    if (!Number.isFinite(heightM) || heightM <= 0) return null;
  }
  const pano = isPano === true || (Number.isFinite(fovDeg) && fovDeg >= 360);
  let fovDegOut;
  if (pano) {
    fovDegOut = 360;
  } else {
    if (!Number.isFinite(fovDeg) || fovDeg <= 0) return null;
    fovDegOut = Math.min(fovDeg, 360);
  }
  const apex = { lon: wrapLon(lon), lat };
  let radiusM = rangeM;
  if (Number.isFinite(heightM) && heightM > 0)
    radiusM = Math.min(radiusM, horizonDistanceM(heightM));
  if (!(radiusM > 0)) return null;

  const sweepDeg = fovDegOut;
  const start = pano ? 0 : compass - sweepDeg / 2;
  const vertices = [apex];
  for (let i = 0; i < VIEW_CONE_ARC_SEGMENTS; i++) {
    const bearing = start + (sweepDeg * i) / (VIEW_CONE_ARC_SEGMENTS - 1);
    vertices.push(offsetPoint(apex, bearing, radiusM));
  }
  return {
    apex,
    heading: compass,
    fovDeg: fovDegOut,
    radiusM,
    isPano: pano,
    vertices,
  };
}

/**
 * The cone's bounding box as {west, south, east, north}; like tile bounds,
 * west > east signals a date-line crossing. A cheap prefilter before the
 * exact `pointInViewCone` check.
 * @param {ViewCone} cone
 * @returns {{west:number,south:number,east:number,north:number}|null}
 */
export function coneBbox(cone) {
  const vertices = cone?.vertices;
  if (!Array.isArray(vertices) || vertices.length === 0) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const { lon, lat } of vertices) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  // The short way round the date line: west > east marks the crossing.
  if (east - west > 180) return { west: east, east: west, south, north };
  return { west, south, east, north };
}

/** True when `point` sits on (or within slack of) segment a → b. */
function onSegment(point, a, b, slackM) {
  // Anchored at a so the segment takes the short way round the date line.
  const dx = wrapLon(b.lon - a.lon);
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return false;
  const px = wrapLon(point.lon - a.lon);
  const py = point.lat - a.lat;
  const cross = Math.abs(dx * py - dy * px) / Math.sqrt(len2);
  if (!Number.isFinite(cross)) return false;
  // Convert degrees to metres at the segment's latitude.
  const metres =
    cross * 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  if (metres > slackM) return false;
  const dot = px * dx + py * dy;
  if (dot < 0) return false;
  return dot <= len2;
}

/**
 * True when the ground point sits inside the photo's visible footprint —
 * the apex itself counts. A pano's disc is a plain radius check; a flat
 * shot's sector is an even-odd polygon test over apex + arc, with points
 * within a millimetre of an edge counted as inside.
 * @param {{lon:number,lat:number}} point
 * @param {ViewCone} cone
 */
export function pointInViewCone(point, cone) {
  if (!Number.isFinite(point?.lon) || !Number.isFinite(point?.lat))
    return false;
  const apex = cone?.apex;
  if (!Number.isFinite(apex?.lon) || !Number.isFinite(apex?.lat)) return false;
  if (!Number.isFinite(cone?.radiusM) || cone.radiusM < 0) return false;
  if (metresBetween(point, apex) <= VIEW_CONE_EDGE_SLACK_M) return true;
  if (cone.isPano)
    return metresBetween(point, apex) <= cone.radiusM + VIEW_CONE_EDGE_SLACK_M;
  const vertices = cone.vertices;
  if (!Array.isArray(vertices) || vertices.length < 3) return false;
  // On an edge (or the closing arc) counts as inside.
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (onSegment(point, a, b, VIEW_CONE_EDGE_SLACK_M)) return true;
  }
  // Even-odd ray cast, the short way round the date line.
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lon;
    const yi = vertices[i].lat;
    const yj = vertices[j].lat;
    // Work in a frame anchored at xi so longitudes stay continuous.
    const xjRel = wrapLon(vertices[j].lon - xi);
    const xRel = wrapLon(point.lon - xi);
    if (yi > point.lat !== yj > point.lat) {
      const xIntersect = (xjRel * (point.lat - yi)) / (yj - yi);
      if (xRel < xIntersect) inside = !inside;
    }
  }
  return inside;
}
