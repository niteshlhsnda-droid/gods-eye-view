import test from 'node:test';
import assert from 'node:assert/strict';
import { CYCLONE_STORY, getBuiltInStory } from './cyclone.js';
import { validateStory } from './storyEngine.js';
import {
  storyToTimelineConfig,
  readTimelineIndex,
} from './timelineRenderer.js';

test('the built-in cyclone story validates', () => {
  assert.deepEqual(validateStory(CYCLONE_STORY), []);
  assert.equal(CYCLONE_STORY.id, 'anatomy-of-a-cyclone');
  assert.ok(CYCLONE_STORY.slides.length >= 5);
});

test('every cyclone slide has a title, narrative text and a sane camera', () => {
  for (const slide of CYCLONE_STORY.slides) {
    assert.ok(slide.title.length > 0, `${slide.id} title`);
    assert.ok(slide.text.length > 40, `${slide.id} text`);
    assert.ok(
      slide.camera.lat >= -90 && slide.camera.lat <= 90,
      `${slide.id} lat`,
    );
    assert.ok(
      slide.camera.lon >= -180 && slide.camera.lon <= 180,
      `${slide.id} lon`,
    );
    assert.ok(slide.camera.alt > 0, `${slide.id} alt`);
  }
});

test('getBuiltInStory resolves the cyclone story and null for unknown ids', () => {
  assert.equal(getBuiltInStory('anatomy-of-a-cyclone'), CYCLONE_STORY);
  assert.equal(getBuiltInStory('nope'), null);
});

test('storyToTimelineConfig emits TimelineJS3 JSON with T+ display dates', () => {
  const config = storyToTimelineConfig(CYCLONE_STORY);
  assert.equal(config.title.text.headline, CYCLONE_STORY.title);
  assert.equal(config.events.length, CYCLONE_STORY.slides.length);
  assert.equal(config.events[0].display_date, 'T+0 hours — formation');
  assert.equal(config.events[2].display_date, 'T+12 hours');
  assert.equal(
    config.events[0].text.headline,
    CYCLONE_STORY.slides[0].title,
  );
  for (const [index, event] of config.events.entries()) {
    assert.equal(event.unique_id, CYCLONE_STORY.slides[index].id);
    assert.ok(Number.isInteger(event.start_date.year));
  }
});

test('readTimelineIndex resolves string unique_ids through the resolver', () => {
  const resolve = (id) => ({ overture: 0, 'the-eye': 3 })[id] ?? null;
  assert.equal(
    readTimelineIndex(
      { getCurrentSlide: () => ({ data: { unique_id: 'the-eye' } }) },
      resolve,
    ),
    3,
  );
  assert.equal(
    readTimelineIndex({ current_id: 'overture' }, resolve),
    0,
  );
  assert.equal(readTimelineIndex({ current_id: 'missing' }, resolve), null);
  assert.equal(readTimelineIndex({}, resolve), null);
  assert.equal(
    readTimelineIndex({ getCurrentSlide: () => { throw new Error('x'); } }),
    null,
  );
});
