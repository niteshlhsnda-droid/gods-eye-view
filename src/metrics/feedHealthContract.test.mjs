import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEED_HEALTH_CONTRACT,
  FEED_HEALTH_CONTRACT_VERSION,
  FEED_HEALTH_STORAGE_KEY,
  FEED_HEALTH_WINDOW_KEY,
  aggregateGrade,
  createFeedEntry,
  createFeedSnapshot,
  gradeFromState,
  normalizeFeedState,
  publishFeedHealth,
  readFeedHealth,
} from './feedHealthContract.js';

test('normalizeFeedState accepts the contract vocabulary and fails closed', () => {
  assert.equal(normalizeFeedState('nominal'), 'nominal');
  assert.equal(normalizeFeedState('FALLBACK'), 'fallback');
  assert.equal(normalizeFeedState('  stale  '), 'stale');
  assert.equal(normalizeFeedState('bogus'), 'unavailable');
  assert.equal(normalizeFeedState(null), 'unavailable');
  assert.equal(normalizeFeedState(undefined), 'unavailable');
});

test('gradeFromState maps states to public letter grades', () => {
  assert.deepEqual(gradeFromState('nominal'), { grade: 'A', score: 100 });
  assert.equal(gradeFromState('loading').grade, 'B');
  assert.equal(gradeFromState('partial').grade, 'B');
  assert.equal(gradeFromState('fallback').grade, 'C');
  assert.equal(gradeFromState('stale').grade, 'C');
  assert.equal(gradeFromState('degraded').grade, 'D');
  assert.deepEqual(gradeFromState('unavailable'), { grade: 'F', score: 0 });
  assert.equal(gradeFromState('nonsense').grade, 'F');
});

test('createFeedEntry normalizes fields and derives grade', () => {
  const entry = createFeedEntry({
    id: 'flights',
    label: 'Flights (ADS-B)',
    state: 'degraded',
    lastUpdate: '2026-10-12T18:00:00.000Z',
    messageCount: 123,
    latencyMs: 412,
    note: '  fallback active  ',
  });
  assert.equal(entry.id, 'flights');
  assert.equal(entry.label, 'Flights (ADS-B)');
  assert.equal(entry.state, 'degraded');
  assert.equal(entry.grade, 'D');
  assert.equal(entry.messageCount, 123);
  assert.equal(entry.latencyMs, 412);
  assert.equal(entry.note, 'fallback active');
  assert.ok(entry.ageMs === null || entry.ageMs >= 0);
});

test('createFeedEntry never throws on garbage input', () => {
  const entry = createFeedEntry({ id: 7 });
  assert.equal(entry.id, '7');
  assert.equal(entry.grade, 'F');
  assert.equal(entry.lastUpdate, null);
  assert.equal(createFeedEntry().state, 'unavailable');
});

test('aggregateGrade takes the worst feed, not the average', () => {
  const feeds = [
    createFeedEntry({ id: 'a', state: 'nominal' }),
    createFeedEntry({ id: 'b', state: 'degraded' }),
    createFeedEntry({ id: 'c', state: 'nominal' }),
  ];
  assert.deepEqual(aggregateGrade(feeds), { grade: 'D', score: 30 });
  assert.deepEqual(aggregateGrade([]), { grade: 'F', score: 0 });
});

test('createFeedSnapshot stamps the contract envelope', () => {
  const snapshot = createFeedSnapshot([{ id: 'flights', state: 'nominal' }], {
    source: 'test',
    generatedAt: '2026-10-12T18:00:00.000Z',
  });
  assert.equal(snapshot.contract, FEED_HEALTH_CONTRACT);
  assert.equal(snapshot.version, FEED_HEALTH_CONTRACT_VERSION);
  assert.equal(snapshot.source, 'test');
  assert.equal(snapshot.generatedAt, '2026-10-12T18:00:00.000Z');
  assert.equal(snapshot.feeds.length, 1);
  assert.equal(snapshot.overall.grade, 'A');
});

function makeStorage() {
  const map = new Map();
  return {
    setItem: (key, value) => map.set(key, String(value)),
    getItem: (key) => (map.has(key) ? map.get(key) : null),
  };
}

test('publishFeedHealth writes host and storage; readFeedHealth reads back', () => {
  const host = {};
  const storage = makeStorage();
  const snapshot = createFeedSnapshot([{ id: 'flights', state: 'nominal' }]);
  const result = publishFeedHealth(snapshot, { host, storage });
  assert.deepEqual(result, { onHost: true, inStorage: true });
  assert.equal(host[FEED_HEALTH_WINDOW_KEY], snapshot);
  assert.equal(
    storage.getItem(FEED_HEALTH_STORAGE_KEY),
    JSON.stringify(snapshot),
  );
  assert.equal(readFeedHealth({ host, storage }), snapshot);
});

test('readFeedHealth prefers the host, falls back to storage, else null', () => {
  const storage = makeStorage();
  const stored = createFeedSnapshot([{ id: 'flights', state: 'stale' }]);
  publishFeedHealth(stored, { storage });
  assert.equal(readFeedHealth({ storage }).overall.grade, 'C');
  const host = {};
  const live = createFeedSnapshot([{ id: 'flights', state: 'nominal' }]);
  publishFeedHealth(live, { host });
  assert.equal(readFeedHealth({ host, storage }).overall.grade, 'A');
  assert.equal(readFeedHealth({}), null);
});

test('publishFeedHealth survives storage failures without throwing', () => {
  const badStorage = {
    setItem() {
      throw new Error('quota exceeded');
    },
  };
  const snapshot = createFeedSnapshot([{ id: 'x', state: 'nominal' }]);
  const result = publishFeedHealth(snapshot, { storage: badStorage });
  assert.deepEqual(result, { onHost: false, inStorage: false });
});
