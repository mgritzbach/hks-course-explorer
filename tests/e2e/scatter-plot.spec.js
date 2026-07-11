import { test, expect } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

test.describe('Scatter Plot built-artifact regression', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => {
      localStorage.setItem('hks-splash-shown', '1')
      localStorage.setItem('hks-tour-home', '1')
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
  })

  test('loads the lazy Plotly path, changes an axis, and zooms the chart', async ({ page }) => {
    // Plotly is deliberately a 4.7 MB lazy chunk. On a busy CI worker it can
    // take longer than Playwright's default five-second assertion window;
    // retain a finite budget while testing the real rendered chart.
    test.slow()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible()

    const chart = page.locator('.js-plotly-plot')
    await expect(chart).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            performance
              .getEntriesByType('resource')
              .some((entry) => entry.name.includes('vendor-plotly')),
          ),
        { timeout: 15_000 },
      )
      .toBe(true)

    const yAxis = page.getByLabel('Y-axis metric')
    await yAxis.selectOption('Instructor_Rating')
    await expect(yAxis).toHaveValue('Instructor_Rating')

    await page.getByText('+', { exact: true }).click()
    await expect(page.getByText('Zoomed in', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Reset zoom' }).click()
    await expect(page.getByText('Zoomed in', { exact: true })).toHaveCount(0)
  })
})
