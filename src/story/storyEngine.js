/**
 * Story engine — timeline-driven globe narratives.
 *
 * Dependency-free choreography core for Story Mode. A story is plain data
 * (see cyclone.js); the engine walks its slides, flies the camera, toggles
 * layers, and shows captions through injected adapters, so the whole thing is
 * unit-testable without Cesium, the DOM, or TimelineJS3.
 *
 * The TimelineJS3 renderer (timelineRenderer.js) is a thin lazy adapter over
 * this engine: the engine stays the source of truth for playback state.
 */

/** Slide advance when a slide omits durationMs. */
export const DEFAULT_SLIDE_DURATION_MS = 9000;

const VALID_STATES = Object.freeze(['idle', 'playing', 'paused']);

/**
 * Validate a story definition. Returns an array of problem strings (empty = ok).
 * @param {object} story
 * @returns {string[]}
 */
export function validateStory(story) {
  const problems = [];
  if (!story || typeof story !== 'object') return ['story must be an object'];
  if (typeof story.id !== 'string' || !story.id.trim())
    problems.push('story.id must be a non-empty string');
  if (typeof story.title !== 'string' || !story.title.trim())
    problems.push('story.title must be a non-empty string');
  if (!Array.isArray(story.slides) || story.slides.length === 0)
    problems.push('story.slides must be a non-empty array');
  for (const [index, slide] of (story.slides || []).entries()) {
    const where = `slides[${index}]`;
    if (typeof slide?.title !== 'string' || !slide.title.trim())
      problems.push(`${where}.title must be a non-empty string`);
    if (typeof slide?.text !== 'string' || !slide.text.trim())
      problems.push(`${where}.text must be a non-empty string`);
    const camera = slide?.camera;
    if (camera != null) {
      for (const key of ['lat', 'lon']) {
        if (!Number.isFinite(camera[key]))
          problems.push(`${where}.camera.${key} must be a finite number`);
      }
      if (camera.lat < -90 || camera.lat > 90)
        problems.push(`${where}.camera.lat out of range`);
      if (camera.lon < -180 || camera.lon > 180)
        problems.push(`${where}.camera.lon out of range`);
      if (camera.alt != null && !Number.isFinite(camera.alt))
        problems.push(`${where}.camera.alt must be a finite number`);
    }
    if (slide?.layers != null && !Array.isArray(slide.layers))
      problems.push(`${where}.layers must be an array of layer ids`);
    if (
      slide?.durationMs != null &&
      (!Number.isFinite(slide.durationMs) || slide.durationMs <= 0)
    )
      problems.push(`${where}.durationMs must be a positive number`);
  }
  return problems;
}

/**
 * Create a story player.
 * @param {object} story Validated story definition.
 * @param {object} adapters
 * @param {(camera: object) => void} [adapters.flyTo] Camera choreography.
 * @param {(layerIds: string[]) => void} [adapters.setLayers] Story layer set.
 * @param {(slide: object, index: number) => void} [adapters.showCaption]
 * @param {() => void} [adapters.hideCaption]
 * @param {(event: string, detail: object) => void} [adapters.onEvent] 'slide' | 'state' | 'end'.
 * @param {object} [clock] Injectable timer: { setTimeout, clearTimeout }.
 * @returns {{state: string, index: number, play, pause, resume, stop, next, prev, goTo, slideCount}}
 */
export function createStoryPlayer(
  story,
  {
    flyTo = () => {},
    setLayers = () => {},
    showCaption = () => {},
    hideCaption = () => {},
    onEvent = () => {},
  } = {},
  clock = { setTimeout, clearTimeout },
) {
  const problems = validateStory(story);
  if (problems.length)
    throw new Error(`Invalid story "${story?.id}": ${problems.join('; ')}`);

  let state = 'idle';
  let index = -1;
  let timer = null;
  // Layers this player turned on, so stop() can put the map back.
  let ownedLayers = [];

  const emit = (event, detail = {}) => {
    try {
      onEvent(event, { ...detail, state, index, storyId: story.id });
    } catch {
      /* Listener errors must not break playback. */
    }
  };
  const setState = (next) => {
    if (!VALID_STATES.includes(next) || next === state) return;
    state = next;
    emit('state', {});
  };
  const clearTimer = () => {
    if (timer != null) {
      clock.clearTimeout(timer);
      timer = null;
    }
  };
  const scheduleAdvance = () => {
    clearTimer();
    const slide = story.slides[index];
    timer = clock.setTimeout(() => {
      timer = null;
      if (state !== 'playing') return;
      if (index + 1 >= story.slides.length) {
        stop();
        emit('end', {});
        return;
      }
      showSlide(index + 1);
      scheduleAdvance();
    }, slide.durationMs ?? DEFAULT_SLIDE_DURATION_MS);
  };

  /** Render one slide through the adapters. Does not touch the timer. */
  function showSlide(nextIndex) {
    index = nextIndex;
    const slide = story.slides[index];
    try {
      if (slide.camera) flyTo(slide.camera);
    } catch {
      /* A failed flight never fails the story. */
    }
    try {
      const layers = Array.isArray(slide.layers) ? slide.layers : [];
      ownedLayers = layers;
      setLayers(layers);
    } catch {
      /* Layer failures are reported by the layer system itself. */
    }
    try {
      showCaption(slide, index);
    } catch {
      /* Captions are progressive enhancement. */
    }
    emit('slide', { slide });
  }

  /** Start (or restart) playback from the first slide. */
  function play() {
    clearTimer();
    setState('playing');
    showSlide(0);
    scheduleAdvance();
  }

  function pause() {
    if (state !== 'playing') return;
    clearTimer();
    setState('paused');
  }

  function resume() {
    if (state !== 'paused') return;
    setState('playing');
    scheduleAdvance();
  }

  /** Stop playback and restore the map: hide captions, release owned layers. */
  function stop() {
    clearTimer();
    index = -1;
    try {
      hideCaption();
    } catch {
      /* Best effort. */
    }
    try {
      if (ownedLayers.length) setLayers([]);
      ownedLayers = [];
    } catch {
      /* Best effort. */
    }
    setState('idle');
  }

  function next() {
    if (index + 1 >= story.slides.length) {
      stop();
      emit('end', {});
      return;
    }
    const wasPlaying = state === 'playing';
    showSlide(index + 1);
    if (wasPlaying) scheduleAdvance();
    else clearTimer();
  }

  function prev() {
    if (index <= 0) return;
    const wasPlaying = state === 'playing';
    showSlide(index - 1);
    if (wasPlaying) scheduleAdvance();
    else clearTimer();
  }

  function goTo(nextIndex) {
    if (
      !Number.isInteger(nextIndex) ||
      nextIndex < 0 ||
      nextIndex >= story.slides.length
    )
      return;
    const wasPlaying = state === 'playing';
    if (state === 'idle') setState('playing');
    showSlide(nextIndex);
    if (state === 'playing' || wasPlaying) scheduleAdvance();
  }

  return {
    get state() {
      return state;
    },
    get index() {
      return index;
    },
    get slideCount() {
      return story.slides.length;
    },
    play,
    pause,
    resume,
    stop,
    next,
    prev,
    goTo,
  };
}
