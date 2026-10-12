import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDebrisSource } from './source.js';
import {
  normalizeDebrisCatalog,
  dedupeDebrisRecords,
  debrisFreshness,
} from './records.js';
import { DEBRIS_GROUPS } from './policy.js';

const LINE1 =
  '1 25544U 98067A   26100.12345678  .00016717  00000-0  30676-3 0  9993';
const LINE2 =
  '2 25544  51.6416 208.9163 0006703  69.9862  25.2906 15.49560532412345';

function stubFetch(text, { ok = true, stale = false } = {}) {
  return async () => ({
    ok,
    status: ok ? 200 : 502,
    text: async () => text,
    headers: {
      get: (name) =>
        name === 'x-tle-cache' && stale ? 'STALE-ERROR' : null,
    },
  });
}

describe('createDebrisSource', () => {
  it('only allows the verified CelesTrak debris groups', () => {
    assert.deepEqual(
      DEBRIS_GROUPS.map((g) => g.path).sort(),
      ['cosmos-2251-debris', 'fengyun-1c-debris', 'iridium-33-debris'],
    );
    const source = createDebrisSource({ fetchImpl: stubFetch('') });
    assert.rejects(() => source.readGroup('stations'), TypeError);
    assert.rejects(() => source.readGroup('debris'), TypeError);
  });

  it('returns catalog text and the STALE-ERROR flag', async () => {
    const source = createDebrisSource({
      fetchImpl: stubFetch('tle text', { stale: true }),
    });
    const res = await source.readGroup('fengyun-1c-debris');
    assert.equal(res.ok, true);
    assert.equal(res.text, 'tle text');
    assert.equal(res.stale, true);
  });
});

describe('normalizeDebrisCatalog / dedupeDebrisRecords', () => {
  it('normalizes sets, keeps group tag, dedupes by NORAD id', () => {
    const text = `OBJ A\n${LINE1}\n${LINE2}\nOBJ A DUP\n${LINE1}\n${LINE2}\n`;
    const records = normalizeDebrisCatalog(text, { group: 'fengyun-1c' });
    assert.equal(records.length, 2);
    assert.equal(records[0].noradId, 25544);
    assert.equal(records[0].group, 'fengyun-1c');
    const deduped = dedupeDebrisRecords(records);
    assert.equal(deduped.length, 1);
  });

  it('skips malformed sets without dropping valid ones', () => {
    const text = `BROKEN\n1 not-a-tle\n2 not-a-tle\nOBJ B\n${LINE1}\n${LINE2}\n`;
    const records = normalizeDebrisCatalog(text, {});
    assert.equal(records.length, 1);
    assert.equal(records[0].name, 'OBJ B');
  });
});

describe('debrisFreshness', () => {
  it('rolls up stale ratios from TLE epochs', () => {
    const now = Date.UTC(2026, 3, 11); // 2026-04-11: TLE epoch day 100 2026 is ~1 day old
    const records = [
      { line1: LINE1 },
      { line1: LINE1.replace('26100', '25001') }, // 2025 day 1 -> very stale
    ];
    const f = debrisFreshness(records, { nowMs: now });
    assert.equal(f.total, 2);
    assert.equal(f.stale, 1);
    assert.equal(f.staleRatio, 0.5);
  });
});
