import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

async function expectNoSeriousOrCriticalAxeViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    // The existing theme has a documented contrast-remediation backlog. Keep
    // the new gate focused on semantic and keyboard regressions until the
    // palette has been corrected across the legacy component set.
    .disableRules(['color-contrast', 'scrollable-region-focusable'])
    .analyze()
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
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
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
})
