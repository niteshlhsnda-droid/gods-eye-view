/**
 * Clean-room emergency squawk detector.
 *
 * Detects aircraft broadcasting one of the three internationally assigned
 * emergency transponder codes:
 *   7500 — unlawful interference (hijack)
 *   7600 — radio communications failure
 *   7700 — general emergency
 * This is a fixed lookup over the squawk field, not a model — there is no
 * probability to compute and no ML to get wrong. Every hit is reported as
 * critical because an emergency squawk always deserves an operator's eyes.
 *
 * Input aircraft contract:
 *   { icao24?, hex?, callsign?, squawk, lat?, lon?, altFt? }
 * `squawk` may be a string ('7700'), a number (7700), or null/undefined.
 */

/** The only squawk codes this detector ever fires on. */
export const EMERGENCY_SQUAWK_CODES = Object.freeze({
  7500: 'unlawful interference',
  7600: 'radio communications failure',
  7700: 'general emergency',
});

function normalizeSquawk(squawk) {
  if (squawk == null) return null;
  const digits = String(squawk).replace(/\D/g, '');
  if (digits.length !== 4) return null;
  return digits;
}

function describePosition(aircraft) {
  const parts = [];
  if (Number.isFinite(aircraft.lat) && Number.isFinite(aircraft.lon)) {
    parts.push(
      `${Math.abs(aircraft.lat).toFixed(2)}°${aircraft.lat >= 0 ? 'N' : 'S'}, ` +
        `${Math.abs(aircraft.lon).toFixed(2)}°${aircraft.lon >= 0 ? 'E' : 'W'}`,
    );
  }
  if (Number.isFinite(aircraft.altFt)) {
    parts.push(`${Math.round(aircraft.altFt).toLocaleString('en-US')} ft`);
  }
  return parts.length ? ` at ${parts.join(' · ')}` : '';
}

/**
 * @param {Array<object>} aircraft Aircraft records (see module contract).
 * @param {object} [options]
 * @param {number} [options.now] Detection timestamp (defaults to Date.now()).
 * @returns {Array<object>} Anomaly events, critical-first.
 */
export function detectEmergencySquawks(
  aircraft = [],
  { now = Date.now() } = {},
) {
  const events = [];
  for (const record of aircraft || []) {
    if (!record || typeof record !== 'object') continue;
    const squawk = normalizeSquawk(record.squawk);
    if (!squawk || !Object.hasOwn(EMERGENCY_SQUAWK_CODES, squawk)) continue;
    const icao24 =
      String(record.icao24 || record.hex || '').trim() || 'unknown';
    const callsign = String(record.callsign || '').trim();
    const label = callsign ? `${callsign} (${icao24})` : icao24;
    events.push({
      id: `emergency-squawk-${squawk}-${icao24}`,
      type: 'emergency-squawk',
      severity: 'critical',
      title: `Squawk ${squawk} — ${EMERGENCY_SQUAWK_CODES[squawk]}`,
      detail:
        `Aircraft ${label} is broadcasting emergency squawk ${squawk}` +
        `${describePosition(record)}. Verify against official sources before acting.`,
      detectedAtMs: now,
      ref: {
        icao24,
        callsign: callsign || null,
        squawk,
        lat: Number.isFinite(record.lat) ? record.lat : null,
        lon: Number.isFinite(record.lon) ? record.lon : null,
      },
    });
  }
  return events;
}
