/**
 * Smoke gate: the built app loads, the Cesium globe renders, and the page
 * stays quiet. Any console error or uncaught page error fails the run —
 * except patterns listed in KNOWN_BENIGN_PATTERNS, which must each name the
 * exact benign source that earned them a place on the list.
 */
import { test, expect } from '@playwright/test';

const KNOWN_BENIGN_PATTERNS = [
  // Kept empty on purpose: every entry here needs a written justification.
];

function isBenign(text) {
  return KNOWN_BENIGN_PATTERNS.some((pattern) => pattern.test(text));
}

test('globe page loads, globe renders, zero console errors', async ({
  page,
}) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenign(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/', { waitUntil: 'load' });

  // The Cesium viewer renders into a canvas; its presence (and non-zero
  // size) is the cheapest reliable "globe is up" signal.
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 90000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);

  // Let the initial data layers settle so first-paint fetch failures count.
  await page.waitForTimeout(10000);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
