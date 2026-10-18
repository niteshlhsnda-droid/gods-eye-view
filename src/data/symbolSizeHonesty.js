/**
 * Symbol-size honesty: display-only labels for what marker SIZE encodes.
 *
 * A map reader naturally reads a marker's size as information — a bigger
 * circle looks like a bigger affected area, a stronger signal, or a higher
 * rank. This module is the vocabulary for stating what size actually encodes
 * per layer family, so a view can label it instead of letting the reader
 * guess. Display-only: no call-site wiring ships here; see
 * docs/symbol-size-honesty.md. Missing or unknowable encodings must surface
 * as an explicit unknown, never as a default encoding.
 */

/** The standing rule: size means what the layer says, and nothing more. */
export const SYMBOL_SIZE_RULE =
  'Marker size encodes what the layer says it encodes — nothing else.';

/**
 * Label for layers whose markers are all the same size on screen
 * (detection dots, world-overlay anchor dots). Uniform size is not a rank.
 */
export const UNIFORM_MARKER_LABEL =
  'Marker size is uniform — size encodes nothing about this item.';

/**
 * Display radius (km) of an earthquake ground circle for a magnitude.
 * Mirrors the earthquake layer's formula
 * (`src/layers/earthquakes/index.js`: `Math.pow(2, mag) * 1000` metres).
 * @param {number|string} mag - Moment magnitude.
 * @returns {number|null} Radius in km, or null when the magnitude is not finite.
 */
export function quakeDisplayRadiusKm(mag) {
  // null/undefined and blank strings are unknown, not magnitude 0:
  // Number(null) and Number('') both coerce to 0 and would fabricate a
  // 'magnitude 0' label. Unknown stays explicit.
  if (mag == null) return null;
  if (typeof mag === 'string' && mag.trim() === '') return null;
  const m = Number(mag);
  if (!Number.isFinite(m)) return null;
  return Math.pow(2, m);
}

/** Two-significant-figure km formatting for the label (256 → '256', 45.25 → '45.3', 4 → '4'). */
function formatKm(km) {
  if (km >= 100) return String(Math.round(km));
  if (km >= 10) return String(Math.round(km * 10) / 10);
  return String(Math.round(km * 100) / 100);
}

/**
 * Honesty label for an earthquake ground circle.
 * @param {number|string} [mag] - Moment magnitude; when finite, the label
 * names the actual displayed radius so the reader can see the convention.
 * @returns {string} The disclosure.
 */
export function quakeSymbolLabel(mag) {
  const radiusKm = quakeDisplayRadiusKm(mag);
  if (radiusKm === null) {
    return (
      'Earthquake circle: sized by display convention — the circle radius ' +
      'grows exponentially with magnitude (2^magnitude km), not linearly ' +
      'and not with affected area. Not an impact zone.'
    );
  }
  return (
    `Earthquake circle (magnitude ${Number(mag)}): displayed radius ≈ ` +
    `${formatKm(radiusKm)} km — sized by display convention, not by affected ` +
    'area. Not an impact zone.'
  );
}

/**
 * Label for the time-rewind replay's expanding shockwave ring
 * (`src/timeRewind/replayView.js`: BASE_RADIUS_KM × ease-out × (0.6 + 0.2×mag)).
 * A cinematic, not a measurement.
 */
export const QUAKE_REPLAY_RING_LABEL =
  'Replay ring: a cinematic expansion loosely scaled by magnitude — ' +
  'not a hazard zone and not a measured impact area.';
