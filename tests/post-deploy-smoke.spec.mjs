/**
 * Post-deploy smoke test — runs against the LIVE GitHub Pages deployment
 * (GEV_BASE_URL=https://niteshlhsnda-droid.github.io/gods-eye-view/ with
 * GEV_NO_WEBSERVER=1), never against a local preview server.
 *
 * Covers: the deployed app boots and the globe renders; the deployed
 * data/live-now.json is fresh and schema-valid; build-metadata.json matches
 * the snapshot it was built from; a share link the app itself writes
 * restores on a fresh load; keyboard Tab moves focus into the page.
 */
import { test, expect } from '@playwright/test';

// This spec runs ONLY against the live Pages deployment, gated by
// GEV_POST_DEPLOY_SMOKE=1 (set by the deploy workflows). A bare
// `npx playwright test` skips it: it needs the deployed
// data/build-metadata.json, which a local preview server does not have.
test.skip(
  process.env.GEV_POST_DEPLOY_SMOKE !== '1',
  'post-deploy smoke only runs with GEV_POST_DEPLOY_SMOKE=1 against the live Pages URL',
);

const LIVE_NOW_MAX_AGE_MS = 120 * 60 * 1000; // deploy + Pages propagation lag
const SHARE_HASH_TIMEOUT_MS = 30000;

/**
 * Clear the first-run dialog the same way the street-level gate does:
 * it blocks initial-restore completion (and therefore hash writes) until
 * dismissed. No-op when the dialog is already gone.
 */
async function clearFirstRun(page) {
  await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), {
    timeout: 150000,
  });
  await page.evaluate(() =>
    document.querySelector('.first-run-explore')?.click(),
  );
  await page.keyboard.press('Escape');
}

test('deployed app boots and the globe renders', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto('/', { waitUntil: 'load' });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 90000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test('deployed live-now.json is fresh and schema-valid', async ({
  request,
}) => {
  const response = await request.get('data/live-now.json');
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.schema).toBe('gev/live-now');
  expect(payload.version).toBe(1);
  expect(Array.isArray(payload.events)).toBe(true);
  expect(payload.events.length).toBeLessThanOrEqual(12);
  const generated = Date.parse(payload.generatedAt);
  expect(Number.isFinite(generated)).toBe(true);
  expect(Date.now() - generated).toBeLessThan(LIVE_NOW_MAX_AGE_MS);
  expect(Array.isArray(payload.feedHealth?.feeds)).toBe(true);
  expect(payload.feedHealth.feeds.length).toBeGreaterThan(0);
});

test('build-metadata.json matches the deployed snapshot', async ({
  request,
}) => {
  const [metaResponse, dataResponse] = await Promise.all([
    request.get('data/build-metadata.json'),
    request.get('data/live-now.json'),
  ]);
  expect(metaResponse.ok()).toBe(true);
  expect(dataResponse.ok()).toBe(true);
  const metadata = await metaResponse.json();
  const payload = await dataResponse.json();
  expect(metadata.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(metadata.dataGeneratedAt).toBe(payload.generatedAt);
  expect(Date.parse(metadata.builtAt)).not.toBeNaN();
});

test('share-link restore: the app-written hash reboots the globe', async ({
  page,
  context,
}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('canvas').first()).toBeVisible({
    timeout: 90000,
  });
  await clearFirstRun(page);
  // The app serializes its camera state into the URL hash (debounced),
  // once the first-run dialog is cleared and initial restore completes.
  await page.waitForFunction(() => window.location.hash.length > 1, {
    timeout: SHARE_HASH_TIMEOUT_MS,
  });
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash.length).toBeGreaterThan(1);

  const restored = await context.newPage();
  const restoredErrors = [];
  restored.on('pageerror', (error) => restoredErrors.push(String(error)));
  await restored.goto(`/${hash}`, { waitUntil: 'load' });
  await expect(restored.locator('canvas').first()).toBeVisible({
    timeout: 90000,
  });
  await clearFirstRun(restored);
  expect(restoredErrors).toEqual([]);
  await restored.close();
  expect(pageErrors).toEqual([]);
});

test('keyboard Tab moves focus into the page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('canvas').first()).toBeVisible({
    timeout: 90000,
  });
  await clearFirstRun(page);
  await page.keyboard.press('Tab');
  const tag = await page.evaluate(
    () => document.activeElement?.tagName ?? 'NONE',
  );
  expect(tag).not.toBe('BODY');
  expect(tag).not.toBe('NONE');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  const stillFocused = await page.evaluate(
    () => document.activeElement?.tagName ?? 'NONE',
  );
  expect(stillFocused).not.toBe('NONE');
  expect(pageErrors).toEqual([]);
});
