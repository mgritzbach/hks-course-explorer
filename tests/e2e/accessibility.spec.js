import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

async function expectNoSeriousOrCriticalAxeViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const blocking = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact),
  )
  expect(
    blocking,
    blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n'),
  ).toEqual([])
}

test.describe('built accessibility checks', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => {
      localStorage.setItem('hks-splash-shown', '1')
      localStorage.setItem('hks-tour-home', '1')
    })
  })

  test('provides a keyboard skip link and an accessible Home screen', async ({ page }) => {
    await page.goto('/')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    // `page.goto()` resolves before React has necessarily committed its first
    // render. Wait for the real first keyboard target so this test exercises
    // keyboard navigation rather than racing hydration on slower CI runners.
    await expect(skip).toBeAttached()
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
    await expectNoSeriousOrCriticalAxeViolations(page)
  })

  test('has no serious or critical WCAG A/AA violations in Schedule Builder', async ({ page }) => {
    await page.goto('/schedule-builder')
    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
    await expectNoSeriousOrCriticalAxeViolations(page)
  })

  test('has no serious or critical WCAG A/AA violations on the mobile primary flows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto('/')
    await expect(page.locator('#main-content')).toBeVisible()
    await expectNoSeriousOrCriticalAxeViolations(page)

    await page.goto('/schedule-builder')
    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
    await expectNoSeriousOrCriticalAxeViolations(page)
  })
})
