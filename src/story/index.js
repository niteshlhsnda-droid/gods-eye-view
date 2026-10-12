/**
 * Story Mode — public entry point.
 *
 * Wires the dependency-free story engine to a Cesium viewer (camera flights),
 * the app's DataManager (layer toggles), and a DOM caption/transport panel.
 * The TimelineJS3 timeline is mounted lazily on top; when the package is
 * missing, the engine's own transport controls carry the story alone.
 */
import * as Cesium from 'cesium';
import { createStoryPlayer, validateStory } from './storyEngine.js';
import { getBuiltInStory } from './cyclone.js';
import { mountTimeline } from './timelineRenderer.js';
import { fadeIn, fadeOut } from '../ui/animate.js';

const STORY_PANEL_ID = 'gev-story-panel';

/**
 * @param {object} input
 * @param {object} input.viewer Cesium viewer.
 * @param {object} input.dataManager App DataManager (setEnabled(layerId, on, opts)).
 * @param {Document} [input.documentRef]
 * @param {(key: string, vars?: object) => string} [input.t] Translator.
 * @returns {{openStory: (storyId?: string) => Promise<{ok: boolean, reason?: string}>, closeStory: () => void, isOpen: () => boolean}}
 */
export function createStoryMode({
  viewer,
  dataManager,
  documentRef = globalThis.document,
  t = (key) => key,
} = {}) {
  let player = null;
  let timelineHandle = null;
  let panel = null;
  let storyLayersOn = new Set();

  const tr = (key, fallback) => {
    const value = t(key);
    return typeof value === 'string' && value !== key ? value : fallback;
  };

  function ensurePanel(story) {
    if (panel?.isConnected) return panel;
    panel?.remove?.();
    const root = documentRef.createElement('section');
    root.id = STORY_PANEL_ID;
    root.className = 'gev-story-panel';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', story.title);
    root.innerHTML =
      '<div class="gev-story-caption">' +
      '<p class="gev-story-kicker"></p>' +
      '<h2 class="gev-story-title"></h2>' +
      '<p class="gev-story-text"></p>' +
      '</div>' +
      '<div class="gev-story-timeline"></div>' +
      '<div class="gev-story-transport">' +
      '<button type="button" data-story-prev aria-label="Previous"></button>' +
      '<button type="button" data-story-play aria-label="Play or pause"></button>' +
      '<button type="button" data-story-next aria-label="Next"></button>' +
      '<button type="button" data-story-close aria-label="Close story"></button>' +
      '</div>';
    root.querySelector('.gev-story-kicker').textContent = tr(
      'story.kicker',
      'STORY MODE',
    );
    root.querySelector('[data-story-prev]').textContent = '‹';
    root
      .querySelector('[data-story-prev]')
      .setAttribute('aria-label', tr('story.prev', 'Previous slide'));
    root.querySelector('[data-story-play]').textContent = '❚❚';
    root
      .querySelector('[data-story-play]')
      .setAttribute('aria-label', tr('story.playPause', 'Play or pause'));
    root.querySelector('[data-story-next]').textContent = '›';
    root
      .querySelector('[data-story-next]')
      .setAttribute('aria-label', tr('story.next', 'Next slide'));
    root.querySelector('[data-story-close]').textContent = '✕';
    root
      .querySelector('[data-story-close]')
      .setAttribute('aria-label', tr('story.close', 'Close story'));
    root
      .querySelector('[data-story-prev]')
      .addEventListener('click', () => player?.prev());
    root
      .querySelector('[data-story-next]')
      .addEventListener('click', () => player?.next());
    root
      .querySelector('[data-story-close]')
      .addEventListener('click', () => closeStory());
    root.querySelector('[data-story-play]').addEventListener('click', () => {
      if (!player) return;
      if (player.state === 'playing') player.pause();
      else if (player.state === 'paused') player.resume();
      else player.play();
    });
    documentRef.body.appendChild(root);
    panel = root;
    return root;
  }

  function paintCaption(slide, index, total) {
    if (!panel) return;
    panel.querySelector('.gev-story-kicker').textContent =
      `${tr('story.kicker', 'STORY MODE')} · ${index + 1}/${total}`;
    panel.querySelector('.gev-story-title').textContent = slide.title;
    const text = panel.querySelector('.gev-story-text');
    text.textContent = slide.text;
    void fadeIn(text, { duration: 350 });
  }

  function flyToCamera(camera) {
    if (!viewer || !camera) return;
    try {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          camera.lon,
          camera.lat,
          camera.alt ?? 5000000,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(camera.heading ?? 0),
          pitch: Cesium.Math.toRadians(camera.pitch ?? -45),
          roll: Cesium.Math.toRadians(camera.roll ?? 0),
        },
        duration: 3.2,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    } catch {
      /* A failed flight never fails the story. */
    }
  }

  async function applyStoryLayers(layerIds) {
    const wanted = new Set(layerIds);
    const turnOff = [...storyLayersOn].filter((id) => !wanted.has(id));
    const turnOn = [...wanted].filter((id) => !storyLayersOn.has(id));
    storyLayersOn = wanted;
    for (const id of turnOff) {
      try {
        await dataManager?.setEnabled?.(id, false, { origin: 'user' });
      } catch {
        /* Layer errors surface in the layer system. */
      }
    }
    for (const id of turnOn) {
      try {
        await dataManager?.setEnabled?.(id, true, { origin: 'user' });
      } catch {
        /* Layer errors surface in the layer system. */
      }
    }
  }

  /** Open (and play) a built-in story. */
  async function openStory(storyId = 'anatomy-of-a-cyclone') {
    const story = getBuiltInStory(storyId);
    if (!story) return { ok: false, reason: 'unknown-story' };
    const problems = validateStory(story);
    if (problems.length) return { ok: false, reason: problems.join('; ') };
    closeStory();
    const root = ensurePanel(story);

    player = createStoryPlayer(story, {
      flyTo: flyToCamera,
      setLayers: (layerIds) => {
        void applyStoryLayers(layerIds);
      },
      showCaption: (slide, index) =>
        paintCaption(slide, index, story.slides.length),
      hideCaption: () => {},
      onEvent: (event, detail) => {
        if (event === 'slide') timelineHandle?.goTo(detail.index);
      },
    });

    // TimelineJS3 on top; engine transport remains the fallback.
    try {
      timelineHandle = await mountTimeline({
        container: root.querySelector('.gev-story-timeline'),
        story,
        onSlideChange: (index) => player?.goTo(index),
      });
    } catch {
      timelineHandle = null;
    }

    root.hidden = false;
    void fadeIn(root, { duration: 400 });
    player.play();
    return { ok: true };
  }

  /** Close the story: stop playback, release layers, remove the panel. */
  function closeStory() {
    try {
      player?.stop();
    } catch {
      /* Best effort. */
    }
    player = null;
    try {
      timelineHandle?.destroy();
    } catch {
      /* Best effort. */
    }
    timelineHandle = null;
    if (storyLayersOn.size) {
      const ids = [...storyLayersOn];
      storyLayersOn = new Set();
      for (const id of ids) {
        try {
          void dataManager?.setEnabled?.(id, false, { origin: 'user' });
        } catch {
          /* Best effort. */
        }
      }
    }
    if (panel) {
      const node = panel;
      panel = null;
      void fadeOut(node, { duration: 250 }).then(() => node.remove());
    }
  }

  return {
    openStory,
    closeStory,
    isOpen: () => player != null,
  };
}

export { CYCLONE_STORY, getBuiltInStory, BUILT_IN_STORIES } from './cyclone.js';
export { createStoryPlayer, validateStory } from './storyEngine.js';
export { storyToTimelineConfig, mountTimeline } from './timelineRenderer.js';
