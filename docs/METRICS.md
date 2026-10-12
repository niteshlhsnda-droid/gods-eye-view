# Metrics & measurement (`src/metrics/analytics.js`)

One init hub for every measurement provider. Keyless-safe by construction:
**no key, no DSN, no endpoint in code — ever.** Every provider no-ops when
unconfigured, and degrades to `{ status: 'unavailable' }` when its package is
not installed, instead of throwing.

## Usage

```js
import { initMetrics } from './metrics/analytics.js';

const report = await initMetrics({
  posthog: { enabled: true, apiKey: POSTHOG_KEY }, // from env/config, never committed
  webVitals: { enabled: true, report: (metric) => sendToBackend(metric) },
  sentry: { enabled: true, dsn: SENTRY_DSN },
  otel: { enabled: true, endpoint: 'https://otel.example.com/v1/traces' },
  heatmap: { enabled: true, container: document.getElementById('heat') },
  growthbook: { enabled: true, clientKey: 'sdk-…', attributes: { id: '…' } },
});
// report = { posthog: {status:'ready'}, webVitals: {status:'skipped', reason:'disabled'}, … }
```

Status values: `ready` | `skipped` (with `reason`: `disabled`,
`no-api-key`, `no-dsn`, `no-endpoint`, `no-container`, `no-client-key`,
`no-report-sink`) | `unavailable` (package missing / load failed).

## Providers

| Provider | Package | License | Needs |
|---|---|---|---|
| PostHog | `posthog-js` | Apache-2.0 AND MIT | `apiKey` (+ optional `apiHost`) |
| Web Vitals | `web-vitals` | Apache-2.0 | `report(metric)` sink — CLS/INP/LCP/FCP/TTFB |
| Sentry | `@sentry/browser` | MIT | `dsn` |
| OpenTelemetry | `@opentelemetry/sdk-trace-web` | Apache-2.0 | OTLP `endpoint` |
| heatmap.js | `heatmap.js` | MIT | `container` element |
| GrowthBook | `@growthbook/growthbook` | MIT | `clientKey` (+ optional `apiHost`) |

## Rules

1. Keys live in runtime config (env, server-injected settings, or a
   maintainer-owned config file) — never in the repo.
2. Public client keys (PostHog `phc_…`, Sentry DSN, GrowthBook `sdk-…`) are
   still config, not code: they ship in the deployed config, not in git.
3. `initMetrics` never throws. Measurement must never break the app.
4. Providers are loaded with dynamic `import()` only — nothing is statically
   imported, so disabled providers add zero bytes to the critical path.
