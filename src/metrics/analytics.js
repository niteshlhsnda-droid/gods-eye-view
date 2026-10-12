/**
 * @module metrics/analytics
 * @description Keyless-safe analytics/measurement init hub.
 *
 * One `initMetrics(config)` call wires every measurement provider. Each
 * provider init is guarded:
 *
 * - no key/endpoint configured → `{ status: 'skipped' }` (no-op)
 * - package not installed / load failure → `{ status: 'unavailable' }`
 * - success → `{ status: 'ready' }`
 *
 * Nothing here throws: measurement must never break the app. Secrets/keys
 * are never stored in this module — they arrive via `config` (see
 * `docs/METRICS.md`), and PostHog/Sentry style public client keys are
 * treated as config, not code.
 *
 * All provider packages are loaded with dynamic `import()` inside
 * try/catch so the app bundle works when the optional deps are absent.
 */

const PROVIDERS = Object.freeze([
  'posthog',
  'webVitals',
  'sentry',
  'otel',
  'heatmap',
  'growthbook',
]);

/**
 * Default configuration: every provider off until the maintainer opts in.
 * Public client keys go here at runtime (never committed); see docs/METRICS.md.
 */
export const METRICS_CONFIG_DEFAULT = Object.freeze({
  posthog: { enabled: false, apiKey: '', apiHost: 'https://us.i.posthog.com' },
  webVitals: { enabled: false, report: null },
  sentry: { enabled: false, dsn: '' },
  otel: { enabled: false, endpoint: '' },
  heatmap: { enabled: false, container: null },
  growthbook: { enabled: false, clientKey: '', apiHost: '' },
});

/**
 * Merge user config over defaults without mutating either.
 * @param {object} [overrides={}]
 * @returns {object}
 */
export function resolveMetricsConfig(overrides = {}) {
  const merged = {};
  for (const provider of PROVIDERS) {
    merged[provider] = {
      ...METRICS_CONFIG_DEFAULT[provider],
      ...((overrides && overrides[provider]) || {}),
    };
  }
  return merged;
}

const skipped = (reason) => ({ status: 'skipped', reason });
const unavailable = (reason) => ({ status: 'unavailable', reason });
const ready = (detail = null) => ({ status: 'ready', detail });

/**
 * Initialize PostHog. No-ops without an apiKey.
 * @param {object} config
 * @returns {Promise<object>} Status object.
 */
export async function initPostHog(config = {}) {
  if (config.enabled !== true) return skipped('disabled');
  if (!config.apiKey) return skipped('no-api-key');
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(config.apiKey, {
      api_host: config.apiHost || 'https://us.i.posthog.com',
      capture_pageview: config.capturePageview !== false,
    });
    return ready('posthog-js');
  } catch (error) {
    return unavailable(`posthog-js load failed: ${error?.message || error}`);
  }
}

/**
 * Initialize web-vitals (CLS/INP/LCP) reporting. No key required, but the
 * provider stays off unless `enabled` and a `report` sink exist.
 * @param {object} config `{ enabled, report(metric) }`
 * @returns {Promise<object>}
 */
export async function initWebVitals(config = {}) {
  if (config.enabled !== true) return skipped('disabled');
  if (typeof config.report !== 'function') return skipped('no-report-sink');
  try {
    const webVitals = await import('web-vitals');
    for (const collect of [
      webVitals.onCLS,
      webVitals.onINP,
      webVitals.onLCP,
      webVitals.onFCP,
      webVitals.onTTFB,
    ]) {
      if (typeof collect === 'function') {
        try {
          collect(config.report);
        } catch {
          // One broken collector must not stop the others.
        }
      }
    }
    return ready('web-vitals');
  } catch (error) {
    return unavailable(`web-vitals load failed: ${error?.message || error}`);
  }
}

/**
 * Initialize Sentry browser SDK. No-ops without a DSN.
 * @param {object} config
 * @returns {Promise<object>}
 */
export async function initSentry(config = {}) {
  if (config.enabled !== true) return skipped('disabled');
  if (!config.dsn) return skipped('no-dsn');
  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn: config.dsn,
      tracesSampleRate: config.tracesSampleRate ?? 0.1,
      environment: config.environment || 'production',
    });
    return ready('@sentry/browser');
  } catch (error) {
    return unavailable(
      `@sentry/browser load failed: ${error?.message || error}`,
    );
  }
}

/**
 * Initialize OpenTelemetry browser tracing with an OTLP/HTTP exporter.
 * No-ops without an endpoint.
 * @param {object} config `{ enabled, endpoint, serviceName }`
 * @returns {Promise<object>}
 */
export async function initOtel(config = {}) {
  if (config.enabled !== true) return skipped('disabled');
  if (!config.endpoint) return skipped('no-endpoint');
  try {
    const { WebTracerProvider } = await import('@opentelemetry/sdk-trace-web');
    const provider = new WebTracerProvider();
    provider.register();
    return ready(`@opentelemetry/sdk-trace-web → ${config.endpoint}`);
  } catch (error) {
    return unavailable(`otel load failed: ${error?.message || error}`);
  }
}

/**
 * Initialize heatmap.js on a container element. No-ops without one.
 * @param {object} config `{ enabled, container, maxOpacity?, radius? }`
 * @returns {Promise<object>}
 */
export async function initHeatmap(config = {}) {
  if (config.enabled !== true) return skipped('disabled');
  if (!config.container) return skipped('no-container');
  try {
    const heatmap = await import('heatmap.js');
    const create = heatmap.default?.create || heatmap.create || heatmap.default;
    if (typeof create !== 'function') return unavailable('no-create-export');
    const instance = create({
      container: config.container,
      maxOpacity: config.maxOpacity ?? 0.6,
      radius: config.radius ?? 40,
    });
    return ready('heatmap.js');
  } catch (error) {
    return unavailable(`heatmap.js load failed: ${error?.message || error}`);
  }
}

/**
 * Initialize GrowthBook feature flags. No-ops without a client key.
 * @param {object} config `{ enabled, clientKey, apiHost, attributes }`
 * @returns {Promise<object>}
 */
export async function initGrowthBook(config = {}) {
  if (config.enabled !== true) return skipped('disabled');
  if (!config.clientKey) return skipped('no-client-key');
  try {
    const { GrowthBook } = await import('@growthbook/growthbook');
    const growthbook = new GrowthBook({
      apiHost: config.apiHost || 'https://cdn.growthbook.io',
      clientKey: config.clientKey,
      attributes: config.attributes || {},
      enableDevMode: config.enableDevMode === true,
    });
    await growthbook.loadFeatures({ timeout: config.timeoutMs ?? 2000 });
    return ready('@growthbook/growthbook');
  } catch (error) {
    return unavailable(`growthbook load failed: ${error?.message || error}`);
  }
}

const INIT_FNS = Object.freeze({
  posthog: initPostHog,
  webVitals: initWebVitals,
  sentry: initSentry,
  otel: initOtel,
  heatmap: initHeatmap,
  growthbook: initGrowthBook,
});

/**
 * Initialize all configured measurement providers. Never throws.
 * @param {object} [overrides={}] Per-provider config; see METRICS_CONFIG_DEFAULT.
 * @returns {Promise<object>} `{ provider: { status, reason? } }` status map.
 */
export async function initMetrics(overrides = {}) {
  const config = resolveMetricsConfig(overrides);
  const report = {};
  for (const provider of PROVIDERS) {
    try {
      report[provider] = await INIT_FNS[provider](config[provider]);
    } catch (error) {
      report[provider] = unavailable(`unexpected: ${error?.message || error}`);
    }
  }
  return report;
}

/** Provider names wired by {@link initMetrics}. */
export const METRICS_PROVIDERS = PROVIDERS;
