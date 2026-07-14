import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'

const baseURL = process.env.DEPLOY_SMOKE_URL

if (!baseURL) {
  throw new Error('DEPLOY_SMOKE_URL is required for the ATS production proof.')
}

export default defineConfig({
  testDir: './tests/production',
  testMatch: 'ats-catalogue-closeout.spec.js',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  globalTimeout: 120_000,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL,
    headless: true,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'ats-production-chromium', use: { ...devices['Desktop Chrome'] } }],
})
