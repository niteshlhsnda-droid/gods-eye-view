/**
 * Moon phase for a UTC instant: lunar age, illumination, phase name, and
 * the neighbouring new / full moons.
 *
 * Algorithm: the mean-element lunation model — count mean synodic months
 * since a reference new moon and read the phase off the fractional
 * lunation. The constants are the standard mean values: the synodic month
 * 29.530588861 days (Delaunay's argument D gives 29.530588860986 days;
 * see the "Lunar month" reference) and the reference new moon of
 * 6 January 2000, 18:14:24 UTC (Julian Day 2451550.26), lunation k = 0
 * in the Meeus low-precision new-moon series. Illumination is the
 * geometric fraction (1 - cos(2π · phase)) / 2.
 *
 * Why a new module: the app's only Moon code is the decorative
 * sun/moon ring in `src/celestialRing.js` — it draws a moon marker but
 * never computes a phase — while the dossier's live-dashboard entry
 * (research/100-videos.md, the multi-panel stream) lists a "Moon phase"
 * panel as a standard dashboard element. Night / "Now Over" views need
 * the real phase; this is the pure calculation they can share.
 *
 * Accuracy: a mean-element model, NOT a full ephemeris. The true phase
 * instants wander by up to ~14 hours around the mean (orbital
 * eccentricity + solar perturbations), so predicted new/full-moon times
 * are accurate to about a day and illumination to about ±0.1 near the
 * quarters. Good enough for a dashboard label; not for eclipse or
 * occultation prediction — those need a real ephemeris (USNO / JPL).
 *
 * Pure: no DOM, no Cesium, no imports, no network. All times are UTC.
 *
 * @module data/moonPhase
 */

/** Mean synodic month (new moon to new moon) in days. */
export const SYNODIC_MONTH_DAYS = 29.530588861;

/**
 * Reference new moon: 6 January 2000, 18:14:24 UTC, as epoch
 * milliseconds. Lunation k = 0.
 */
export const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 24);

/** The eight named phases, in cycle order from new moon. */
export const PHASE_NAMES = Object.freeze([
  'New Moon',
  'Waxing Crescent',
  'First Quarter',
  'Waxing Gibbous',
  'Full Moon',
  'Waning Gibbous',
  'Last Quarter',
  'Waning Crescent',
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const SYNODIC_MS = SYNODIC_MONTH_DAYS * DAY_MS;

/**
 * Phase name for a fractional lunation `phase` in [0, 1). The four
 * primary phases sit at the centres of 1/8-cycle sectors; the
 * intermediate phases fill the sectors between them.
 */
function phaseName(phase) {
  const sector = Math.floor(((phase + 1 / 16) % 1) * 8);
  return PHASE_NAMES[sector];
}

/**
 * Moon phase at `date`.
 * @param {Date} date - the instant to evaluate (UTC).
 * @returns {{date:Date, ageDays:number, phase:number,
 *   illumination:number, phaseName:string, waxing:boolean,
 *   previousNewMoon:Date, nextNewMoon:Date, nextFullMoon:Date}}
 *   `phase` is the fractional lunation in [0, 1); `illumination` is the
 *   lit fraction of the disc in [0, 1]; `waxing` is true from new moon
 *   up to (excluding) full moon. `previousNewMoon` is the most recent
 *   new moon at or before `date`; the `next*` moons are strictly after
 *   `date`.
 */
export function moonPhase(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
  const elapsedMs = date.getTime() - REFERENCE_NEW_MOON_MS;
  const lunations = elapsedMs / SYNODIC_MS;
  const phase = ((lunations % 1) + 1) % 1;
  const ageDays = phase * SYNODIC_MONTH_DAYS;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const whole = Math.floor(lunations);
  return {
    date: new Date(date.getTime()),
    ageDays,
    phase,
    illumination,
    phaseName: phaseName(phase),
    waxing: phase < 0.5,
    previousNewMoon: new Date(REFERENCE_NEW_MOON_MS + whole * SYNODIC_MS),
    nextNewMoon: new Date(REFERENCE_NEW_MOON_MS + (whole + 1) * SYNODIC_MS),
    nextFullMoon: new Date(
      REFERENCE_NEW_MOON_MS + (Math.floor(lunations - 0.5) + 1.5) * SYNODIC_MS,
    ),
  };
}
