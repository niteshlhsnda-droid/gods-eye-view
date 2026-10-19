import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHOTO_STALENESS,
  STALENESS_DATE_KIND,
  auditRenderedStaleness,
  photoDateOf,
  photoStalenessOf,
  stalenessLabel,
} from './photoStaleness.js';

const DAY_MS = 86_400_000;
// Fixed "today": 2026-10-18, so labels and boundaries are pinned.
const NOW = Date.UTC(2026, 9, 18);
const monthsAgo = (n) => NOW - n * 30 * DAY_MS;

test('fresh photo: captured 6 months ago classifies fresh with its capture date', () => {
  const result = photoStalenessOf({ capturedAt: monthsAgo(6) }, NOW);
  assert.equal(result.staleness, PHOTO_STALENESS.FRESH);
  assert.equal(result.dateKind, STALENESS_DATE_KIND.CAPTURED);
  assert.equal(result.dateMs, monthsAgo(6));
  assert.ok(result.ageMs > 0 && result.ageMs < 365 * DAY_MS);
});

test('capture date wins over upload date; upload is a labelled fallback', () => {
  const both = photoStalenessOf(
    { capturedAt: monthsAgo(30), uploadedAt: monthsAgo(2) },
    NOW,
  );
  assert.equal(both.dateKind, STALENESS_DATE_KIND.CAPTURED);
  assert.equal(both.dateMs, monthsAgo(30));

  const uploadOnly = photoStalenessOf({ uploadedAt: monthsAgo(14) }, NOW);
  assert.equal(uploadOnly.dateKind, STALENESS_DATE_KIND.UPLOADED);
  assert.equal(uploadOnly.staleness, PHOTO_STALENESS.AGING);
});

test('aging/stale cut-overs sit exactly on the 1-year and 3-year lines', () => {
  const oneYear = NOW - 365 * DAY_MS;
  const threeYears = NOW - 3 * 365 * DAY_MS;
  assert.equal(
    photoStalenessOf({ capturedAt: oneYear + 1 }, NOW).staleness,
    PHOTO_STALENESS.FRESH,
  );
  assert.equal(
    photoStalenessOf({ capturedAt: oneYear }, NOW).staleness,
    PHOTO_STALENESS.AGING,
  );
  assert.equal(
    photoStalenessOf({ capturedAt: threeYears }, NOW).staleness,
    PHOTO_STALENESS.AGING,
  );
  assert.equal(
    photoStalenessOf({ capturedAt: threeYears - 1 }, NOW).staleness,
    PHOTO_STALENESS.STALE,
  );
});

test('unknown when there is no usable date', () => {
  for (const record of [
    undefined,
    null,
    {},
    { capturedAt: 'not a date' },
    { capturedAt: '', uploadedAt: '   ' },
    { capturedAt: Number.NaN },
    { uploadedAt: Number.POSITIVE_INFINITY },
  ]) {
    const result = photoStalenessOf(record, NOW);
    assert.equal(
      result.staleness,
      PHOTO_STALENESS.UNKNOWN,
      JSON.stringify(record),
    );
    assert.equal(result.dateKind, STALENESS_DATE_KIND.NONE);
    assert.equal(result.dateMs, null);
    assert.equal(result.ageMs, null);
  }
  const validIso = photoStalenessOf({ capturedAt: '2026-10-18' }, NOW);
  assert.equal(validIso.staleness, PHOTO_STALENESS.FRESH);
});

test('a capture date in the future is unknown, never fresh', () => {
  const result = photoStalenessOf({ capturedAt: NOW + DAY_MS }, NOW);
  assert.equal(result.staleness, PHOTO_STALENESS.UNKNOWN);
  assert.equal(result.ageMs, null);
  assert.equal(result.dateKind, STALENESS_DATE_KIND.CAPTURED);
});

test('accepts ISO strings and Date objects', () => {
  const fromIso = photoStalenessOf({ capturedAt: '2024-04-18T00:00:00Z' }, NOW);
  assert.equal(fromIso.staleness, PHOTO_STALENESS.AGING);
  assert.equal(fromIso.dateMs, Date.UTC(2024, 3, 18));

  const fromDate = photoStalenessOf(
    { capturedAt: new Date('2019-01-05') },
    NOW,
  );
  assert.equal(fromDate.staleness, PHOTO_STALENESS.STALE);
  assert.equal(fromDate.dateKind, STALENESS_DATE_KIND.CAPTURED);
});

test('photoDateOf resolves the best date without classifying', () => {
  assert.deepEqual(photoDateOf({ capturedAt: 123 }), {
    dateMs: 123,
    dateKind: STALENESS_DATE_KIND.CAPTURED,
  });
  assert.deepEqual(photoDateOf({ uploadedAt: 456 }), {
    dateMs: 456,
    dateKind: STALENESS_DATE_KIND.UPLOADED,
  });
  assert.deepEqual(photoDateOf(null), {
    dateMs: null,
    dateKind: STALENESS_DATE_KIND.NONE,
  });
});

test('fresh label names the date and its age', () => {
  const label = stalenessLabel(
    photoStalenessOf({ capturedAt: monthsAgo(6) }, NOW),
  );
  assert.equal(label, 'Photo taken Apr 2026 · less than a year old');
});

test('upload fallback label says uploaded, never taken', () => {
  const label = stalenessLabel(
    photoStalenessOf({ uploadedAt: monthsAgo(14) }, NOW),
  );
  assert.equal(label, 'Photo uploaded Aug 2025 · about 1 year old');
  assert.ok(!label.includes('taken'));
});

test('stale label warns the street may have changed: a 5-year-old photo is never current', () => {
  const label = stalenessLabel(
    photoStalenessOf({ capturedAt: NOW - 5 * 365 * DAY_MS }, NOW),
  );
  assert.equal(
    label,
    'Photo taken Oct 2021 · about 5 years old — may not reflect the current street',
  );
  assert.ok(!/shows the current|is current|as of today|\blive\b/i.test(label));
});

test('unknown label admits it and never defaults to current', () => {
  assert.equal(
    stalenessLabel(photoStalenessOf({}, NOW)),
    'Photo date unknown — treat as possibly outdated',
  );
  assert.equal(
    stalenessLabel(null),
    'Photo date unknown — treat as possibly outdated',
  );
  assert.equal(
    stalenessLabel({ staleness: PHOTO_STALENESS.UNKNOWN }),
    'Photo date unknown — treat as possibly outdated',
  );
});

test('auditRenderedStaleness is clean when the open card carries its freshness label', () => {
  assert.deepEqual(
    auditRenderedStaleness({
      viewer: {
        open: true,
        captionStaleness: 'Photo taken Oct 2021 · about 5 years old',
      },
    }),
    [],
  );
});

test('auditRenderedStaleness flags an open card whose freshness label never rendered', () => {
  const issues = auditRenderedStaleness({ viewer: { open: true } });
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes('freshness label'));
  const blank = auditRenderedStaleness({
    viewer: { open: true, captionStaleness: '   ' },
  });
  assert.equal(blank.length, 1, 'a whitespace-only label is not a label');
});

test('auditRenderedStaleness is clean for a closed viewer', () => {
  assert.deepEqual(auditRenderedStaleness({ viewer: { open: false } }), []);
});
