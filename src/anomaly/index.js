/**
 * Clean-room anomaly engine for the God's Eye View HUD.
 *
 * Heuristic detectors only — fixed lookups and geometric clustering, no
 * models, no probabilities, no vendored code. The three upstream repos that
 * inspired this idea (`signal-anomaly-detective`, `deepfake-detection`,
 * `alethia-main`) carry no declared license, so nothing was copied from them;
 * see docs/license-policy.md.
 *
 * @module anomaly
 */

import { detectEmergencySquawks, EMERGENCY_SQUAWK_CODES } from './squawk.js';
import {
  detectAisDarkGaps,
  DEFAULT_DARK_GAP_THRESHOLD_MS,
} from './aisDarkGaps.js';
import { detectQuakeSwarms } from './quakeSwarm.js';

export { detectEmergencySquawks, EMERGENCY_SQUAWK_CODES };
export { detectAisDarkGaps, DEFAULT_DARK_GAP_THRESHOLD_MS };
export { detectQuakeSwarms };

/** Anomaly event types this engine can emit. */
export const ANOMALY_TYPES = Object.freeze([
  'emergency-squawk',
  'ais-dark-gap',
  'quake-swarm',
]);

const SEVERITY_RANK = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
});

/**
 * Run every detector over one snapshot and return a ranked event list.
 *
 * @param {object} snapshot
 * @param {Array<object>} [snapshot.aircraft] See squawk.js contract.
 * @param {Array<object>} [snapshot.vessels] See aisDarkGaps.js contract.
 * @param {Array<object>} [snapshot.quakes] See quakeSwarm.js contract.
 * @param {object} [options] Detector options ({ now, radiusKm, windowHrs,
 *   minEvents, darkGapThresholdMs, minHistorySamples }).
 * @returns {Array<object>} Events, critical-first, then most-recent first.
 */
export function detectAnomalies(
  { aircraft = [], vessels = [], quakes = [] } = {},
  options = {},
) {
  const events = [
    ...detectEmergencySquawks(aircraft, options),
    ...detectAisDarkGaps(vessels, options),
    ...detectQuakeSwarms(quakes, options),
  ];
  return events.sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) ||
      (b.detectedAtMs ?? 0) - (a.detectedAtMs ?? 0),
  );
}
