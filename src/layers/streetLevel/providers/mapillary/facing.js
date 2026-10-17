import { metresBetween } from '../../view.js';

/**
 * A flat shot counts as facing the requested heading when its camera looks
 * within this many degrees of it — wide enough for a street's two sides,
 * narrow enough that a shot looking back down the road does not qualify.
 */
export const FACING_TOLERANCE_DEG = 60;

/**
 * A facing shot may be this much farther away than the nearest candidate and
 * still win the pick. Beyond it, proximity wins: a shot facing the right way
 * 40 m down the road is worse than the shot at your feet facing away.
 */
export const FACING_MAX_EXTRA_M = 15;

/** Smallest angle between two headings, 0–180. */
export function angularDifference(a, b) {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * A heading normalised to [0, 360), or null when the value is not a usable
 * heading. 0 is north and counts — it is a heading, not a missing value.
 */
export function normalizeHeading(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const heading = Number(value);
  if (!Number.isFinite(heading)) return null;
  return ((heading % 360) + 360) % 360;
}

/**
 * Where a record's camera looked: the computed compass first (Mapillary's
 * refined estimate), then the device compass. Null when neither is usable.
 * A pano sees every direction, so callers treat it as facing any heading.
 */
export function headingOf(record) {
  const computed = normalizeHeading(record?.computed_compass_angle);
  if (computed !== null) return computed;
  return normalizeHeading(record?.compass_angle);
}

/** True when the record looks within tolerance of `heading` — panos always do. */
export function facesHeading(record, heading) {
  if (record?.is_pano === true) return true;
  const target = normalizeHeading(heading);
  const camera = headingOf(record);
  if (target === null || camera === null) return false;
  return angularDifference(camera, target) <= FACING_TOLERANCE_DEG;
}

/** Distance from `point` to a record's position; Infinity without one. */
function distanceTo(record, point) {
  const [lon, lat] = (record?.computed_geometry || record?.geometry)
    ?.coordinates || [NaN, NaN];
  const metres = metresBetween(point, { lon, lat });
  return Number.isFinite(metres) ? metres : Infinity;
}

/**
 * Best record near `point` for a viewer looking along `heading` (degrees
 * clockwise from north). Without a heading the nearest record wins — the
 * long-standing behaviour. With one, the nearest facing record wins when it
 * is at most FACING_MAX_EXTRA_M farther than the nearest record; otherwise
 * the nearest record wins. Records without a usable position sort last.
 * Returns the record, or null for an empty list.
 */
export function pickFacingImage(records, { lat, lon, heading = null } = {}) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const point = { lat, lon };
  const ranked = records
    .map((record) => ({ record, metres: distanceTo(record, point) }))
    .sort((a, b) => a.metres - b.metres);
  const nearest = ranked[0];
  const target = normalizeHeading(heading);
  if (target === null) return nearest.record;
  const facing = ranked.find(({ record }) => facesHeading(record, target));
  if (facing && facing.metres - nearest.metres <= FACING_MAX_EXTRA_M)
    return facing.record;
  return nearest.record;
}
