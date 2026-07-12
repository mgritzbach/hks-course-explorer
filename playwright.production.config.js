import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.DEPLOY_SMOKE_URL

if (!baseURL) {
  throw new Error('DEPLOY_SMOKE_URL is required for the production browser smoke test.')
}

export default defineConfig({
  testDir: './tests/production',
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  globalTimeout: 240_000,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL,
    headless: true,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'production-chromium', use: { ...devices['Desktop Chrome'] } }],
})
