import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTourSteps,
  stepsWithExistingTargets,
  maybeStartOnboardingTour,
  ONBOARDING_TOUR_STORAGE_KEY,
  ONBOARDING_TOUR_SESSION_KEY,
} from './onboardingTour.js';

function memoryStore() {
  const values = new Map();
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, value),
    read: (name) => values.get(name) ?? null,
  };
}

test('buildTourSteps returns five i18n-aware steps', () => {
  const steps = buildTourSteps((key) => key);
  assert.equal(steps.length, 5);
  const ids = steps.map((step) => step.id);
  assert.deepEqual(ids, ['search', 'layers', 'share', 'style', 'voice']);
  for (const step of steps) {
    assert.ok(step.selector.startsWith('#') || step.selector.startsWith('['));
    assert.ok(step.title.length > 0);
    assert.ok(step.description.length > 0);
  }
});

test('stepsWithExistingTargets drops missing chrome', () => {
  const steps = buildTourSteps((key) => key);
  const documentRef = {
    querySelector: (selector) =>
      selector === '#share-btn' ? { selector } : null,
  };
  const kept = stepsWithExistingTargets(steps, documentRef);
  assert.deepEqual(
    kept.map((step) => step.id),
    ['share'],
  );
  assert.deepEqual(stepsWithExistingTargets(steps, null), []);
});

test('maybeStartOnboardingTour never tours twice (durable key)', async () => {
  const storage = memoryStore();
  storage.setItem(ONBOARDING_TOUR_STORAGE_KEY, 'seen');
  const drove = await maybeStartOnboardingTour({
    storage,
    sessionStorageRef: memoryStore(),
    location: { search: '', hash: '' },
    delayMs: 0,
  });
  assert.equal(drove, false);
});

test('maybeStartOnboardingTour skips share/embed/welcome=0 sessions', async () => {
  for (const location of [
    { search: '', hash: '#lat=1&lon=2' },
    { search: '?embed=1', hash: '' },
    { search: '?welcome=0', hash: '' },
  ]) {
    const drove = await maybeStartOnboardingTour({
      storage: memoryStore(),
      sessionStorageRef: memoryStore(),
      location,
      delayMs: 0,
    });
    assert.equal(drove, false, JSON.stringify(location));
  }
});

test('maybeStartOnboardingTour yields to exclusive surfaces', async () => {
  const drove = await maybeStartOnboardingTour({
    storage: memoryStore(),
    sessionStorageRef: memoryStore(),
    location: { search: '', hash: '' },
    exclusiveSurfaceActive: () => true,
    delayMs: 0,
  });
  assert.equal(drove, false);
});

test('maybeStartOnboardingTour resolves false when driver.js is missing', async () => {
  // driver.js is not installed in the lane worktree, so the dynamic import
  // fails and the tour degrades to "not driven" — but the session guard is
  // still written so it does not retry every init.
  const session = memoryStore();
  const drove = await maybeStartOnboardingTour({
    storage: memoryStore(),
    sessionStorageRef: session,
    location: { search: '', hash: '' },
    delayMs: 0,
    documentRef: { querySelector: () => ({}) },
  });
  assert.equal(drove, false);
  assert.equal(session.read(ONBOARDING_TOUR_SESSION_KEY), 'seen');
});
