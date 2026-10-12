/**
 * Time-rewind replay view — renderer-agnostic entity descriptors.
 *
 * Turns live visible events (from the scrubber) into shockwave descriptors:
 * expanding rings colored by magnitude with an age-driven fade. The app maps
 * these descriptors to Cesium entities (ellipse with growing axes + fading
 * material); unit tests assert the math without a renderer.
 */

const KM_PER_DEG_LAT = 111.32;
/** Ring expands to this radius (km) over its lifetime, scaled by magnitude. */
const BASE_RADIUS_KM = 60;

/** Magnitude → marker color (green → yellow → orange → red). */
export function magnitudeColor(mag) {
  if (mag >= 7) return '#ff3b30';
  if (mag >= 6) return '#ff9500';
  if (mag >= 5) return '#ffcc00';
  return '#34c759';
}

/**
 * Build shockwave descriptors for events alive at `nowMs`.
 * @param {Array} events Rows with {stableId, lat, lon, mag, time}.
 * @param {number} nowMs Playhead epoch ms.
 * @param {number} lifetimeMs Shockwave lifetime ms.
 */
export function planShockwaves(events, nowMs, lifetimeMs) {
  return (events || [])
    .filter(
      (event) => Number.isFinite(event?.lat) && Number.isFinite(event?.lon),
    )
    .map((event) => {
      const ageMs = Math.max(0, nowMs - event.time);
      const progress = Math.min(1, ageMs / lifetimeMs);
      const easeOut = 1 - (1 - progress) ** 3;
      const radiusKm =
        BASE_RADIUS_KM * easeOut * (0.6 + 0.2 * (event.mag || 5));
      return {
        id: event.stableId,
        lat: event.lat,
        lon: event.lon,
        mag: event.mag ?? null,
        place: event.place ?? null,
        ageMs,
        progress,
        radiusKm,
        radiusDegrees: radiusKm / KM_PER_DEG_LAT,
        alpha: 1 - progress,
        color: magnitudeColor(event.mag ?? 0),
      };
    });
}

/** Compact event count summary for the replay HUD. Pure. */
export function replaySummary(timeline, nowMs, maxMag = null) {
  const past = timeline.events.filter((event) => event.time <= nowMs);
  const peak = past.reduce((max, event) => Math.max(max, event.mag ?? 0), 0);
  return {
    total: timeline.events.length,
    reached: past.length,
    peakMagnitude: peak || null,
    maxMagnitude: maxMag,
  };
}
