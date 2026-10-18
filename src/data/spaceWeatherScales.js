/**
 * NOAA Space Weather Scales: the three SWPC severity scales — G
 * (geomagnetic storms), S (solar radiation storms), and R (radio
 * blackouts) — each G1/S1/R1 (Minor) to G5/S5/R5 (Extreme), with the
 * published physical measure that defines each level and the
 * published possible effects for the level.
 *
 * Why a new module: GEV already has weather-adjacent pure helpers
 * (Cycles 1-11 added sunTimes, moonPhase, Beaufort, feelsLike, ICAO
 * Standard Atmosphere, FAA flight categories, sunPosition, EPA AQI,
 * Saffir-Simpson, WHO UV Index, and the Enhanced Fujita Scale), but
 * nothing that answers "how severe is this space-weather event?"
 * for a space / satellite readout. GEV tracks satellites (TLEs,
 * launches), and geomagnetic storms drive exactly the satellite
 * effects those readouts care about — drag on low-Earth-orbit
 * spacecraft, surface charging, orientation and tracking problems.
 * This module is that answer: three pure classifiers plus the scale
 * tables (thresholds, descriptors, effect glosses) that a badge or
 * readout needs. No call-site migration — no layer reads this yet.
 *
 * Standard: the NOAA / NWS Space Weather Prediction Center (SWPC)
 * "NOAA Space Weather Scales". The three scales are INDEPENDENT:
 * a G3, an S1, and an R0 can all hold at once, and a number on one
 * scale never implies a number on another. Each scale has five
 * numbered levels, analogous to hurricane / tornado / earthquake
 * severity scales. The levels below are the table's "Physical
 * measure" column, and each entry's `threshold` is that measure:
 * classification is "highest threshold reached", i.e. the entry
 * whose threshold is the largest one less than or equal to the
 * measured value.
 *
 * - G scale: physical measure is the planetary Kp index.
 *   G1 Kp = 5, G2 Kp = 6, G3 Kp = 7, G4 Kp = 8 (table: "Kp = 8,
 *   including a 9-"), G5 Kp = 9.
 * - S scale: physical measure is the flux level of >= 10 MeV
 *   protons (5-minute averages, GOES). S1 10, S2 10^2 (100),
 *   S3 10^3 (1000), S4 10^4 (10000), S5 10^5 (100000) pfu.
 * - R scale: physical measure is the GOES X-ray peak brightness
 *   by flare class (and flux). R1 M1 (10^-5), R2 M5 (5 x 10^-5),
 *   R3 X1 (10^-4), R4 X10 (10^-3), R5 X20 (2 x 10^-3) W/m2.
 *
 * Sources (primary sources only; no blog summaries):
 * - NOAA / NWS SWPC, "NOAA Space Weather Scales": the three
 *   tables (levels, descriptors, effects, physical measures, and
 *   average frequencies per 11-year solar cycle), the note that
 *   the scales describe environmental disturbances for three event
 *   types and convey severity with numbered levels, and the
 *   footnotes "Duration of event will influence severity of
 *   effects" and (S scale) "Flux levels are 5 minute averages."
 *   https://www.spaceweather.gov/noaa-space-weather-scales#s_scales
 * - NOAA / NWS SWPC, "Solar Flares (Radio Blackouts)": flare
 *   intensities are classified by peak emission in the 0.1-0.8 nm
 *   soft X-ray band of the NOAA/GOES XRS (A from 10^-8, B >= 10^-7,
 *   C 10^-6, M 10^-5, X 10^-4 W/m2); radio blackouts use the
 *   five-level NOAA Space Weather Scale, "directly related to the
 *   flare's max peak in soft X-rays reached or expected"; and the
 *   R1 M1 / R2 M5 / R3 X1 / R4 X10 / R5 X20 correlation table
 *   with fluxes 0.00001 / 0.00005 / 0.0001 / 0.001 / 0.002 W/m2.
 *   https://www.spaceweather.gov/phenomena/solar-flares-radio-blackouts
 * - NOAA / NWS SWPC, "Solar Radiation Storm": S1-S5 are based on
 *   energetic-proton measurements from the GOES satellite; a
 *   storm STARTS when the flux of protons at energies >= 10 MeV
 *   equals or exceeds 10 pfu (1 pfu =
 *   1 particle*cm-2*s-1*ster-1) and ENDS at the last time the
 *   flux is measured at or above 10 pfu; a storm can persist from
 *   hours to days.
 *   https://www.spaceweather.gov/phenomena/solar-radiation-storm
 * - NOAA SWPC, "GOES Proton Flux": the >= 10 MeV products match
 *   the S-scale thresholds (10, 100, 1000, 10000, 100000 pfu).
 *   https://www.swpc.noaa.gov/node/39
 *
 * No colours: NOAA publishes no colour code for these scales
 * (unlike the WHO UV Index), so none is stored. Display colours
 * are a presentation choice; callers pick their own.
 *
 * Below-scale inputs: Kp below 5, proton flux below 10 pfu, and
 * X-ray flux below 10^-5 W/m2 map to NO level (`null`), not to
 * level 1. NOAA's tables have no G0 / S0 / R0 row — "G0" appears
 * only in third-party summaries — so this module does not invent
 * one. A null means "below storm / blackout level on this scale".
 *
 * Fractional inputs: Kp is often reported with decimals (e.g. a
 * forecast maximum Kp of 4.67) or in thirds (5-, 5, 5+, ... 9-,
 * 9). Classification accepts fractional Kp and treats each G
 * level as the half-open band [threshold, next threshold): Kp
 * 5.5 -> G1, Kp 8.67 (Kp 9-) -> G4 per the table's "including a
 * 9-" note, and only Kp 9 itself -> G5. The same half-open rule
 * applies to the S and R scales: a value exactly at a threshold
 * reaches that level (S1 starts AT 10 pfu; R2 starts AT 5 x 10^-5
 * W/m2), and S5 / R5 are open-ended above their thresholds.
 *
 * Accuracy / scope limits — read before using the numbers:
 * - POSSIBLE EFFECTS, NOT GUARANTEES. The table lists effects
 *   that are possible at each level ("Some or all of these effects
 *   are possible"), and duration influences severity. Never
 *   present a level as a promise that a listed effect will occur
 *   (or that an unlisted effect will not).
 * - G CLASSIFIES OBSERVED Kp. Kp is a 3-hour planetary index.
 *   SWPC forecast products may round a predicted value up to a
 *   storm level (e.g. a forecast maximum Kp of 4.67 shown as G1).
 *   This module classifies the Kp value as given — it does not
 *   round a forecast up. Label forecast-derived levels as
 *   forecast, not observed.
 * - S USES 5-MINUTE AVERAGE FLUX. The S thresholds are 5-minute
 *   averages of >= 10 MeV proton flux at GOES, not instantaneous
 *   spikes. Feeding a 1-minute peak misclassifies by construction.
 *   An S storm's start/end are defined by the 10 pfu crossing
 *   (see the Solar Radiation Storm source above), not by this
 *   classifier alone.
 * - R USES PEAK FLUX, REACHED OR EXPECTED. The R scale is tied
 *   to the flare's maximum peak soft X-ray flux (0.1-0.8 nm band,
 *   GOES XRS), reached or expected — not a time-averaged flux and
 *   not a flux in another band.
 * - NOT MEDICAL ADVICE. The S-scale "Biological" rows describe
 *   astronaut / aircrew radiation-hazard categories, not personal
 *   dose guidance. Do not convert an S level into a dose or a
 *   health recommendation for any individual.
 * - Kp IS CAPPED AT 9 BY DEFINITION. Inputs above 9 are not a
 *   stronger storm; they are out of the index's domain and throw.
 */

/** Lowest Kp that counts as a geomagnetic storm (G1). */
export const KP_STORM_MIN = 5;

/** Highest Kp in the index's domain (G5). */
export const KP_MAX = 9;

/** Lowest >= 10 MeV proton flux that counts as a radiation storm (S1), in pfu. */
export const PROTON_FLUX_STORM_MIN_PFU = 10;

/** Lowest GOES soft X-ray peak flux that counts as a radio blackout (R1), in W/m2. */
export const XRAY_FLUX_BLACKOUT_MIN_W_PER_M2 = 1e-5;

/**
 * Geomagnetic storm (G) scale, weakest first. `threshold` is the
 * Kp value at which the level is reached; classification takes the
 * highest threshold <= the reported Kp. `thresholdLabel` is the
 * table's physical-measure wording. `effect` condenses the
 * table's published possible effects for the level.
 * @type {ReadonlyArray<Readonly<{
 *   key: string,
 *   name: string,
 *   level: number,
 *   descriptor: string,
 *   threshold: number,
 *   thresholdUnit: string,
 *   thresholdLabel: string,
 *   effect: string,
 * }>>}
 */
export const GEOMAGNETIC_STORM_SCALE = Object.freeze([
  Object.freeze({
    key: 'G1',
    name: 'G1',
    level: 1,
    descriptor: 'Minor',
    threshold: 5,
    thresholdUnit: 'Kp',
    thresholdLabel: 'Kp = 5',
    effect:
      'Power systems: weak power grid fluctuations can occur. Spacecraft operations: minor impact on satellite operations possible. Other systems: migratory animals are affected at this and higher levels; aurora is commonly visible at high latitudes (northern Michigan and Maine).',
  }),
  Object.freeze({
    key: 'G2',
    name: 'G2',
    level: 2,
    descriptor: 'Moderate',
    threshold: 6,
    thresholdUnit: 'Kp',
    thresholdLabel: 'Kp = 6',
    effect:
      'Power systems: high-latitude power systems may experience voltage alarms, long-duration storms may cause transformer damage. Spacecraft operations: corrective actions to orientation may be required by ground control; possible changes in drag affect orbit predictions. Other systems: HF radio propagation can fade at higher latitudes, and aurora has been seen as low as New York and Idaho (typically 55 degrees geomagnetic lat.).',
  }),
  Object.freeze({
    key: 'G3',
    name: 'G3',
    level: 3,
    descriptor: 'Strong',
    threshold: 7,
    thresholdUnit: 'Kp',
    thresholdLabel: 'Kp = 7',
    effect:
      'Power systems: voltage corrections may be required, false alarms triggered on some protection devices. Spacecraft operations: surface charging may occur on satellite components, drag may increase on low-Earth-orbit satellites, and corrections may be needed for orientation problems. Other systems: intermittent satellite navigation and low-frequency radio navigation problems may occur, HF radio may be intermittent, and aurora has been seen as low as Illinois and Oregon (typically 50 degrees geomagnetic lat.).',
  }),
  Object.freeze({
    key: 'G4',
    name: 'G4',
    level: 4,
    descriptor: 'Severe',
    threshold: 8,
    thresholdUnit: 'Kp',
    thresholdLabel: 'Kp = 8, including a 9-',
    effect:
      'Power systems: possible widespread voltage control problems and some protective systems will mistakenly trip out key assets from the grid. Spacecraft operations: may experience surface charging and tracking problems, corrections may be needed for orientation problems. Other systems: induced pipeline currents affect preventive measures, HF radio propagation sporadic, satellite navigation degraded for hours, low-frequency radio navigation disrupted, and aurora has been seen as low as Alabama and northern California (typically 45 degrees geomagnetic lat.).',
  }),
  Object.freeze({
    key: 'G5',
    name: 'G5',
    level: 5,
    descriptor: 'Extreme',
    threshold: 9,
    thresholdUnit: 'Kp',
    thresholdLabel: 'Kp = 9',
    effect:
      'Power systems: widespread voltage control problems and protective system problems can occur, some grid systems may experience complete collapse or blackouts. Transformers may experience damage. Spacecraft operations: may experience extensive surface charging, problems with orientation, uplink/downlink and tracking satellites. Other systems: pipeline currents can reach hundreds of amps, HF (high frequency) radio propagation may be impossible in many areas for one to two days, satellite navigation may be degraded for days, low-frequency radio navigation can be out for hours, and aurora has been seen as low as Florida and southern Texas (typically 40 degrees geomagnetic lat.).',
  }),
]);

/** Scale key ('G1'..'G5') -> scale entry. */
export const GEOMAGNETIC_STORM_BY_KEY = Object.freeze(
  Object.fromEntries(
    GEOMAGNETIC_STORM_SCALE.map((entry) => [entry.key, entry]),
  ),
);

/**
 * Solar radiation storm (S) scale, weakest first. `threshold` is
 * the >= 10 MeV proton flux (5-minute average, pfu) at which the
 * level is reached; classification takes the highest threshold <=
 * the measured flux.
 * @type {ReadonlyArray<Readonly<{
 *   key: string,
 *   name: string,
 *   level: number,
 *   descriptor: string,
 *   threshold: number,
 *   thresholdUnit: string,
 *   thresholdLabel: string,
 *   effect: string,
 * }>>}
 */
export const SOLAR_RADIATION_STORM_SCALE = Object.freeze([
  Object.freeze({
    key: 'S1',
    name: 'S1',
    level: 1,
    descriptor: 'Minor',
    threshold: 10,
    thresholdUnit: 'pfu',
    thresholdLabel: '10 pfu',
    effect:
      'Biological: none. Satellite operations: none. Other systems: minor impacts on HF radio in the polar regions.',
  }),
  Object.freeze({
    key: 'S2',
    name: 'S2',
    level: 2,
    descriptor: 'Moderate',
    threshold: 100,
    thresholdUnit: 'pfu',
    thresholdLabel: '10^2 pfu',
    effect:
      'Biological: passengers and crew in high-flying aircraft at high latitudes may be exposed to elevated radiation risk. Satellite operations: infrequent single-event upsets possible. Other systems: small effects on HF propagation through the polar regions and navigation at polar cap locations possibly affected.',
  }),
  Object.freeze({
    key: 'S3',
    name: 'S3',
    level: 3,
    descriptor: 'Strong',
    threshold: 1000,
    thresholdUnit: 'pfu',
    thresholdLabel: '10^3 pfu',
    effect:
      'Biological: radiation hazard avoidance recommended for astronauts on EVA; passengers and crew in high-flying aircraft at high latitudes may be exposed to radiation risk. Satellite operations: single-event upsets, noise in imaging systems, and slight reduction of efficiency in solar panel are likely. Other systems: degraded HF radio propagation through the polar regions and navigation position errors likely.',
  }),
  Object.freeze({
    key: 'S4',
    name: 'S4',
    level: 4,
    descriptor: 'Severe',
    threshold: 10000,
    thresholdUnit: 'pfu',
    thresholdLabel: '10^4 pfu',
    effect:
      'Biological: unavoidable radiation hazard to astronauts on EVA; passengers and crew in high-flying aircraft at high latitudes may be exposed to radiation risk. Satellite operations: may experience memory device problems and noise on imaging systems; star-tracker problems may cause orientation problems, and solar panel efficiency can be degraded. Other systems: blackout of HF radio communications through the polar regions and increased navigation errors over several days are likely.',
  }),
  Object.freeze({
    key: 'S5',
    name: 'S5',
    level: 5,
    descriptor: 'Extreme',
    threshold: 100000,
    thresholdUnit: 'pfu',
    thresholdLabel: '10^5 pfu',
    effect:
      'Biological: unavoidable high radiation hazard to astronauts on EVA (extra-vehicular activity); passengers and crew in high-flying aircraft at high latitudes may be exposed to radiation risk. Satellite operations: satellites may be rendered useless, memory impacts can cause loss of control, may cause serious noise in image data, star-trackers may be unable to locate sources; permanent damage to solar panels possible. Other systems: complete blackout of HF (high frequency) communications possible through the polar regions, and position errors make navigation operations extremely difficult.',
  }),
]);

/** Scale key ('S1'..'S5') -> scale entry. */
export const SOLAR_RADIATION_STORM_BY_KEY = Object.freeze(
  Object.fromEntries(
    SOLAR_RADIATION_STORM_SCALE.map((entry) => [entry.key, entry]),
  ),
);

/**
 * Radio blackout (R) scale, weakest first. `threshold` is the GOES
 * soft X-ray peak flux (0.1-0.8 nm band, W/m2) at which the level
 * is reached; classification takes the highest threshold <= the
 * peak flux. `flareClass` is the table's GOES X-ray peak brightness
 * class for the level.
 * @type {ReadonlyArray<Readonly<{
 *   key: string,
 *   name: string,
 *   level: number,
 *   descriptor: string,
 *   threshold: number,
 *   thresholdUnit: string,
 *   thresholdLabel: string,
 *   flareClass: string,
 *   effect: string,
 * }>>}
 */
export const RADIO_BLACKOUT_SCALE = Object.freeze([
  Object.freeze({
    key: 'R1',
    name: 'R1',
    level: 1,
    descriptor: 'Minor',
    threshold: 1e-5,
    thresholdUnit: 'W/m2',
    thresholdLabel: 'M1 (10^-5 W/m2)',
    flareClass: 'M1',
    effect:
      'HF Radio: weak or minor degradation of HF radio communication on sunlit side, occasional loss of radio contact. Navigation: low-frequency navigation signals degraded for brief intervals.',
  }),
  Object.freeze({
    key: 'R2',
    name: 'R2',
    level: 2,
    descriptor: 'Moderate',
    threshold: 5e-5,
    thresholdUnit: 'W/m2',
    thresholdLabel: 'M5 (5 x 10^-5 W/m2)',
    flareClass: 'M5',
    effect:
      'HF Radio: limited blackout of HF radio communication on sunlit side, loss of radio contact for tens of minutes. Navigation: degradation of low-frequency navigation signals for tens of minutes.',
  }),
  Object.freeze({
    key: 'R3',
    name: 'R3',
    level: 3,
    descriptor: 'Strong',
    threshold: 1e-4,
    thresholdUnit: 'W/m2',
    thresholdLabel: 'X1 (10^-4 W/m2)',
    flareClass: 'X1',
    effect:
      'HF Radio: wide area blackout of HF radio communication, loss of radio contact for about an hour on sunlit side of Earth. Navigation: low-frequency navigation signals degraded for about an hour.',
  }),
  Object.freeze({
    key: 'R4',
    name: 'R4',
    level: 4,
    descriptor: 'Severe',
    threshold: 1e-3,
    thresholdUnit: 'W/m2',
    thresholdLabel: 'X10 (10^-3 W/m2)',
    flareClass: 'X10',
    effect:
      'HF Radio: HF radio communication blackout on most of the sunlit side of Earth for one to two hours. HF radio contact lost during this time. Navigation: outages of low-frequency navigation signals cause increased error in positioning for one to two hours. Minor disruptions of satellite navigation possible on the sunlit side of Earth.',
  }),
  Object.freeze({
    key: 'R5',
    name: 'R5',
    level: 5,
    descriptor: 'Extreme',
    threshold: 2e-3,
    thresholdUnit: 'W/m2',
    thresholdLabel: 'X20 (2 x 10^-3 W/m2)',
    flareClass: 'X20',
    effect:
      'HF Radio: complete HF (high frequency) radio blackout on the entire sunlit side of the Earth lasting for a number of hours. This results in no HF radio contact with mariners and en route aviators in this sector. Navigation: low-frequency navigation signals used by maritime and general aviation systems experience outages on the sunlit side of the Earth for many hours, causing loss in positioning. Increased satellite navigation errors in positioning for several hours on the sunlit side of Earth, which may spread into the night side.',
  }),
]);

/** Scale key ('R1'..'R5') -> scale entry. */
export const RADIO_BLACKOUT_BY_KEY = Object.freeze(
  Object.fromEntries(RADIO_BLACKOUT_SCALE.map((entry) => [entry.key, entry])),
);

/**
 * Shared classifier: the entry whose threshold is the largest one
 * less than or equal to `value`, or null when `value` is below the
 * first threshold (below storm / blackout level).
 * @param {ReadonlyArray<object>} scale
 * @param {number} value
 * @returns {object | null}
 */
function classifyByThreshold(scale, value) {
  let matched = null;
  for (const entry of scale) {
    if (value >= entry.threshold) {
      matched = entry;
    } else {
      break;
    }
  }
  return matched;
}

/**
 * Requires `value` to be a finite number >= 0.
 * @param {number} value
 * @param {string} name
 */
function requireNonNegativeFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${value}`);
  }
  if (value < 0) {
    throw new TypeError(`${name} must be >= 0, got ${value}`);
  }
}

/**
 * Classifies a planetary Kp index on the NOAA G (geomagnetic storm)
 * scale.
 *
 * @param {number} kp - planetary Kp index, 0-9 (fractional values
 *   accepted; Kp 9- in thirds notation is ~8.67 and classifies G4).
 * @returns {object | null} the frozen scale entry for the Kp, or
 *   null when Kp is below 5 (below storm level — there is no G0 in
 *   the NOAA table).
 * @throws {TypeError} on a non-finite, negative, non-numeric Kp,
 *   or a Kp above 9 (outside the index's domain).
 */
export function classifyGeomagneticStorm(kp) {
  requireNonNegativeFinite(kp, 'classifyGeomagneticStorm: kp');
  if (kp > KP_MAX) {
    throw new TypeError(
      `classifyGeomagneticStorm: kp must be <= ${KP_MAX} (Kp is defined on 0-9), got ${kp}`,
    );
  }
  return classifyByThreshold(GEOMAGNETIC_STORM_SCALE, kp);
}

/**
 * Classifies a >= 10 MeV proton flux (5-minute average, pfu) on
 * the NOAA S (solar radiation storm) scale.
 *
 * @param {number} protonFluxPfu - proton flux in pfu
 *   (1 pfu = 1 particle*cm-2*s-1*ster-1).
 * @returns {object | null} the frozen scale entry for the flux, or
 *   null when the flux is below 10 pfu (below storm level — an S
 *   storm starts at 10 pfu).
 * @throws {TypeError} on a non-finite, negative, or non-numeric flux.
 */
export function classifySolarRadiationStorm(protonFluxPfu) {
  requireNonNegativeFinite(
    protonFluxPfu,
    'classifySolarRadiationStorm: protonFluxPfu',
  );
  return classifyByThreshold(SOLAR_RADIATION_STORM_SCALE, protonFluxPfu);
}

/**
 * Classifies a GOES soft X-ray peak flux (0.1-0.8 nm band, W/m2)
 * on the NOAA R (radio blackout) scale.
 *
 * @param {number} xrayFluxWPerM2 - peak soft X-ray flux in W/m2,
 *   reached or expected.
 * @returns {object | null} the frozen scale entry for the flux, or
 *   null when the flux is below 10^-5 W/m2 (below blackout level).
 * @throws {TypeError} on a non-finite, negative, or non-numeric flux.
 */
export function classifyRadioBlackout(xrayFluxWPerM2) {
  requireNonNegativeFinite(
    xrayFluxWPerM2,
    'classifyRadioBlackout: xrayFluxWPerM2',
  );
  return classifyByThreshold(RADIO_BLACKOUT_SCALE, xrayFluxWPerM2);
}

/**
 * Classifies one observation on all three NOAA Space Weather
 * Scales at once. The three scales are independent — each is
 * classified from its own physical measure alone.
 *
 * @param {object} observation - at least one of `kp`,
 *   `protonFluxPfu`, `xrayFluxWPerM2`; omitted measures classify
 *   as null (no reading), not as level 1.
 * @returns {{ geomagnetic: object | null,
 *   solarRadiation: object | null, radioBlackout: object | null }}
 *   the frozen scale entry (or null, below level) per scale.
 * @throws {TypeError} on a non-object observation, an unknown key,
 *   or an invalid measure (see the single-scale classifiers).
 */
export function classifySpaceWeather(observation) {
  if (
    observation === null ||
    typeof observation !== 'object' ||
    Array.isArray(observation)
  ) {
    throw new TypeError(
      `classifySpaceWeather: observation must be an object, got ${observation}`,
    );
  }
  for (const key of Object.keys(observation)) {
    if (!['kp', 'protonFluxPfu', 'xrayFluxWPerM2'].includes(key)) {
      throw new TypeError(
        `classifySpaceWeather: unknown key ${String(key)} — expected kp, protonFluxPfu, xrayFluxWPerM2`,
      );
    }
  }
  return {
    geomagnetic:
      observation.kp === undefined
        ? null
        : classifyGeomagneticStorm(observation.kp),
    solarRadiation:
      observation.protonFluxPfu === undefined
        ? null
        : classifySolarRadiationStorm(observation.protonFluxPfu),
    radioBlackout:
      observation.xrayFluxWPerM2 === undefined
        ? null
        : classifyRadioBlackout(observation.xrayFluxWPerM2),
  };
}
