/**
 * Clean-room AIS "dark gap" detector.
 *
 * Flags vessels that were broadcasting regularly and then went silent: the
 * classic signature of AIS being switched off, not of sparse data. A vessel
 * that was never seen, or was only ever seen a handful of times, is not a
 * dark gap — silence without history is just absence, and absence is not an
 * anomaly.
 *
 * Input vessel contract:
 *   { mmsi, name?, lastSeenMs, sampleCount?, lastLat?, lastLon? }
 * `sampleCount` is how many AIS positions we have on record for the vessel;
 * `lastSeenMs` is when its most recent position was received.
 */

/** Default silence window before a gap is reported: six hours. */
export const DEFAULT_DARK_GAP_THRESHOLD_MS = 6 * 60 * 60 * 1000;

/**
 * @param {Array<object>} vessels Vessel records (see module contract).
 * @param {object} [options]
 * @param {number} [options.now] Detection timestamp (defaults to Date.now()).
 * @param {number} [options.darkGapThresholdMs] Silence window.
 * @param {number} [options.minHistorySamples] Positions needed before silence counts.
 * @returns {Array<object>} Anomaly events.
 */
export function detectAisDarkGaps(
  vessels = [],
  {
    now = Date.now(),
    darkGapThresholdMs = DEFAULT_DARK_GAP_THRESHOLD_MS,
    minHistorySamples = 3,
  } = {},
) {
  const events = [];
  for (const vessel of vessels || []) {
    if (!vessel || typeof vessel !== 'object') continue;
    const mmsi = String(vessel.mmsi || '').trim();
    if (!mmsi) continue;
    const lastSeenMs = Number(vessel.lastSeenMs);
    if (!Number.isFinite(lastSeenMs) || lastSeenMs > now) continue;
    const history = Number(vessel.sampleCount);
    const trackedBefore = Number.isFinite(history)
      ? history >= minHistorySamples
      : Boolean(vessel.trackedBefore);
    // Never seen enough to establish a pattern: silence is not an anomaly.
    if (!trackedBefore) continue;
    const gapMs = now - lastSeenMs;
    if (gapMs <= darkGapThresholdMs) continue;
    const gapHours = gapMs / 3600000;
    const label = String(vessel.name || '').trim() || `MMSI ${mmsi}`;
    const position =
      Number.isFinite(vessel.lastLat) && Number.isFinite(vessel.lastLon)
        ? ` Last known position ${Math.abs(vessel.lastLat).toFixed(2)}°` +
          `${vessel.lastLat >= 0 ? 'N' : 'S'}, ${Math.abs(vessel.lastLon).toFixed(2)}°` +
          `${vessel.lastLon >= 0 ? 'E' : 'W'}.`
        : '';
    events.push({
      id: `ais-dark-gap-${mmsi}`,
      type: 'ais-dark-gap',
      severity: 'high',
      title: `AIS dark gap — ${label}`,
      detail:
        `${label} last broadcast AIS ${gapHours.toFixed(1)} hours ago after ` +
        `regular reporting. Possible AIS disablement or loss of signal.${position}`,
      detectedAtMs: now,
      ref: {
        mmsi,
        name: String(vessel.name || '').trim() || null,
        lastSeenMs,
        gapMs,
        lastLat: Number.isFinite(vessel.lastLat) ? vessel.lastLat : null,
        lastLon: Number.isFinite(vessel.lastLon) ? vessel.lastLon : null,
      },
    });
  }
  return events;
}
