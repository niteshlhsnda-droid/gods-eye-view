import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LIVE_NOW_DEPLOY_SLO_MINUTES,
  validateLiveNowFile,
  validateLiveNowSnapshot,
} from '../../scripts/validate-live-now.mjs';

const NOW = Date.parse('2026-10-15T10:00:00.000Z');

function payload(overrides = {}) {
  return {
    schema: 'gev/live-now',
    version: 1,
    generatedAt: new Date(NOW - 5 * 60000).toISOString(),
    events: [],
    staleSources: [],
    feedHealth: {
      feeds: [
        { id: 'quakes', state: 'nominal' },
        { id: 'fires', state: 'unavailable' },
      ],
    },
    ...overrides,
  };
}

test('valid snapshot passes', () => {
  const { ok, errors } = validateLiveNowSnapshot(payload(), { nowMs: NOW });
  assert.equal(ok, true, errors.join('; '));
});

test('all feeds stale/unavailable fails', () => {
  const { ok, errors } = validateLiveNowSnapshot(
    payload({
      feedHealth: {
        feeds: [
          { id: 'quakes', state: 'stale' },
          { id: 'fires', state: 'unavailable' },
        ],
      },
    }),
    { nowMs: NOW },
  );
  assert.equal(ok, false);
  assert.ok(errors.some((error) => error.includes('all feeds')));
});

test('missing feedHealth fails', () => {
  const broken = payload();
  delete broken.feedHealth;
  const { ok, errors } = validateLiveNowSnapshot(broken, { nowMs: NOW });
  assert.equal(ok, false);
  assert.ok(errors.some((error) => error.includes('feedHealth')));
});

test('generatedAt older than the SLO fails', () => {
  const { ok, errors } = validateLiveNowSnapshot(
    payload({
      generatedAt: new Date(
        NOW - (LIVE_NOW_DEPLOY_SLO_MINUTES + 1) * 60000,
      ).toISOString(),
    }),
    { nowMs: NOW },
  );
  assert.equal(ok, false);
  assert.ok(errors.some((error) => error.includes('older than')));
});

test('future generatedAt fails', () => {
  const { ok, errors } = validateLiveNowSnapshot(
    payload({ generatedAt: new Date(NOW + 60000).toISOString() }),
    { nowMs: NOW },
  );
  assert.equal(ok, false);
  assert.ok(errors.some((error) => error.includes('future')));
});

test('schema violations and unknown feed states fail', () => {
  const { ok, errors } = validateLiveNowSnapshot(
    payload({
      version: 2,
      feedHealth: { feeds: [{ id: 'quakes', state: 'mystery' }] },
    }),
    { nowMs: NOW },
  );
  assert.equal(ok, false);
  assert.ok(errors.some((error) => error.includes('version')));
  assert.ok(errors.some((error) => error.includes('unknown state')));
});

test('file validation reports missing and malformed files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'livenow-validate-'));
  try {
    const missing = validateLiveNowFile(path.join(dir, 'nope.json'), {
      nowMs: NOW,
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.errors[0].includes('cannot read'));

    const badPath = path.join(dir, 'bad.json');
    writeFileSync(badPath, '{not json', 'utf8');
    const bad = validateLiveNowFile(badPath, { nowMs: NOW });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors[0].includes('not valid JSON'));

    const goodPath = path.join(dir, 'good.json');
    writeFileSync(goodPath, JSON.stringify(payload()), 'utf8');
    const good = validateLiveNowFile(goodPath, { nowMs: NOW });
    assert.equal(good.ok, true, good.errors.join('; '));
    assert.equal(good.payload.generatedAt, payload().generatedAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
