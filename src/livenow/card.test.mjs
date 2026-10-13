import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEventCard,
  formatTimeAgo,
  formatSourceCount,
  severityIcon,
} from './card.js';
import { makeDocument } from './testdom.mjs';

function event(overrides = {}) {
  return {
    id: 'quake:7xfjw:cb1d7d9f',
    type: 'quake',
    title: 'M6.9 earthquake — central Mid-Atlantic Ridge',
    summary: 'Magnitude 6.9 earthquake central Mid-Atlantic Ridge.',
    lat: -0.4016,
    lon: -19.4151,
    severity: 5,
    startedAt: '2026-10-13T12:23:07.383Z',
    updatedAt: '2026-10-13T13:00:00.000Z',
    sources: [{ name: 'USGS', url: 'https://example.invalid/e' }],
    confidence: 'verified',
    ...overrides,
  };
}

const NOW = Date.parse('2026-10-13T13:30:00.000Z');

test('card renders title, summary, time-ago, sources, confidence', () => {
  const doc = makeDocument();
  const card = createEventCard(event(), {
    documentRef: doc,
    locale: 'en',
    nowMs: NOW,
  });
  assert.equal(card.tagName, 'ARTICLE');
  const text = JSON.stringify(card, (k, v) => (k === 'parent' ? undefined : v));
  assert.ok(text.includes('M6.9 earthquake'), 'title present');
  assert.ok(text.includes('30 min ago'), 'time-ago present');
  assert.ok(text.includes('1 source'), 'source count present');
  assert.ok(text.includes('verified'), 'confidence present');
  assert.ok(
    text.includes('Critical'),
    'severity text present (never color alone)',
  );
  assert.ok(text.includes(severityIcon(5)), 'severity icon present');
});

test('card is keyboard-activatable: Enter on the card flies there', () => {
  const doc = makeDocument();
  let flown = null;
  const card = createEventCard(event(), {
    documentRef: doc,
    locale: 'en',
    nowMs: NOW,
    onFlyTo: (ev) => {
      flown = ev;
    },
  });
  assert.equal(card.tabIndex, 0);
  card.fire('keydown', {
    key: 'Enter',
    target: card,
    preventDefault: () => {},
  });
  assert.equal(flown?.id, 'quake:7xfjw:cb1d7d9f');
  flown = null;
  card.fire('keydown', { key: ' ', target: card, preventDefault: () => {} });
  assert.equal(flown?.id, 'quake:7xfjw:cb1d7d9f');
  // Other keys do not activate.
  flown = null;
  card.fire('keydown', { key: 'a', target: card, preventDefault: () => {} });
  assert.equal(flown, null);
});

test('card Fly-there button activates and is labeled in-language', () => {
  const doc = makeDocument();
  let flown = 0;
  const card = createEventCard(event(), {
    documentRef: doc,
    locale: 'hi',
    nowMs: NOW,
    onFlyTo: () => {
      flown += 1;
    },
  });
  const button = card.querySelector('button');
  assert.ok(button, 'button exists');
  button.fire('click', { preventDefault: () => {} });
  assert.equal(flown, 1);
  assert.notEqual(button.textContent, 'Fly there');
  assert.ok(button.textContent.length > 0, 'Hindi label present');
});

test('unconfirmed events get the visible unconfirmed treatment', () => {
  const doc = makeDocument();
  const card = createEventCard(event({ confidence: 'unconfirmed' }), {
    documentRef: doc,
    locale: 'en',
    nowMs: NOW,
  });
  assert.ok(card.classList.contains('ln-unconfirmed'));
  const text = JSON.stringify(card, (k, v) => (k === 'parent' ? undefined : v));
  assert.ok(text.includes('unconfirmed'), 'unconfirmed label visible');
});

test('formatTimeAgo: just now / minutes / hours', () => {
  const now = Date.parse('2026-10-13T13:30:00.000Z');
  assert.equal(
    formatTimeAgo('2026-10-13T13:29:50.000Z', now, 'en'),
    'just now',
  );
  assert.equal(
    formatTimeAgo('2026-10-13T13:00:00.000Z', now, 'en'),
    '30 min ago',
  );
  assert.equal(
    formatTimeAgo('2026-10-13T11:30:00.000Z', now, 'en'),
    '2 hr ago',
  );
  assert.equal(formatTimeAgo('bogus', now, 'en'), '');
});

test('formatSourceCount: singular vs plural', () => {
  assert.equal(formatSourceCount(1, 'en'), '1 source');
  assert.equal(formatSourceCount(4, 'en'), '4 sources');
});
