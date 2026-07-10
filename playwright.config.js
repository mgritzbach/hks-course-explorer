import { defineConfig, devices } from '@playwright/test'

// Allow a parallel local verification to use an isolated port without ever
// reusing an unknown/stale server. CI retains the stable default.
const previewPort = Number(process.env.PLAYWRIGHT_PORT || 4173)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // A browser process can occasionally fail to exit even after individual
  // tests have timed out. Fail closed instead of leaving a release gate
  // running indefinitely; normal CI runs complete in well under one minute.
  globalTimeout: process.env.CI ? 180_000 : undefined,
  // Keep the hosted runner below resource saturation while retaining parallel
  // coverage. Local runs preserve Playwright's normal worker selection.
  workers: process.env.CI ? 4 : undefined,
  timeout: 30000,
  use: {
    // E2E always exercises the static build produced by this revision, never
    // a mutable deployment that may be on a different version.
    baseURL: `http://127.0.0.1:${previewPort}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    // CI and `test:e2e:build` create `dist` before this starts. Serving it
    // directly keeps normal E2E feedback fast while testing the artifact that
    // would actually be deployed.
    command: `npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: `http://127.0.0.1:${previewPort}`,
    // Reusing a server could test stale files (or a different project) on the
    // same port. Fail instead of producing misleading green results.
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
