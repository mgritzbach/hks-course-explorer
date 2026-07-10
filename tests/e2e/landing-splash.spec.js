import { test, expect } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

test.describe('welcome landing page', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => window.localStorage.clear())
  })

  test('Direct opens Course Explorer without activating the Home tutorial', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', { name: 'Welcome to the HKS Course Explorer' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Continue directly without the tutorial' }).click()

    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page.getByRole('dialog', { name: 'Start with the Year' })).toHaveCount(0)
  })

  test('Tutorial opens Course Explorer with the Home tutorial active', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Continue with the guided tutorial' }).click()

    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Start with the Year' })).toBeVisible()
  })
})
