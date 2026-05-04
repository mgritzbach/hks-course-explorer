import { test, expect } from '@playwright/test'

test.describe('Schedule Builder — critical flows', () => {

  test('TEST 1: HKS browse shows courses and session filter works', async ({ page }) => {
    await page.goto('/schedule-builder')
    // Wait for Supabase live_courses to load (can take 3-5s on cold start)
    await page.waitForTimeout(6000)

    // Target specifically the "with schedule" count — not the "Already Taken" 0 courses
    const countText = page.locator('text=/\\d+ with schedule/').first()
    await expect(countText).toBeVisible({ timeout: 15000 })
    const before = await countText.textContent()
    const countBefore = parseInt(before.match(/\d+/)[0])
    expect(countBefore).toBeGreaterThan(5)

    // Find and change session filter to Spring 1
    const sessionSelect = page.locator('select').filter({ hasText: /All sessions/ })
    await sessionSelect.selectOption('Spring 1')
    await page.waitForTimeout(1500)

    const after = await countText.textContent()
    const countAfter = parseInt(after.match(/\d+/)[0])
    // Spring 1 is a subset — should show fewer than all sessions
    expect(countAfter).toBeLessThan(countBefore)
  })

  test('TEST 2: Non-HKS browse shows non-HKS courses', async ({ page }) => {
    await page.goto('/schedule-builder')
    await page.waitForTimeout(4000)

    // Find the school source selector and switch to Non-HKS
    const schoolSelect = page.locator('select').filter({ hasText: /HKS/ }).first()
    await schoolSelect.selectOption('Non-HKS')
    await page.waitForTimeout(3000)

    // Should show Non-HKS courses
    const countText = page.locator('text=/\\d+ (courses|with schedule)/').first()
    await expect(countText).toBeVisible({ timeout: 10000 })
    const text = await countText.textContent()
    const count = parseInt(text.match(/\d+/)[0])
    expect(count).toBeGreaterThan(0)

    // Should mention Non-HKS in the count text
    const pageText = await page.textContent('body')
    expect(pageText).toMatch(/Non-HKS/)
  })

  test('TEST 3: Typed search returns results without crashing', async ({ page }) => {
    // Watch for console errors
    const errors = []
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('ReferenceError')) {
        errors.push(msg.text())
      }
    })

    await page.goto('/schedule-builder')
    await page.waitForTimeout(3000)

    // Type a search query
    const searchInput = page.locator('input[type="text"], input[placeholder*="Search"], input[placeholder*="search"]').first()
    await searchInput.fill('economics')
    await page.waitForTimeout(3000)

    // Should show results or "no results" — but NOT crash
    const body = await page.textContent('body')
    expect(body).not.toMatch(/Something went wrong/)
    expect(errors).toHaveLength(0)
  })

})
