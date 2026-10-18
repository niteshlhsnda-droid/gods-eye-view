/**
 * Shared signal math: decibel / power conversions, free-space path loss,
 * thermal noise, and link-budget helpers.
 *
 * Why this module exists: the codebase talks about radio, GNSS, ADS-B,
 * and satellite links (radio layer, GNSS spoof-signal detection, satellite
 * passes) but has no canonical decibel handling — every future call site
 * would otherwise re-derive `10 * log10(...)` with its own edge-case
 * behaviour (0 mW, negative ratios, -Infinity dBm) and its own path-loss
 * constant. The 10-vs-20 log factor (power vs amplitude) is the classic
 * source of 2x errors here, so the two families are kept as separate,
 * explicitly named functions.
 *
 * Canonical semantics (standalone — no call sites re-pointed):
 * - Pure: no DOM, no imports. All inputs/outputs are plain numbers,
 *   arrays of numbers, or one plain options object.
 * - Numeric functions return `NaN` on invalid input (negative power,
 *   negative ratio, non-positive frequency, negative temperature, a
 *   non-finite or missing argument). They never throw and never return
 *   `null`. This matches the numeric-return convention of windMath.
 * - Zero is NOT invalid where the math has an exact limit: a power of
 *   0 mW is exactly `-Infinity` dBm, a ratio of 0 is exactly
 *   `-Infinity` dB, and `-Infinity` dBm is exactly 0 mW. Callers must
 *   handle `-Infinity` explicitly (e.g. "no signal") rather than
 *   treating it as a missing value.
 * - `+Infinity` propagates mathematically: `mwToDbm(+Infinity)` is
 *   `+Infinity`, `dbmToMw(+Infinity)` is `+Infinity`.
 * - Power ratios use `10 * log10` (power quantities: mW, W, power
 *   ratios). Amplitude ratios use `20 * log10` (voltage / field
 *   quantities). Mixing the two is a bug — the function names say
 *   which family they belong to.
 * - dBm is referenced to 1 mW; dBW is referenced to 1 W; they differ
 *   by exactly 30 dB (`dBW = dBm - 30`).
 * - `freeSpacePathLossDb` uses the exact speed of light
 *   `c = 299792458 m/s` and `20 * log10(4 * PI * d / lambda)`.
 *   `freeSpacePathLossDbMhzKm` uses the conventional engineering form
 *   `32.44 + 20 * log10(f_MHz) + 20 * log10(d_km)`, which assumes
 *   `c ≈ 3e8 m/s`; the two agree to ~0.01 dB. Prefer the exact form
 *   when both inputs are already in Hz / metres.
 * - Free-space path loss at zero distance is `-Infinity` (the formula's
 *   exact limit for co-located antennas), not 0 dB and not NaN.
 * - `thermalNoiseDbm` is the Johnson–Nyquist floor `10 * log10(kTB)`
 *   in dBm with the exact Boltzmann constant
 *   `k = 1.380649e-23 J/K`, defaulting to `T = 290 K` (the standard
 *   room-temperature reference, giving -173.98 dBm/Hz, commonly quoted
 *   as -174 dBm/Hz). It is a noise FLOOR, not a receiver sensitivity:
 *   sensitivity = floor + noise figure + required SNR.
 * - `linkBudgetDbm` is the plain additive budget
 *   `tx + txGain + rxGain - pathLoss - miscLoss`. It does not model
 *   fading, polarization mismatch, or atmospheric absorption — those
 *   belong in `miscLossDb` / a propagation model, not in this helper.
 * - `sumPowerDbm([])` is `-Infinity` (the sum of no powers is 0 mW).
 *   `-Infinity` entries contribute zero power and are ignored; a
 *   `+Infinity` entry dominates the sum; any `NaN` entry poisons it.
 *
 * Adoption follow-up (NOT done here): no call site is re-pointed in this
 * commit — migration is a separate, per-group change, like the prior
 * idea-cycle modules.
 *
 * @module data/signalMath
 */

/** Exact speed of light in m/s (SI defining constant). */
const SPEED_OF_LIGHT_MPS = 299792458;
/** Exact Boltzmann constant in J/K (SI defining constant). */
const BOLTZMANN_J_PER_K = 1.380649e-23;
/** Standard room-temperature reference for thermal noise, in kelvin. */
const REFERENCE_TEMPERATURE_K = 290;

/** True when `value` is a finite number. */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Power ratio (linear) from decibels: `10 ^ (db / 10)`.
 * Non-finite input returns `NaN`.
 */
export function dbToPowerRatio(db) {
  if (!isFiniteNumber(db)) return NaN;
  return 10 ** (db / 10);
}

/**
 * Decibels from a power ratio (linear): `10 * log10(ratio)`.
 * A ratio of 0 returns `-Infinity`; a negative or non-finite ratio
 * returns `NaN`.
 */
export function powerRatioToDb(ratio) {
  if (typeof ratio !== 'number') return NaN;
  if (ratio === 0) return -Infinity;
  if (!Number.isFinite(ratio) || ratio < 0) return NaN;
  return 10 * Math.log10(ratio);
}

/**
 * Amplitude (voltage / field) ratio (linear) from decibels:
 * `10 ^ (db / 20)`. Non-finite input returns `NaN`.
 */
export function dbToAmplitudeRatio(db) {
  if (!isFiniteNumber(db)) return NaN;
  return 10 ** (db / 20);
}

/**
 * Decibels from an amplitude ratio (linear): `20 * log10(ratio)`.
 * A ratio of 0 returns `-Infinity`; a negative or non-finite ratio
 * returns `NaN`.
 */
export function amplitudeRatioToDb(ratio) {
  if (typeof ratio !== 'number') return NaN;
  if (ratio === 0) return -Infinity;
  if (!Number.isFinite(ratio) || ratio < 0) return NaN;
  return 20 * Math.log10(ratio);
}

/**
 * Milliwatts from dBm (referenced to 1 mW): `10 ^ (dbm / 10)`.
 * `-Infinity` dBm is exactly 0 mW; non-finite (other than `-Infinity`)
 * input returns `NaN`.
 */
export function dbmToMw(dbm) {
  if (typeof dbm !== 'number') return NaN;
  if (dbm === -Infinity) return 0;
  if (dbm === Infinity) return Infinity;
  if (!Number.isFinite(dbm)) return NaN;
  return 10 ** (dbm / 10);
}

/**
 * dBm from milliwatts: `10 * log10(mw)`.
 * 0 mW returns `-Infinity`; negative or non-finite (other than
 * `+Infinity`) input returns `NaN`; `+Infinity` mW is `+Infinity` dBm.
 */
export function mwToDbm(mw) {
  if (typeof mw !== 'number') return NaN;
  if (mw === 0) return -Infinity;
  if (mw === Infinity) return Infinity;
  if (!Number.isFinite(mw) || mw < 0) return NaN;
  return 10 * Math.log10(mw);
}

/**
 * dBW from dBm: `dbm - 30`. Non-finite input returns `NaN`, except
 * `-Infinity` maps to `-Infinity` and `+Infinity` to `+Infinity`.
 */
export function dbmToDbw(dbm) {
  if (typeof dbm !== 'number') return NaN;
  if (dbm === -Infinity) return -Infinity;
  if (dbm === Infinity) return Infinity;
  if (!Number.isFinite(dbm)) return NaN;
  return dbm - 30;
}

/**
 * dBm from dBW: `dbw + 30`. Non-finite input behaves like `dbmToDbw`.
 */
export function dbwToDbm(dbw) {
  if (typeof dbw !== 'number') return NaN;
  if (dbw === -Infinity) return -Infinity;
  if (dbw === Infinity) return Infinity;
  if (!Number.isFinite(dbw)) return NaN;
  return dbw + 30;
}

/**
 * Milliwatts from dBW (referenced to 1 W): `10 ^ ((dbw + 30) / 10)`.
 * `-Infinity` dBW is exactly 0 mW; `+Infinity` dBW is `+Infinity` mW;
 * other non-finite input is `NaN`.
 */
export function dbwToMw(dbw) {
  if (typeof dbw !== 'number') return NaN;
  if (dbw === -Infinity) return 0;
  if (dbw === Infinity) return Infinity;
  if (!Number.isFinite(dbw)) return NaN;
  return 10 ** ((dbw + 30) / 10);
}

/**
 * dBW from milliwatts: `10 * log10(mw) - 30`.
 * 0 mW returns `-Infinity`; negative input returns `NaN`.
 */
export function mwToDbw(mw) {
  const dbm = mwToDbm(mw);
  if (dbm === -Infinity) return -Infinity;
  if (Number.isNaN(dbm)) return NaN;
  return dbm - 30;
}

/**
 * dBm from watts: `10 * log10(w * 1000)`.
 * 0 W returns `-Infinity`; negative input returns `NaN`.
 */
export function wattsToDbm(watts) {
  if (typeof watts !== 'number') return NaN;
  if (watts === 0) return -Infinity;
  if (watts === Infinity) return Infinity;
  if (!Number.isFinite(watts) || watts < 0) return NaN;
  return 10 * Math.log10(watts * 1000);
}

/**
 * Watts from dBm: `10 ^ (dbm / 10) / 1000`.
 * `-Infinity` dBm is exactly 0 W; `+Infinity` dBm is `+Infinity` W;
 * other non-finite input is `NaN`.
 */
export function dbmToWatts(dbm) {
  if (typeof dbm !== 'number') return NaN;
  if (dbm === -Infinity) return 0;
  if (dbm === Infinity) return Infinity;
  if (!Number.isFinite(dbm)) return NaN;
  return 10 ** (dbm / 10) / 1000;
}

/**
 * Total power in dBm of two signals given in dBm: power-domain sum,
 * NOT `a + b` (adding decibels directly is the classic error — that
 * multiplies the powers). Equivalent to
 * `10 * log10(10 ^ (a / 10) + 10 ^ (b / 10))`.
 * `-Infinity` means "no signal" and contributes zero power; `NaN`
 * input returns `NaN`.
 */
export function addPowerDbm(a, b) {
  return sumPowerDbm([a, b]);
}

/**
 * Total power in dBm of any number of signals given in dBm, summed in
 * the power domain. An empty list is `-Infinity` (0 mW total).
 * `-Infinity` entries contribute zero power; a `+Infinity` entry
 * dominates; any `NaN` (or non-number) entry returns `NaN`.
 */
export function sumPowerDbm(values) {
  if (!Array.isArray(values)) return NaN;
  let totalMw = 0;
  for (const value of values) {
    if (typeof value !== 'number') return NaN;
    if (Number.isNaN(value)) return NaN;
    if (value === Infinity) return Infinity;
    if (value === -Infinity) continue;
    totalMw += 10 ** (value / 10);
  }
  return 10 * Math.log10(totalMw);
}

/**
 * Free-space path loss in dB for a frequency in Hz and a distance in
 * metres: `20 * log10(4 * PI * d / lambda)`, `lambda = c / f`, with the
 * exact speed of light. Zero distance returns `-Infinity` (co-located
 * antennas). Non-positive frequency, negative distance, or non-finite
 * inputs return `NaN`.
 */
export function freeSpacePathLossDb(frequencyHz, distanceM) {
  if (!isFiniteNumber(frequencyHz) || !isFiniteNumber(distanceM)) {
    return NaN;
  }
  if (frequencyHz <= 0 || distanceM < 0) return NaN;
  if (distanceM === 0) return -Infinity;
  const wavelengthM = SPEED_OF_LIGHT_MPS / frequencyHz;
  return 20 * Math.log10((4 * Math.PI * distanceM) / wavelengthM);
}

/**
 * Free-space path loss in dB, engineering form: frequency in MHz,
 * distance in km: `32.44 + 20 * log10(f) + 20 * log10(d)`.
 * Zero distance returns `-Infinity`. Non-positive frequency, negative
 * distance, or non-finite inputs return `NaN`. Agrees with
 * `freeSpacePathLossDb` to ~0.01 dB (this form assumes c ≈ 3e8 m/s).
 */
export function freeSpacePathLossDbMhzKm(frequencyMhz, distanceKm) {
  if (!isFiniteNumber(frequencyMhz) || !isFiniteNumber(distanceKm)) {
    return NaN;
  }
  if (frequencyMhz <= 0 || distanceKm < 0) return NaN;
  if (distanceKm === 0) return -Infinity;
  return 32.44 + 20 * Math.log10(frequencyMhz) + 20 * Math.log10(distanceKm);
}

/**
 * Thermal (Johnson–Nyquist) noise floor in dBm for a bandwidth in Hz
 * at a temperature in kelvin (default 290 K):
 * `10 * log10(k * T * B / 1 mW)`.
 * At 290 K and 1 Hz this is -173.98 dBm. Non-positive bandwidth or
 * temperature, or non-finite inputs, return `NaN`.
 */
export function thermalNoiseDbm(
  bandwidthHz,
  temperatureK = REFERENCE_TEMPERATURE_K,
) {
  if (!isFiniteNumber(bandwidthHz) || !isFiniteNumber(temperatureK)) {
    return NaN;
  }
  if (bandwidthHz <= 0 || temperatureK <= 0) return NaN;
  const noiseMw = (BOLTZMANN_J_PER_K * temperatureK * bandwidthHz) / 1e-3;
  return 10 * Math.log10(noiseMw);
}

/**
 * Received power in dBm from a simple link budget:
 * `txPowerDbm + txGainDbi + rxGainDbi - pathLossDb - miscLossDb`.
 * `options.miscLossDb` defaults to 0. Any missing, non-number, or
 * non-finite field returns `NaN`.
 */
export function linkBudgetDbm(options) {
  if (options === null || typeof options !== 'object') return NaN;
  const {
    txPowerDbm,
    txGainDbi,
    rxGainDbi,
    pathLossDb,
    miscLossDb = 0,
  } = options;
  for (const term of [
    txPowerDbm,
    txGainDbi,
    rxGainDbi,
    pathLossDb,
    miscLossDb,
  ]) {
    if (!isFiniteNumber(term)) return NaN;
  }
  return txPowerDbm + txGainDbi + rxGainDbi - pathLossDb - miscLossDb;
}

/**
 * Link margin in dB: `receivedDbm - sensitivityDbm`. Positive means
 * the signal clears the receiver sensitivity. Non-finite inputs
 * return `NaN`.
 */
export function linkMarginDb(receivedDbm, sensitivityDbm) {
  if (!isFiniteNumber(receivedDbm) || !isFiniteNumber(sensitivityDbm)) {
    return NaN;
  }
  return receivedDbm - sensitivityDbm;
}

/**
 * Signal-to-noise ratio in dB: `signalDbm - noiseDbm`.
 * Non-finite inputs return `NaN`.
 */
export function snrDb(signalDbm, noiseDbm) {
  if (!isFiniteNumber(signalDbm) || !isFiniteNumber(noiseDbm)) return NaN;
  return signalDbm - noiseDbm;
}
