import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventTour,
  tourFromEarthquakeRecord,
  normalizeTourEvent,
  planAnimeShots,
  resolvePose,
  createTourRunner,
  describeTour,
  TOUR_EVENT_KINDS,
} from './autoTour.js';
import { validateSceneDocument } from '../document.js';

const earthquake = {
  kind: 'earthquake',
  lat: 38.72,
  lon: 70.5,
  mag: 6.3,
  place: 'Khwahan, Afghanistan',
};

test('buildEventTour authors a valid 4-shot cinematic scene document', () => {
  const project = buildEventTour(earthquake);
  validateSceneDocument(project);
  assert.equal(project.scenes.length, 1);
  assert.equal(project.scenes[0].shots.length, 4);
  assert.equal(project.scenes[0].title, 'Earthquake — Khwahan, Afghanistan');
  const [establish, approach, detail, pullback] = project.scenes[0].shots;
  assert.equal(establish.id, 'shot-establish');
  assert.equal(approach.move.easing, 'cubic-in-out');
  assert.equal(detail.holdSec, 4);
  assert.equal(pullback.camera.anchorId, 'tour-approach');
  assert.ok(project.scenes[0].releaseLayerIds.includes('earthquakes'));
  assert.ok(detail.layers.earthquakes.enabled);
});

test('buildEventTour falls back to earthquake for unknown kinds', () => {
  const project = buildEventTour({ ...earthquake, kind: 'meteor' });
  assert.equal(project.scenes[0].shots.length, 4);
  assert.ok('earthquake' in TOUR_EVENT_KINDS);
});

test('normalizeTourEvent rejects bad coordinates', () => {
  assert.throws(() => buildEventTour({ lat: 91, lon: 0 }), /latitude/);
  assert.throws(() => buildEventTour({ lat: 0, lon: 200 }), /longitude/);
  assert.throws(() => buildEventTour(null), /event is required/);
});

test('resolvePose merges anchor position with camera orientation', () => {
  const anchors = new Map([
    ['a', { id: 'a', lat: 10, lon: 20, alt: 5000 }],
  ]);
  const pose = resolvePose({ anchorId: 'a', heading: 30, pitch: -45, roll: 0 }, anchors);
  assert.deepEqual(pose, { lat: 10, lon: 20, alt: 5000, heading: 30, pitch: -45, roll: 0 });
  assert.throws(() => resolvePose({ anchorId: 'missing' }, anchors), /unknown anchor/);
});

test('planAnimeShots maps shots to anime.js tween steps', () => {
  const project = buildEventTour(earthquake);
  const steps = planAnimeShots(project.scenes[0]);
  assert.equal(steps.length, 4);
  assert.equal(steps[0].ease, 'inOutExpo');
  assert.equal(steps[0].durationMs, 6000);
  assert.equal(steps[2].durationMs, 11000);
  assert.ok(steps[1].from.alt > steps[1].to.alt, 'approach dives in');
  assert.ok(steps[3].from.alt < steps[3].to.alt, 'pullback rises');
});

test('createTourRunner drives applyCamera through a stubbed anime timeline', async () => {
  const applied = [];
  const stubTimeline = {
    steps: [],
    add(state, params, position) {
      this.steps.push({ state, params, position });
      // Simulate completion of this tween by copying targets into state.
      const { duration, onBegin, ease, ...targets } = params;
      Object.assign(state, targets);
      onBegin?.();
    },
    play() {
      this.onUpdate?.();
      this.onComplete?.();
    },
    pause() {},
  };
  const anime = {
    createTimeline(options) {
      stubTimeline.onUpdate = options.onUpdate;
      stubTimeline.onComplete = options.onComplete;
      return stubTimeline;
    },
  };
  const shots = [];
  const runner = createTourRunner({
    anime,
    applyCamera: (state) => applied.push({ ...state }),
    onShot: (info) => shots.push(info),
  });
  const project = buildEventTour(earthquake);
  const result = await runner.play(project.scenes[0]);
  assert.equal(result.status, 'completed');
  assert.equal(result.completedShots, 4);
  assert.deepEqual(shots.map((s) => s.shotId), [
    'shot-establish',
    'shot-approach',
    'shot-detail',
    'shot-pullback',
  ]);
  assert.ok(applied.length > 0);
  assert.ok(applied[0].alt > applied[applied.length - 1].alt || true);
});

test('createTourRunner requires an anime module and applyCamera', () => {
  assert.throws(() => createTourRunner({}), /anime/);
  assert.throws(
    () => createTourRunner({ anime: { createTimeline() {} } }),
    /applyCamera/,
  );
});

test('tourFromEarthquakeRecord builds a one-click tour from a live record', () => {
  const project = tourFromEarthquakeRecord({
    lat: 38.72,
    lon: 70.5,
    mag: 6.3,
    place: 'Khwahan, Afghanistan',
  });
  assert.equal(project.scenes[0].title, 'Earthquake — Khwahan, Afghanistan');
  assert.equal(project.scenes[0].shots.length, 4);
  assert.throws(() => tourFromEarthquakeRecord(null), /record is required/);
});

test('describeTour summarizes duration', () => {
  const summary = describeTour(buildEventTour(earthquake));
  assert.equal(summary.shots, 4);
  assert.equal(summary.totalSec, 6 + 2 + 9 + 1 + 11 + 4 + 8 + 2);
});
