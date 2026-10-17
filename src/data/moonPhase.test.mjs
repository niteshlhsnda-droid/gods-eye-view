import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYNODIC_MONTH_DAYS, moonPhase } from './moonPhase.js';

/**
 * External anchors: timeanddate's October 2026 Moon guide lists
 * Last Quarter Oct 3 13:25 UTC, New Moon Oct 10 15:50 UTC,
 * First Quarter Oct 18 16:13 UTC, Full Moon Oct 26 04:11 UTC.
 * A mean-element model wanders ~14h around the true instants, so
 * phase-name checks use the exact published instants (all sit well
 * inside their 1/8-cycle sectors) and event-time checks allow 24h.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

test('full moon Oct 26 2026: Full Moon, ~100% lit', () => {
  const m = moonPhase(new Date('2026-10-26T04:11:00Z'));
  assert.equal(m.phaseName, 'Full Moon');
  assert.ok(m.illumination > 0.99, `illumination ${m.illumination}`);
  assert.equal(m.waxing, false);
  assert.ok(Math.abs(m.ageDays - SYNODIC_MONTH_DAYS / 2) < 1);
});

test('new moon Oct 10 2026: New Moon, ~0% lit', () => {
  const m = moonPhase(new Date('2026-10-10T15:50:00Z'));
  assert.equal(m.phaseName, 'New Moon');
  assert.ok(m.illumination < 0.02, `illumination ${m.illumination}`);
  // The mean new moon falls ~17h after the published instant, so the
  // model still reads waning at the published instant — but a day later,
  // past the mean new moon, it reads waxing.
  assert.equal(m.waxing, false);
  assert.equal(moonPhase(new Date('2026-10-11T12:00:00Z')).waxing, true);
});

test('first quarter Oct 18 2026: First Quarter, ~50% lit, waxing', () => {
  const m = moonPhase(new Date('2026-10-18T16:13:00Z'));
  assert.equal(m.phaseName, 'First Quarter');
  assert.ok(Math.abs(m.illumination - 0.5) < 0.1);
  assert.equal(m.waxing, true);
});

test('last quarter Oct 3 2026: Last Quarter, ~50% lit, waning', () => {
  const m = moonPhase(new Date('2026-10-03T13:25:00Z'));
  assert.equal(m.phaseName, 'Last Quarter');
  assert.ok(Math.abs(m.illumination - 0.5) < 0.1);
  assert.equal(m.waxing, false);
});

test('next full moon from Oct 17 lands within 24h of published Oct 26 04:11 UTC', () => {
  const m = moonPhase(new Date('2026-10-17T12:00:00Z'));
  const published = new Date('2026-10-26T04:11:00Z').getTime();
  assert.ok(
    Math.abs(m.nextFullMoon.getTime() - published) < DAY_MS,
    `nextFullMoon ${m.nextFullMoon.toISOString()}`,
  );
  assert.ok(m.nextFullMoon.getTime() > m.date.getTime());
});

test('next new moon from Oct 17 falls on Nov 9 2026 (published date)', () => {
  const m = moonPhase(new Date('2026-10-17T12:00:00Z'));
  assert.equal(m.nextNewMoon.toISOString().slice(0, 10), '2026-11-09');
  assert.ok(m.nextNewMoon.getTime() > m.date.getTime());
});

test('reference epoch itself is a new moon', () => {
  const m = moonPhase(new Date('2000-01-06T18:14:24Z'));
  assert.equal(m.phaseName, 'New Moon');
  assert.ok(m.ageDays < 0.001, `ageDays ${m.ageDays}`);
  assert.ok(m.illumination < 0.0001, `illumination ${m.illumination}`);
  assert.equal(m.previousNewMoon.getTime(), m.date.getTime());
});

test('invariants hold across a full lunation', () => {
  const start = new Date('2026-10-10T15:50:00Z').getTime();
  for (let d = 0; d <= 30; d += 1) {
    const m = moonPhase(new Date(start + d * DAY_MS));
    assert.ok(m.ageDays >= 0 && m.ageDays < SYNODIC_MONTH_DAYS);
    assert.ok(m.illumination >= 0 && m.illumination <= 1);
    assert.ok(m.phase >= 0 && m.phase < 1);
    assert.ok(m.previousNewMoon.getTime() <= m.date.getTime());
    assert.ok(m.nextNewMoon.getTime() > m.date.getTime());
    assert.ok(m.nextFullMoon.getTime() > m.date.getTime());
    assert.ok(
      Math.abs(
        m.nextNewMoon.getTime() -
          m.previousNewMoon.getTime() -
          SYNODIC_MONTH_DAYS * DAY_MS,
      ) < HOUR_MS,
    );
  }
});

test('all eight phase names occur across one lunation', () => {
  const seen = new Set();
  const start = new Date('2026-10-10T15:50:00Z').getTime();
  for (let d = 0; d <= 30; d += 1) {
    seen.add(moonPhase(new Date(start + d * DAY_MS)).phaseName);
  }
  assert.equal(seen.size, 8);
});

test('invalid date throws TypeError', () => {
  assert.throws(() => moonPhase(new Date('not-a-date')), TypeError);
  assert.throws(() => moonPhase('2026-10-26'), TypeError);
  assert.throws(() => moonPhase(null), TypeError);
});
