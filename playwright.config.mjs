export default {
  testDir: 'tests',
  timeout: 120000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.GEV_BASE_URL || 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  // In CI the preview server is started explicitly by the workflow before
  // `npx playwright test` runs; locally this block lets `playwright test`
  // bring up `vite preview` on its own.
  webServer: process.env.GEV_NO_WEBSERVER
    ? undefined
    : {
        command: 'npx vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 120000,
      },
};
