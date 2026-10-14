import test from 'node:test';
import assert from 'node:assert/strict';

import { createIngestion } from './ingestion.js';
import { needsDesktopServerError } from '../../sources/needsDesktopServer.js';

/** Minimal harness for pollFeed: only the error path is exercised. */
function setup({ requestSnapshot }) {
  const state = {
    _enabled: true,
    _generation: 1,
    _inFlight: new Map(),
    _feedStatus: new Map(),
    _vehicles: new Map(),
    _activeFeeds: new Map(),
    _staticTerminal: false,
    _error: null,
    _historyBudget: { allocatedBytes: 0, maxBytes: 1 },
  };
  const services = {
    render: { governorRequestRender: () => {} },
    credits: { registerDynamicCredit: () => {}, transitFeedCredit: () => ({}) },
  };
  const parts = {};
  const source = { requestSnapshot };
  const { pollFeed, feedStatus } = createIngestion({
    state,
    services,
    parts,
    source,
  });
  return { state, pollFeed, feedStatus };
}

const FEED = { id: 'mbta', name: 'MBTA' };

test('static honest error settles terminal: status carries the message, no retry', async () => {
  let calls = 0;
  const { state, pollFeed, feedStatus } = setup({
    requestSnapshot: async () => {
      calls += 1;
      throw needsDesktopServerError('Transit feeds');
    },
  });
  state._activeFeeds.set(FEED.id, FEED);
  await pollFeed(FEED, 1);
  assert.equal(calls, 1);
  assert.equal(state._staticTerminal, true);
  const status = feedStatus(FEED.id);
  assert.match(status.error, /Transit feeds/);
  assert.match(status.error, /needs the desktop server/);
  assert.equal(status.retryInSec, null);
  assert.equal(state._error, status.error);
  // Manager ticks and camera-move polls must not re-enter the source.
  await pollFeed(FEED, 1);
  await pollFeed(FEED, 1);
  assert.equal(calls, 1);
});

test('ordinary poll failures keep the per-feed message and stay retryable', async () => {
  let calls = 0;
  const { state, pollFeed, feedStatus } = setup({
    requestSnapshot: async () => {
      calls += 1;
      const error = new Error('transit proxy HTTP 503');
      error.retryInSec = 30;
      throw error;
    },
  });
  state._activeFeeds.set(FEED.id, FEED);
  await pollFeed(FEED, 1);
  assert.equal(calls, 1);
  assert.equal(state._staticTerminal, false);
  assert.equal(feedStatus(FEED.id).error, 'MBTA feed unavailable');
  assert.equal(feedStatus(FEED.id).retryInSec, 30);
  await pollFeed(FEED, 1);
  assert.equal(calls, 2);
});
