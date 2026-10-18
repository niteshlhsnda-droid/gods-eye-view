import { headingOf } from './facing.js';

/**
 * The eight-wind compass names, in sector order starting at north.
 * For other sector counts the sector's centre bearing doubles as its name.
 */
export const SECTOR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Default sector count: the eight-wind compass. */
export const DEFAULT_SECTORS = 8;

/**
 * A usable sector count, or null when `sectors` is not one. Each sector is
 * centred on `i * (360 / sectors)` — the eight-wind convention, 0° (north)
 * at the centre of sector 0 — and counts must divide the circle evenly so
 * every bearing maps to exactly one sector.
 */
export function normalizeSectors(sectors) {
  if (sectors === undefined) return DEFAULT_SECTORS;
  if (
    typeof sectors !== 'number' ||
    !Number.isInteger(sectors) ||
    sectors < 4 ||
    sectors > 36 ||
    360 % sectors !== 0
  ) {
    return null;
  }
  return sectors;
}

/** Compass bearings of every sector centre for `sectors`, starting at 0°. */
export function sectorCentres(sectors) {
  const valid = normalizeSectors(sectors);
  if (valid === null) return null;
  const width = 360 / valid;
  return Array.from({ length: valid }, (_, index) => index * width);
}

/**
 * Which sector a compass bearing falls in (the eight-wind convention:
 * sector 0 is centred on north, spanning ±half a sector width either way,
 * so 350° and 10° both land in sector 0). Null on an unusable bearing.
 */
export function sectorOf(bearing, sectors = DEFAULT_SECTORS) {
  const valid = normalizeSectors(sectors);
  if (valid === null) return null;
  if (typeof bearing !== 'number' || !Number.isFinite(bearing)) return null;
  const wrapped = ((bearing % 360) + 360) % 360;
  const width = 360 / valid;
  return ((Math.round(wrapped / width) % valid) + valid) % valid;
}

/** Human name for a sector: the eight-wind name, else its centre bearing. */
export function sectorName(index, sectors = DEFAULT_SECTORS) {
  const valid = normalizeSectors(sectors);
  if (valid === null || index < 0 || index >= valid) return null;
  if (valid === SECTOR_NAMES.length) return SECTOR_NAMES[index];
  return `${String(index * (360 / valid)).padStart(3, '0')}°`;
}

/**
 * The camera heading a photo contributes to coverage: a pano sees every
 * direction and covers all sectors; a flat shot contributes its compass
 * heading (the computed one first); a photo with no usable heading
 * contributes nothing. Returns { all: true } for panos, { all: false,
 * sector } for flat shots with a sector index, or null otherwise.
 */
function coverageContribution(photo, sectors) {
  if (photo?.is_pano === true) return { all: true, sector: null };
  const heading = headingOf(photo);
  if (heading === null) return null;
  return { all: false, sector: sectorOf(heading, sectors) };
}

/**
 * Per-sector heading coverage for a set of street photos. Each entry is
 * { index, name, centerBearing, width, covered, count }. A pano covers
 * every sector; photos without a usable heading are skipped. Null on
 * invalid input: a non-array `photos`, or a sector count that is not a
 * valid integer between 4 and 36 dividing 360 evenly.
 */
export function headingCoverage(photos, options) {
  if (!Array.isArray(photos)) return null;
  const opts = options === undefined ? {} : options;
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    return null;
  }
  const sectors = normalizeSectors(opts.sectors);
  if (sectors === null) return null;
  const width = 360 / sectors;
  const result = Array.from({ length: sectors }, (_, index) => ({
    index,
    name: sectorName(index, sectors),
    centerBearing: index * width,
    width,
    covered: false,
    count: 0,
  }));
  for (const photo of photos) {
    const contribution = coverageContribution(photo, sectors);
    if (contribution === null) continue;
    if (contribution.all) {
      for (const sector of result) {
        sector.covered = true;
        sector.count += 1;
      }
      continue;
    }
    const sector = result[contribution.sector];
    sector.covered = true;
    sector.count += 1;
  }
  return result;
}

/**
 * The compass sectors no photo looks at: { index, name, centerBearing,
 * width } for each uncovered sector, in sector order. The antimeridian is
 * irrelevant to bearings, but the 0°/360° wrap is handled by the sector
 * math — 350° and 10° count as the same sector. Null on invalid input.
 */
export function coverageGaps(photos, options) {
  const coverage = headingCoverage(photos, options);
  if (coverage === null) return null;
  return coverage
    .filter((sector) => !sector.covered)
    .map(({ index, name, centerBearing, width }) => ({
      index,
      name,
      centerBearing,
      width,
    }));
}
