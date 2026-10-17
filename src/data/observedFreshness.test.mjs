import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBSERVED_FETCHED_DISCLOSURE_GAP_MS,
  formatObservedAge,
  newestObservedAt,
  observedFreshnessLabel,
} from './observedFreshness.js';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

test('refetch of old observations discloses both clocks', () => {
  assert.equal(
    observedFreshnessLabel({
      observedAt: NOW - 5 * HOUR,
      fetchedAt: NOW - 30 * 1000,
      now: NOW,
    }),
    'observed 5h ago · fetched <1m ago',
  );
});

test('fetch close to the observation needs no suffix', () => {
  assert.equal(
    observedFreshnessLabel({
      observedAt: NOW - 3 * MIN,
      fetchedAt: NOW - MIN,
      now: NOW,
    }),
    'observed 3m ago',
  );
});

test('suffix appears exactly at the disclosure gap', () => {
  assert.equal(
    observedFreshnessLabel({
      observedAt: NOW - 30 * MIN,
      fetchedAt: NOW - 30 * MIN + OBSERVED_FETCHED_DISCLOSURE_GAP_MS,
      now: NOW,
    }),
    'observed 30m ago · fetched 25m ago',
  );
});

test('unknown observation age is stated, never silently replaced by fetch time', () => {
  assert.equal(
    observedFreshnessLabel({
      observedAt: null,
      fetchedAt: NOW - 10 * MIN,
      now: NOW,
    }),
    'fetched 10m ago · observation age unknown',
  );
});

test('no timestamps at all reads age unknown', () => {
  assert.equal(observedFreshnessLabel({ now: NOW }), 'age unknown');
  assert.equal(
    observedFreshnessLabel({ observedAt: 'bogus', fetchedAt: -1, now: NOW }),
    'age unknown',
  );
});

test('future observation (clock skew) reads just now, not a negative age', () => {
  assert.equal(
    observedFreshnessLabel({
      observedAt: NOW + HOUR,
      fetchedAt: NOW,
      now: NOW,
    }),
    'observed just now',
  );
  assert.equal(formatObservedAge(-1), 'just now');
  assert.equal(formatObservedAge(Number.NaN), 'just now');
});

test('formatObservedAge mirrors the FIRMS fresh-feed buckets', () => {
  assert.equal(formatObservedAge(0), '<1m ago');
  assert.equal(formatObservedAge(45 * MIN), '45m ago');
  assert.equal(formatObservedAge(5 * HOUR), '5h ago');
});

test('newestObservedAt picks the newest valid observation', () => {
  assert.equal(
    newestObservedAt([
      { acqMs: NOW - 5 * HOUR },
      { acqMs: NOW - 2 * HOUR },
      { acqMs: null },
      { acqMs: Number.NaN },
      { acqMs: -1 },
      {},
    ]),
    NOW - 2 * HOUR,
  );
  assert.equal(newestObservedAt([]), null);
  assert.equal(newestObservedAt(null), null);
  assert.equal(newestObservedAt([{ acqMs: null }]), null);
});

test('newestObservedAt accepts a custom picker', () => {
  assert.equal(
    newestObservedAt(
      [{ observedAtMs: NOW - HOUR }, { observedAtMs: NOW - 10 * MIN }],
      (item) => item.observedAtMs,
    ),
    NOW - 10 * MIN,
  );
});
