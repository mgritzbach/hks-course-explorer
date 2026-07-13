import { test, expect } from '@playwright/test'
import { ALL_TUTORIAL_STORAGE_KEYS } from '../../src/lib/tutorialPreferences.js'
import { installMockBackend } from './support/mockBackend.js'

test.describe('Course Explorer bidding history', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript((tutorialKeys) => {
      localStorage.setItem('hks-splash-shown', '1')
      for (const key of tutorialKeys) localStorage.setItem(key, '1')
    }, ALL_TUTORIAL_STORAGE_KEYS)
  })

  test('loads the bidding trend after a student opens the history tab', async ({ page }) => {
    await page.goto('/courses?id=history-api-101')

    await expect(page.getByRole('tab', { name: 'Bidding History' })).toBeVisible()
    await page.getByRole('tab', { name: 'Bidding History' }).click()
    await expect(page.getByText('Clearing Price Trend')).toBeVisible()
    await expect(page.locator('[role="status"]', { hasText: 'Loading bidding trend' })).toHaveCount(
      0,
    )
    await expect(page.locator('svg.recharts-surface')).toBeVisible()
  })
})
