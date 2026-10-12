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

test('enabled providers report honest status whether the package loads or not', async () => {
  // The optional deps are absent in a bare lane checkout but present after
  // the orchestrator's central install. Probe real loadability first, then
  // assert the init result matches it — the contract (a status object, never
  // a throw) must hold in both worlds.
  //
  // posthog is deliberately NOT live-initialized here: posthog.init() opens
  // a persistent event-flush socket by design, which stalls node --test.
  // The live posthog path is browser-verified (smoke test) instead; here we
  // verify the loader resolves an initializable client shape.
  const canLoad = async (specifier) => {
    try {
      await import(specifier);
      return true;
    } catch {
      return false;
    }
  };
  const sentry = await initSentry({
    enabled: true,
    dsn: 'https://example.invalid/1',
  });
  assert.equal(
    sentry.status,
    (await canLoad('@sentry/browser')) ? 'ready' : 'unavailable',
  );
  const growthbook = await initGrowthBook({
    enabled: true,
    clientKey: 'sdk-test',
  });
  assert.equal(
    growthbook.status,
    (await canLoad('@growthbook/growthbook')) ? 'ready' : 'unavailable',
  );
  const posthogMod = await canLoad('posthog-js')
    .then((ok) => (ok ? import('posthog-js') : null))
    .catch(() => null);
  if (posthogMod) {
    // Mirrors the export-shape fallback in initPostHog: v1.x puts the
    // singleton on the named `posthog` export, older builds on default.
    const client = posthogMod.posthog ?? posthogMod.default;
    assert.equal(
      typeof client?.init,
      'function',
      'posthog client exposes init',
    );
  }
});
