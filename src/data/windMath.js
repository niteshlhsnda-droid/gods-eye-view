/**
 * Shared wind math: meteorological direction <-> vector components,
 * WMO Beaufort scale classification, 16-point compass labels, and
 * wind-speed unit conversions.
 *
 * Direction convention (meteorological, used by every weather feed the
 * app consumes): degrees clockwise from north, naming the direction the
 * wind comes FROM. `0` / `360` = from the north, `90` = from the east,
 * `180` = from the south, `270` = from the west. This is the opposite
 * of a "heading toward" angle, which is the usual source of sign bugs
 * when converting to vector components.
 *
 * Component convention: `u` is the eastward component, `v` is the
 * northward component, in the same speed units as the input. A wind
 * FROM the north (`directionDegrees = 0`) blows toward the south, so
 * it has `v = -speed`:
 *
 *   u = -speed * sin(direction)
 *   v = -speed * cos(direction)
 *
 * Canonical semantics:
 * - Directions are normalized to `[0, 360)` on the way in; `360` and
 *   `-90` behave exactly like `0` and `270`.
 * - Negative speeds are invalid: `windComponents` and `beaufort` return
 *   `NaN` (components) / `NaN` (force) for them. A negative speed is a
 *   caller bug, not a direction flip.
 * - Non-finite inputs propagate as `NaN` (numeric returns),
 *   `{ u: NaN, v: NaN }` / `{ speed: NaN, directionDegrees: NaN }`
 *   (object returns), or `null` (label returns). This module never
 *   silently invents a value or drops a sample.
 * - Beaufort thresholds are the WMO table in m/s (lower bounds):
 *   force 1 starts at 0.3, 2 at 1.6, 3 at 3.4, 4 at 5.5, 5 at 8.0,
 *   6 at 10.8, 7 at 13.9, 8 at 17.2, 9 at 20.8, 10 at 24.5,
 *   11 at 28.5, 12 at 32.7. Anything below 0.3 m/s is force 0 (Calm).
 *   `beaufort` takes m/s; convert first with `knotsToMps` / `mphToMps` /
 *   `kmhToMps` when the source feed reports other units.
 * - `compassPoint` uses the 16-wind compass with half-step boundaries:
 *   `N` covers `[348.75, 11.25)`, `NNE` covers `[11.25, 33.75)`, and so
 *   on clockwise. Exactly-on-boundary values round up to the next point
 *   (e.g. `11.25` is `NNE`).
 *
 * Pure: no DOM, no imports. All inputs/outputs are plain numbers,
 * strings, or plain objects.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in this
 * commit — migration is a separate, per-group change, like the prior
 * idea-cycle modules.
 *
 * @module data/windMath
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Exact: 1 knot = 1852 m / 3600 s. */
const KNOT_TO_MPS = 1852 / 3600;
/** Exact (international mile): 1 mph = 1609.344 m / 3600 s. */
const MPH_TO_MPS = 1609.344 / 3600;
/** Exact: 1 km/h = 1000 m / 3600 s. */
const KMH_TO_MPS = 1000 / 3600;

/**
 * WMO Beaufort scale lower bounds in m/s. Index `i` holds the minimum
 * speed for force `i + 1`; below the first bound the force is 0.
 */
const BEAUFORT_LOWER_BOUNDS_MPS = [
  0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7,
];

/** WMO Beaufort scale descriptions, indexed by force number 0-12. */
const BEAUFORT_LABELS = [
  'Calm',
  'Light air',
  'Light breeze',
  'Gentle breeze',
  'Moderate breeze',
  'Fresh breeze',
  'Strong breeze',
  'Near gale',
  'Gale',
  'Strong gale',
  'Storm',
  'Violent storm',
  'Hurricane force',
];

/** 16-wind compass points, clockwise from north. */
const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/**
 * Normalize a direction in degrees to `[0, 360)`.
 * @param {number} degrees
 * @returns {number} Normalized direction, or `NaN` for non-finite input.
 */
function normalizeDirection(degrees) {
  if (!Number.isFinite(degrees)) {
    return NaN;
  }
  return ((degrees % 360) + 360) % 360;
}

/**
 * Wind vector components for a meteorological wind direction.
 *
 * @param {number} speed Speed in any unit; returned components use the
 *   same unit.
 * @param {number} directionDegrees Meteorological direction (wind comes
 *   FROM this bearing), degrees clockwise from north.
 * @returns {{ u: number, v: number }} Eastward (`u`) and northward (`v`)
 *   components. Both are `NaN` for non-finite inputs or a negative speed.
 */
function windComponents(speed, directionDegrees) {
  if (!Number.isFinite(speed) || !Number.isFinite(directionDegrees)) {
    return { u: NaN, v: NaN };
  }
  if (speed < 0) {
    return { u: NaN, v: NaN };
  }
  const radians = normalizeDirection(directionDegrees) * DEG_TO_RAD;
  return {
    u: -speed * Math.sin(radians),
    v: -speed * Math.cos(radians),
  };
}

/**
 * Speed and meteorological direction from wind vector components.
 *
 * @param {number} u Eastward component.
 * @param {number} v Northward component.
 * @returns {{ speed: number, directionDegrees: number }} Speed in the
 *   components' unit and the direction the wind comes FROM, in
 *   `[0, 360)`. Both are `NaN` for non-finite inputs. A zero vector
 *   yields speed `0` and direction `0` (calm has no meaningful
 *   direction; callers should check `speed === 0` first).
 */
function windFromComponents(u, v) {
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    return { speed: NaN, directionDegrees: NaN };
  }
  const speed = Math.hypot(u, v);
  if (speed === 0) {
    return { speed: 0, directionDegrees: 0 };
  }
  const directionDegrees = normalizeDirection(Math.atan2(-u, -v) * RAD_TO_DEG);
  return { speed, directionDegrees };
}

/**
 * WMO Beaufort force number (0-12) for a wind speed in m/s.
 *
 * @param {number} speedMps Wind speed in metres per second.
 * @returns {number} Beaufort force, or `NaN` for non-finite or negative input.
 */
function beaufort(speedMps) {
  if (!Number.isFinite(speedMps) || speedMps < 0) {
    return NaN;
  }
  let force = 0;
  for (let i = 0; i < BEAUFORT_LOWER_BOUNDS_MPS.length; i += 1) {
    if (speedMps >= BEAUFORT_LOWER_BOUNDS_MPS[i]) {
      force = i + 1;
    } else {
      break;
    }
  }
  return force;
}

/**
 * WMO Beaufort description for a Beaufort force number.
 *
 * @param {number} force Beaufort force, integer 0-12.
 * @returns {string|null} Description, or `null` for non-integer,
 *   out-of-range, or non-finite input.
 */
function beaufortLabel(force) {
  if (!Number.isInteger(force) || force < 0 || force > 12) {
    return null;
  }
  return BEAUFORT_LABELS[force];
}

/**
 * Beaufort force and label for a wind speed in m/s, in one call.
 *
 * @param {number} speedMps Wind speed in metres per second.
 * @returns {{ force: number, label: string|null }} Force is `NaN` and
 *   label is `null` for non-finite or negative input.
 */
function beaufortSummary(speedMps) {
  const force = beaufort(speedMps);
  return { force, label: Number.isNaN(force) ? null : beaufortLabel(force) };
}

/**
 * 16-wind compass point for a meteorological direction.
 *
 * @param {number} directionDegrees Direction in degrees clockwise from north.
 * @returns {string|null} Compass point (e.g. `'NNE'`), or `null` for
 *   non-finite input.
 */
function compassPoint(directionDegrees) {
  if (!Number.isFinite(directionDegrees)) {
    return null;
  }
  const normalized = normalizeDirection(directionDegrees);
  const index = Math.round(normalized / 22.5) % 16;
  return COMPASS_POINTS[index];
}

/**
 * Convert metres per second to knots.
 * @param {number} speedMps
 * @returns {number} Knots, or `NaN` for non-finite input.
 */
function mpsToKnots(speedMps) {
  return Number.isFinite(speedMps) ? speedMps / KNOT_TO_MPS : NaN;
}

/**
 * Convert knots to metres per second.
 * @param {number} knots
 * @returns {number} Metres per second, or `NaN` for non-finite input.
 */
function knotsToMps(knots) {
  return Number.isFinite(knots) ? knots * KNOT_TO_MPS : NaN;
}

/**
 * Convert metres per second to kilometres per hour.
 * @param {number} speedMps
 * @returns {number} Kilometres per hour, or `NaN` for non-finite input.
 */
function mpsToKmh(speedMps) {
  return Number.isFinite(speedMps) ? speedMps / KMH_TO_MPS : NaN;
}

/**
 * Convert kilometres per hour to metres per second.
 * @param {number} kmh
 * @returns {number} Metres per second, or `NaN` for non-finite input.
 */
function kmhToMps(kmh) {
  return Number.isFinite(kmh) ? kmh * KMH_TO_MPS : NaN;
}

/**
 * Convert metres per second to miles per hour.
 * @param {number} speedMps
 * @returns {number} Miles per hour, or `NaN` for non-finite input.
 */
function mpsToMph(speedMps) {
  return Number.isFinite(speedMps) ? speedMps / MPH_TO_MPS : NaN;
}

/**
 * Convert miles per hour to metres per second.
 * @param {number} mph
 * @returns {number} Metres per second, or `NaN` for non-finite input.
 */
function mphToMps(mph) {
  return Number.isFinite(mph) ? mph * MPH_TO_MPS : NaN;
}

export {
  beaufort,
  beaufortLabel,
  beaufortSummary,
  compassPoint,
  kmhToMps,
  knotsToMps,
  mphToMps,
  mpsToKmh,
  mpsToKnots,
  mpsToMph,
  windComponents,
  windFromComponents,
};
