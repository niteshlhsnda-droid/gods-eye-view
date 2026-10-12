/**
 * TimelineJS3 adapter for Story Mode.
 *
 * Converts a story definition into TimelineJS3 JSON and mounts the timeline UI
 * into a container. The package (@knight-lab/timelinejs, MPL-2.0) is loaded
 * lazily so the story engine works — with its own caption/transport UI — even
 * when the package is unavailable. All slide changes flow through the story
 * engine, which stays the source of truth for playback state.
 *
 * NOTE ON CSS: TimelineJS3 ships its stylesheet at
 * `@knight-lab/timelinejs/dist/css/timeline.css`. It is imported from the
 * root style.css (added by the orchestrator after the central install).
 * Without it the timeline still mounts and drives the story; it just renders
 * unstyled.
 *
 * NOTE ON JS: the package root entry points at its webpack source tree
 * (which imports .less), so the adapter loads the prebuilt classic bundle at
 * `@knight-lab/timelinejs/dist/js/timeline.js` via a ?url asset import +
 * classic <script> injection, reading the constructor off globalThis.TL.
 */

/** Base date for the synthetic storm timeline (UTC). Arbitrary but stable. */
export const STORM_EPOCH = Object.freeze({
  year: 2026,
  month: 10,
  day: 12,
  hour: 0,
  minute: 0,
});

/**
 * Convert a story definition to a TimelineJS3 JSON config.
 * Each slide becomes an event at T+0h, T+6h, T+12h… with a display_date label,
 * so the timeline reads as storm evolution rather than calendar history.
 * @param {object} story
 * @returns {object} TimelineJS3-ready config.
 */
export function storyToTimelineConfig(story) {
  const slides = Array.isArray(story?.slides) ? story.slides : [];
  const first = slides[0];
  return {
    title: {
      text: {
        headline: String(story?.title ?? 'Story'),
        text: String(story?.description ?? ''),
      },
    },
    events: slides.map((slide, index) => {
      const hours = index * 6;
      return {
        unique_id: String(slide.id ?? `slide-${index}`),
        start_date: {
          year: STORM_EPOCH.year,
          month: STORM_EPOCH.month,
          day: STORM_EPOCH.day,
          hour: (STORM_EPOCH.hour + hours) % 24,
        },
        display_date:
          index === 0 ? 'T+0 hours — formation' : `T+${hours} hours`,
        text: {
          headline: String(slide.title ?? ''),
          text: String(slide.text ?? ''),
        },
      };
    }),
    // Keep the first slide's epoch date honest even though display_date carries
    // the narrative meaning.
    _storySlideCount: slides.length,
    _storyFirstSlideId: first ? String(first.id ?? 'slide-0') : null,
  };
}

/**
 * Read the current slide index from a TimelineJS3 instance, defensively.
 * The in-page API surface varies by build; every access is guarded so an
 * unexpected shape degrades to "unknown" instead of throwing.
 * @param {object} timeline
 * @param {(uniqueId: string) => number|null} [resolveIndex] Maps a slide unique_id to its story index.
 * @returns {number|null}
 */
export function readTimelineIndex(timeline, resolveIndex = null) {
  try {
    let uniqueId = null;
    if (typeof timeline?.getCurrentSlide === 'function') {
      const slide = timeline.getCurrentSlide();
      uniqueId = slide?.data?.unique_id ?? slide?.unique_id ?? null;
    } else if (typeof timeline?.current_id === 'string') {
      uniqueId = timeline.current_id;
    }
    if (uniqueId == null) return null;
    if (typeof resolveIndex === 'function') return resolveIndex(uniqueId);
    const parsed = Number.parseInt(String(uniqueId), 10);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    /* Unknown build shape — caller treats null as "no signal". */
  }
  return null;
}

/**
 * Mount a TimelineJS3 timeline for a story.
 * @param {object} input
 * @param {HTMLElement} input.container
 * @param {object} input.story
 * @param {(index: number) => void} [input.onSlideChange] Called when the user scrubs the timeline.
 * @param {object} [input.options] Extra TimelineJS3 options.
 * @returns {Promise<{timeline: object|null, destroy: () => void, goTo: (index: number) => void}>}
 *   `timeline` is null when the package could not be loaded — the caller keeps
 *   the engine's own transport UI as the fallback.
 */
export async function mountTimeline({
  container,
  story,
  onSlideChange = () => {},
  options = {},
}) {
  const noop = {
    timeline: null,
    destroy: () => {},
    goTo: () => {},
  };
  if (!container || !story) return noop;

  // The published package's root entry points at its webpack *source* tree
  // (`src/js/index.js`), whose first line imports a .less file — unbuildable
  // without the less preprocessor. The prebuilt classic bundle at
  // dist/js/timeline.js is self-contained but has no ESM exports (it assigns
  // a module-scoped `var TL`), so a bundled dynamic import cannot see it.
  // Load it as a classic <script> (global scope) via Vite's ?url asset URL.
  // In node (unit tests) the ?url specifier fails to resolve -> caught below
  // -> engine-only mode, same graceful fallback as a missing package.
  let Timeline = null;
  try {
    const urlMod =
      await import('@knight-lab/timelinejs/dist/js/timeline.js?url');
    const bundleUrl = urlMod?.default;
    if (typeof bundleUrl === 'string' && bundleUrl) {
      await new Promise((resolve, reject) => {
        if (globalThis.TL?.Timeline) return resolve();
        const script = document.createElement('script');
        script.src = bundleUrl;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('timeline bundle failed to load'));
        document.head.appendChild(script);
      });
      const GlobalTimeline = globalThis.TL?.Timeline;
      if (typeof GlobalTimeline === 'function') Timeline = GlobalTimeline;
    }
  } catch {
    // Package not installed, asset missing, or script failed: engine-only mode.
  }
  if (!Timeline) return noop;

  const config = storyToTimelineConfig(story);
  let timeline = null;
  try {
    timeline = new Timeline(container, config, {
      hash_bookmark: false,
      timenav_height_percentage: 28,
      ...options,
    });
  } catch {
    return noop;
  }

  // Timeline -> engine: poll the current slide at a low cadence and report
  // changes. Guarded polling (not event subscription) because the in-page
  // event API is not contractual across builds.
  const idToIndex = new Map(
    story.slides.map((slide, slideIndex) => [
      String(slide.id ?? `slide-${slideIndex}`),
      slideIndex,
    ]),
  );
  const resolveIndex = (uniqueId) =>
    idToIndex.has(String(uniqueId)) ? idToIndex.get(String(uniqueId)) : null;
  let lastSeen = -1;
  let stopped = false;
  const poll = () => {
    if (stopped) return;
    const current = readTimelineIndex(timeline, resolveIndex);
    if (current != null && current !== lastSeen) {
      lastSeen = current;
      try {
        onSlideChange(current);
      } catch {
        /* Listener errors must not break the timeline. */
      }
    }
    pollTimer = setTimeout(poll, 500);
  };
  let pollTimer = setTimeout(poll, 500);

  return {
    timeline,
    destroy: () => {
      stopped = true;
      clearTimeout(pollTimer);
      try {
        timeline?.destroy?.();
      } catch {
        /* Best effort. */
      }
      timeline = null;
    },
    goTo: (index) => {
      try {
        if (typeof timeline?.goTo === 'function') timeline.goTo(index);
      } catch {
        /* A failed seek never fails the story. */
      }
      lastSeen = index;
    },
  };
}
