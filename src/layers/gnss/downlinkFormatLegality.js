/**
 * Mode-S downlink-format / type-code legality audit (DO-260B scope).
 *
 * A raw decoded Mode-S message hands a decoder two small integers — the
 * 5-bit downlink format (DF, message bits 1–5) and, for the extended
 * squitters, the 5-bit type code (TC, bits 33–37) that names the ADS-B
 * message type. This module judges whether that pair could have come out
 * of a real transponder at all, purely as classification: observed facts,
 * never a spoofing verdict, no feed wiring.
 *
 * What no prior check sees: the decoders (e.g. src/sdr/adsbDecoder.js)
 * parse DF 17/18 messages and trust the DF/TC they were handed. The
 * plausibility checks judge *values inside* decoded messages — altitude
 * encodings, velocities, ICAO duplicates, emitter categories — but never
 * the envelope: a feed that reports DF 20 with a "type code", or a
 * DF 17 carrying a TC no DO-260B table assigns, sails through every one
 * of them. Those envelopes are exactly what bit-flips in a noisy RF
 * capture, a decoder slicing the wrong bit window, or a fabricator
 * inventing messages gets wrong first.
 *
 * The rules (RTCA DO-260B, ADS-B version 2):
 *
 * In-scope downlink formats — the surveillance and extended-squitter
 * formats a ground feed can legitimately see:
 * - DF 4 / 5: short surveillance replies (altitude / identity), 56-bit.
 * - DF 11: all-call reply, 56-bit.
 * - DF 17: extended squitter (ADS-B), 112-bit, TC in bits 33–37.
 * - DF 18: extended squitter, non-transponder (TIS-B / ADS-R / ground
 *   equipment rebroadcasts use the same TC table), 112-bit, TC in
 *   bits 33–37.
 * - DF 19: military extended squitter, 112-bit, TC field in bits 33–37
 *   per the MOPS (judged against the same table; non-standard military
 *   TC assignments are not modeled).
 * - DF 20 / 21: Comm-B roll-call replies (altitude / identity), 112-bit.
 *   These are *replies to interrogations*, and bits 33–88 are the MB
 *   Comm-B data field — the first five of those bits are NOT a type code.
 * - DF 24: Comm-D extended-length message, 112-bit; bits 33–88 are the
 *   MD Comm-D message — NOT a type code.
 *
 * DF 0 and DF 16 (short/long air-air surveillance, ACAS) are defined
 * Mode-S formats but outside this audit's scope; every other DF value is
 * undefined. DF 4/5/11 are 56-bit formats: bits 33–37 do not exist there
 * at all, so a "type code" attached to them is a decoding error, as is
 * one attached to DF 20/21/24, where those bits belong to MB/MD data.
 *
 * Type codes for DF 17/18/19 (DO-260B ADS-B message types):
 * - 1–4: aircraft identification and category
 * - 5–8: surface position
 * - 9–18: airborne position (barometric altitude)
 * - 19: airborne velocities
 * - 20–22: airborne position (GNSS height)
 * - 28: aircraft status (emergency/priority status, ACAS RA broadcast)
 * - 29: target state and status information
 * - 31: aircraft operational status
 * - 0: unassigned (no type code); 23: test-message slot; 24–27, 30:
 *   reserved. None of these is a legal operational ADS-B message type.
 *
 * RESEARCH NOTE — the reserved set above was verified against the
 * published DO-260B tables and DIFFERS from the task brief's example
 * list (0/23/28/29/30/31): TC 28, 29 and 31 are ASSIGNED under DO-260B
 * (version-2 messages; see mode-s.org "The 1090MHz Riddle" ADS-B v2
 * transmission table, RTCA SC-186 working papers on TC 28/29/31
 * scheduling, and the EASA CS-ACNS BDS-register/type-code mapping).
 * Flagging 28/29/31 as reserved would false-positive on the most
 * safety-critical squitters in the sky — TC 28 subtype 1 is the
 * emergency/priority status message. TC 24–27 are reserved per the
 * EASA-adapted table (the "surface system status" label belongs to a
 * later revision's TC 24 slot, not DO-260B's). TC 23 is kept in the
 * reserved set: some tables mark the slot for test use, but a compliant
 * operational transponder never emits it.
 *
 * The signals are secondary, unvalidated facts — never a verdict. Benign
 * causes also produce illegal pairs:
 * - RF noise flipping bits in DF or TC before the CRC check (a corrupt
 *   message that still passes CRC is rare but possible).
 * - A decoder slicing bits 33–37 out of a DF 20/21/24 message and
 *   labeling the slice a type code.
 * - Test equipment or a misconfigured transponder emitting reserved TCs.
 * - Aggregators synthesizing "messages" from track state and guessing
 *   the envelope wrong.
 *
 * Pure module, no imports. Standalone: no feed wiring. Wiring (carrying
 * decoded DF/TC pairs through normalization) is a separate step.
 */

/** Observed fact: the downlink format is undefined or outside our scope. */
export const DF_TC_SIGNAL_UNKNOWN_DF = 'unknown-df';
/** Observed fact: the type code is reserved under DO-260B. */
export const DF_TC_SIGNAL_RESERVED_TC = 'reserved-tc';
/**
 * Observed fact: a type code was supplied for a DF that carries no
 * type-code field (DF 4/5/11 have no bits 33–37; DF 20/21/24 use those
 * bits for MB/MD data).
 */
export const DF_TC_SIGNAL_ILLEGAL_DF_TC_COMBO = 'illegal-df-tc-combo';

/** Downlink formats this audit covers. */
export const DF_TC_SCOPE_DFS = Object.freeze([
  4, 5, 11, 17, 18, 19, 20, 21, 24,
]);
/** Downlink formats whose bits 33–37 are a type-code field. */
export const DF_TC_TYPE_CODE_DFS = Object.freeze([17, 18, 19]);
/**
 * Type codes that are not assigned ADS-B message types under DO-260B:
 * 0 (no type code), 23 (test-message slot), 24–27 and 30 (reserved).
 * TC 28/29/31 are deliberately NOT here — they are assigned version-2
 * messages (aircraft status, target state and status, operational
 * status); see the research note above.
 */
export const DF_TC_RESERVED_TYPE_CODES = Object.freeze([
  0, 23, 24, 25, 26, 27, 30,
]);
/** Defined Mode-S downlink formats outside this audit's scope. */
export const DF_TC_OUT_OF_SCOPE_DFS = Object.freeze([0, 16]);

/** DO-260B ADS-B message name per type code, or the reserved label. */
const TYPE_CODE_NAMES = Object.freeze([
  'unassigned (no type code)', // 0
  'aircraft identification and category', // 1
  'aircraft identification and category', // 2
  'aircraft identification and category', // 3
  'aircraft identification and category', // 4
  'surface position', // 5
  'surface position', // 6
  'surface position', // 7
  'surface position', // 8
  'airborne position (barometric altitude)', // 9
  'airborne position (barometric altitude)', // 10
  'airborne position (barometric altitude)', // 11
  'airborne position (barometric altitude)', // 12
  'airborne position (barometric altitude)', // 13
  'airborne position (barometric altitude)', // 14
  'airborne position (barometric altitude)', // 15
  'airborne position (barometric altitude)', // 16
  'airborne position (barometric altitude)', // 17
  'airborne position (barometric altitude)', // 18
  'airborne velocities', // 19
  'airborne position (GNSS height)', // 20
  'airborne position (GNSS height)', // 21
  'airborne position (GNSS height)', // 22
  'reserved (test-message slot)', // 23
  'reserved', // 24
  'reserved', // 25
  'reserved', // 26
  'reserved', // 27
  'aircraft status (emergency/priority, ACAS RA)', // 28
  'target state and status information', // 29
  'reserved', // 30
  'aircraft operational status', // 31
]);

const isDf = (value) => Number.isInteger(value) && value >= 0 && value <= 31;
const isTc = (value) =>
  value === null || (Number.isInteger(value) && value >= 0 && value <= 31);

/**
 * The DO-260B ADS-B message name for a type code.
 *
 * @param {number} tc - Type code 0–31.
 * @returns {string|null} The message name, or null for invalid input.
 */
export function describeTypeCode(tc) {
  if (!Number.isInteger(tc) || tc < 0 || tc > 31) return null;
  return TYPE_CODE_NAMES[tc];
}

/**
 * Classify one decoded downlink-format / type-code pair.
 *
 * A `null` type code means the decoder reported no TC (the normal state
 * for DF 4/5/11/20/21/24, which carry no type-code field). At most one
 * signal fires per pair: an unknown DF short-circuits before any TC
 * judgment, and reserved-TC vs. illegal-combo are mutually exclusive by
 * construction.
 *
 * @param {number} df - Downlink format, integer 0–31.
 * @param {number|null} [tc] - Type code, integer 0–31, or null when the
 *   decoder reported none.
 * @returns {{df: number, tc: number|null, legal: boolean, signals: string[],
 *   reason: string|null}|null} The classification, or null for invalid
 *   input (non-integer DF, DF outside 0–31, or a non-null TC that is not
 *   an integer 0–31). Facts only — no interpretation.
 */
export function classifyDownlinkFormatLegality(df, tc = null) {
  if (!isDf(df) || !isTc(tc)) return null;
  const verdict = { df, tc, legal: true, signals: [], reason: null };
  if (!DF_TC_SCOPE_DFS.includes(df)) {
    verdict.legal = false;
    verdict.signals.push(DF_TC_SIGNAL_UNKNOWN_DF);
    verdict.reason = DF_TC_OUT_OF_SCOPE_DFS.includes(df)
      ? 'out-of-scope-downlink-format'
      : 'undefined-downlink-format';
    return verdict;
  }
  if (DF_TC_TYPE_CODE_DFS.includes(df)) {
    if (tc !== null && DF_TC_RESERVED_TYPE_CODES.includes(tc)) {
      verdict.legal = false;
      verdict.signals.push(DF_TC_SIGNAL_RESERVED_TC);
      verdict.reason = 'reserved-type-code';
    }
    return verdict;
  }
  // DF 4/5/11/20/21/24: no type-code field exists (56-bit formats have no
  // bits 33–37; DF 20/21/24 use them for MB/MD data). A supplied TC is a
  // decoding error, never a real message.
  if (tc !== null) {
    verdict.legal = false;
    verdict.signals.push(DF_TC_SIGNAL_ILLEGAL_DF_TC_COMBO);
    verdict.reason = 'type-code-not-applicable';
  }
  return verdict;
}

/**
 * Audit a batch of decoded DF/TC pairs. Pure aggregation over
 * classifyDownlinkFormatLegality: counts, a signal histogram, and the
 * offending pairs (with caller-supplied hex/atMs echoed for traceability).
 * No interpretation, no corroboration — classification only.
 *
 * @param {{df?: number, tc?: number|null, hex?: string,
 *   atMs?: number}[]} pairs - Decoded pairs in any order.
 * @returns {{pairCount: number, legalCount: number, illegalCount: number,
 *   invalidCount: number,
 *   signalCounts: Record<string, number>,
 *   illegalPairs: {index: number, df: number, tc: number|null,
 *   hex: string|null, atMs: number|null, signals: string[],
 *   reason: string|null}[]}} The audit. Pairs that fail input validation
 *   are counted in `invalidCount` and excluded from the pair tallies.
 */
export function auditDownlinkFormatPairs(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  const summary = {
    pairCount: 0,
    legalCount: 0,
    illegalCount: 0,
    invalidCount: 0,
    signalCounts: {},
    illegalPairs: [],
  };
  list.forEach((pair, index) => {
    const verdict = classifyDownlinkFormatLegality(pair?.df, pair?.tc ?? null);
    if (verdict === null) {
      summary.invalidCount += 1;
      return;
    }
    summary.pairCount += 1;
    if (verdict.legal) {
      summary.legalCount += 1;
      return;
    }
    summary.illegalCount += 1;
    for (const signal of verdict.signals) {
      summary.signalCounts[signal] = (summary.signalCounts[signal] ?? 0) + 1;
    }
    summary.illegalPairs.push({
      index,
      df: verdict.df,
      tc: verdict.tc,
      hex: typeof pair?.hex === 'string' ? pair.hex : null,
      atMs: Number.isFinite(pair?.atMs) ? pair.atMs : null,
      signals: verdict.signals,
      reason: verdict.reason,
    });
  });
  return summary;
}
