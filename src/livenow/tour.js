/**
 * Live Now auto-tour — "Play today's tour".
 *
 * Builds a Director Mode scene document (SCENE_DOCUMENT_VERSION 6) from the
 * top-8 ranked events: one shot per event, a cinematic move between events,
 * and a 3-second dwell (`holdSec`) on each. The document shape mirrors the
 * existing `buildEventTour` authoring in `src/director/tours/autoTour.js` so
 * the director's own playback (`createTourRunner`) and scene-document
 * validation accept it unchanged.
 *
 * SAFETY GATE (spec §4.5, non-negotiable): `confidence: 'unconfirmed'`
 * events are filtered out here and can never enter the auto-tour.
 */

export const LIVE_NOW_TOUR_VERSION = 6;
export const TOUR_MAX_EVENTS = 8;
export const TOUR_DWELL_SEC = 3;
export const TOUR_MOVE_SEC = 2.5;
export const TOUR_HASH_KEY = 'tour';
/** Mirrors the share-link size cap in src/director/tours/tourLink.js. */
export const MAX_TOUR_LINK_BYTES = 256 * 1024;

function validCoords(event) {
  return (
    Number.isFinite(event?.lat) &&
    Math.abs(event.lat) <= 90 &&
    Number.isFinite(event?.lon) &&
    Math.abs(event.lon) <= 180
  );
}

function scoreOf(event) {
  return Number.isFinite(event?.score) ? event.score : 0;
}

/** Anchor altitude by severity: critical events get the closest look. */
export function tourAltitudeForSeverity(severity) {
  if (severity >= 5) return 1_200_000;
  if (severity === 4) return 1_800_000;
  return 2_500_000;
}

/**
 * Tour-eligible events: drops `unconfirmed` (safety gate), drops malformed
 * coordinates, ranks by score desc, takes the top 8.
 * @returns {{eligible:Object[], excludedUnconfirmed:number}}
 */
export function selectTourEvents(events, maxEvents = TOUR_MAX_EVENTS) {
  const list = Array.isArray(events) ? events : [];
  let excludedUnconfirmed = 0;
  const eligible = list
    .filter((event) => {
      if (event?.confidence === 'unconfirmed') {
        excludedUnconfirmed += 1;
        return false;
      }
      return validCoords(event);
    })
    .slice()
    .sort(
      (a, b) =>
        scoreOf(b) - scoreOf(a) || String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, Math.max(0, Math.floor(Number(maxEvents) || 0)));
  return { eligible, excludedUnconfirmed };
}

function anchorFor(index, event) {
  return {
    id: `livenow-tour-anchor-${index}`,
    title: event.title ?? `Event ${index + 1}`,
    lat: event.lat,
    lon: event.lon,
    alt: tourAltitudeForSeverity(event.severity),
    altitudeReference: 'ellipsoid',
  };
}

function poseFor(anchorId, heading = 0, pitch = -48, roll = 0) {
  return { anchorId, heading, pitch, roll };
}

function shotFor(index, event, previousAnchorId) {
  const anchorId = `livenow-tour-anchor-${index}`;
  const shot = {
    id: `livenow-tour-shot-${index}`,
    title: event.title ?? `Event ${index + 1}`,
    durationSec: TOUR_MOVE_SEC,
    holdSec: TOUR_DWELL_SEC,
    camera: poseFor(anchorId),
    visual: { style: 'normal', hud: { visible: true, variant: 'tactical' } },
    layers: {},
    sourcePackId: 'live-now',
    sourcePackVersion: 1,
  };
  if (previousAnchorId) {
    shot.move = { from: poseFor(previousAnchorId), easing: 'cubic-in-out' };
  }
  return shot;
}

/**
 * Build the tour project for the top-8 eligible events.
 * @throws {Error} when no eligible events exist (`tour.noEvents`).
 */
export function buildLiveNowTour(events, { nowMs = Date.now() } = {}) {
  const { eligible, excludedUnconfirmed } = selectTourEvents(events);
  if (eligible.length === 0) {
    const error = new Error('no eligible events for the tour');
    error.code = 'tour.noEvents';
    error.excludedUnconfirmed = excludedUnconfirmed;
    throw error;
  }
  const stamp = new Date(nowMs).toISOString();
  const anchors = eligible.map((event, index) => anchorFor(index, event));
  const shots = eligible.map((event, index) =>
    shotFor(index, event, index > 0 ? anchors[index - 1].id : null),
  );
  const project = {
    version: LIVE_NOW_TOUR_VERSION,
    createdAt: stamp,
    updatedAt: stamp,
    installedBuiltInSceneIds: [],
    scenes: [
      {
        id: `livenow-tour-${stamp.slice(0, 10)}`,
        title: 'Live Now — today\u2019s tour',
        releaseLayerIds: [],
        appliedShotPacks: [],
        anchors,
        dataPacks: [],
        shots,
      },
    ],
  };
  const problems = validateTourProject(project);
  if (problems.length) {
    throw new Error(`tour project invalid: ${problems.join('; ')}`);
  }
  return {
    project,
    included: eligible.map((event) => event.id),
    excludedUnconfirmed,
  };
}

/**
 * Structural validation mirroring `validateSceneCameras` /
 * `SCENE_DOCUMENT_LIMITS` in `src/director` (self-contained so this module
 * never imports director code across the boundary; the tour test additionally
 * runs the real director validator).
 * @returns {string[]} problem descriptions (empty when valid).
 */
export function validateTourProject(project) {
  const problems = [];
  const fail = (message) => problems.push(message);
  if (!project || typeof project !== 'object')
    return ['project is not an object'];
  if (project.version !== LIVE_NOW_TOUR_VERSION)
    fail(`version must be ${LIVE_NOW_TOUR_VERSION}`);
  if (!Array.isArray(project.scenes) || project.scenes.length === 0)
    return [...problems, 'scenes must be a non-empty array'];
  for (const scene of project.scenes) {
    const anchorIds = new Set();
    for (const anchor of scene.anchors ?? []) {
      if (typeof anchor.id !== 'string' || anchorIds.has(anchor.id))
        fail(`bad/duplicate anchor id ${anchor?.id}`);
      anchorIds.add(anchor.id);
      if (!Number.isFinite(anchor.lat) || Math.abs(anchor.lat) > 90)
        fail(`anchor ${anchor.id}: bad lat`);
      if (!Number.isFinite(anchor.lon) || Math.abs(anchor.lon) > 180)
        fail(`anchor ${anchor.id}: bad lon`);
      if (
        !Number.isFinite(anchor.alt) ||
        anchor.alt < -12000 ||
        anchor.alt > 1e9
      )
        fail(`anchor ${anchor.id}: bad alt`);
      if (anchor.altitudeReference !== 'ellipsoid')
        fail(`anchor ${anchor.id}: altitudeReference must be ellipsoid`);
    }
    for (const shot of scene.shots ?? []) {
      const at = `shot ${shot?.id}`;
      if (
        !Number.isFinite(shot?.durationSec) ||
        shot.durationSec < 0.2 ||
        shot.durationSec > 86400
      )
        fail(`${at}: bad durationSec`);
      if (
        !Number.isFinite(shot?.holdSec) ||
        shot.holdSec < 0 ||
        shot.holdSec > 86400
      )
        fail(`${at}: bad holdSec`);
      for (const pose of [shot?.camera, shot?.move?.from].filter(Boolean)) {
        if (!anchorIds.has(pose.anchorId))
          fail(`${at}: unknown anchorId ${pose.anchorId}`);
        for (const [key, [lo, hi]] of [
          ['heading', [-360, 360]],
          ['pitch', [-90, 90]],
          ['roll', [-360, 360]],
        ]) {
          const value = Number(pose[key] ?? 0);
          if (!Number.isFinite(value) || value < lo || value > hi)
            fail(`${at}: bad ${key}`);
        }
      }
      if (
        shot?.move &&
        shot.move.easing !== 'cubic-in-out' &&
        shot.move.easing !== 'linear'
      )
        fail(`${at}: bad easing`);
    }
  }
  return problems;
}

/**
 * Encode a tour project as a `#tour=<base64url>` hash fragment — the same
 * channel `src/director/tours/tourLink.js` decodes (`decodeTourLink`),
 * implemented with browser primitives (TextEncoder + btoa) instead of
 * Node's Buffer so this module stays browser-boundary clean.
 */
export function encodeTourFragment(project) {
  const text = JSON.stringify(project);
  if (typeof TextEncoder === 'undefined' || typeof btoa === 'undefined') {
    throw new Error('tour link encoding needs a browser text encoder');
  }
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  const base64url = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (new TextEncoder().encode(text).length > MAX_TOUR_LINK_BYTES)
    throw new Error('tour exceeds share size limit');
  return `#${TOUR_HASH_KEY}=${base64url}`;
}

/** Full shareable URL for a tour project. */
export function tourShareUrl(project, baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl)
    throw new Error('baseUrl is required');
  return `${baseUrl}${encodeTourFragment(project)}`;
}
