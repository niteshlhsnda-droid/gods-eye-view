/**
 * Raw-bit Mode-S altitude-field plausibility: a decoder-level ADS-B check.
 *
 * Research basis: in a DF17 extended squitter with type code 9-18 (airborne
 * position, barometric altitude), message bits 41-52 carry a 12-bit altitude
 * field. Per ICAO Doc 9871 Table A-2-5 the field is the Annex 10 Vol IV
 * §3.1.2.6.5.4 13-bit altitude code with the M-bit removed, ordered
 * C1 A1 C2 A2 C4 A4 B1 (Q) B2 D2 B4 D4 — the Q-bit is the 8th bit of the
 * field (message bit 48). DO-260B §2.2.3.2.7.2.2: Q=1 selects binary
 * 25-ft encoding (altitude = 25N − 1000 ft, N the remaining 11 bits);
 * Q=0 selects the Gillham (modified Gray) code in 100-ft steps.
 * Junzi Sun, "The 1090MHz Riddle" §5.5.1 works the reference example:
 * message 8D40621D58C382D690C8AC2863A7 carries field bits `1100001 1 1000`,
 * Q=1, N=1560 → 38000 ft; an all-zero field means altitude unavailable.
 *
 * Why this check, not one of the earlier ones: the landed
 * `altitudeEncodingPlausibility` (Cycle 17) judges DECODED altitudes —
 * range and quantization on float values — and explicitly scoped OUT
 * "Gillham bit-level impossible transitions observable only in raw message
 * bits — belongs at the decoder, not here". This module IS that
 * decoder-level check, and it is still owed (carried as a follow-up since
 * Cycle 17). A decoded-field check can never see it: reference decoders map
 * an impossible Gillham pattern to "no altitude" (None) and silently drop
 * the evidence. Judging the raw 12-bit pattern catches bit combinations no
 * conforming Gillham encoder can emit — a strictly stronger, earlier
 * signal than anything downstream of a decoder.
 *
 * Validity rule (ported from the readsb/mlat-server decoder lineage,
 * Oliver Jowett's mlat-server `modes/altitude.py::_decode_ac13`, itself
 * derived from dump1090's `decodeAC13Field` — the same partition readsb,
 * the lane's data source, applies before it ever reports an altitude):
 *  - field all zeros → altitude unavailable (not a violation);
 *  - Q=1 → always a valid pattern (N = 0..2047 → −1000..+50175 ft);
 *  - Q=0 → the 11 Gillham bits must form a legal code: at least one of
 *    C1/C2/C4 set; the C-bit Gray state must not be the single illegal
 *    state (C2 set alone); and the decoded value must not fall below the
 *    Gillham floor of −1200 ft. Anything else is a pattern no conforming
 *    encoder emits.
 * Research note: pyModeS v3 partitions one or two exotic C-bit states
 * differently (observed during vector generation); this module follows the
 * readsb/mlat-server partition deliberately, because that is what the
 * lane's own feed decodes with.
 *
 * What this is NOT:
 * - Not a CRC/PI check. The parity field (bits 89-112) is not verified
 *   here — that is error detection, a receiver concern. Callers should feed
 *   CRC-validated messages; without CRC validation, RF bit corruption is
 *   the leading benign cause of an impossible pattern, ahead of faulty
 *   encoders and crafted spoof messages.
 * - Not a range check. A pattern decoding above the DO-260B ADS-B ceiling
 *   is decoder-valid and judged consistent here; the decoded-level range
 *   judgment belongs to `altitudeEncodingPlausibility`.
 * - Not DF18 / TC 20-22. DF18 (non-transponder/TIS-B) prefixes the ME
 *   field with a Control Field, so its bit layout differs; TC 20-22 carry
 *   GNSS height in metres under a different encoding. Both are
 *   unjudgeable here, never violations.
 * - Not corroboration-gated. Per-report verdicts carry no interpretation;
 *   a corroborated summary (repeated impossible patterns from one emitter
 *   across CRC-valid messages) may read `suspected-adsb-spoofing` — that is
 *   a wiring concern, out of scope for a standalone module.
 *
 * Pure: no DOM, no Cesium, no imports, no node:fs/node:path. Standalone:
 * no feed wiring — no call-site changes ship with this module.
 */

/** Observed fact: the raw Gillham pattern is not a legal altitude code. */
export const RAW_ALTITUDE_SIGNAL_IMPOSSIBLE = 'gillham-code-impossible';

/** Downlink format judged here: 1090ES extended squitter. */
export const RAW_ALTITUDE_DOWNLINK_FORMAT = 17;
/** Type codes carrying the barometric altitude field (DO-260B Table 2-15). */
export const RAW_ALTITUDE_TYPE_CODE_MIN = 9;
export const RAW_ALTITUDE_TYPE_CODE_MAX = 18;
/** Gillham code floor: patterns decoding below this are impossible. */
export const RAW_ALTITUDE_GILLHAM_FLOOR_FT = -1200;
/** A 112-bit Mode-S message is 28 hex characters. */
const MODE_S_112_HEX_LENGTH = 28;
const HEX_112_RE = /^[0-9a-fA-F]{28}$/;

/**
 * Read message bit n (1-indexed, MSB-first) from the byte array.
 *
 * @param {Uint8Array} bytes Message bytes.
 * @param {number} n 1-indexed bit position.
 */
function messageBit(bytes, n) {
  const index = n - 1;
  return (bytes[index >> 3] >> (7 - (index & 7))) & 1;
}

/**
 * Value of message bits [fromBit, toBit] inclusive (1-indexed, MSB-first).
 *
 * @param {Uint8Array} bytes Message bytes.
 * @param {number} fromBit First bit (1-indexed).
 * @param {number} toBit Last bit (1-indexed).
 */
function messageBits(bytes, fromBit, toBit) {
  let value = 0;
  for (let n = fromBit; n <= toBit; n++)
    value = (value << 1) | messageBit(bytes, n);
  return value;
}

/**
 * Judge the 12-bit Gillham portion of the altitude field (Q-bit already
 * known clear). Ports the mlat-server validity partition exactly; see the
 * header for the rule and its provenance.
 *
 * @param {number} ac12 The 12-bit altitude field as an integer.
 * @returns {{valid: boolean, altitude: (number|null), detail: (string|null)}}
 */
function judgeGillhamField(ac12) {
  // Rebuild the 13-bit Annex 10 field with the (absent) M-bit as zero,
  // exactly as mlat-server's decode_ac12 does.
  const ac13 = ((ac12 & 0x0fc0) << 1) | (ac12 & 0x003f);
  // No C bits set: no legal Gillham code is C-silent (the all-zero field
  // is handled earlier as "altitude unavailable").
  if ((ac13 & 0x1500) === 0) {
    return {
      valid: false,
      altitude: null,
      detail: 'no-c-bits',
    };
  }
  // C-bit Gray state: C1^7, C2^3, C4^1, folded; the single state that folds
  // above 5 (C2 set alone) is not encodable.
  let h = 0;
  if (ac13 & 0x1000) h ^= 7; // C1
  if (ac13 & 0x0400) h ^= 3; // C2
  if (ac13 & 0x0100) h ^= 1; // C4
  if (h & 5) h ^= 5;
  if (h > 5) {
    return {
      valid: false,
      altitude: null,
      detail: 'illegal-c-bit-state',
    };
  }
  // Gray-unscramble the A/B/D pulse groups into the 500-ft step index.
  let f = 0;
  if (ac13 & 0x0004) f ^= 0x0ff; // D2
  if (ac13 & 0x0001) f ^= 0x07f; // D4
  if (ac13 & 0x0800) f ^= 0x03f; // A1
  if (ac13 & 0x0200) f ^= 0x01f; // A2
  if (ac13 & 0x0080) f ^= 0x00f; // A4
  if (ac13 & 0x0020) f ^= 0x007; // B1
  if (ac13 & 0x0008) f ^= 0x003; // B2
  if (ac13 & 0x0002) f ^= 0x001; // B4
  if (f & 1) h = 6 - h;
  const altitude = 500 * f + 100 * h - 1300;
  if (altitude < RAW_ALTITUDE_GILLHAM_FLOOR_FT) {
    return {
      valid: false,
      altitude: null,
      detail: 'below-gillham-floor',
    };
  }
  return { valid: true, altitude, detail: null };
}

/**
 * Decode the 12-bit altitude field once its shape (Q-bit) is known.
 *
 * @param {number} ac12 The 12-bit altitude field as an integer.
 * @returns {{encoding: string, altitude: (number|null), valid: boolean, detail: (string|null)}}
 */
function decodeAltitudeField(ac12) {
  const qBit = (ac12 >> 4) & 1;
  if (qBit === 1) {
    const ac13 = ((ac12 & 0x0fc0) << 1) | (ac12 & 0x003f);
    const n = ((ac13 & 0x1f80) >> 2) | ((ac13 & 0x0020) >> 1) | (ac13 & 0x000f);
    return {
      encoding: 'binary-25ft',
      altitude: n * 25 - 1000,
      valid: true,
      detail: null,
    };
  }
  const gillham = judgeGillhamField(ac12);
  return {
    encoding: 'gillham-100ft',
    altitude: gillham.altitude,
    valid: gillham.valid,
    detail: gillham.detail,
  };
}

/**
 * Judge the raw altitude-field bits of one 112-bit Mode-S message.
 * Normalises the hex input (lowercase); returns null on invalid input;
 * never throws.
 *
 * @param {object} input
 * @param {string} input.hex Raw 112-bit Mode-S message as 28 hex chars.
 * @returns {null|{
 *   judged: boolean,
 *   consistent: boolean,
 *   signals: string[],
 *   interpretation: (string|null),
 *   reason: (string|null),
 *   hex: string,
 *   downlinkFormat: number,
 *   typeCode: (number|null),
 *   altitudeFieldBits: (string|null),
 *   encoding: (string|null),
 *   decodedAltitudeFt: (number|null),
 * }} Null on invalid input; an unjudgeable result (judged:false) when the
 * message carries no DF17 airborne-position altitude field, or the field
 * reports altitude unavailable.
 */
export function rawAltitudePlausibility(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  if (typeof input.hex !== 'string' || !HEX_112_RE.test(input.hex)) {
    return null;
  }
  const hex = input.hex.toLowerCase();
  const bytes = Uint8Array.from(
    hex.match(/../g).map((pair) => parseInt(pair, 16)),
  );
  const downlinkFormat = messageBits(bytes, 1, 5);

  const base = {
    judged: false,
    consistent: true,
    signals: [],
    interpretation: null,
    reason: null,
    hex,
    downlinkFormat,
    typeCode: null,
    altitudeFieldBits: null,
    encoding: null,
    decodedAltitudeFt: null,
  };

  if (downlinkFormat !== RAW_ALTITUDE_DOWNLINK_FORMAT) {
    return {
      ...base,
      reason: `downlink format ${downlinkFormat} carries no ADS-B airborne-position altitude field`,
    };
  }

  const typeCode = messageBits(bytes, 33, 37);
  if (
    typeCode < RAW_ALTITUDE_TYPE_CODE_MIN ||
    typeCode > RAW_ALTITUDE_TYPE_CODE_MAX
  ) {
    return {
      ...base,
      typeCode,
      reason: `type code ${typeCode} carries no barometric altitude field`,
    };
  }

  const ac12 = messageBits(bytes, 41, 52);
  const altitudeFieldBits = ac12.toString(2).padStart(12, '0');
  if (ac12 === 0) {
    return {
      ...base,
      typeCode,
      altitudeFieldBits,
      reason: 'altitude field is all zeros: altitude unavailable',
    };
  }

  const decoded = decodeAltitudeField(ac12);
  if (!decoded.valid) {
    const why =
      decoded.detail === 'no-c-bits'
        ? 'no C1/C2/C4 bit set'
        : decoded.detail === 'illegal-c-bit-state'
          ? 'illegal C-bit Gray state'
          : 'decodes below the Gillham floor of -1200 ft';
    return {
      ...base,
      judged: true,
      consistent: false,
      signals: [RAW_ALTITUDE_SIGNAL_IMPOSSIBLE],
      reason:
        `Gillham altitude field ${altitudeFieldBits} is not a legal code ` +
        `(${why}); no conforming encoder emits this pattern`,
      typeCode,
      altitudeFieldBits,
      encoding: decoded.encoding,
    };
  }

  return {
    ...base,
    judged: true,
    typeCode,
    altitudeFieldBits,
    encoding: decoded.encoding,
    decodedAltitudeFt: decoded.altitude,
    reason: `${decoded.encoding} altitude field decodes to ${decoded.altitude} ft`,
  };
}
