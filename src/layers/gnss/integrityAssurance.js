/**
 * SIL/SDA integrity-assurance consistency: a cross-check between the
 * integrity claim, the design-assurance claim, and the containment
 * claim on ONE ADS-B fix.
 *
 * Each ADS-B fix carries three statements about the trustworthiness of
 * its own position:
 * - NIC (Navigation Integrity Category) bounds the integrity
 *   containment radius Rc: the true position lies within Rc of the
 *   reported position with near-certainty.
 * - SIL (Source Integrity Level) grades that near-certainty: the
 *   probability that the true position lies OUTSIDE Rc WITHOUT
 *   alerting. 0 = unknown (or worse than 1e-3), 1 = at most 1e-3,
 *   2 = at most 1e-5, 3 = at most 1e-7 per flight hour.
 * - SDA (System Design Assurance) grades the position source itself:
 *   the probability of a system failure causing misleading
 *   information. 0 = unknown / no assurance, 1 = at most 1e-3
 *   (minor), 2 = at most 1e-5 (major), 3 = at most 1e-7 (hazardous)
 *   per flight hour.
 *
 * The three claims must cohere, and two pairings cannot:
 * - SIL > 0 with NIC 0: NIC 0 means the containment radius is
 *   UNKNOWN, so a bounded probability of exceeding it is vacuous —
 *   "the chance of being outside an unknown radius is at most 1e-7"
 *   claims a number over a quantity that was never stated.
 * - SIL 3 with SDA < 2: DO-260B permits the 1e-7 integrity claim
 *   only with major-or-better design assurance (SDA 2 or 3). A
 *   transmitter that claims 1e-7 integrity from a system whose
 *   failure modes are assured only to 1e-3 — or not at all — claims
 *   more integrity than its own design assurance supports.
 *
 * A third pairing is not a spec violation but has no basis, so it is
 * a lower-severity warning rather than incoherence:
 * - SIL 1 or 2 with SDA 0: a quantified integrity failure rate from
 *   a system whose failure modes are uncharacterized. The SIL number
 *   has no assurance behind it. (SIL 3 with SDA 0 is already caught
 *   by the pairing rule above, so this warning covers SIL 1–2 only
 *   and never double-fires.)
 *
 * What no prior check sees:
 * - The cell classifier (`records.js`) reads NIC and NACp on one fix
 *   but never reads SIL or SDA. A fix reporting NIC 11, NACp 11,
 *   SIL 3, SDA 0 passes every NIC/NACp threshold and looks like the
 *   most trustworthy report in the sky — maximum integrity claimed,
 *   zero design assurance behind it — while only this check notices
 *   the SIL 3 claim has no SDA basis.
 * - The NIC/NACp claim-consistency check compares the two quality
 *   fields against each other, never against SIL/SDA. A pair that
 *   coheres (tight NIC with tighter NACp) can still carry an
 *   incoherent integrity claim, and vice versa: the two checks are
 *   orthogonal, one per pair of fields.
 * - The quality-drop check compares an aircraft's quality fields
 *   against its OWN earlier fields (a temporal drop). This check
 *   compares fields on the SAME fix against each other, so a
 *   transponder misconfigured since power-on — no drop, no change,
 *   wrong from the first report — passes the drop check and fails
 *   here.
 * - The position-based checks (teleport, velocity, acceleration,
 *   altitude, update-rate, cluster) never read the quality fields
 *   at all.
 *
 * What this is NOT:
 * - Not a quality-drop check. No history is read; a lone fix is
 *   judged on its own fields.
 * - Not a verdict on the positions. An incoherent triple says the
 *   REPORT is mis-set, not that the position is wrong: the position
 *   may be perfectly good while the integrity fields disagree about
 *   how trustworthy it is.
 * - Not a verdict on absence. SIL 0 (no integrity claim) with any
 *   NIC/SDA is coherent: declining to claim integrity is not
 *   incoherent, however weak the report. Likewise SDA 3 with
 *   SIL 0 is coherent: high design assurance with no quantified
 *   integrity claim.
 * - Not an on-ground exclusion. Ground state is irrelevant to
 *   whether three fields on one report cohere, so on-ground fixes
 *   are judged like any other — unlike the kinematic checks, where
 *   ground handling bends tracks for benign reasons.
 *
 * The event is a secondary, unvalidated signal — never a verdict.
 * Benign causes also produce incoherent triples:
 * - Transponder misconfiguration: SIL/SDA defaults left at the
 *   factory or installer setting (e.g. SIL 3 stamped on every
 *   report) while SDA was never set.
 * - Decoder mis-mapping: a decoder that maps the wrong bits into
 *   SIL or SDA manufactures incoherence the transmitter never sent.
 * - DO-260A transmitters: the SIL 3 / SDA pairing rule is DO-260B;
 *   a version-1 transmitter that predates the pairing rule can
 *   misfire under v2 rules. Version-aware gating is future work;
 *   `records.js` already restricts the layer to versions 1–2.
 * One aircraft misreporting is a receiver/transponder event until
 * corroborated: several aircraft incoherent in the same window is
 * the sky-event test (a shared decoder or feed mis-mapping).
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring
 * (carrying SIL/SDA through normalization, which currently keeps
 * only NIC/NACp — with TISB/MLAT-derived SIL already excluded the
 * same way) is a separate step.
 */

/** SIL value that claims a quantified integrity failure rate. */
const SIL_CLAIMED_MIN = 1;
/** Strongest SIL: the 1e-7 integrity claim. */
const SIL_MAX = 3;
/** Minimum SDA the DO-260B pairing rule requires beside SIL 3. */
const SDA_REQUIRED_FOR_SIL_MAX = 2;
/** SDA value that means unknown / no design assurance. */
const SDA_UNKNOWN = 0;
/** NIC value that means containment radius unknown. */
const NIC_UNKNOWN = 0;
/** Corroboration window: incoherent reports this close count as one sky event. */
export const INTEGRITY_ASSURANCE_CORROBORATION_WINDOW_MS = 300_000;
/** Distinct aircraft that must misreport inside one window to corroborate. */
export const INTEGRITY_ASSURANCE_CORROBORATION_MIN_AIRCRAFT = 2;
/** Observed fact: one fix's integrity fields contradict each other. */
export const INTEGRITY_ASSURANCE_SIGNAL = 'integrity-assurance-inconsistent';
/** Observed fact: one fix claims integrity with no assurance basis. */
export const INTEGRITY_UNASSURED_SIGNAL = 'integrity-unassured';
/** Secondary, unvalidated reading of an incoherent integrity triple. */
export const INTEGRITY_ASSURANCE_INTERPRETATION =
  'suspected-integrity-misreport';

/** Rule codes, stable for consumers that filter on them. */
export const INTEGRITY_ASSURANCE_REASONS = Object.freeze({
  /** SIL > 0 with NIC 0: integrity graded over an unknown radius. */
  UNKNOWN_CONTAINMENT: 'sil-over-unknown-containment',
  /** SIL 3 with SDA < 2: DO-260B pairing rule. */
  SIL3_WITHOUT_SDA: 'sil3-without-sda',
  /** SIL 1–2 with SDA 0: integrity number with no assurance basis. */
  UNASSURED: 'sil-without-assurance',
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a value is a usable DO-260B NIC category (integer 0–11). */
function isNic(value) {
  return finite(value) && Number.isInteger(value) && value >= 0 && value <= 11;
}

/** Whether a value is a usable DO-260B SIL/SDA level (integer 0–3). */
function isLevel(value) {
  return finite(value) && Number.isInteger(value) && value >= 0 && value <= 3;
}

/** Hex to stamp on events: the fix's own hex, else the caller's. */
function eventHex(fix, fallbackHex) {
  if (typeof fix?.hex === 'string') return fix.hex;
  if (typeof fallbackHex === 'string') return fallbackHex;
  return null;
}

/**
 * SIL/SDA integrity-assurance verdict over one ADS-B fix.
 *
 * Each rule is judged on the fields it needs, so a fix missing one
 * field can still be judged on the rules its remaining fields
 * support: the NIC rule needs NIC + SIL, the SDA rules need
 * SIL + SDA. A fix that supports no rule yields no verdict
 * (`judged: false`) with the reason recorded, so callers can tell
 * "coherent claims" apart from "could not judge". A fix with any
 * present-but-invalid field is not judged at all: an invalid field
 * means the fix's quality block cannot be trusted for any rule.
 *
 * @param {{nic?: number, sil?: number, sda?: number}} fix - One fix's
 *   integrity fields (positions, velocity, altitude, NACp, and
 *   ground state ignored).
 * @returns {{judged: boolean, anomalous: boolean, signals: string[],
 *   interpretation: string|null, reason: string|null,
 *   reasons: string[], severity: 'incoherent'|'unassured'|null,
 *   nic: number|null, sil: number|null, sda: number|null}} The verdict.
 * @throws {TypeError} When `fix` is null or not an object.
 */
export function integrityAssuranceCheck(fix) {
  if (fix === null || typeof fix !== 'object') {
    throw new TypeError('integrityAssuranceCheck requires a fix object');
  }
  const base = {
    judged: false,
    anomalous: false,
    signals: [],
    interpretation: null,
    reason: null,
    reasons: [],
    severity: null,
    nic: null,
    sil: null,
    sda: null,
  };
  const nicPresent = fix.nic !== undefined && fix.nic !== null;
  const silPresent = fix.sil !== undefined && fix.sil !== null;
  const sdaPresent = fix.sda !== undefined && fix.sda !== null;
  if (
    (nicPresent && !isNic(fix.nic)) ||
    (silPresent && !isLevel(fix.sil)) ||
    (sdaPresent && !isLevel(fix.sda))
  ) {
    return { ...base, reason: 'invalid-quality' };
  }
  // Every rule needs SIL: without it nothing is evaluable. The NIC
  // rule additionally needs NIC; the SDA rules need SDA.
  if (!silPresent || (!nicPresent && !sdaPresent)) {
    return { ...base, reason: 'missing-quality' };
  }
  const nic = nicPresent ? fix.nic : null;
  const sil = fix.sil;
  const sda = sdaPresent ? fix.sda : null;
  const reasons = [];
  if (nic === NIC_UNKNOWN && sil >= SIL_CLAIMED_MIN) {
    reasons.push(INTEGRITY_ASSURANCE_REASONS.UNKNOWN_CONTAINMENT);
  }
  if (sda !== null && sil === SIL_MAX && sda < SDA_REQUIRED_FOR_SIL_MAX) {
    reasons.push(INTEGRITY_ASSURANCE_REASONS.SIL3_WITHOUT_SDA);
  }
  if (sda === SDA_UNKNOWN && sil >= SIL_CLAIMED_MIN && sil < SIL_MAX) {
    reasons.push(INTEGRITY_ASSURANCE_REASONS.UNASSURED);
  }
  const incoherent = reasons.some(
    (reason) => reason !== INTEGRITY_ASSURANCE_REASONS.UNASSURED,
  );
  const signals = [];
  if (incoherent) signals.push(INTEGRITY_ASSURANCE_SIGNAL);
  if (reasons.includes(INTEGRITY_ASSURANCE_REASONS.UNASSURED)) {
    signals.push(INTEGRITY_UNASSURED_SIGNAL);
  }
  const anomalous = reasons.length > 0;
  return {
    ...base,
    judged: true,
    anomalous,
    signals,
    interpretation: anomalous ? INTEGRITY_ASSURANCE_INTERPRETATION : null,
    reason: anomalous ? reasons[0] : null,
    reasons,
    severity: anomalous ? (incoherent ? 'incoherent' : 'unassured') : null,
    nic,
    sil,
    sda,
  };
}

/**
 * Detect integrity-assurance events across fixes. One event per
 * incoherent/unassured fix, in input order: each fix is judged on
 * its own fields, so one bad fix yields one event, never a cluster.
 *
 * @param {{nic?: number, sil?: number, sda?: number, hex?: string,
 *   atMs?: number}[]} fixes - Fixes (any order; unjudgeable fixes
 *   are skipped).
 * @param {{hex?: string}} [options] - Hex to stamp on events when
 *   the fixes do not carry one.
 * @returns {{hex: string|null, atMs: number|null, nic: number|null,
 *   sil: number, sda: number|null, reasons: string[],
 *   severity: 'incoherent'|'unassured', signal: string,
 *   interpretation: string}[]} Integrity events, in input order.
 * @throws {TypeError} When `fixes` is not an array.
 */
export function detectIntegrityAssuranceEvents(fixes, { hex = null } = {}) {
  if (!Array.isArray(fixes)) {
    throw new TypeError('detectIntegrityAssuranceEvents requires an array');
  }
  const events = [];
  for (const fix of fixes) {
    if (fix === null || typeof fix !== 'object') continue;
    let verdict;
    try {
      verdict = integrityAssuranceCheck(fix);
    } catch {
      continue;
    }
    if (!verdict.anomalous) continue;
    events.push({
      hex: eventHex(fix, hex),
      atMs: finite(fix.atMs) ? fix.atMs : null,
      nic: verdict.nic,
      sil: verdict.sil,
      sda: verdict.sda,
      reasons: verdict.reasons,
      severity: verdict.severity,
      signal: verdict.signals[0],
      interpretation: INTEGRITY_ASSURANCE_INTERPRETATION,
    });
  }
  return events;
}

/**
 * Summarize integrity-assurance events across aircraft.
 * Corroboration is the sky-event test: at least `minAircraft`
 * DISTINCT aircraft misreporting inside one sliding `windowMs`
 * window. Two events from one aircraft never corroborate each other.
 * Events without a finite timestamp are malformed and ignored.
 *
 * @param {{hex?: string|null, atMs?: number}[]} events - Integrity
 *   events.
 * @param {{windowMs?: number, minAircraft?: number}} [options] -
 *   Corroboration window and distinct-aircraft bar.
 * @returns {{count: number, aircraftCount: number, corroborated: boolean,
 *   windowMs: number, firstAtMs: number|null, lastAtMs: number|null,
 *   interpretation: string|null}} The summary.
 */
export function summarizeIntegrityAssuranceEvents(
  events,
  {
    windowMs = INTEGRITY_ASSURANCE_CORROBORATION_WINDOW_MS,
    minAircraft = INTEGRITY_ASSURANCE_CORROBORATION_MIN_AIRCRAFT,
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
    interpretation: ordered.length ? INTEGRITY_ASSURANCE_INTERPRETATION : null,
  };
}
