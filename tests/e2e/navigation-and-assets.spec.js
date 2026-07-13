import { test, expect } from '@playwright/test'
import {
  DESKTOP_NAV_ITEMS,
  MOBILE_MORE_NAV_ITEMS,
  MOBILE_PRIMARY_NAV_ITEMS,
} from '../../src/lib/visitorNavigation.js'
import { ALL_TUTORIAL_STORAGE_KEYS } from '../../src/lib/tutorialPreferences.js'
import { installMockBackend } from './support/mockBackend.js'

test.describe('local build navigation and static assets', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript((tutorialKeys) => {
      localStorage.setItem('hks-splash-shown', '1')
      // Navigation coverage should exercise the application after a user has
      // completed onboarding, not a deliberate first-run teaching overlay.
      for (const key of tutorialKeys) localStorage.setItem(key, '1')
    }, ALL_TUTORIAL_STORAGE_KEYS)
    await page.setViewportSize({ width: 1440, height: 1000 })
  })

  test('serves the guide and manifest from the built preview', async ({ page }) => {
    const [guide, manifest] = await Promise.all([
      page.request.get('/user-guide.html'),
      page.request.get('/manifest.json'),
    ])

    expect(guide.ok()).toBe(true)
    await expect(guide.text()).resolves.toContain('HKS Course Explorer')
    expect(manifest.ok()).toBe(true)
    await expect(manifest.json()).resolves.toMatchObject({ name: 'HKS Course Explorer' })

    await page.goto('/')
    await expect(page.locator('a[href="/user-guide.html"]').first()).toBeVisible()

    // A missing same-origin image, icon, or manifest is a release regression
    // even if the SPA shell itself still renders.
    const localAssetUrls = await page
      .locator('img[src], link[rel="icon"][href], link[rel="manifest"][href]')
      .evaluateAll((elements) => [
        ...new Set(
          elements
            .map((element) => element.src || element.href)
            .filter((url) => new URL(url).origin === window.location.origin),
        ),
      ])
    for (const url of localAssetUrls) {
      const response = await page.request.get(url)
      expect(response.ok(), `static asset should load: ${url}`).toBe(true)
    }
  })

  test('keeps primary navigation targets wired to their intended routes', async ({ page }) => {
    await page.goto('/')
    const navigation = page.getByRole('navigation', { name: 'Main navigation' }).first()
    const routes = DESKTOP_NAV_ITEMS.filter((item) => item.to !== '/')

    for (const item of routes) {
      await expect(navigation.getByRole('link', { name: item.label, exact: true })).toHaveAttribute(
        'href',
        item.to,
      )
    }

    await navigation.getByRole('link', { name: 'Schedule Builder', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule-builder$/)
    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
  })

  test('restores the Course Explorer Replay control after keyboard dismissal', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/courses')
      if (viewport.width < 768) {
        await page.getByRole('button', { name: 'Open filters' }).click()
      }

      const replay = page.getByRole('button', { name: 'Replay tour' })
      await replay.focus()
      await page.keyboard.press('Enter')
      await expect(replay).toHaveAttribute('aria-disabled', 'true')
      await expect(replay).toBeFocused()

      const tour = page.getByRole('dialog', { name: 'Set the Year' })
      await expect(tour).toBeFocused({ timeout: 15_000 })
      await page.keyboard.press('Escape')
      await expect(tour).toHaveCount(0)
      await expect(replay).toBeFocused()
    }
  })

  test('renders every visitor-facing SPA route from a direct URL', async ({ page }) => {
    const routes = [
      ['/courses', 'Course Explorer'],
      ['/faculty', 'Faculty Explorer'],
      ['/compare', 'Compare Courses'],
      ['/schedule-builder', 'Schedule Builder'],
      ['/requirements', 'Requirements Tracker'],
      ['/resources', 'HKS Resources'],
    ]

    for (const [route, marker] of routes) {
      await page.goto(route)
      // Full CI runs load every lazy route in parallel on one preview server.
      // Keep the assertion strict, but allow the same route load that completes
      // in ~2 seconds alone enough headroom under CPU contention.
      await expect(page.locator('#main-content')).toContainText(marker, { timeout: 15_000 })
      await expect(page.getByRole('main')).toHaveCount(1)
      expect(new URL(page.url()).pathname).toBe(route)
      await expect(page.locator('#main-content')).not.toContainText('Failed to load course data')
    }
  })

  test('keeps scheduling, degree planning, and secondary destinations reachable on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')

    const navigation = page.getByRole('navigation', { name: 'Mobile navigation' })
    for (const item of MOBILE_PRIMARY_NAV_ITEMS) {
      await expect(navigation.getByRole('link', { name: item.label, exact: true })).toBeVisible()
    }

    const moreButton = navigation.getByRole('button', { name: 'More', exact: true })
    await moreButton.focus()
    await page.keyboard.press('Enter')
    await expect(moreButton).toHaveAttribute('aria-expanded', 'true')
    for (const item of MOBILE_MORE_NAV_ITEMS) {
      await expect(page.getByRole('link', { name: item.label, exact: true })).toBeVisible()
    }

    await page.keyboard.press('Escape')
    await expect(page.locator('#mobile-more-navigation')).toHaveCount(0)
    await expect(moreButton).toBeFocused()

    await moreButton.click()

    await page.getByRole('link', { name: 'Resources', exact: true }).click()
    await expect(page).toHaveURL(/\/resources$/)
    await expect(page.locator('#mobile-more-navigation')).toHaveCount(0)

    await moreButton.click()
    await navigation.getByRole('link', { name: 'Schedule Builder', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule-builder$/)
    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
    await expect(page.locator('#mobile-more-navigation')).toHaveCount(0)
  })
})
