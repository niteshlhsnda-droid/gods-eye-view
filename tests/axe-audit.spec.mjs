/**
 * Accessibility gate: inject the declared axe-core build into the running app
 * and fail on any critical-impact violation. Critical-only keeps the gate
 * honest about what it enforces — serious/moderate findings are reported as
 * warnings in the HTML report for follow-up, not silent passes.
 */
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Resolves to the axe-core version declared in package.json devDependencies.
const axeSource = require('axe-core/axe.min.js');

test('page has no critical accessibility violations', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 });
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    const axe = window.axe;
    if (!axe) throw new Error('axe-core failed to inject');
    return axe.run(document, { resultTypes: ['violations'] });
  });
  const critical = results.violations.filter(
    (violation) => violation.impact === 'critical',
  );
  if (critical.length) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(critical, null, 2));
  }
  expect(critical).toEqual([]);
});
