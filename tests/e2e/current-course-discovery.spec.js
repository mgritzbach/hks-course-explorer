import { test, expect } from '@playwright/test'
import { ALL_TUTORIAL_STORAGE_KEYS } from '../../src/lib/tutorialPreferences.js'
import { installMockBackend } from './support/mockBackend.js'

for (const year of [2027, 2031]) {
  test(`discovers ${year} automatically on Home, Courses and Compare`, async ({ page }) => {
    await installMockBackend(page, {
      liveCoursesResponse: [
        {
          id: `future-${year}`,
          is_hks: true,
          active: true,
          school: 'HKS',
          course_code: 'SUP-434-001',
          course_code_base: 'SUP-434',
          title: 'Future Teacher Workforce',
          instructors: ['Future Professor'],
          term: `${year} Spring`,
          session_description: 'January',
        },
      ],
    })
    await page.addInitScript((keys) => {
      localStorage.setItem('hks-splash-shown', '1')
      for (const key of keys) localStorage.setItem(key, '1')
    }, ALL_TUTORIAL_STORAGE_KEYS)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/')
    await expect(page.getByLabel('Academic year').last()).toHaveValue(String(year))
    await expect(page.locator('h1')).toHaveText(`HKS Course Search - All Terms ${year}`)
    await expect(page.getByText(`January ${year}`, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Future Teacher Workforce', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/have no evaluation or bidding scores yet/)).toBeVisible()
    await page.goto(`/courses?y=${year}&q=Future Professor`)
    await expect(page.getByLabel('Academic year').last()).toHaveValue(String(year))
    await expect(page.getByText('Future Teacher Workforce', { exact: true }).first()).toBeVisible()
    await page.goto('/compare')
    await page.getByPlaceholder(/Search by name, code, professor/).fill('SUP-434')
    await page.getByRole('button', { name: /SUP-434-001 Future Teacher Workforce/ }).click()
    await expect(page.getByText('Future Teacher Workforce', { exact: true }).first()).toBeVisible()
    await expect(page).toHaveURL(/ids=SUP-434/)
  })
}
