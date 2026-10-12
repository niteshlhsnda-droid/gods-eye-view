/**
 * Time-rewind scrubber model — pure playback math for historical replays.
 *
 * A scrubber holds a sorted event list and a playhead. `tick` advances the
 * playhead by real elapsed time × speed; `visibleEvents` returns everything
 * whose shockwave is still alive at the playhead. No DOM, no Cesium, no
 * network — the replay view turns these rows into entities.
 */

export const SHOCKWAVE_LIFETIME_MS = 20_000;

/** Sort + index events for scrubbing. Events must carry numeric `time` (epoch ms). */
export function buildTimeline(events) {
  const sorted = [...(events || [])]
    .filter((event) => Number.isFinite(event?.time))
    .sort((a, b) => a.time - b.time);
  return {
    events: sorted,
    startMs: sorted.length ? sorted[0].time : null,
    endMs: sorted.length ? sorted[sorted.length - 1].time : null,
  };
}

/** Events whose shockwave is alive at playhead `nowMs`. */
export function visibleEvents(timeline, nowMs) {
  return timeline.events.filter(
    (event) =>
      event.time <= nowMs && nowMs - event.time <= SHOCKWAVE_LIFETIME_MS,
  );
}

/** Fraction of events already reached by the playhead, 0..1. */
export function playheadProgress(timeline, nowMs) {
  if (!timeline.events.length) return 0;
  const past = timeline.events.filter((event) => event.time <= nowMs).length;
  return past / timeline.events.length;
}

/**
 * Create a scrubber: play/pause/seek/scrub over the timeline.
 * @param {Object} timeline From buildTimeline.
 * @param {{speed?: number, onTick?: function}} options speed = playback multiplier.
 */
export function createScrubber(timeline, { speed = 60, onTick } = {}) {
  const state = {
    playing: false,
    playheadMs: timeline.startMs,
    speed,
    lastWallMs: null,
  };

  function tick(wallMs = Date.now()) {
    if (!state.playing || timeline.events.length === 0) {
      state.lastWallMs = wallMs;
      return state;
    }
    const elapsed = Math.max(0, wallMs - (state.lastWallMs ?? wallMs));
    state.lastWallMs = wallMs;
    state.playheadMs += elapsed * state.speed;
    if (state.playheadMs >= timeline.endMs + SHOCKWAVE_LIFETIME_MS) {
      state.playing = false;
      state.playheadMs = timeline.endMs + SHOCKWAVE_LIFETIME_MS;
    }
    onTick?.({ ...state });
    return state;
  }

  return {
    get state() {
      return { ...state };
    },
    play() {
      if (!timeline.events.length) return false;
      state.playing = true;
      state.lastWallMs = null;
      return true;
    },
    pause() {
      state.playing = false;
    },
    seek(playheadMs) {
      state.playheadMs = Math.min(
        Math.max(Number(playheadMs) || timeline.startMs, timeline.startMs),
        timeline.endMs + SHOCKWAVE_LIFETIME_MS,
      );
    },
    setSpeed(next) {
      state.speed = Math.min(3600, Math.max(0.25, Number(next) || 60));
    },
    tick,
    visible() {
      return visibleEvents(timeline, state.playheadMs);
    },
    progress() {
      return playheadProgress(timeline, state.playheadMs);
    },
  };
}

/** Format an epoch-ms playhead as a compact UTC label. Pure. */
export function formatPlayhead(playheadMs) {
  if (!Number.isFinite(playheadMs)) return '—';
  const date = new Date(playheadMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
