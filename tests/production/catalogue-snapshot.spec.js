import { expect, test } from '@playwright/test'
import { ALL_TUTORIAL_STORAGE_KEYS } from '../../src/lib/tutorialPreferences.js'

test.describe('snapshot failure recovery', () => {
  test.skip(process.env.REQUIRE_CATALOGUE_SNAPSHOTS !== 'true', 'Only applies to snapshot releases')

  test('a new visitor can browse and plan while the data host is unavailable', async ({ page }) => {
    await page.addInitScript((keys) => {
      localStorage.setItem('hks-splash-shown', '1')
      for (const key of keys) localStorage.setItem(key, '1')
      localStorage.setItem('hks_favorites', '["API-101"]')
    }, ALL_TUTORIAL_STORAGE_KEYS)
    const databaseReads = []
    await page.route('**/*', async (route) => {
      const hostname = new URL(route.request().url()).hostname
      if (hostname.endsWith('.supabase.co')) {
        databaseReads.push(route.request().url())
        return route.abort('blockedbyclient')
      }
      if (hostname === 'hks-course-explorer-data.pages.dev' || hostname === 'us.i.posthog.com') {
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    await page.goto('/schedule-builder')
    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
    await expect(page.getByText(/Showing the last available catalogue/)).toBeVisible()
    const terms = page.getByLabel('Catalogue term')
    await expect.poll(() => terms.locator('option').count()).toBeGreaterThanOrEqual(2)
    const results = page.getByRole('list', { name: 'Course search results' })
    await expect(results.getByRole('listitem').first()).toBeVisible()
    const add = results.getByRole('button', { name: /^Add .+ to plan$/ }).first()
    const label = await add.getAttribute('aria-label')
    const code = label.match(/^Add (.+) to plan$/)[1]
    await add.click()
    await expect(results.getByRole('button', { name: `Remove ${code} from plan` })).toBeVisible()
    await page.reload()
    await expect(results.getByRole('button', { name: `Remove ${code} from plan` })).toBeVisible()
    await terms.selectOption({ index: 1 })
    await expect(results.getByRole('listitem').first()).toBeVisible()
    expect(databaseReads).toEqual([])
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hks_favorites')))).toContain(
      'API-101',
    )
  })
})
