import { test, expect } from '@playwright/test'
import config from '../../src/school.config.js'
import { installMockBackend } from './support/mockBackend.js'

test.describe('course advisor lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => {
      localStorage.setItem('hks-splash-shown', '1')
      localStorage.setItem('hks-tour-home', '1')
    })
  })

  test('welcomes once and restores focus when the advisor is reopened', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByRole('button', { name: 'Open course advisor' })
    await toggle.click()

    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(config.chatWelcome, { exact: true })).toHaveCount(1)
    await expect(dialog.getByPlaceholder(/light workload/i)).toBeFocused()

    await dialog.getByRole('button', { name: 'Close Course Advisor', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await toggle.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(config.chatWelcome, { exact: true })).toHaveCount(1)
    await expect(dialog.getByPlaceholder(/light workload/i)).toBeFocused()
  })
})
