import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureAgeLabel,
  captureLabel,
  formatCaptureDate,
} from './captureDate.js';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

test('formatCaptureDate renders a day-precision date in UTC', () => {
  assert.equal(
    formatCaptureDate(Date.UTC(2024, 2, 12, 23, 30), 'day', { nowMs: NOW }),
    'Captured 12 Mar 2024',
  );
});

test('formatCaptureDate never invents a day for month precision', () => {
  // Google dates are YYYY-MM, stored as the 1st: the 1st is storage, not data.
  assert.equal(
    formatCaptureDate(Date.UTC(2024, 2, 1), 'month', { nowMs: NOW }),
    'Captured Mar 2024',
  );
  // Even a mid-month epoch renders month-only when precision is month.
  assert.equal(
    formatCaptureDate(Date.UTC(2024, 2, 15), 'month', { nowMs: NOW }),
    'Captured Mar 2024',
  );
});

test('formatCaptureDate defaults to day precision', () => {
  assert.equal(
    formatCaptureDate(Date.UTC(2019, 6, 4), undefined, { nowMs: NOW }),
    'Captured 4 Jul 2019',
  );
});

test('formatCaptureDate reads unknown for missing, malformed, or future dates', () => {
  for (const bad of [null, undefined, Number.NaN, 0, -1, 'junk', '', {}]) {
    assert.equal(
      formatCaptureDate(bad, 'day', { nowMs: NOW }),
      'Capture date unknown',
    );
  }
  // A capture dated after now is clock skew or bad data, never a real photo.
  assert.equal(
    formatCaptureDate(NOW + 86_400_000, 'day', { nowMs: NOW }),
    'Capture date unknown',
  );
});

test('captureAgeLabel reports today, days, months, and years', () => {
  assert.equal(
    captureAgeLabel(NOW - 3_600_000, { precision: 'day', nowMs: NOW }),
    'today',
  );
  assert.equal(
    captureAgeLabel(Date.UTC(2026, 9, 17), { precision: 'day', nowMs: NOW }),
    '1 day ago',
  );
  assert.equal(
    captureAgeLabel(Date.UTC(2026, 9, 8), { precision: 'day', nowMs: NOW }),
    '10 days ago',
  );
  assert.equal(
    captureAgeLabel(Date.UTC(2026, 6, 18), { precision: 'day', nowMs: NOW }),
    '3 months ago',
  );
  assert.equal(
    captureAgeLabel(Date.UTC(2026, 8, 18), { precision: 'day', nowMs: NOW }),
    '1 month ago',
  );
  assert.equal(
    captureAgeLabel(Date.UTC(2024, 9, 18), { precision: 'day', nowMs: NOW }),
    '2 years ago',
  );
  assert.equal(
    captureAgeLabel(Date.UTC(2025, 9, 18), { precision: 'day', nowMs: NOW }),
    '1 year ago',
  );
});

test('captureAgeLabel is calendar-based, not a 30-day approximation', () => {
  // 18 Sep -> 18 Oct is exactly 1 month even though September has 30 days.
  assert.equal(
    captureAgeLabel(Date.UTC(2026, 8, 18), { precision: 'day', nowMs: NOW }),
    '1 month ago',
  );
  // 19 Oct 2025 -> 18 Oct 2026 is not yet a full year.
  assert.equal(
    captureAgeLabel(Date.UTC(2025, 9, 19), { precision: 'day', nowMs: NOW }),
    '11 months ago',
  );
});

test('captureAgeLabel never yields a day-granular age for month precision', () => {
  assert.equal(
    captureAgeLabel(Date.UTC(2026, 9, 1), { precision: 'month', nowMs: NOW }),
    'this month',
  );
  assert.equal(
    captureAgeLabel(Date.UTC(2026, 7, 1), { precision: 'month', nowMs: NOW }),
    '2 months ago',
  );
  assert.equal(
    captureAgeLabel(Date.UTC(2024, 9, 1), { precision: 'month', nowMs: NOW }),
    '2 years ago',
  );
});

test('captureAgeLabel is null for unknown or future dates', () => {
  assert.equal(captureAgeLabel(null, { nowMs: NOW }), null);
  assert.equal(
    captureAgeLabel(NOW + 1_000, { precision: 'day', nowMs: NOW }),
    null,
  );
});

test('captureLabel combines date and age, or reads unknown', () => {
  assert.equal(
    captureLabel(Date.UTC(2024, 9, 18), 'day', { nowMs: NOW }),
    'Captured 18 Oct 2024 · 2 years ago',
  );
  assert.equal(
    captureLabel(Date.UTC(2024, 2, 1), 'month', { nowMs: NOW }),
    'Captured Mar 2024 · 2 years ago',
  );
  assert.equal(
    captureLabel(null, 'day', { nowMs: NOW }),
    'Capture date unknown',
  );
});
