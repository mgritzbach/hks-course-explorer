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

  test('welcomes once and restores trigger focus after either keyboard or button close', async ({
    page,
  }) => {
    await page.goto('/')
    const toggle = page.getByRole('button', { name: 'Open course advisor' })
    await toggle.click()

    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(config.chatWelcome, { exact: true })).toHaveCount(1)
    await expect(dialog.getByPlaceholder(/light workload/i)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toBeFocused()

    await toggle.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(config.chatWelcome, { exact: true })).toHaveCount(1)
    await expect(dialog.getByPlaceholder(/light workload/i)).toBeFocused()

    await dialog.getByRole('button', { name: 'Close Course Advisor', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toBeFocused()

    await toggle.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(config.chatWelcome, { exact: true })).toHaveCount(1)
  })

  test('serializes a real course question and renders the deterministic recommendation', async ({
    page,
  }) => {
    await page.route('**/api/chat', async (route) => {
      const payload = route.request().postDataJSON()
      expect(payload.message).toBe('Suggest a light workload course')
      expect(payload.courses.length).toBeGreaterThan(0)
      expect(
        payload.courses.every(
          (course) => course.is_core === undefined || typeof course.is_core === 'boolean',
        ),
      ).toBe(true)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'Based on the available course data, consider:\n- API-101: Policy Analysis.',
          source: 'course-data-fallback',
        }),
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Open course advisor' }).click()
    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    await dialog.getByPlaceholder(/light workload/i).fill('Suggest a light workload course')
    await dialog.getByRole('button', { name: 'Send message' }).click()

    await expect(dialog.getByText(/API-101: Policy Analysis/)).toBeVisible()
    await expect(dialog.getByText(/Error:/)).toHaveCount(0)
  })
})
