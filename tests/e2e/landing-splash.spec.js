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

    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible()
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

  test('Tutorial opens Course Explorer with the Home tutorial active', async ({ page }) => {
    // The guided path waits for the real Home view, including its deliberately
    // lazy chart. Keep a finite budget for slower parallel CI workers.
    test.slow()
    await page.goto('/')

    await page.getByRole('button', { name: 'Continue with the guided tutorial' }).click()

    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('dialog', { name: 'Start with the Year' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })
})
