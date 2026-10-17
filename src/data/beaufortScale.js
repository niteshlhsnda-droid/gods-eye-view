/**
 * Beaufort wind scale: sustained wind speed -> force 0-12, WMO
 * classification, and observed sea / land effects.
 *
 * Why a new module: the wind layer (`src/layers/wind/`) renders particle
 * speeds but has no human-readable wind-strength vocabulary — a 19 m/s
 * flow means nothing to a reader, while "Force 5, Fresh breeze" does.
 * Cards, legends, and voice readouts can share this one table instead
 * of each hard-coding thresholds.
 *
 * Canonical bands are the knot ranges: the scale was defined on
 * observed effects and only later given velocity equivalents, and the
 * knot bands are the ones the WMO / NOAA tables agree on. All other
 * units convert to knots and classify on the knot bands, so a speed
 * always maps to the same force whatever unit it arrived in.
 *
 * Sources (both fetched and verified 2026-10-17):
 * - NOAA Storm Prediction Center, "Beaufort Wind Scale",
 *   https://www.spc.noaa.gov/faq/tornado/beaufort.html
 *   (force bands in knots, WMO classifications, sea + land effects).
 * - NOAA JetStream, "JetStream Max: Wind and Sea Scales",
 *   https://www.noaa.gov/jetstream/ocean/waves/jetstream-max-wind-and-sea-scales
 *   (mean speeds, mph / km/h ranges; confirms the 0-12 bands).
 *
 * Scope notes: this is the standard 0-12 scale. JetStream lists
 * extended forces 13-17 (1946 refinement for tropical cyclones), but
 * they carry no effect descriptions and are special-case only, so any
 * speed at or above 64 kt maps to Force 12 here. Force 12 "Hurricane"
 * names a wind strength, not a tropical cyclone — a 64 kt gradient
 * wind is Force 12 without any cyclone being present.
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/beaufortScale
 */

/** Exact metres per second in one international knot. */
export const METERS_PER_SECOND_PER_KNOT = 0.514444;

/** Knots in one mile per hour (0.44704 m/s per mph). */
export const KNOTS_PER_MILE_PER_HOUR = 0.44704 / METERS_PER_SECOND_PER_KNOT;

/** Knots in one kilometre per hour (1 kt = 1.852 km/h, exact). */
export const KNOTS_PER_KILOMETRE_PER_HOUR = 1 / 1.852;

/** First force that counts as gale strength (NWS gale warnings). */
export const GALE_FORCE = 8;

/**
 * The 13 Beaufort forces, in order. `knotsMax` / `mphMax` / `kmhMax`
 * are null for Force 12: the scale is open-ended above 64 kt.
 * `meanKnots` is NOAA JetStream's mean speed for the force. `sea` /
 * `land` are the NOAA SPC observed-effects texts.
 */
export const BEAUFORT_SCALE = Object.freeze([
  Object.freeze({
    force: 0,
    name: 'Calm',
    knotsMin: 0,
    knotsMax: 1,
    mphMin: 0,
    mphMax: 1,
    kmhMin: 0,
    kmhMax: 1,
    meanKnots: 0,
    sea: 'Sea surface smooth and mirror-like',
    land: 'Calm, smoke rises vertically',
  }),
  Object.freeze({
    force: 1,
    name: 'Light Air',
    knotsMin: 1,
    knotsMax: 4,
    mphMin: 1,
    mphMax: 4,
    kmhMin: 1,
    kmhMax: 6,
    meanKnots: 2,
    sea: 'Scaly ripples, no foam crests',
    land: 'Smoke drift indicates wind direction, still wind vanes',
  }),
  Object.freeze({
    force: 2,
    name: 'Light Breeze',
    knotsMin: 4,
    knotsMax: 7,
    mphMin: 4,
    mphMax: 8,
    kmhMin: 6,
    kmhMax: 12,
    meanKnots: 5,
    sea: 'Small wavelets, crests glassy, no breaking',
    land: 'Wind felt on face, leaves rustle, vanes begin to move',
  }),
  Object.freeze({
    force: 3,
    name: 'Gentle Breeze',
    knotsMin: 7,
    knotsMax: 11,
    mphMin: 8,
    mphMax: 13,
    kmhMin: 12,
    kmhMax: 20,
    meanKnots: 9,
    sea: 'Large wavelets, crests begin to break, scattered whitecaps',
    land: 'Leaves and small twigs constantly moving, light flags extended',
  }),
  Object.freeze({
    force: 4,
    name: 'Moderate Breeze',
    knotsMin: 11,
    knotsMax: 17,
    mphMin: 13,
    mphMax: 19,
    kmhMin: 20,
    kmhMax: 29,
    meanKnots: 13,
    sea: 'Small waves 1-4 ft. becoming longer, numerous whitecaps',
    land: 'Dust, leaves, and loose paper lifted, small tree branches move',
  }),
  Object.freeze({
    force: 5,
    name: 'Fresh Breeze',
    knotsMin: 17,
    knotsMax: 22,
    mphMin: 19,
    mphMax: 25,
    kmhMin: 29,
    kmhMax: 39,
    meanKnots: 19,
    sea: 'Moderate waves 4-8 ft taking longer form, many whitecaps, some spray',
    land: 'Small trees in leaf begin to sway',
  }),
  Object.freeze({
    force: 6,
    name: 'Strong Breeze',
    knotsMin: 22,
    knotsMax: 28,
    mphMin: 25,
    mphMax: 32,
    kmhMin: 39,
    kmhMax: 50,
    meanKnots: 24,
    sea: 'Larger waves 8-13 ft, whitecaps common, more spray',
    land: 'Larger tree branches moving, whistling in wires',
  }),
  Object.freeze({
    force: 7,
    name: 'Near Gale',
    knotsMin: 28,
    knotsMax: 34,
    mphMin: 32,
    mphMax: 39,
    kmhMin: 50,
    kmhMax: 62,
    meanKnots: 30,
    sea: 'Sea heaps up, waves 13-19 ft, white foam streaks off breakers',
    land: 'Whole trees moving, resistance felt walking against wind',
  }),
  Object.freeze({
    force: 8,
    name: 'Gale',
    knotsMin: 34,
    knotsMax: 41,
    mphMin: 39,
    mphMax: 47,
    kmhMin: 62,
    kmhMax: 75,
    meanKnots: 37,
    sea: 'Moderately high (18-25 ft) waves of greater length, edges of crests begin to break into spindrift, foam blown in streaks',
    land: 'Twigs breaking off trees, generally impedes progress',
  }),
  Object.freeze({
    force: 9,
    name: 'Strong Gale',
    knotsMin: 41,
    knotsMax: 48,
    mphMin: 47,
    mphMax: 55,
    kmhMin: 75,
    kmhMax: 89,
    meanKnots: 44,
    sea: 'High waves (23-32 ft), sea begins to roll, dense streaks of foam, spray may reduce visibility',
    land: 'Slight structural damage occurs, slate blows off roofs',
  }),
  Object.freeze({
    force: 10,
    name: 'Storm',
    knotsMin: 48,
    knotsMax: 56,
    mphMin: 55,
    mphMax: 64,
    kmhMin: 89,
    kmhMax: 103,
    meanKnots: 52,
    sea: 'Very high waves (29-41 ft) with overhanging crests, sea white with densely blown foam, heavy rolling, lowered visibility',
    land: 'Seldom experienced on land, trees broken or uprooted, "considerable structural damage"',
  }),
  Object.freeze({
    force: 11,
    name: 'Violent Storm',
    knotsMin: 56,
    knotsMax: 64,
    mphMin: 64,
    mphMax: 73,
    kmhMin: 103,
    kmhMax: 118,
    meanKnots: 60,
    sea: 'Exceptionally high (37-52 ft) waves, foam patches cover sea, visibility more reduced',
    land: 'Widespread damage, very rarely experienced on land',
  }),
  Object.freeze({
    force: 12,
    name: 'Hurricane',
    knotsMin: 64,
    knotsMax: null,
    mphMin: 73,
    mphMax: null,
    kmhMin: 118,
    kmhMax: null,
    meanKnots: 68,
    sea: 'Air filled with foam, waves over 45 ft, sea completely white with driving spray, visibility greatly reduced',
    land: 'Countryside is devastated',
  }),
]);

/**
 * Validate a wind speed: a finite number at or above zero.
 * @param {number} speed - the speed to validate.
 * @param {string} label - unit label for the error message.
 */
function checkSpeed(speed, label) {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) {
    throw new TypeError(`${label} speed must be a finite number`);
  }
  if (speed < 0) {
    throw new RangeError(`${label} speed cannot be negative`);
  }
}

/**
 * Beaufort entry for a sustained wind speed in knots.
 * Bands are half-open [min, max): a speed exactly on a boundary
 * takes the higher force (e.g. 4 kt is Force 2, not Force 1).
 * @param {number} knots - sustained wind speed in knots (>= 0).
 * @returns {object} the frozen `BEAUFORT_SCALE` entry.
 */
export function beaufortFromKnots(knots) {
  checkSpeed(knots, 'knot');
  for (const entry of BEAUFORT_SCALE) {
    if (entry.knotsMax === null || knots < entry.knotsMax) {
      return entry;
    }
  }
  // Unreachable: Force 12 has no upper bound, but keep the
  // exhaustiveness explicit rather than returning undefined.
  return BEAUFORT_SCALE[BEAUFORT_SCALE.length - 1];
}

/**
 * Beaufort entry for a sustained wind speed in metres per second.
 * @param {number} metersPerSecond - sustained wind speed in m/s (>= 0).
 * @returns {object} the frozen `BEAUFORT_SCALE` entry.
 */
export function beaufortFromMetersPerSecond(metersPerSecond) {
  checkSpeed(metersPerSecond, 'm/s');
  return beaufortFromKnots(metersPerSecond / METERS_PER_SECOND_PER_KNOT);
}

/**
 * Beaufort entry for a sustained wind speed in miles per hour.
 * @param {number} milesPerHour - sustained wind speed in mph (>= 0).
 * @returns {object} the frozen `BEAUFORT_SCALE` entry.
 */
export function beaufortFromMilesPerHour(milesPerHour) {
  checkSpeed(milesPerHour, 'mph');
  return beaufortFromKnots(milesPerHour * KNOTS_PER_MILE_PER_HOUR);
}

/**
 * Beaufort entry for a sustained wind speed in kilometres per hour.
 * @param {number} kilometresPerHour - sustained wind speed in km/h (>= 0).
 * @returns {object} the frozen `BEAUFORT_SCALE` entry.
 */
export function beaufortFromKilometresPerHour(kilometresPerHour) {
  checkSpeed(kilometresPerHour, 'km/h');
  return beaufortFromKnots(kilometresPerHour * KNOTS_PER_KILOMETRE_PER_HOUR);
}

/**
 * Whether a Beaufort force counts as gale strength or stronger
 * (Force 8 and up, the NWS gale-warning threshold).
 * @param {number} force - Beaufort force (0-12).
 * @returns {boolean} true at Force 8 and above.
 */
export function isGaleForce(force) {
  if (
    typeof force !== 'number' ||
    !Number.isInteger(force) ||
    force < 0 ||
    force > 12
  ) {
    throw new RangeError('force must be an integer in [0, 12]');
  }
  return force >= GALE_FORCE;
}
