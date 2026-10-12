/**
 * Built-in Story Mode narrative: "Anatomy of a cyclone".
 *
 * A classroom-ready, timeline-driven tour of how a tropical cyclone is born,
 * spins up, forms an eye, and makes landfall — choreographed over the Bay of
 * Bengal. Camera poses are { lat, lon, alt (meters), heading, pitch, roll };
 * `layers` names layer ids the engine enables while the slide is up.
 */

/** @type {object} */
export const CYCLONE_STORY = Object.freeze({
  id: 'anatomy-of-a-cyclone',
  title: 'Anatomy of a Cyclone',
  description:
    'How a tropical cyclone is born over warm ocean water, spins up, forms an eye, and makes landfall — told over the Bay of Bengal.',
  slides: Object.freeze([
    Object.freeze({
      id: 'overture',
      title: 'Anatomy of a Cyclone',
      text: 'Every year, some of the most powerful storms on Earth are born over the warm waters of the Bay of Bengal. This is the anatomy of one — from first breath to landfall.',
      camera: Object.freeze({
        lat: 20,
        lon: 80,
        alt: 14000000,
        heading: 0,
        pitch: -90,
        roll: 0,
      }),
      layers: Object.freeze([]),
      durationMs: 10000,
    }),
    Object.freeze({
      id: 'warm-water',
      title: 'Born over warm water',
      text: 'It starts with heat. When sea-surface temperatures pass about 26.5°C, the ocean feeds enormous energy into the air above it. Warm, moist air rises — and the engine turns on.',
      camera: Object.freeze({
        lat: 12,
        lon: 88,
        alt: 5200000,
        heading: 0,
        pitch: -55,
        roll: 0,
      }),
      layers: Object.freeze([]),
      durationMs: 11000,
    }),
    Object.freeze({
      id: 'the-spin',
      title: 'The spin begins',
      text: 'Rising air leaves low pressure behind. Surrounding air rushes in — and Earth’s rotation bends it. In the northern hemisphere that bend is counter-clockwise: the storm begins to spin.',
      camera: Object.freeze({
        lat: 14,
        lon: 87,
        alt: 2800000,
        heading: 20,
        pitch: -48,
        roll: 0,
      }),
      layers: Object.freeze([]),
      durationMs: 11000,
    }),
    Object.freeze({
      id: 'the-eye',
      title: 'The eye forms',
      text: 'At the center, air sinks instead of rising — and a calm eye opens, ringed by the eyewall, where the fiercest winds on the planet live. From orbit, this is the most recognizable shape in meteorology.',
      camera: Object.freeze({
        lat: 16,
        lon: 86.5,
        alt: 1500000,
        heading: 0,
        pitch: -60,
        roll: 0,
      }),
      layers: Object.freeze(['satellites']),
      durationMs: 11000,
    }),
    Object.freeze({
      id: 'landfall',
      title: 'Landfall',
      text: 'The storm’s final act is its most dangerous: landfall. Winds slam the coast, but the real killer is the storm surge — a wall of ocean pushed ashore. Ships in its path scatter; coastal cities brace.',
      camera: Object.freeze({
        lat: 20.2,
        lon: 86.4,
        alt: 1900000,
        heading: -15,
        pitch: -52,
        roll: 0,
      }),
      layers: Object.freeze(['vessels']),
      durationMs: 12000,
    }),
    Object.freeze({
      id: 'epilogue',
      title: 'What remains',
      text: 'Cut off from its warm-water fuel, the cyclone weakens and dies over land — leaving flooded fields and a coastline changed. Understanding the anatomy is the first step to surviving it.',
      camera: Object.freeze({
        lat: 20,
        lon: 80,
        alt: 14000000,
        heading: 0,
        pitch: -90,
        roll: 0,
      }),
      layers: Object.freeze([]),
      durationMs: 10000,
    }),
  ]),
});

/** Built-in stories shipped with Story Mode. */
export const BUILT_IN_STORIES = Object.freeze([CYCLONE_STORY]);

/**
 * @param {string} id
 * @returns {object|null} The built-in story with that id, or null.
 */
export function getBuiltInStory(id) {
  return BUILT_IN_STORIES.find((story) => story.id === id) ?? null;
}
