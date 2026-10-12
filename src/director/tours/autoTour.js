/**
 * Director Mode: one-click cinematic auto-tours of live events, powered by anime.js.
 *
 * `buildEventTour` authors a valid SCENE_DOCUMENT_VERSION=6 project for any
 * live event (earthquake, fire, cyclone): an establishing wide shot, a dive-in,
 * a detail hold with the event's data layers enabled, and a pull-back.
 *
 * `createTourRunner` plays the tour with anime.js timelines (the approved MIT
 * animation library — GSAP is never used): each shot's camera move is an anime
 * tween with a cinematic ease, driving `applyCamera` on every update. The
 * anime module is injected so unit tests can run headless with a stub.
 */

import { SCENE_DOCUMENT_VERSION, validateSceneDocument } from '../document.js';

export const TOUR_EVENT_KINDS = Object.freeze({
  earthquake: Object.freeze({
    label: 'Earthquake',
    layers: ['earthquakes'],
    anchors: { wide: 12_000_000, approach: 1_500_000, detail: 250_000 },
  }),
  fire: Object.freeze({
    label: 'Wildfire',
    layers: ['firms', 'perimeters'],
    anchors: { wide: 8_000_000, approach: 900_000, detail: 120_000 },
  }),
  cyclone: Object.freeze({
    label: 'Cyclone',
    layers: ['cyclones', 'wind'],
    anchors: { wide: 14_000_000, approach: 2_000_000, detail: 500_000 },
  }),
});

/** Validate and normalize a live-event record into a tour event. */
export function normalizeTourEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('event is required');
  const lat = Number(event.lat);
  const lon = Number(event.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90)
    throw new Error('event.lat must be a valid latitude');
  if (!Number.isFinite(lon) || Math.abs(lon) > 180)
    throw new Error('event.lon must be a valid longitude');
  const kind =
    typeof event.kind === 'string' && event.kind in TOUR_EVENT_KINDS
      ? event.kind
      : 'earthquake';
  return {
    kind,
    lat,
    lon,
    title:
      typeof event.title === 'string' && event.title.trim()
        ? event.title
        : defaultTourTitle(kind, event),
    subtitle: typeof event.subtitle === 'string' ? event.subtitle : '',
  };
}

function defaultTourTitle(kind, event) {
  const label = TOUR_EVENT_KINDS[kind].label;
  if (event.place) return `${label} — ${event.place}`;
  if (event.mag != null) return `${label} M${event.mag}`;
  return `${label} event`;
}

/**
 * Author a cinematic 4-shot auto-tour project for a live event.
 * Returns a validated scene document (SCENE_DOCUMENT_VERSION).
 */
export function buildEventTour(event) {
  const normalized = normalizeTourEvent(event);
  const preset = TOUR_EVENT_KINDS[normalized.kind];
  const { lat, lon } = normalized;
  const { wide, approach, detail } = preset.anchors;

  const anchors = [
    anchor('tour-wide', 'Wide establishing view', lat, lon, wide),
    anchor('tour-approach', 'Approach', lat, lon, approach),
    anchor('tour-detail', 'Event detail', lat, lon, detail),
  ];

  const layers = Object.fromEntries(
    preset.layers.map((id) => [id, { enabled: true, params: {} }]),
  );
  const visual = {
    style: 'normal',
    hud: { visible: true, variant: 'tactical' },
  };

  const project = {
    version: SCENE_DOCUMENT_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    installedBuiltInSceneIds: [],
    scenes: [
      {
        id: `tour-${normalized.kind}-${Date.now().toString(36)}`,
        title: normalized.title,
        releaseLayerIds: [...preset.layers],
        appliedShotPacks: [],
        anchors,
        dataPacks: [],
        shots: [
          shot({
            id: 'shot-establish',
            title: 'Establishing view',
            durationSec: 6,
            holdSec: 2,
            camera: pose('tour-wide', 0, -55, 0),
            visual,
            layers,
          }),
          shot({
            id: 'shot-approach',
            title: 'Dive in',
            durationSec: 9,
            holdSec: 1,
            camera: pose('tour-approach', 0, -48, 0),
            move: {
              from: pose('tour-wide', 0, -55, 0),
              easing: 'cubic-in-out',
            },
            visual,
            layers,
          }),
          shot({
            id: 'shot-detail',
            title: normalized.subtitle || 'Event detail',
            durationSec: 11,
            holdSec: 4,
            camera: pose('tour-detail', 25, -38, 0),
            move: {
              from: pose('tour-approach', 0, -48, 0),
              easing: 'cubic-in-out',
            },
            visual,
            layers,
          }),
          shot({
            id: 'shot-pullback',
            title: 'Pull back',
            durationSec: 8,
            holdSec: 2,
            camera: pose('tour-approach', -20, -52, 0),
            move: {
              from: pose('tour-detail', 25, -38, 0),
              easing: 'cubic-in-out',
            },
            visual,
            layers,
          }),
        ],
      },
    ],
  };
  return validateSceneDocument(project);
}

function anchor(id, title, lat, lon, alt) {
  return { id, title, lat, lon, alt, altitudeReference: 'ellipsoid' };
}

function pose(anchorId, heading, pitch, roll) {
  return { anchorId, heading, pitch, roll };
}

function shot({
  id,
  title,
  durationSec,
  holdSec,
  camera,
  move,
  visual,
  layers,
}) {
  const entry = {
    id,
    title,
    durationSec,
    holdSec,
    camera,
    visual,
    layers,
    sourcePackId: 'auto-tour',
    sourcePackVersion: 1,
  };
  if (move) entry.move = move;
  return entry;
}

/** Resolve an anchored or explicit camera pose to {lat, lon, alt, heading, pitch, roll}. */
export function resolvePose(poseValue, anchorsById) {
  if (!poseValue || typeof poseValue !== 'object')
    throw new Error('camera pose is required');
  const anchor = poseValue.anchorId
    ? anchorsById.get(poseValue.anchorId)
    : null;
  if (poseValue.anchorId && !anchor)
    throw new Error(`unknown anchor: ${poseValue.anchorId}`);
  return {
    lat: Number(anchor?.lat ?? poseValue.lat),
    lon: Number(anchor?.lon ?? poseValue.lon),
    alt: Number(anchor?.alt ?? poseValue.alt),
    heading: Number(poseValue.heading ?? 0),
    pitch: Number(poseValue.pitch ?? -45),
    roll: Number(poseValue.roll ?? 0),
  };
}

/**
 * Plan the anime.js timeline steps for a scene's shots.
 * Pure: returns [{shotId, from, to, durationMs, ease}] — no anime.js touched.
 */
export function planAnimeShots(scene) {
  const anchorsById = new Map(
    (scene.anchors || []).map((anchor) => [anchor.id, anchor]),
  );
  return (scene.shots || []).map((shot) => {
    const to = resolvePose(shot.camera, anchorsById);
    const from = shot.move?.from
      ? resolvePose(shot.move.from, anchorsById)
      : to;
    return {
      shotId: shot.id,
      from,
      to,
      durationMs: Math.round(Number(shot.durationSec || 4) * 1000),
      ease: 'inOutExpo',
    };
  });
}

/**
 * Play a tour scene with anime.js cinematic camera tweens.
 *
 * @param {Object} options
 * @param {Object} options.anime anime.js v4 module (exposes createTimeline).
 * @param {function(Object):void} options.applyCamera Applies {lat, lon, alt, heading, pitch, roll} to the viewer.
 * @param {function({shotId:string, index:number}):void} [options.onShot] Shot-start callback.
 * @returns {{play(scene, {signal}):Promise<{status:'completed'|'cancelled', completedShots:number}>, stop():void}}
 */
export function createTourRunner({ anime, applyCamera, onShot } = {}) {
  if (!anime || typeof anime.createTimeline !== 'function')
    throw new Error('an anime.js module exposing createTimeline is required');
  if (typeof applyCamera !== 'function')
    throw new Error('applyCamera is required');
  let active = null;

  function play(scene, { signal } = {}) {
    stop();
    const steps = planAnimeShots(scene);
    let resolve;
    const done = new Promise((r) => {
      resolve = r;
    });
    const state = steps.length ? { ...steps[0].from } : null;
    const token = { cancelled: false };
    const abort = () => {
      if (token.cancelled) return;
      token.cancelled = true;
      active?.pause?.();
      resolve({ status: 'cancelled', completedShots });
    };
    signal?.addEventListener?.('abort', abort, { once: true });
    let completedShots = 0;
    const timeline = anime.createTimeline({
      defaults: { ease: 'inOutExpo' },
      onUpdate: () => {
        if (!token.cancelled && state) applyCamera(state);
      },
      onComplete: () => {
        if (!token.cancelled) {
          completedShots = steps.length;
          resolve({ status: 'completed', completedShots });
        }
      },
    });
    steps.forEach((step, index) => {
      const target = { ...step.to };
      timeline.add(
        state,
        {
          ...target,
          duration: step.durationMs,
          onBegin: () => onShot?.({ shotId: step.shotId, index }),
        },
        index === 0 ? 0 : '>',
      );
    });
    active = timeline;
    if (state) applyCamera(state);
    timeline.play?.();
    return done.finally(() => {
      signal?.removeEventListener?.('abort', abort);
      if (active === timeline) active = null;
    });
  }

  function stop() {
    if (active) {
      active.pause?.();
      active = null;
    }
  }

  return { play, stop };
}

/** One-click tour from a live earthquake-layer record ({lat, lon, mag, place}). */
export function tourFromEarthquakeRecord(record) {
  if (!record || typeof record !== 'object')
    throw new Error('record is required');
  return buildEventTour({
    kind: 'earthquake',
    lat: record.lat,
    lon: record.lon,
    mag: record.mag,
    place: record.place,
  });
}

/** One-line summary of a tour project for share cards / HUD. */
export function describeTour(project) {
  const scenes = project?.scenes || [];
  const shots = scenes.flatMap((scene) => scene.shots || []);
  const totalSec = shots.reduce(
    (sum, shot) =>
      sum + Number(shot.durationSec || 0) + Number(shot.holdSec || 0),
    0,
  );
  return {
    title: scenes[0]?.title || 'Tour',
    scenes: scenes.length,
    shots: shots.length,
    totalSec: Math.round(totalSec),
  };
}
