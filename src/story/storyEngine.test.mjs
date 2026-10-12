import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStoryPlayer,
  validateStory,
  DEFAULT_SLIDE_DURATION_MS,
} from './storyEngine.js';

const STORY = {
  id: 'test-story',
  title: 'Test Story',
  description: 'A story for tests.',
  slides: [
    {
      id: 's1',
      title: 'One',
      text: 'First slide.',
      camera: { lat: 10, lon: 20, alt: 1000 },
      layers: ['earthquakes'],
      durationMs: 100,
    },
    { id: 's2', title: 'Two', text: 'Second slide.', durationMs: 100 },
    { id: 's3', title: 'Three', text: 'Third slide.' },
  ],
};

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, delay) => {
      const id = ++seq;
      timers.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

function harness(story = STORY) {
  const clock = fakeClock();
  const calls = { flyTo: [], layers: [], captions: [], events: [] };
  const player = createStoryPlayer(
    story,
    {
      flyTo: (camera) => calls.flyTo.push(camera),
      setLayers: (ids) => calls.layers.push([...ids]),
      showCaption: (slide, index) => calls.captions.push({ slide, index }),
      hideCaption: () => calls.captions.push(null),
      onEvent: (event, detail) => calls.events.push({ event, detail }),
    },
    clock,
  );
  return { player, clock, calls };
}

// ── validation ─────────────────────────────────────────────────────────────

test('validateStory accepts the fixture and rejects junk', () => {
  assert.deepEqual(validateStory(STORY), []);
  assert.ok(validateStory(null).length > 0);
  assert.ok(validateStory({ id: 'x' }).length > 0);
  const badCamera = {
    ...STORY,
    slides: [{ id: 's', title: 'T', text: 'x', camera: { lat: 999, lon: 0 } }],
  };
  assert.ok(
    validateStory(badCamera).some((problem) => problem.includes('lat')),
  );
});

test('createStoryPlayer throws on an invalid story', () => {
  assert.throws(() => createStoryPlayer({ id: 'x' }, {}, fakeClock()));
});

// ── playback ───────────────────────────────────────────────────────────────

test('play walks slides through adapters and auto-advances', () => {
  const { player, clock, calls } = harness();
  player.play();
  assert.equal(player.state, 'playing');
  assert.equal(player.index, 0);
  assert.deepEqual(calls.flyTo[0], STORY.slides[0].camera);
  assert.deepEqual(calls.layers[0], ['earthquakes']);
  assert.equal(calls.captions[0].slide.id, 's1');

  clock.advance(100);
  assert.equal(player.index, 1);
  assert.deepEqual(calls.layers[1], []);
  clock.advance(100);
  assert.equal(player.index, 2);
});

test('playback stops at the end and releases layers', () => {
  const { player, clock, calls } = harness();
  player.play();
  clock.advance(100);
  clock.advance(100);
  clock.advance(DEFAULT_SLIDE_DURATION_MS + 1);
  assert.equal(player.state, 'idle');
  assert.equal(player.index, -1);
  assert.deepEqual(calls.layers.at(-1), []);
  assert.equal(calls.captions.at(-1), null);
  assert.ok(calls.events.some((entry) => entry.event === 'end'));
  assert.equal(clock.pending(), 0);
});

test('pause freezes the clock; resume continues', () => {
  const { player, clock } = harness();
  player.play();
  player.pause();
  assert.equal(player.state, 'paused');
  clock.advance(10000);
  assert.equal(player.index, 0);
  player.resume();
  clock.advance(100);
  assert.equal(player.index, 1);
});

test('next/prev/goTo move deterministically without a running clock', () => {
  const { player, clock } = harness();
  player.play();
  player.pause();
  player.next();
  assert.equal(player.index, 1);
  player.prev();
  assert.equal(player.index, 0);
  player.prev();
  assert.equal(player.index, 0);
  player.goTo(2);
  assert.equal(player.index, 2);
  player.goTo(99);
  assert.equal(player.index, 2);
  player.next();
  assert.equal(player.state, 'idle');
  assert.equal(clock.pending(), 0);
});

test('adapter exceptions never break playback', () => {
  const clock = fakeClock();
  const player = createStoryPlayer(
    STORY,
    {
      flyTo: () => {
        throw new Error('camera boom');
      },
      setLayers: () => {
        throw new Error('layer boom');
      },
      showCaption: () => {
        throw new Error('caption boom');
      },
      onEvent: () => {
        throw new Error('listener boom');
      },
    },
    clock,
  );
  player.play();
  clock.advance(100);
  assert.equal(player.index, 1);
});
