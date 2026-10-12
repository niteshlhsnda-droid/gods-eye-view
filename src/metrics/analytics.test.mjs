import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METRICS_CONFIG_DEFAULT,
  METRICS_PROVIDERS,
  initGrowthBook,
  initHeatmap,
  initMetrics,
  initOtel,
  initPostHog,
  initSentry,
  initWebVitals,
  resolveMetricsConfig,
} from './analytics.js';

test('default config has every provider disabled', () => {
  assert.deepEqual([...METRICS_PROVIDERS], [
    'posthog',
    'webVitals',
    'sentry',
    'otel',
    'heatmap',
    'growthbook',
  ]);
  for (const provider of METRICS_PROVIDERS) {
    assert.equal(
      METRICS_CONFIG_DEFAULT[provider].enabled,
      false,
      `${provider} must default to disabled`,
    );
  }
});

test('resolveMetricsConfig merges without mutating defaults', () => {
  const merged = resolveMetricsConfig({
    posthog: { enabled: true, apiKey: 'phc_test' },
  });
  assert.equal(merged.posthog.enabled, true);
  assert.equal(merged.posthog.apiKey, 'phc_test');
  assert.equal(merged.posthog.apiHost, METRICS_CONFIG_DEFAULT.posthog.apiHost);
  assert.equal(METRICS_CONFIG_DEFAULT.posthog.enabled, false);
  assert.equal(METRICS_CONFIG_DEFAULT.posthog.apiKey, '');
});

test('initMetrics with empty config skips every provider (never throws)', async () => {
  const report = await initMetrics({});
  for (const provider of METRICS_PROVIDERS) {
    assert.equal(report[provider].status, 'skipped', provider);
  }
});

test('initMetrics never throws even for garbage config', async () => {
  const report = await initMetrics(null);
  assert.equal(Object.keys(report).length, METRICS_PROVIDERS.length);
  const report2 = await initMetrics({ posthog: 'yes' });
  assert.equal(report2.posthog.status, 'skipped');
});

test('each provider skips cleanly when its key/endpoint is missing', async () => {
  assert.deepEqual(await initPostHog({ enabled: true }), {
    status: 'skipped',
    reason: 'no-api-key',
  });
  assert.deepEqual(await initWebVitals({ enabled: true }), {
    status: 'skipped',
    reason: 'no-report-sink',
  });
  assert.deepEqual(await initSentry({ enabled: true }), {
    status: 'skipped',
    reason: 'no-dsn',
  });
  assert.deepEqual(await initOtel({ enabled: true }), {
    status: 'skipped',
    reason: 'no-endpoint',
  });
  assert.deepEqual(await initHeatmap({ enabled: true }), {
    status: 'skipped',
    reason: 'no-container',
  });
  assert.deepEqual(await initGrowthBook({ enabled: true }), {
    status: 'skipped',
    reason: 'no-client-key',
  });
});

test('enabled providers report unavailable when the package cannot load', async () => {
  // In the unit-test environment the optional deps are absent, so enabled
  // providers must degrade to 'unavailable' rather than throw.
  const posthog = await initPostHog({
    enabled: true,
    apiKey: 'phc_test_key_never_real',
  });
  assert.equal(posthog.status, 'unavailable');
  const sentry = await initSentry({
    enabled: true,
    dsn: 'https://example.invalid/1',
  });
  assert.equal(sentry.status, 'unavailable');
  const growthbook = await initGrowthBook({
    enabled: true,
    clientKey: 'sdk-test',
  });
  assert.equal(growthbook.status, 'unavailable');
});
