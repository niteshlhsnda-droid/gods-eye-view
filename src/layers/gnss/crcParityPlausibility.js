/**
 * Mode-S 24-bit CRC parity / address-parity plausibility (decoder envelope check).
 *
 * Every plausibility check in this layer judges *values inside* decoded
 * messages — altitudes, velocities, ICAO duplicates, emitter categories —
 * but all of them silently assume the message envelope itself survived the
 * RF channel intact. `rawAltitudePlausibility.js` states that assumption
 * outright ("CRC-validated input assumed"). This module supplies the
 * missing check: the 24-bit parity field at the tail of a Mode-S message
 * is verifiable from the message bits alone, with no feed, no track
 * history, and no external reference.
 *
 * The rule (ICAO Annex 10, Volume IV, §3.1.2.3.2 — the 24-bit CRC with
 * generator polynomial 0x1FFF409 over the message as received):
 *
 * - Extended squitters (DF 17 / DF 18, 112-bit): the transmitted parity is
 *   the plain CRC remainder of the first 88 bits, so the remainder over
 *   the full 112-bit message must be ZERO for an intact message. The
 *   ICAO24 address rides in bits 9–32 of the message itself and is NOT
 *   overlaid on the parity — verified computationally against the
 *   published pyModeS test suite (see below): four valid DF 17 messages
 *   all yield residue 0, a corrupted one yields non-zero.
 * - Address/parity replies (DF 0/4/5/16/20/21/24): these carry no address
 *   field, so the transmitted parity is CRC ⊕ the 24-bit ICAO24 address
 *   and the remainder over the received message IS the address. A valid
 *   reply's residue equals the claimed ICAO24; dump1090-family decoders
 *   use exactly this to attribute short replies and to recover addresses
 *   by brute force. Verified against pyModeS's DF 20/21 vectors (residues
 *   10719924, 4805588, 5659991, 11727682 — the documented ICAO24s).
 *
 * RESEARCH NOTE — the brief's "CPR parity/PI-field" framing is kept, but
 * two of its sibling options were rejected on research:
 * - The "decoder-level Gillham bit-transition check" is NOT an open
 *   Cycle-18 follow-up: the Cycle-17 Gillham follow-up was closed by
 *   `rawAltitudePlausibility` (branch idea/gnss-20261018-1900), which
 *   already judges Gillham legality at the raw-bit level. A transition
 *   variant would re-skin it.
 * - "NIC/NACv cross-consistency" is physically unsound: NIC is an
 *   integrity containment radius while NACv is a 95% velocity-accuracy
 *   bound — different quantities with no definable contradiction.
 *   NACp-vs-NIC (qualityConsistency) and NACv-vs-derived-velocity
 *   (velocityAccuracy) already landed; there is nothing left to
 *   cross-check between NIC and NACv.
 *
 * Out of scope (judged `unjudgeable`, never a mismatch):
 * - DF 11 (all-call reply): its PI field overlays the interrogator
 *   identifier code, which this module has no input for.
 * - DF 19 (military extended squitter): same 112-bit envelope, but no
 *   verified test vector was available, so the construction is not
 *   asserted.
 * - Any other DF: undefined or outside the parity audit.
 *
 * The signals are observed facts, never a spoofing verdict — the benign
 * causes dominate: RF noise flipping bits after (or before) the
 * receiver's own CRC gate, a decoder slicing the wrong bit window, or an
 * aggregator synthesizing "messages" from track state with a guessed
 * envelope. Per-message verdicts never carry `interpretation` (line
 * rule); only `summarizeCrcParity` may attach one, and only when
 * mismatches are corroborated across ≥2 distinct aircraft in a short
 * window — which points at the receiver/decoder or wideband RF
 * impairment, not at any single airframe. A competent fabricator
 * computes correct CRCs, so a CRC failure argues *against* competent
 * spoofing and *for* corruption; the summary interpretation is named
 * accordingly.
 *
 * Pure module, zero imports. Standalone: no feed wiring, no
 * normalization changes. Wiring (carrying raw message hex through
 * normalization) is a separate step.
 */

/** Observed fact: the 24-bit parity envelope is self-consistent. */
export const CRC_SIGNAL_OK = 'crc-ok';
/** Observed fact: the parity residue contradicts the expected value. */
export const CRC_SIGNAL_MISMATCH = 'crc-mismatch';
/**
 * Observed fact: the input is not a well-formed Mode-S message (bad hex,
 * wrong length, or the DF contradicts the message length).
 */
export const CRC_SIGNAL_MALFORMED = 'malformed-message';
/**
 * Observed fact: the DF's parity construction needs an input this module
 * does not model (DF 11 interrogator overlay, DF 19 unverified, unknown
 * DFs, or an address/parity reply with no claimed address supplied).
 */
export const CRC_SIGNAL_UNJUDGEABLE = 'unjudgeable';
/**
 * Observed fact: the message envelope is intact but the ICAO24 embedded
 * in bits 9–32 is not the ICAO24 the caller attributed the message to —
 * the message was filed against the wrong track.
 */
export const CRC_SIGNAL_ATTRIBUTION_MISMATCH = 'attribution-mismatch';

/**
 * Corroborated-summary interpretation (only): mismatches on ≥2 distinct
 * aircraft inside the window implicate the receiver/decoder or the RF
 * path, not any one airframe.
 */
export const CRC_CORROBORATED_INTERPRETATION = 'suspected-rf-or-decoder-fault';

/** Mode-S CRC-24 generator polynomial (the x^24 term is implicit). */
export const CRC24_GENERATOR_POLY = 0x1fff409;
/** Mask for a 24-bit ICAO24 address. */
export const ICAO24_MASK = 0xffffff;

/**
 * Extended-squitter DFs judged by the residue-zero rule (112-bit).
 * DF 19 is deliberately absent — same envelope shape, but no verified
 * test vector, so the construction is not asserted (see header).
 */
export const CRC_SQUITTER_DFS = Object.freeze([17, 18]);
/**
 * Address/parity reply DFs judged by the residue-equals-claimed-address
 * rule. DF 0/4/5/16 are 56-bit short replies; DF 20/21/24 are 112-bit
 * long replies — none carries an address field, so the transmitted parity
 * is CRC ⊕ the 24-bit ICAO24 address and the remainder over the received
 * message IS the address.
 */
export const CRC_SHORT_REPLY_DFS = Object.freeze([0, 4, 5, 16]);
export const CRC_LONG_REPLY_DFS = Object.freeze([20, 21, 24]);
/** Bit position (0-indexed) of the DF field: bits 0–4. */
const DF_FIELD_END = 5;
/** Bit positions (0-indexed) of the ICAO24 address field in DF 17/18. */
const ADDRESS_FIELD_START = 8;
const ADDRESS_FIELD_END = 32;
/** Bits of a short (56-bit) and long (112-bit) Mode-S message. */
const SHORT_MESSAGE_BITS = 56;
const LONG_MESSAGE_BITS = 112;

/**
 * Parse a hex message into an array of 0/1 bits (MSB first).
 *
 * @param {unknown} hex
 * @returns {number[]|null} Bit array, or null when the input is not a
 *   well-formed even-length hex string.
 */
export function hexToBitArray(hex) {
  if (typeof hex !== 'string') return null;
  const clean =
    hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
  const bits = new Array(clean.length * 4);
  let i = 0;
  for (const char of clean) {
    const value = parseInt(char, 16);
    bits[i++] = (value >> 3) & 1;
    bits[i++] = (value >> 2) & 1;
    bits[i++] = (value >> 1) & 1;
    bits[i++] = value & 1;
  }
  return bits;
}

/**
 * Read an unsigned integer out of a bit array.
 *
 * @param {number[]} bits
 * @param {number} start 0-indexed start bit (inclusive).
 * @param {number} end 0-indexed end bit (exclusive).
 * @returns {number}
 */
function readBits(bits, start, end) {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 2 + bits[i];
  return value;
}

/**
 * Mode-S CRC-24 remainder over a full message *as received* (parity field
 * included), MSB-first binary long division with generator 0x1FFF409.
 *
 * For an intact extended squitter the result is 0; for an intact
 * address/parity reply it is the 24-bit ICAO24 address the parity was
 * overlaid with.
 *
 * @param {number[]} bits Full message bits, MSB first.
 * @returns {number} 24-bit residue.
 */
export function crc24Residue(bits) {
  let remainder = 0;
  for (const bit of bits) {
    const top = (remainder >> 23) & 1;
    remainder = ((remainder << 1) | bit) & 0x1ffffff;
    if (top) remainder ^= CRC24_GENERATOR_POLY;
  }
  return remainder & ICAO24_MASK;
}

/**
 * Validate a claimed ICAO24 address input.
 *
 * @param {unknown} value
 * @returns {number|null} The address, or null when it is not a 24-bit
 *   integer.
 */
function validClaimedAddress(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > ICAO24_MASK) return null;
  return value;
}

/**
 * Judge one raw Mode-S message's parity envelope.
 *
 * @param {{hex?: unknown, claimedIcao24?: unknown}} [input]
 * @returns {Readonly<{judged: boolean, plausible: boolean, signals: string[], df: number|null, bitLength: number|null, residue: number|null, expectedResidue: number|null, embeddedIcao24: number|null, recoveredAddress: number|null, claimedIcao24: number|null, interpretation: null, reason: string|null}>}
 *   Per-message verdict. `plausible` is strictly about the parity
 *   envelope. `interpretation` is always null here — see
 *   `summarizeCrcParity` for the corroborated reading.
 */
export function checkCrcParity(input = {}) {
  const base = {
    judged: false,
    plausible: false,
    signals: [],
    df: null,
    bitLength: null,
    residue: null,
    expectedResidue: null,
    embeddedIcao24: null,
    recoveredAddress: null,
    claimedIcao24: null,
    interpretation: null,
    reason: null,
  };
  const bits = hexToBitArray(input?.hex);
  if (!bits) {
    return {
      ...base,
      signals: [CRC_SIGNAL_MALFORMED],
      reason: 'not-hex',
    };
  }
  const bitLength = bits.length;
  const df = readBits(bits, 0, DF_FIELD_END);
  const claimed = validClaimedAddress(input?.claimedIcao24);
  if (input?.claimedIcao24 !== undefined && claimed === null) {
    return {
      ...base,
      df,
      bitLength,
      signals: [CRC_SIGNAL_MALFORMED],
      reason: 'bad-claimed-address',
    };
  }
  const verdict = { ...base, df, bitLength, claimedIcao24: claimed };

  const expectsLongSquitter = CRC_SQUITTER_DFS.includes(df);
  const expectsShortReply = CRC_SHORT_REPLY_DFS.includes(df);
  const expectsLongReply = CRC_LONG_REPLY_DFS.includes(df);
  const expectedBits = expectsShortReply
    ? SHORT_MESSAGE_BITS
    : expectsLongSquitter || expectsLongReply
      ? LONG_MESSAGE_BITS
      : null;
  if (expectedBits !== null && bitLength !== expectedBits) {
    return {
      ...verdict,
      signals: [CRC_SIGNAL_MALFORMED],
      reason: 'length-df-mismatch',
    };
  }

  if (expectsLongSquitter) {
    const residue = crc24Residue(bits);
    const embedded = readBits(bits, ADDRESS_FIELD_START, ADDRESS_FIELD_END);
    const ok = residue === 0;
    const signals = ok ? [CRC_SIGNAL_OK] : [CRC_SIGNAL_MISMATCH];
    if (ok && claimed !== null && claimed !== embedded) {
      signals.push(CRC_SIGNAL_ATTRIBUTION_MISMATCH);
    }
    return {
      ...verdict,
      judged: true,
      plausible: ok,
      signals,
      residue,
      expectedResidue: 0,
      embeddedIcao24: embedded,
      reason: ok ? null : 'parity-residue-nonzero',
    };
  }

  if (expectsShortReply || expectsLongReply) {
    const residue = crc24Residue(bits);
    if (claimed === null) {
      // The residue IS the address for these formats — report it as the
      // observed fact even though there is nothing to judge it against.
      return {
        ...verdict,
        judged: false,
        signals: [CRC_SIGNAL_UNJUDGEABLE],
        residue,
        expectedResidue: null,
        recoveredAddress: residue,
        reason: 'needs-claimed-address',
      };
    }
    const ok = residue === claimed;
    return {
      ...verdict,
      judged: true,
      plausible: ok,
      signals: ok ? [CRC_SIGNAL_OK] : [CRC_SIGNAL_MISMATCH],
      residue,
      expectedResidue: claimed,
      recoveredAddress: residue,
      reason: ok ? null : 'residue-not-claimed-address',
    };
  }

  return {
    ...verdict,
    judged: false,
    signals: [CRC_SIGNAL_UNJUDGEABLE],
    reason: df === 11 ? 'df11-interrogator-overlay' : 'df-out-of-scope',
  };
}

/**
 * Summarize a batch of per-message CRC verdicts. `interpretation` is
 * `suspected-rf-or-decoder-fault` only when parity mismatches are
 * corroborated across at least two distinct aircraft inside the window;
 * a lone mismatch is reported as the observed fact only.
 *
 * @param {{hex?: unknown, claimedIcao24?: unknown, atMs?: unknown}[]} [messages]
 * @param {{windowMs?: number, minAircraft?: number}} [options]
 * @returns {{total: number, judged: number, ok: number, mismatch: number, malformed: number, unjudgeable: number, mismatchAircraft: number[], corroborated: boolean, interpretation: string|null}}
 */
export function summarizeCrcParity(messages = [], options = {}) {
  const { windowMs = 300000, minAircraft = 2 } = options ?? {};
  const summary = {
    total: 0,
    judged: 0,
    ok: 0,
    mismatch: 0,
    malformed: 0,
    unjudgeable: 0,
    mismatchAircraft: [],
    corroborated: false,
    interpretation: null,
  };
  // aircraft key -> sorted atMs list of its mismatches
  const mismatchTimes = new Map();
  const keyOf = (verdict) => {
    const key = verdict.embeddedIcao24 ?? verdict.claimedIcao24;
    return key === null ? 'unknown' : `icao24:${key.toString(16)}`;
  };
  for (const message of messages ?? []) {
    summary.total += 1;
    let verdict;
    try {
      verdict = checkCrcParity(message);
    } catch {
      summary.malformed += 1;
      continue;
    }
    if (verdict.signals.includes(CRC_SIGNAL_MALFORMED)) {
      summary.malformed += 1;
      continue;
    }
    if (!verdict.judged) {
      summary.unjudgeable += 1;
      continue;
    }
    summary.judged += 1;
    if (verdict.plausible) {
      summary.ok += 1;
      continue;
    }
    summary.mismatch += 1;
    const atMs =
      typeof message?.atMs === 'number' && Number.isFinite(message.atMs)
        ? message.atMs
        : null;
    const key = keyOf(verdict);
    if (!mismatchTimes.has(key)) mismatchTimes.set(key, []);
    mismatchTimes.get(key).push(atMs);
  }
  const aircraft = [...mismatchTimes.keys()].filter((k) => k !== 'unknown');
  summary.mismatchAircraft = aircraft.map((k) =>
    parseInt(k.slice('icao24:'.length), 16),
  );
  if (aircraft.length >= minAircraft) {
    // Corroborated when two distinct aircraft mismatch inside one window.
    // Entries without timestamps are treated as simultaneous (a batch
    // handed together is implicitly one window).
    const events = [];
    for (const key of aircraft) {
      for (const atMs of mismatchTimes.get(key)) {
        events.push({ atMs: atMs ?? 0, key });
      }
    }
    events.sort((a, b) => a.atMs - b.atMs);
    let start = 0;
    for (let end = 0; end < events.length; end++) {
      while (events[end].atMs - events[start].atMs > windowMs) start++;
      const inWindow = new Set();
      for (let i = start; i <= end; i++) inWindow.add(events[i].key);
      if (inWindow.size >= minAircraft) {
        summary.corroborated = true;
        break;
      }
    }
  }
  if (summary.corroborated) {
    summary.interpretation = CRC_CORROBORATED_INTERPRETATION;
  }
  return summary;
}
