import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReplayStore,
  isValidReplayPayload,
  DEFAULT_REPLAY_BUDGET_BYTES,
} from './replayStore.js';

const event = (type = 2, timestamp = 1000) => ({ type, timestamp, data: {} });

test('isValidReplayPayload accepts rrweb-shaped events and rejects junk', () => {
  assert.equal(isValidReplayPayload([event()]), true);
  assert.equal(
    isValidReplayPayload([event(), { type: 3, timestamp: 1001, data: {} }]),
    true,
  );
  assert.equal(isValidReplayPayload([]), false);
  assert.equal(isValidReplayPayload(null), false);
  assert.equal(isValidReplayPayload([{ type: 'x', timestamp: 1 }]), false);
  assert.equal(isValidReplayPayload([{ type: 2 }]), false);
});

test('push/get round-trips events in order', () => {
  const store = createReplayStore();
  const id = store.startSession({ label: 'demo' });
  assert.ok(store.push(id, event(2, 1000)));
  assert.ok(store.push(id, event(3, 1001)));
  assert.deepEqual(store.getSession(id), [event(2, 1000), event(3, 1001)]);
  assert.equal(store.getSession('missing'), null);
});

test('the budget evicts the oldest sessions first', () => {
  const store = createReplayStore({ maxBytes: 400 });
  const first = store.startSession();
  for (let i = 0; i < 3; i++) store.push(first, event(3, i));
  const second = store.startSession();
  // A large new session must evict the first to fit.
  const big = { type: 3, timestamp: 9, data: { blob: 'x'.repeat(300) } };
  assert.ok(store.push(second, big));
  assert.equal(store.hasSession(first), false);
  assert.equal(store.hasSession(second), true);
  const stats = store.stats();
  assert.ok(stats.usedBytes <= 400);
});

test('an event larger than the whole budget is refused', () => {
  const store = createReplayStore({ maxBytes: 50 });
  const id = store.startSession();
  assert.equal(
    store.push(id, { type: 3, timestamp: 1, data: { blob: 'x'.repeat(500) } }),
    false,
  );
  assert.equal(store.getSession(id).length, 0);
});

test('export/import round-trips a session and preserves its id', () => {
  const store = createReplayStore();
  const id = store.startSession({ label: 'export-me' });
  store.push(id, event(2, 1000));
  const json = store.exportSession(id);
  assert.ok(json.includes('gev-session-replay'));

  const store2 = createReplayStore();
  const imported = store2.importSession(json);
  assert.equal(imported, id);
  assert.deepEqual(store2.getSession(imported), [event(2, 1000)]);
  const meta = store2.listSessions()[0];
  assert.equal(meta.eventCount, 1);
  assert.equal(meta.meta.importedFrom, id);
});

test('importSession mints a fresh id on collision', () => {
  const store = createReplayStore();
  const id = store.startSession();
  store.push(id, event(2, 1000));
  const json = store.exportSession(id);
  const again = store.importSession(json);
  assert.ok(typeof again === 'string' && again !== id);
});

test('importSession rejects malformed payloads', () => {
  const store = createReplayStore();
  assert.equal(store.importSession('not json'), null);
  assert.equal(
    store.importSession(JSON.stringify({ kind: 'nope', events: [] })),
    null,
  );
  assert.equal(
    store.importSession(
      JSON.stringify({ kind: 'gev-session-replay', events: [{ bad: 1 }] }),
    ),
    null,
  );
});

test('deleteSession and clear manage the budget', () => {
  const store = createReplayStore();
  const id = store.startSession();
  store.push(id, event());
  assert.equal(store.deleteSession(id), true);
  assert.equal(store.deleteSession(id), false);
  assert.equal(store.stats().usedBytes, 0);
  const other = store.startSession();
  store.push(other, event());
  store.clear();
  assert.deepEqual(store.listSessions(), []);
});

test('session ids are unique', () => {
  const store = createReplayStore();
  const ids = new Set(Array.from({ length: 50 }, () => store.startSession()));
  assert.equal(ids.size, 50);
  assert.ok(DEFAULT_REPLAY_BUDGET_BYTES > 0);
});
