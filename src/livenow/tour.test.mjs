import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLiveNowTour,
  selectTourEvents,
  validateTourProject,
  encodeTourFragment,
  tourShareUrl,
  tourAltitudeForSeverity,
  TOUR_MAX_EVENTS,
  TOUR_DWELL_SEC,
} from './tour.js';
// The real director validator (test-only import; excluded from boundary
// checks) proves the tour project is genuinely playable.
import { validateSceneDocument } from '../director/document.js';

function event(id, overrides = {}) {
  return {
    id,
    type: 'quake',
    title: `Event ${id}`,
    lat: 10,
    lon: 20,
    severity: 3,
    startedAt: '2026-10-13T14:00:00.000Z',
    updatedAt: '2026-10-13T14:30:00.000Z',
    sources: [{ name: 'USGS', url: 'https://example.invalid/' }],
    confidence: 'verified',
    score: 50,
    ...overrides,
  };
}

test('selectTourEvents excludes unconfirmed and caps at 8', () => {
  const events = [];
  for (let i = 0; i < 10; i++) events.push(event(`e${i}`, { score: 100 - i }));
  events.push(event('u1', { confidence: 'unconfirmed', score: 999 }));
  events.push(event('bad', { lat: 999, score: 998 }));
  const { eligible, excludedUnconfirmed } = selectTourEvents(events);
  assert.equal(eligible.length, TOUR_MAX_EVENTS);
  assert.equal(excludedUnconfirmed, 1);
  assert.ok(!eligible.some((e) => e.confidence === 'unconfirmed'));
  assert.ok(!eligible.some((e) => e.id === 'bad'));
  assert.equal(eligible[0].id, 'e0', 'highest score first');
});

test('tourAltitudeForSeverity brings critical events closer', () => {
  assert.ok(tourAltitudeForSeverity(5) < tourAltitudeForSeverity(3));
  assert.ok(tourAltitudeForSeverity(4) < tourAltitudeForSeverity(2));
});

test('buildLiveNowTour produces a valid, playable director project', () => {
  const events = [];
  for (let i = 0; i < 6; i++) events.push(event(`e${i}`, { score: 90 - i }));
  const { project, included, excludedUnconfirmed } = buildLiveNowTour(events, {
    nowMs: Date.parse('2026-10-13T15:00:00.000Z'),
  });
  assert.equal(excludedUnconfirmed, 0);
  assert.deepEqual(included, ['e0', 'e1', 'e2', 'e3', 'e4', 'e5']);
  // The REAL director scene-document validator accepts the project.
  const validated = validateSceneDocument(project);
  assert.ok(validated, 'director validator accepts the tour project');
  const scene = project.scenes[0];
  assert.equal(scene.shots.length, 6);
  for (const [i, shot] of scene.shots.entries()) {
    assert.equal(shot.holdSec, TOUR_DWELL_SEC, `shot ${i}: 3s dwell`);
    assert.ok(
      scene.anchors.some((a) => a.id === shot.camera.anchorId),
      `shot ${i}: camera anchor resolves`,
    );
    if (i > 0) {
      assert.ok(shot.move, `shot ${i}: cinematic move from previous anchor`);
      assert.equal(shot.move.easing, 'cubic-in-out');
    } else {
      assert.equal(shot.move, undefined, 'first shot has no move');
    }
  }
});

test('buildLiveNowTour throws a coded error with no eligible events', () => {
  let err = null;
  try {
    buildLiveNowTour([event('u', { confidence: 'unconfirmed' })]);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'throws');
  assert.equal(err.code, 'tour.noEvents');
});

test('validateTourProject catches bad anchors and shots', () => {
  const { project } = buildLiveNowTour([event('e0')]);
  assert.deepEqual(validateTourProject(project), []);
  const broken = JSON.parse(JSON.stringify(project));
  broken.scenes[0].anchors[0].lat = 999;
  assert.ok(validateTourProject(broken).some((p) => p.includes('bad lat')));
  const broken2 = JSON.parse(JSON.stringify(project));
  broken2.scenes[0].shots[0].holdSec = -1;
  assert.ok(validateTourProject(broken2).some((p) => p.includes('holdSec')));
  const broken3 = JSON.parse(JSON.stringify(project));
  broken3.scenes[0].shots[0].camera.anchorId = 'nope';
  assert.ok(
    validateTourProject(broken3).some((p) => p.includes('unknown anchorId')),
  );
  assert.ok(validateTourProject(null).length > 0);
});

test('encodeTourFragment is a shareable #tour fragment the app can decode', () => {
  const { project } = buildLiveNowTour([event('e0'), event('e1')]);
  const fragment = encodeTourFragment(project);
  assert.ok(fragment.startsWith('#tour='));
  const payloadPart = fragment.slice('#tour='.length);
  assert.ok(
    !payloadPart.includes('+') &&
      !payloadPart.includes('/') &&
      !payloadPart.includes('='),
    'base64url payload, no padding',
  );
  // Decode the way src/director/tours/tourLink.js does (URLSearchParams + base64url).
  const params = new URLSearchParams(fragment.slice(1));
  const payload = params.get('tour');
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  const body = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  const json = Buffer.from(body, 'base64').toString('utf8');
  assert.deepEqual(
    JSON.parse(json),
    project,
    'fragment round-trips the project',
  );
});

test('tourShareUrl builds a full URL from a base', () => {
  const { project } = buildLiveNowTour([event('e0')]);
  const url = tourShareUrl(project, 'https://example.invalid/globe');
  assert.ok(url.startsWith('https://example.invalid/globe#tour='));
  assert.throws(() => tourShareUrl(project, ''), /baseUrl/);
});
