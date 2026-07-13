import { test, expect } from '@playwright/test'
import { ALL_TUTORIAL_STORAGE_KEYS } from '../../src/lib/tutorialPreferences.js'
import { installMockBackend } from './support/mockBackend.js'

test.describe('welcome landing page', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => window.localStorage.clear())
  })

  test('Direct opens Course Explorer without activating the Home tutorial', async ({ page }) => {
    await page.goto('/')

    const landing = page.getByRole('dialog', { name: 'Welcome to the HKS Course Explorer' })
    const direct = page.getByRole('button', {
      name: 'Continue directly and skip all tutorial boxes',
    })
    const tutorial = page.getByRole('button', { name: 'Continue with the guided tutorial' })
    await expect(landing).toBeVisible()
    await expect(page.getByRole('main')).toHaveCount(0)
    await tutorial.focus()
    await page.keyboard.press('Tab')
    await expect(direct).toBeFocused()
    await direct.click()

    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('main')).toHaveCount(1)
    await page.waitForTimeout(600)
    await expect(page.getByRole('dialog', { name: 'Start with the Year' })).toHaveCount(0)
    await expect(
      page.evaluate(
        (keys) => keys.every((key) => window.localStorage.getItem(key) === '1'),
        ALL_TUTORIAL_STORAGE_KEYS,
      ),
    ).resolves.toBe(true)
  })

  for (const [viewportName, viewport] of [
    ['desktop', { width: 1280, height: 720 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    test(`moves focus into the application after keyboard Direct entry on ${viewportName}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      const direct = page.getByRole('button', {
        name: 'Continue directly and skip all tutorial boxes',
      })
      await direct.focus()
      await page.keyboard.press('Enter')

      await expect(page.locator('#main-content')).toBeFocused({ timeout: 15_000 })
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    test(`contains and restores focus for the keyboard tutorial on ${viewportName}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      const tutorial = page.getByRole('button', { name: 'Continue with the guided tutorial' })
      await tutorial.focus()
      await page.keyboard.press('Enter')

      const tour = page.getByRole('dialog', { name: 'Start with the Year' })
      await expect(tour).toBeFocused({ timeout: 15_000 })
      await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true')
      await expect.poll(() => page.locator('#root').evaluate((root) => root.inert)).toBe(true)

      await page.keyboard.press('Shift+Tab')
      await expect(tour.getByRole('button', { name: /next/i })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(tour.getByRole('button', { name: 'Close tour' })).toBeFocused()

      await page.keyboard.press('Escape')
      await expect(tour).toHaveCount(0)
      await expect(page.locator('#main-content')).toBeFocused()
      await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', 'true')
      await expect.poll(() => page.locator('#root').evaluate((root) => root.inert)).toBe(false)
    })

    test(`restores the actual Replay control after a keyboard tour on ${viewportName}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page
        .getByRole('button', { name: 'Continue directly and skip all tutorial boxes' })
        .click()
      await expect(page.locator('#main-content')).toBeFocused({ timeout: 15_000 })

      if (viewportName === 'mobile') {
        const openFilters = page.getByRole('button', { name: 'Open filters' })
        await openFilters.focus()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('button', { name: 'Close filter panel' })).toBeVisible()
      }
      const replay = page.locator('button[aria-label="Replay tour"]:visible')
      await replay.focus()
      await page.evaluate(() => {
        window.__replayFocusAudit = { bodySeen: false, completed: false }
        const sample = () => {
          const active = document.activeElement
          if (!active || active === document.body || active === document.documentElement) {
            window.__replayFocusAudit.bodySeen = true
          }
          if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
            window.__replayFocusAudit.completed = true
            return
          }
          window.requestAnimationFrame(sample)
        }
        window.requestAnimationFrame(sample)
      })
      await replay.press('Enter')

      const tour = page.getByRole('dialog', { name: 'Start with the Year' })
      await expect(tour).toBeFocused({ timeout: 15_000 })
      await expect
        .poll(() => page.evaluate(() => window.__replayFocusAudit))
        .toEqual({ bodySeen: false, completed: true })
      await page.keyboard.press('Escape')
      await expect(tour).toHaveCount(0)
      await expect(replay).toBeFocused()
      await expect(replay).toHaveAttribute('aria-disabled', 'false')
    })
  }

  test('a direct route visit shows only the landing dialog before the visitor decides', async ({
    page,
  }) => {
    await page.goto('/courses')

    await expect(
      page.getByRole('dialog', { name: 'Welcome to the HKS Course Explorer' }),
    ).toBeVisible()
    // Route-level and global tours use portals outside #root, so merely making
    // the application inert is insufficient. The landing page must be the
    // sole dialog after their delayed startup window has elapsed.
    await page.waitForTimeout(600)
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })

  test('does not request the historical catalogue before the visitor chooses to continue', async ({
    page,
  }) => {
    const catalogueRequests = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/rest/v1/courses')) {
        catalogueRequests.push(request.url())
      }
    })

    await page.goto('/')
    await expect(
      page.getByRole('dialog', { name: 'Welcome to the HKS Course Explorer' }),
    ).toBeVisible()
    await page.waitForTimeout(600)

    expect(catalogueRequests).toEqual([])
  })

  test('starts product analytics only after the visitor enters the application', async ({
    page,
  }) => {
    let analyticsRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).hostname === 'us.i.posthog.com') analyticsRequests += 1
    })

    await page.goto('/')
    await expect(
      page.getByRole('dialog', { name: 'Welcome to the HKS Course Explorer' }),
    ).toBeVisible()
    await page.waitForTimeout(600)
    expect(analyticsRequests).toBe(0)

    await page
      .getByRole('button', { name: 'Continue directly and skip all tutorial boxes' })
      .click()
    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible({
      timeout: 15_000,
    })
    await expect.poll(() => analyticsRequests, { timeout: 10_000 }).toBeGreaterThan(0)
  })

  test('keeps both first-visit actions inside a 1280 by 720 desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    for (const name of [
      'Continue directly and skip all tutorial boxes',
      'Continue with the guided tutorial',
    ]) {
      const button = page.getByRole('button', { name })
      await expect(button).toBeVisible()
      const bounds = await button.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(720)
    }
  })

  test('keeps both first-visit actions reachable in a 390 by 844 mobile viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    for (const name of [
      'Continue directly and skip all tutorial boxes',
      'Continue with the guided tutorial',
    ]) {
      const button = page.getByRole('button', { name })
      await expect(button).toBeVisible()
      const bounds = await button.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
    }
  })

  test('Tutorial opens Course Explorer with the Home tutorial active', async ({ page }) => {
    // The guided path waits for the real Home view, including its deliberately
    // lazy chart. Keep a finite budget for slower parallel CI workers.
    test.slow()
    await page.goto('/')

    await page.getByRole('button', { name: 'Continue with the guided tutorial' }).click()

    await expect(page.getByRole('dialog', { name: 'Start with the Year' })).toBeVisible({
      timeout: 15_000,
    })
    // The modal correctly removes the application root from the accessibility
    // tree, so assert the rendered page heading through its DOM visibility.
    await expect(page.locator('h2').filter({ hasText: 'Course Comparisons' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })
})
