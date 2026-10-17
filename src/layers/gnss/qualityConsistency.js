/**
 * NIC/NACp claim consistency: a cross-check between the two quality
 * fields on ONE ADS-B fix.
 *
 * Each ADS-B fix carries two statements about the same position error
 * distribution:
 * - NIC (Navigation Integrity Category) bounds the integrity
 *   containment radius Rc: the true position lies within Rc of the
 *   reported position with near-certainty (SIL 3 grades that
 *   near-certainty as a failure rate at or below 1e-7 per hour).
 * - NACp (Navigation Accuracy Category for Position) bounds the 95%
 *   accuracy radius EPU: 95% of true positions lie within EPU of the
 *   reported position.
 *
 * For any error distribution, the near-certain quantile is at least
 * as large as the 95% quantile: a distribution whose 95% radius is
 * 370 m cannot have its 1e-7 radius under 25 m. So a fix whose
 * claimed EPU bound exceeds its claimed Rc bound by more than any
 * error distribution allows is internally incoherent: at least one of
 * the two fields is mis-set. The check judges the CLAIMS against each
 * other, never the positions, so it needs no kinematics, no velocity,
 * no altitude, and no history — one fix is enough.
 *
 * What no prior check sees:
 * - The cell classifier (`records.js`) reads NIC and NACp on one fix
 *   but judges each field against a FIXED threshold (NIC < 7 or
 *   NACp < 8), never against each other. A fix reporting NIC 10
 *   (Rc < 25 m) with NACp 7 (EPU < 0.1 NM) passes both fixed
 *   thresholds — each field looks good alone — while the pair is
 *   incoherent: no distribution is 95%-within-185 m and
 *   1e-7-within-25 m at once.
 * - The quality-drop check compares an aircraft's quality fields
 *   against its OWN earlier quality fields (a temporal drop). This
 *   check compares the two fields on the SAME fix against each
 *   other, so a transponder that has mis-set its fields since
 *   power-on — no drop, no change, wrong from the first report —
 *   passes the drop check and fails here.
 * - The position-based checks (teleport, velocity, acceleration,
 *   altitude, update-rate, cluster) never read the quality fields
 *   at all. A spoofer that fakes positions along a flyable path with
 *   consistent velocity fields passes all of them; if it also sets
 *   NIC high to look trustworthy while leaving NACp at a default
 *   low value, only this check notices the pair does not cohere.
 *
 * Threshold derivation: for a Gaussian error, the 1e-7 quantile sits
 * ~2.7x the 95% quantile (5.33 sigma vs 1.96 sigma); for a Rayleigh
 * radial error, ~2.3x. The flag edge is a ratio of 4: above the
 * Gaussian/Rayleigh figures, with margin for estimator conservatism
 * and for the coarseness of the categories. The check therefore
 * assumes transmitters report the tightest category that holds, as
 * DO-260B categorization intends: a transmitter whose true EPU is
 * 5 m reports NACp 10, not NACp 7. A pair at exactly the edge
 * (NIC 11 with NACp 9, ratio exactly 4.0) passes: the edge is strict
 * (>), so boundary pairs are not flagged.
 *
 * Tables are DO-260B (Version 2) category bounds, 1 NM = 1852 m:
 * - NIC containment radius Rc: 1 <20 NM, 2 <8 NM, 3 <4 NM, 4 <2 NM,
 *   5 <1 NM, 6 <0.6 NM, 7 <0.2 NM, 8 <0.1 NM, 9 <75 m, 10 <25 m,
 *   11 <7.5 m. NIC 0 claims no containment (unknown).
 * - NACp accuracy bound EPU: 1 <10 NM, 2 <4 NM, 3 <2 NM, 4 <1 NM,
 *   5 <0.5 NM, 6 <0.3 NM, 7 <0.1 NM, 8 <0.05 NM, 9 <30 m,
 *   10 <10 m, 11 <3 m. NACp 0 claims no accuracy (unknown).
 *
 * What this is NOT:
 * - Not a quality-drop check. No history is read; a lone fix is
 *   judged on its own fields.
 * - Not a verdict on the positions. An incoherent pair says the
 *   REPORT is mis-set, not that the position is wrong: the position
 *   may be perfectly good while the quality fields disagree about
 *   how good.
 * - Not an on-ground exclusion. Ground state is irrelevant to
 *   whether two fields on one report cohere, so on-ground fixes are
 *   judged like any other — unlike the kinematic checks, where
 *   ground handling bends tracks for benign reasons.
 *
 * The event is a secondary, unvalidated signal — never a verdict.
 * Benign causes also produce incoherent pairs:
 * - Independent estimators: a transponder that derives NIC from one
 *   estimator and NACp from another, more conservative one can
 *   report a pair past the edge while the underlying navigation
 *   solution is fine.
 * - Decoder mis-mapping: a decoder that maps the wrong bits into
 *   NIC or NACp manufactures incoherence the transmitter never sent.
 * - Conservative NACp: a transmitter that deliberately understates
 *   accuracy (reporting a looser NACp than its true EPU supports)
 *   while reporting an honest tight NIC trips the edge by caution,
 *   not by fault.
 * One aircraft misreporting is a receiver/transponder event until
 * corroborated: several aircraft incoherent in the same window is
 * the sky-event test (a shared decoder or feed mis-mapping).
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring
 * (carrying NIC/NACp through normalization, which currently keeps
 * them only for the cell classifier) is a separate step.
 */

/** 1 NM in metres (exact). */
const NM_M = 1852;
/**
 * DO-260B NIC containment-radius bounds in metres, indexed by NIC.
 * Index 0 is null: NIC 0 claims no containment (unknown).
 */
const NIC_CONTAINMENT_RADIUS_M = Object.freeze([
  null,
  20 * NM_M,
  8 * NM_M,
  4 * NM_M,
  2 * NM_M,
  1 * NM_M,
  0.6 * NM_M,
  0.2 * NM_M,
  0.1 * NM_M,
  75,
  25,
  7.5,
]);
/**
 * DO-260B NACp 95% accuracy (EPU) bounds in metres, indexed by NACp.
 * Index 0 is null: NACp 0 claims no accuracy (unknown).
 */
const NACP_EPU_M = Object.freeze([
  null,
  10 * NM_M,
  4 * NM_M,
  2 * NM_M,
  1 * NM_M,
  0.5 * NM_M,
  0.3 * NM_M,
  0.1 * NM_M,
  0.05 * NM_M,
  30,
  10,
  3,
]);
/**
 * Plausibility edge: a claimed EPU bound more than this many times
 * the claimed containment radius is incoherent. Above the ~2.7x
 * Gaussian / ~2.3x Rayleigh quantile ratios, with margin for
 * estimator conservatism and category coarseness.
 */
export const QUALITY_CONSISTENCY_MAX_RATIO = 4;
/** Corroboration window: incoherent reports this close count as one sky event. */
export const QUALITY_CONSISTENCY_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must misreport inside one window to corroborate. */
export const QUALITY_CONSISTENCY_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: one fix's NIC and NACp claims contradict each other. */
export const QUALITY_CONSISTENCY_SIGNAL = 'quality-inconsistent';
/** Secondary, unvalidated reading of an incoherent quality pair. */
export const QUALITY_CONSISTENCY_INTERPRETATION = 'suspected-quality-misreport';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a quality field is a usable DO-260B category (integer 0-11). */
function isCategory(value) {
  return finite(value) && Number.isInteger(value) && value >= 0 && value <= 11;
}

/** Hex to stamp on events: the fix's own hex, else the caller's. */
function eventHex(fix, fallbackHex) {
  if (typeof fix?.hex === 'string') return fix.hex;
  if (typeof fallbackHex === 'string') return fallbackHex;
  return null;
}

/**
 * NIC/NACp claim-consistency verdict over one ADS-B fix.
 *
 * Judged when both fields are present, in range, and claim something
 * (NIC > 0 and NACp > 0). A fix that cannot be judged yields no
 * verdict (`judged: false`) with the reason recorded, so callers can
 * tell "coherent claims" apart from "could not judge".
 *
 * @param {{nic?: number, nacp?: number}} fix - One fix's quality
 *   fields (positions, velocity, altitude, and ground state ignored).
 * @param {{maxRatio?: number}} [options] - Plausibility edge.
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: string|null, reason: string|null, nic: number|null,
 *   nacp: number|null, containmentRadiusM: number|null,
 *   epuBoundM: number|null, ratio: number|null}} The verdict.
 * @throws {TypeError} When `fix` is null or not an object.
 */
export function qualityConsistencyCheck(
  fix,
  { maxRatio = QUALITY_CONSISTENCY_MAX_RATIO } = {},
) {
  if (fix === null || typeof fix !== 'object') {
    throw new TypeError('qualityConsistencyCheck requires a fix object');
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    nic: null,
    nacp: null,
    containmentRadiusM: null,
    epuBoundM: null,
    ratio: null,
  };
  if (!isCategory(fix.nic) || !isCategory(fix.nacp)) {
    if (
      (fix.nic !== undefined && fix.nic !== null && !isCategory(fix.nic)) ||
      (fix.nacp !== undefined && fix.nacp !== null && !isCategory(fix.nacp))
    ) {
      return { ...base, reason: 'invalid-quality' };
    }
    return { ...base, reason: 'missing-quality' };
  }
  const nic = fix.nic;
  const nacp = fix.nacp;
  if (nic === 0) {
    return { ...base, nic, nacp, reason: 'unknown-containment' };
  }
  if (nacp === 0) {
    return { ...base, nic, nacp, reason: 'unknown-accuracy' };
  }
  const containmentRadiusM = NIC_CONTAINMENT_RADIUS_M[nic];
  const epuBoundM = NACP_EPU_M[nacp];
  const ratio = epuBoundM / containmentRadiusM;
  const anomalous = ratio > maxRatio;
  return {
    ...base,
    judged: true,
    anomalous,
    signals: anomalous ? [QUALITY_CONSISTENCY_SIGNAL] : [],
    interpretation: anomalous ? QUALITY_CONSISTENCY_INTERPRETATION : null,
    nic,
    nacp,
    containmentRadiusM,
    epuBoundM,
    ratio,
  };
}

/**
 * Detect quality-inconsistency events across fixes. One event per
 * incoherent fix, in input order: each fix is judged on its own
 * fields, so one bad fix yields one event, never a cluster.
 *
 * @param {{nic?: number, nacp?: number, hex?: string, atMs?: number}[]}
 *   fixes - Fixes (any order; unjudgeable fixes are skipped).
 * @param {{maxRatio?: number, hex?: string}} [options] - Plausibility
 *   edge, and hex to stamp on events when the fixes do not carry one.
 * @returns {{hex: string|null, atMs: number|null, nic: number,
 *   nacp: number, containmentRadiusM: number, epuBoundM: number,
 *   ratio: number, signal: string, interpretation: string}[]}
 *   Inconsistency events, in input order.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectQualityConsistencyEvents(
  fixes,
  { maxRatio = QUALITY_CONSISTENCY_MAX_RATIO, hex = null } = {},
) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectQualityConsistencyEvents requires an array');
  }
  const events = [];
  for (const fix of fixes) {
    if (fix === null || typeof fix !== 'object') continue;
    let verdict;
    try {
      verdict = qualityConsistencyCheck(fix, { maxRatio });
    } catch {
      continue;
    }
    if (!verdict.anomalous) continue;
    events.push({
      hex: eventHex(fix, hex),
      atMs: finite(fix.atMs) ? fix.atMs : null,
      nic: verdict.nic,
      nacp: verdict.nacp,
      containmentRadiusM: verdict.containmentRadiusM,
      epuBoundM: verdict.epuBoundM,
      ratio: verdict.ratio,
      signal: QUALITY_CONSISTENCY_SIGNAL,
      interpretation: QUALITY_CONSISTENCY_INTERPRETATION,
    });
  }
  return events;
}

/**
 * Summarize quality-inconsistency events across aircraft.
 * Corroboration is the sky-event test: at least `minAircraft`
 * DISTINCT aircraft misreporting inside one sliding `windowMs`
 * window. Two events from one aircraft never corroborate each other.
 * Events without a finite timestamp are malformed and ignored.
 *
 * @param {{hex?: string|null, atMs?: number}[]} events - Inconsistency
 *   events.
 * @param {{windowMs?: number, minAircraft?: number}} [options] -
 *   Corroboration window and distinct-aircraft bar.
 * @returns {{count: number, aircraftCount: number, corroborated: boolean,
 *   windowMs: number, firstAtMs: number|null, lastAtMs: number|null,
 *   interpretation: string|null}} The summary.
 */
export function summarizeQualityConsistencyEvents(
  events,
  {
    windowMs = QUALITY_CONSISTENCY_CORROBORATION_WINDOW_MS,
    minAircraft = QUALITY_CONSISTENCY_CORROBORATION_MIN_AIRCRAFT,
  } = {},
) {
  const usable = (Array.isArray(events) ? events : []).filter((event) =>
    finite(event?.atMs),
  );
  const ordered = [...usable].sort((a, b) => a.atMs - b.atMs);
  const aircraft = new Set(
    ordered.map((event) => event?.hex).filter((hex) => typeof hex === 'string'),
  );
  let corroborated = false;
  for (let start = 0; start < ordered.length && !corroborated; start += 1) {
    const windowAircraft = new Set();
    for (let i = start; i < ordered.length; i += 1) {
      if (ordered[i].atMs - ordered[start].atMs > windowMs) break;
      if (typeof ordered[i]?.hex === 'string') {
        windowAircraft.add(ordered[i].hex);
      }
      if (windowAircraft.size >= minAircraft) {
        corroborated = true;
        break;
      }
    }
  }
  return {
    count: ordered.length,
    aircraftCount: aircraft.size,
    corroborated,
    windowMs,
    firstAtMs: ordered.length ? ordered[0].atMs : null,
    lastAtMs: ordered.length ? ordered[ordered.length - 1].atMs : null,
    interpretation: ordered.length ? QUALITY_CONSISTENCY_INTERPRETATION : null,
  };
}
