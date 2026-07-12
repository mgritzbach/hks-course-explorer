import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

const SCHEDULE_READY_TIMEOUT_MS = 15_000
const VISITOR_ROUTES = [
  ['/', 'Course Comparisons', 'HKS Course Search'],
  ['/courses', 'Course Explorer', 'HKS Course Explorer - Courses'],
  ['/faculty', 'Faculty Explorer', 'HKS Course Explorer - Faculty'],
  ['/compare', 'Compare Courses', 'HKS Course Explorer - Compare'],
  ['/resources', 'HKS Resources', 'HKS Course Explorer - Resources'],
  ['/schedule-builder', 'Schedule Builder', 'HKS Course Explorer - Schedule Builder'],
  ['/requirements', 'Requirements Tracker', 'HKS Course Explorer - My Degree'],
  ['/not-a-real-route', 'Page not found', 'HKS Course Explorer - Page Not Found'],
]

async function expectNoWcagViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(
    results.violations,
    results.violations
      .map(
        (violation) =>
          `${violation.impact || 'unknown'} ${violation.id}: ${violation.help} (${violation.nodes.length} node${violation.nodes.length === 1 ? '' : 's'})`,
      )
      .join('\n'),
  ).toEqual([])
}

async function openVisitorRoute(page, route, marker, expectedTitle) {
  await page.goto(route)
  await expect(page.locator('#main-content')).toContainText(marker, {
    timeout: SCHEDULE_READY_TIMEOUT_MS,
  })
  await expect(page.getByRole('main')).toHaveCount(1)
  // Responsive routes may keep alternate desktop/mobile headings in the DOM;
  // exactly one page-level heading must be exposed in the active layout.
  await expect(page.locator('h1:visible')).toHaveCount(1)
  await expect(page).toHaveTitle(new RegExp(expectedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

test.describe('built accessibility checks', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => {
      localStorage.setItem('hks-splash-shown', '1')
      localStorage.setItem('hks-tour-home', '1')
    })
  })

  test('provides a working keyboard skip link on every visitor route', async ({ page }) => {
    test.slow()

    for (const [route, marker, title] of VISITOR_ROUTES) {
      await openVisitorRoute(page, route, marker, title)
      const skip = page.getByRole('link', { name: 'Skip to main content' })
      // `page.goto()` resolves before React has necessarily committed its first
      // render. Wait for the real first keyboard target so this test exercises
      // keyboard navigation rather than racing hydration on slower CI runners.
      await expect(skip).toBeAttached()
      await page.keyboard.press('Tab')
      await expect(skip).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('#main-content')).toBeFocused()
    }
  })

  test('has no WCAG A/AA violations on every desktop visitor route', async ({ page }) => {
    test.slow()

    for (const [route, marker, title] of VISITOR_ROUTES) {
      await openVisitorRoute(page, route, marker, title)
      await expectNoWcagViolations(page)
    }
  })

  test('has no WCAG A/AA violations on every mobile visitor route', async ({ page }) => {
    test.slow()
    await page.setViewportSize({ width: 390, height: 844 })

    for (const [route, marker, title] of VISITOR_ROUTES) {
      await openVisitorRoute(page, route, marker, title)
      await expectNoWcagViolations(page)
    }
  })

  test('moves focus to main content after client-side navigation', async ({ page }) => {
    await openVisitorRoute(page, ...VISITOR_ROUTES[0])

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Courses', exact: true })
      .click()

    await expect(page).toHaveURL(/\/courses$/)
    await expect(page.locator('#main-content')).toBeFocused()
    await expect(page.locator('h1')).toHaveText('Course Explorer')
    await expect(page).toHaveTitle('HKS Course Explorer - Courses')
  })
})

test.describe('first-visit accessibility checks', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => window.localStorage.clear())
  })

  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 720 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    test(`has no WCAG A/AA violations and traps keyboard focus on ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      const landing = page.getByRole('dialog', { name: 'Welcome to the HKS Course Explorer' })
      const direct = page.getByRole('button', {
        name: 'Continue directly and skip all tutorial boxes',
      })
      const tutorial = page.getByRole('button', { name: 'Continue with the guided tutorial' })
      await expect(landing).toBeVisible()
      // Focus starts on the dialog itself so screen readers announce the
      // complete title and description before either decision button.
      await expect(landing).toBeFocused()
      await expectNoWcagViolations(page)

      await tutorial.focus()
      await page.keyboard.press('Tab')
      await expect(direct).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(tutorial).toBeFocused()
    })
  }
})
