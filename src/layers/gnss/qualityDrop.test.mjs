import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUALITY_DROP_CORROBORATION_MIN_AIRCRAFT,
  QUALITY_DROP_CORROBORATION_WINDOW_MS,
  QUALITY_DROP_INTERPRETATION,
  QUALITY_DROP_MAX_INTERVAL_MS,
  QUALITY_DROP_SIGNAL,
  detectQualityDrops,
  isQualityDegraded,
  isQualityGood,
  qualityDropCheck,
  summarizeQualityDrops,
} from './qualityDrop.js';

/** One fix; good by default (NIC 8, NACp 10). */
const fix = (overrides = {}) => ({
  atMs: 0,
  nic: 8,
  nacp: 10,
  ...overrides,
});

test('good-to-degraded via NIC only is a drop on that field', () => {
  const result = qualityDropCheck(fix(), fix({ atMs: 60_000, nic: 5 }));
  assert.equal(result.judged, true);
  assert.equal(result.dropped, true);
  assert.deepEqual(result.signals, [QUALITY_DROP_SIGNAL]);
  assert.equal(result.interpretation, QUALITY_DROP_INTERPRETATION);
  assert.deepEqual(result.droppedFields, ['nic']);
  assert.equal(result.intervalMs, 60_000);
  assert.equal(result.reason, null);
});

test('good-to-degraded via NACp only is a drop on that field', () => {
  const result = qualityDropCheck(fix(), fix({ atMs: 30_000, nacp: 4 }));
  assert.equal(result.dropped, true);
  assert.deepEqual(result.droppedFields, ['nacp']);
});

test('both fields degrading names both dropped fields', () => {
  const result = qualityDropCheck(
    fix(),
    fix({ atMs: 30_000, nic: 3, nacp: 2 }),
  );
  assert.equal(result.dropped, true);
  assert.deepEqual(result.droppedFields, ['nic', 'nacp']);
});

test('a field absent before and degraded after counts as dropped', () => {
  const result = qualityDropCheck(
    fix({ nacp: null }),
    fix({ atMs: 30_000, nacp: 3 }),
  );
  assert.equal(result.dropped, true);
  assert.deepEqual(result.droppedFields, ['nacp']);
});

test('good-to-good yields a judged no-drop verdict', () => {
  const result = qualityDropCheck(fix(), fix({ atMs: 60_000, nic: 9 }));
  assert.equal(result.judged, true);
  assert.equal(result.dropped, false);
  assert.deepEqual(result.signals, []);
  assert.equal(result.interpretation, null);
  assert.equal(result.reason, null);
});

test('degraded-to-degraded is not a drop: already-degraded, not judged', () => {
  const result = qualityDropCheck(
    fix({ nic: 4 }),
    fix({ atMs: 60_000, nic: 3 }),
  );
  assert.equal(result.judged, false);
  assert.equal(result.dropped, false);
  assert.equal(result.reason, 'already-degraded');
});

test('degraded-to-good recovery is not a drop', () => {
  const result = qualityDropCheck(
    fix({ nic: 4 }),
    fix({ atMs: 60_000, nic: 8 }),
  );
  assert.equal(result.judged, false);
  assert.equal(result.dropped, false);
  assert.equal(result.reason, 'already-degraded');
});

test('NIC 0 with NACp >= 10 is unknown, not a drop', () => {
  assert.equal(isQualityDegraded({ nic: 0, nacp: 12 }), false);
  const result = qualityDropCheck(fix(), fix({ atMs: 60_000, nic: 0 }));
  assert.equal(result.judged, true);
  assert.equal(result.dropped, false);
});

test('NIC 0 with NACp below 10 is degraded, so it drops', () => {
  assert.equal(isQualityDegraded({ nic: 0, nacp: 9 }), true);
  const result = qualityDropCheck(
    fix(),
    fix({ atMs: 60_000, nic: 0, nacp: 5 }),
  );
  assert.equal(result.dropped, true);
  assert.deepEqual(result.droppedFields, ['nic', 'nacp']);
});

test('fixes with no quality data cannot anchor or close a drop', () => {
  assert.equal(isQualityGood({ nic: null, nacp: null }), false);
  assert.equal(isQualityGood({}), false);
  const noBaseline = qualityDropCheck(
    fix({ nic: null, nacp: null }),
    fix({ atMs: 60_000, nic: 2 }),
  );
  assert.equal(noBaseline.judged, false);
  assert.equal(noBaseline.reason, 'insufficient-quality-data');
  const noClose = qualityDropCheck(
    fix(),
    fix({ atMs: 60_000, nic: null, nacp: null }),
  );
  assert.equal(noClose.judged, false);
  assert.equal(noClose.reason, 'insufficient-quality-data');
});

test('one good field with the other absent is a good baseline', () => {
  assert.equal(isQualityGood({ nic: 9, nacp: null }), true);
  assert.equal(isQualityGood({ nic: null, nacp: 11 }), true);
  assert.equal(isQualityGood({ nic: 2, nacp: null }), false);
});

test('pairs past the interval window are not sudden drops', () => {
  const result = qualityDropCheck(
    fix(),
    fix({ atMs: QUALITY_DROP_MAX_INTERVAL_MS + 1, nic: 2 }),
  );
  assert.equal(result.judged, false);
  assert.equal(result.reason, 'interval-exceeds-window');
});

test('non-increasing and missing timestamps yield no verdict', () => {
  assert.equal(
    qualityDropCheck(fix({ atMs: 60_000 }), fix({ atMs: 60_000, nic: 2 }))
      .reason,
    'non-increasing-timestamp',
  );
  assert.equal(
    qualityDropCheck(fix({ atMs: 60_000 }), fix({ atMs: 1_000, nic: 2 }))
      .reason,
    'non-increasing-timestamp',
  );
  assert.equal(
    qualityDropCheck({}, fix({ atMs: 60_000, nic: 2 })).reason,
    'missing-timestamp',
  );
});

test('detectQualityDrops finds only good-to-degraded transitions', () => {
  const events = detectQualityDrops([
    fix({ atMs: 0 }),
    fix({ atMs: 60_000 }),
    fix({ atMs: 120_000, nic: 4 }),
    fix({ atMs: 180_000, nic: 3 }),
    fix({ atMs: 240_000, nic: 8 }),
    fix({ atMs: 300_000, nacp: 2 }),
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].atMs, 120_000);
  assert.deepEqual(events[0].droppedFields, ['nic']);
  assert.equal(events[1].atMs, 300_000);
  assert.deepEqual(events[1].droppedFields, ['nacp']);
  assert.equal(events[0].signal, QUALITY_DROP_SIGNAL);
  assert.equal(events[0].interpretation, QUALITY_DROP_INTERPRETATION);
});

test('detectQualityDrops sorts out-of-order fixes and stamps hex', () => {
  const events = detectQualityDrops(
    [
      fix({ atMs: 120_000, nic: 4, hex: 'abc123' }),
      fix({ atMs: 0, hex: 'abc123' }),
      fix({ atMs: 60_000, hex: 'abc123' }),
    ],
    { hex: 'fallback' },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].hex, 'abc123');
  assert.equal(events[0].atMs, 120_000);
});

test('detectQualityDrops falls back to the option hex, then null', () => {
  const withOption = detectQualityDrops([
    fix({ atMs: 0 }),
    fix({ atMs: 60_000, nic: 2 }),
  ]);
  assert.equal(withOption[0].hex, null);
  const withFallback = detectQualityDrops(
    [fix({ atMs: 0 }), fix({ atMs: 60_000, nic: 2 })],
    { hex: 'abc123' },
  );
  assert.equal(withFallback[0].hex, 'abc123');
});

test('detectQualityDrops rejects a non-array input', () => {
  assert.throws(() => detectQualityDrops(null), TypeError);
  assert.throws(() => detectQualityDrops('fixes'), TypeError);
});

test('summarizeQualityDrops is empty-aware', () => {
  const summary = summarizeQualityDrops([]);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.count, 0);
  assert.equal(summary.aircraftCount, 0);
  assert.equal(summary.firstAtMs, null);
  assert.equal(summary.lastAtMs, null);
  assert.equal(summary.interpretation, null);
  assert.equal(
    summary.windowMs,
    QUALITY_DROP_CORROBORATION_WINDOW_MS,
  );
});

test('two drops from one aircraft never corroborate', () => {
  const summary = summarizeQualityDrops([
    { hex: 'abc123', atMs: 0 },
    { hex: 'abc123', atMs: 60_000 },
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.aircraftCount, 1);
  assert.equal(summary.corroborated, false);
  assert.equal(summary.firstAtMs, 0);
  assert.equal(summary.lastAtMs, 60_000);
});

test('two aircraft dropping inside the window corroborate', () => {
  const summary = summarizeQualityDrops([
    { hex: 'abc123', atMs: 0 },
    { hex: 'def456', atMs: 120_000 },
  ]);
  assert.equal(summary.corroborated, true);
  assert.equal(summary.aircraftCount, 2);
  assert.equal(summary.interpretation, QUALITY_DROP_INTERPRETATION);
});

test('two aircraft dropping outside the window do not corroborate', () => {
  const summary = summarizeQualityDrops([
    { hex: 'abc123', atMs: 0 },
    {
      hex: 'def456',
      atMs: QUALITY_DROP_CORROBORATION_WINDOW_MS + 1,
    },
  ]);
  assert.equal(summary.corroborated, false);
});

test('corroboration honours a raised distinct-aircraft bar', () => {
  const events = [
    { hex: 'abc123', atMs: 0 },
    { hex: 'def456', atMs: 60_000 },
  ];
  assert.equal(
    summarizeQualityDrops(events, {
      minAircraft: QUALITY_DROP_CORROBORATION_MIN_AIRCRAFT + 1,
    }).corroborated,
    false,
  );
});

test('summarizeQualityDrops ignores events without a timestamp', () => {
  const summary = summarizeQualityDrops([
    { hex: 'abc123', atMs: 0 },
    { hex: 'def456' },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.corroborated, false);
});
