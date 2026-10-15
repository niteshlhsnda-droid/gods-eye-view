import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveNowPanel } from './panel.js';
import { makeDocument, makeElement } from './testdom.mjs';

const NOW = Date.parse('2026-10-13T15:00:00.000Z');

function event(id, overrides = {}) {
  return {
    id,
    type: 'quake',
    title: `Event ${id}`,
    summary: `Summary ${id}`,
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

function payload(events) {
  return {
    schema: 'gev/live-now',
    version: 1,
    generatedAt: '2026-10-13T14:55:00.000Z',
    events,
    feedHealth: {},
    staleSources: ['fires', 'weather', 'maritime'],
  };
}

function fixture({ fetchData } = {}) {
  const doc = makeDocument();
  const button = makeElement('button');
  button.id = 'live-now-btn';
  const dot = makeElement('span');
  dot.className = 'live-now-dot';
  dot.hidden = true;
  button.append(dot);
  const calls = { flyTo: [], tours: [], toasts: [] };
  const panel = createLiveNowPanel({
    documentRef: doc,
    button,
    fetchData:
      fetchData ??
      (async () => ({
        payload: payload([event('a'), event('b')]),
        fresh: true,
        fromCache: false,
      })),
    flyTo: (ev) => calls.flyTo.push(ev.id),
    onPlayTourProject: (project, fragment) =>
      calls.tours.push({ project, fragment }),
    onToast: (message) => calls.toasts.push(message),
    refreshIntervalMs: 0,
    nowMs: () => NOW,
  });
  return { doc, button, dot, panel, calls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function sheetOf(doc) {
  return doc.getElementById('gev-live-now-sheet');
}

function sheetText(doc) {
  const sheet = sheetOf(doc);
  assert.ok(sheet, 'sheet is open');
  return JSON.stringify(sheet, (k, v) => (k === 'parent' ? undefined : v));
}

test('panel requires the toolbar button', () => {
  assert.throws(
    () => createLiveNowPanel({ documentRef: makeDocument() }),
    /toolbar button/,
  );
});

test('toolbar click opens the sheet and renders cards + stale badge', async () => {
  const { doc, button, panel, calls } = fixture();
  panel.start();
  await tick();
  button.fire('click');
  await tick();
  await tick();
  assert.equal(panel.isOpen, true);
  const text = sheetText(doc);
  assert.ok(text.includes('Event a'), 'card a rendered');
  assert.ok(text.includes('Event b'), 'card b rendered');
  assert.ok(text.includes('3 sources stale'), 'stale-source badge rendered');
  assert.ok(text.includes('Play today'), 'tour button rendered');
  // Fly-to from a card button (the close button comes first in DOM order).
  const cardButton = sheetOf(doc)
    .querySelectorAll('button')
    .find((b) => b.className === 'ln-flyto');
  assert.ok(cardButton, 'card fly-to button exists');
  cardButton.fire('click', { preventDefault: () => {} });
  assert.deepEqual(calls.flyTo, ['a']);
  panel.stop();
});

test('Escape closes the sheet and returns focus to the button', async () => {
  const { doc, button, panel } = fixture();
  panel.start();
  await tick();
  panel.open();
  await tick();
  await tick();
  assert.equal(panel.isOpen, true);
  doc.fire('keydown', { key: 'Escape' });
  assert.equal(panel.isOpen, false);
  assert.equal(sheetOf(doc), null);
  assert.equal(button.focused, true, 'focus returns to the toolbar button');
  assert.equal(
    doc.listenerCount('keydown'),
    0,
    'key listener removed on close',
  );
  panel.stop();
});

test('empty events render the quiet-planet state with minutes', async () => {
  const { doc, panel } = fixture({
    fetchData: async () => ({
      payload: payload([]),
      fresh: true,
      fromCache: false,
    }),
  });
  panel.start();
  await tick();
  panel.open();
  await tick();
  await tick();
  const text = sheetText(doc);
  assert.ok(text.includes('Quiet planet'), 'empty state rendered');
  assert.ok(text.includes('5 min ago'), 'minutes since generatedAt');
  panel.stop();
});

test('failed fetch with no payload renders the unavailable state', async () => {
  const { doc, panel } = fixture({
    fetchData: async () => ({
      payload: null,
      fresh: false,
      fromCache: false,
      error: 'x',
    }),
  });
  panel.open();
  await tick();
  await tick();
  const text = sheetText(doc);
  assert.ok(
    text.includes('Live data unavailable'),
    'unavailable state rendered',
  );
  panel.stop();
});

test('loading shows before the first fetch resolves', async () => {
  const { doc, panel } = fixture({
    fetchData: () => new Promise(() => {}),
  });
  panel.open();
  await tick();
  const text = sheetText(doc);
  assert.ok(text.includes('Checking the planet'), 'loading state rendered');
  panel.stop();
});

test('empty events with all feeds stale render the all-feeds-stale state', async () => {
  const { doc, panel } = fixture({
    fetchData: async () => ({
      payload: {
        schema: 'gev/live-now',
        version: 1,
        generatedAt: '2026-10-13T14:55:00.000Z',
        events: [],
        staleSources: ['quakes', 'fires'],
        feedHealth: {
          feeds: [
            { id: 'quakes', label: 'Earthquakes (USGS)', state: 'stale' },
            { id: 'fires', label: 'Fires (NASA FIRMS)', state: 'unavailable' },
          ],
        },
      },
      fresh: true,
      fromCache: false,
    }),
  });
  panel.open();
  await tick();
  await tick();
  const text = sheetText(doc);
  assert.ok(
    text.includes('every source is stale'),
    'all-feeds-stale state rendered, not quiet planet',
  );
  assert.ok(!text.includes('Quiet planet'), 'no quiet-planet mislabel');
  panel.stop();
});

test('per-feed health list shows state and age', async () => {
  const { doc, panel } = fixture({
    fetchData: async () => ({
      payload: {
        schema: 'gev/live-now',
        version: 1,
        generatedAt: '2026-10-13T14:55:00.000Z',
        events: [event('a')],
        staleSources: ['fires'],
        feedHealth: {
          feeds: [
            {
              id: 'quakes',
              label: 'Earthquakes (USGS)',
              state: 'nominal',
              lastUpdate: '2026-10-13T14:55:00.000Z',
            },
            {
              id: 'fires',
              label: 'Fires (NASA FIRMS)',
              state: 'unavailable',
              lastUpdate: null,
            },
          ],
        },
      },
      fresh: true,
      fromCache: false,
    }),
  });
  panel.open();
  await tick();
  await tick();
  const text = sheetText(doc);
  assert.ok(text.includes('Source status'), 'feed health heading rendered');
  assert.ok(
    text.includes('Earthquakes (USGS) · nominal · 5 min ago'),
    'healthy feed line with age rendered',
  );
  assert.ok(
    text.includes('Fires (NASA FIRMS) · unavailable · never updated'),
    'dead feed line with never-updated rendered',
  );
  panel.stop();
});

test('pulsing dot: visible for fresh severity-5, hidden otherwise', async () => {
  const critical = event('c', {
    severity: 5,
    startedAt: '2026-10-13T14:30:00.000Z',
  });
  const stale = event('s', {
    severity: 5,
    startedAt: '2026-10-13T08:00:00.000Z',
  });
  const mild = [event('m', { severity: 2 })];

  const a = fixture({
    fetchData: async () => ({ payload: payload([critical]), fresh: true }),
  });
  await a.panel.refresh();
  assert.equal(a.dot.hidden, false, 'dot shows for fresh severity-5');

  const b = fixture({
    fetchData: async () => ({ payload: payload([stale]), fresh: true }),
  });
  await b.panel.refresh();
  assert.equal(
    b.dot.hidden,
    true,
    'dot hides when severity-5 is older than 6h',
  );

  const c = fixture({
    fetchData: async () => ({ payload: payload(mild), fresh: true }),
  });
  await c.panel.refresh();
  assert.equal(c.dot.hidden, true, 'dot hides without severity-5');

  a.panel.stop();
  b.panel.stop();
  c.panel.stop();
});

test('Play tour builds the top-8 eligible project and hands it to the shell', async () => {
  const events = [];
  for (let i = 0; i < 9; i++) {
    events.push(event(`e${i}`, { score: 90 - i }));
  }
  events.push(event('u1', { confidence: 'unconfirmed', score: 99 }));
  events.push(event('u2', { confidence: 'unconfirmed', score: 98 }));
  const { doc, panel, calls } = fixture({
    fetchData: async () => ({
      payload: payload(events),
      fresh: true,
      fromCache: false,
    }),
  });
  panel.start();
  await tick();
  panel.open();
  await tick();
  await tick();

  const tourBtn = sheetOf(doc)
    .querySelectorAll('button')
    .find((b) => b.className === 'ln-tour-btn');
  assert.ok(tourBtn, 'tour button exists');
  tourBtn.fire('click', { preventDefault: () => {} });

  assert.equal(calls.tours.length, 1);
  const { project, fragment } = calls.tours[0];
  assert.equal(project.version, 6);
  assert.equal(project.scenes[0].shots.length, 8, 'top 8 only');
  const shotTitles = project.scenes[0].shots.map((s) => s.title);
  assert.ok(
    !shotTitles.some((t) => t.includes('u1') || t.includes('u2')),
    'unconfirmed excluded',
  );
  assert.ok(shotTitles[0].includes('e0'), 'highest score first');
  for (const shot of project.scenes[0].shots) {
    assert.equal(shot.holdSec, 3, '3s dwell each');
  }
  assert.ok(fragment.startsWith('#tour='), 'shareable fragment produced');
  assert.equal(panel.isOpen, false, 'sheet closes when the tour starts');
  panel.stop();
});

test('Play tour with no eligible events toasts instead of touring', async () => {
  const { doc, panel, calls } = fixture({
    fetchData: async () => ({
      payload: payload([event('u', { confidence: 'unconfirmed' })]),
      fresh: true,
      fromCache: false,
    }),
  });
  panel.start();
  await tick();
  panel.open();
  await tick();
  await tick();
  const tourBtn = sheetOf(doc)
    .querySelectorAll('button')
    .find((b) => b.className === 'ln-tour-btn');
  tourBtn.fire('click', { preventDefault: () => {} });
  assert.equal(calls.tours.length, 0, 'no project handed over');
  assert.equal(calls.toasts.length, 1);
  assert.ok(calls.toasts[0].length > 0, 'user told there is nothing to tour');
  panel.stop();
});
