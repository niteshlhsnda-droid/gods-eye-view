import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTleText,
  tleCatalogNumber,
  tleEpochMs,
  tleAgeMs,
  tleIsStale,
  TLE_MAX_AGE_MS,
  formatTleAge,
  satellitePredictionLabel,
} from './tle.js';
import { TLE_MAX_AGE_MS as SATELLITE_TLE_MAX_AGE_MS } from '../layers/satellites/policy.js';
import { DEBRIS_TLE_MAX_AGE_MS } from '../layers/debris/policy.js';

// ISS TLE epoch: 2024 day 123.45678901 (columns 19-32 of line 1).
const LINE1 =
  '1 25544U 98067A   24123.45678901  .00016717  00000-0  30676-3 0  9993';
const LINE1_1999 =
  '1 25544U 98067A   99365.12345678  .00016717  00000-0  30676-3 0  9993';

describe('parseTleText', () => {
  it('parses name/line1/line2 triples and skips malformed sets', () => {
    const text = `ISS (ZARYA)\n${LINE1}\n2 25544  51.6416  18.0 0006703  69.0  40.0 15.49560532412345\nGARBAGE\n1 BOGUS\n`;
    const entries = parseTleText(text);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'ISS (ZARYA)');
    assert.equal(tleCatalogNumber(entries[0].line1), 25544);
  });
});

describe('tleEpochMs', () => {
  it('decodes a 20xx epoch from columns 19-32', () => {
    const epoch = tleEpochMs(LINE1);
    const expected = Date.UTC(2024, 0, 1) + (123.45678901 - 1) * 86400000;
    assert.ok(Math.abs(epoch - expected) < 1);
  });

  it('maps 2-digit years 57-99 to the 1900s', () => {
    const epoch = tleEpochMs(LINE1_1999);
    assert.ok(epoch < Date.UTC(2000, 0, 1));
    const expected = Date.UTC(1999, 0, 1) + (365.12345678 - 1) * 86400000;
    assert.ok(Math.abs(epoch - expected) < 1);
  });

  it('returns null for malformed epoch fields', () => {
    assert.equal(tleEpochMs('1 25544U 98067A   XX.XXXXXXXX'), null);
    assert.equal(tleEpochMs('short'), null);
  });
});

describe('tleAgeMs / tleIsStale', () => {
  it('ages a TLE relative to a fixed now', () => {
    const now = tleEpochMs(LINE1) + 36 * 3600_000;
    assert.ok(Math.abs(tleAgeMs(LINE1, now) - 36 * 3600_000) < 1000);
  });

  it('flags stale TLEs beyond maxAgeMs and malformed epochs', () => {
    const fresh = tleEpochMs(LINE1) + 3600_000;
    assert.equal(tleIsStale(LINE1, { nowMs: fresh }), false);
    const old = tleEpochMs(LINE1) + 73 * 3600_000;
    assert.equal(tleIsStale(LINE1, { nowMs: old }), true);
    assert.equal(tleIsStale('garbage', { nowMs: Date.now() }), true);
  });

  it('treats future-dated epochs as stale, not fresh', () => {
    const beforeEpoch = tleEpochMs(LINE1) - 3600_000;
    assert.equal(tleAgeMs(LINE1, beforeEpoch) < 0, true);
    assert.equal(tleIsStale(LINE1, { nowMs: beforeEpoch }), true);
  });

  it('uses one canonical 72 h threshold across all layers', () => {
    assert.equal(TLE_MAX_AGE_MS, 72 * 3600_000);
    assert.equal(SATELLITE_TLE_MAX_AGE_MS, TLE_MAX_AGE_MS);
    assert.equal(DEBRIS_TLE_MAX_AGE_MS, TLE_MAX_AGE_MS);
  });
});

describe('formatTleAge', () => {
  it('uses minutes below an hour, hours below two days, days above', () => {
    assert.equal(formatTleAge(0), '0 min');
    assert.equal(formatTleAge(30 * 60000), '30 min');
    assert.equal(formatTleAge(90 * 60000), '1 h');
    assert.equal(formatTleAge(47 * 3600_000), '47 h');
    assert.equal(formatTleAge(49 * 3600_000), '2 d');
    assert.equal(formatTleAge(4 * 86400_000), '4 d');
  });
});

describe('satellitePredictionLabel', () => {
  const epoch = tleEpochMs(LINE1);

  it('labels a fresh prediction with the TLE age, never the fetch time', () => {
    assert.equal(
      satellitePredictionLabel(LINE1, { nowMs: epoch + 25 * 60000 }),
      'PREDICTED · TLE 25 min old',
    );
    assert.equal(
      satellitePredictionLabel(LINE1, { nowMs: epoch + 36 * 3600_000 }),
      'PREDICTED · TLE 36 h old',
    );
  });

  it('marks element sets older than 72 h STALE', () => {
    assert.equal(
      satellitePredictionLabel(LINE1, { nowMs: epoch + 72 * 3600_000 }),
      'PREDICTED · TLE 3 d old',
    );
    assert.equal(
      satellitePredictionLabel(LINE1, { nowMs: epoch + 73 * 3600_000 }),
      'PREDICTED · TLE 3 d old · STALE',
    );
    assert.equal(
      satellitePredictionLabel(LINE1, { nowMs: epoch + 4 * 86400_000 }),
      'PREDICTED · TLE 4 d old · STALE',
    );
  });

  it('reports unknown instead of inventing an age', () => {
    assert.equal(
      satellitePredictionLabel('garbage', { nowMs: epoch }),
      'PREDICTED · TLE age unknown',
    );
    assert.equal(
      satellitePredictionLabel(undefined, { nowMs: epoch }),
      'PREDICTED · TLE age unknown',
    );
    // An epoch in the future cannot have an age — unknown, not negative.
    assert.equal(
      satellitePredictionLabel(LINE1, { nowMs: epoch - 3600_000 }),
      'PREDICTED · TLE age unknown',
    );
  });
});
