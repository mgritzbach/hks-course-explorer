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

  test('serializes a real course question and labels a verified free-model response', async ({
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
          reply: 'API-101 is a grounded recommendation from the course database.',
          source: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          cost: 0,
        }),
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Open course advisor' }).click()
    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    await dialog.getByPlaceholder(/light workload/i).fill('Suggest a light workload course')
    await dialog.getByRole('button', { name: 'Send message' }).click()

    await expect(dialog.getByText(/API-101 is a grounded recommendation/)).toBeVisible()
    await expect(
      dialog.getByText('Free AI response · openai/gpt-oss-20b:free · verified cost $0.00'),
    ).toBeVisible()
    await expect(dialog.getByText(/Error:/)).toHaveCount(0)
  })

  test('shows provider failure explicitly and never substitutes a canned answer', async ({
    page,
  }) => {
    await page.route('**/api/chat', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Please wait 3 seconds before sending another AI request.',
          code: 'AI_RATE_LIMITED',
        }),
      }),
    )

    await page.goto('/')
    await page.getByRole('button', { name: 'Open course advisor' }).click()
    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    await dialog.getByPlaceholder(/light workload/i).fill('What are Hong Qu’s courses?')
    await dialog.getByRole('button', { name: 'Send message' }).click()

    await expect(dialog.getByText(/Please wait 3 seconds/)).toBeVisible()
    await expect(dialog.getByText('AI provider was not used')).toBeVisible()
    await expect(dialog.getByText(/Based on the available course data/)).toHaveCount(0)
  })
})
