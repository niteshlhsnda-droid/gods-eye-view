# Lane-copilot dependency declarations

New runtime dependencies declared in `package.json` by the copilot (metrics /
scoreboard) lane. Versions are pinned exact; licenses verified against the
npm registry on 2026-10-12. **The orchestrator installs centrally — never run
`npm install` in this worktree.**

| Package | Version | SPDX license | Why |
|---|---|---|---|
| `echarts` | 6.1.0 | Apache-2.0 | Apache ECharts HUD telemetry strip (`src/metrics/telemetryStrip.js`): live altitude/speed chart with history sparklines for tracked targets. Lazy-loaded; strip no-ops when absent. |
| `web-vitals` | 6.2.3 | Apache-2.0 | Core Web Vitals measurement (CLS/INP/LCP/FCP/TTFB) via `src/metrics/analytics.js`. Opt-in; no key required. |
| `heatmap.js` | 2.0.5 | MIT | Interaction heatmaps (`h337`) via `src/metrics/analytics.js`. Opt-in; no key required. Registry `license` field is empty but the package ships MIT license text (pa7/heatmap.js). |
| `posthog-js` | 1.438.8 | (Apache-2.0 AND MIT) | Product analytics via `src/metrics/analytics.js`. No-op without `apiKey`. |
| `@sentry/browser` | 11.7.0 | MIT | Browser error monitoring via `src/metrics/analytics.js`. No-op without `dsn`. |
| `@opentelemetry/sdk-trace-web` | 2.12.0 | Apache-2.0 | Browser distributed tracing via `src/metrics/analytics.js`. No-op without OTLP `endpoint`. |
| `@growthbook/growthbook` | 1.8.0 | MIT | Feature flags / experimentation via `src/metrics/analytics.js`. No-op without `clientKey`. |

## Notes

- All seven are **optional at runtime**: every consumer uses dynamic
  `import()` inside try/catch and degrades to a no-op status object when the
  package is not installed. The app must never break because a measurement
  package is missing.
- No secrets or keys are declared here or in code. Keys arrive at runtime via
  `initMetrics(config)` (see `docs/METRICS.md`).
- `echarts` is the only one with a UI-facing consumer; the rest are
  measurement-only and add zero bytes to the critical path when disabled
  (they are never statically imported).
