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

    const controls = page.locator('[aria-label="Graph controls"]')
    await expect(controls).toBeVisible()
    await expect(chart.locator('.modebar')).toHaveCount(0)
    const controlsBox = await controls.boundingBox()
    const chartBox = await chart.boundingBox()
    expect(controlsBox).not.toBeNull()
    expect(chartBox).not.toBeNull()
    expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(chartBox.y)

    const renderedRanges = () =>
      chart.evaluate((element) => ({
        x: [...element._fullLayout.xaxis.range],
        y: [...element._fullLayout.yaxis.range],
      }))

    // Repeatedly zoom and pan the rendered Plotly canvas before resetting.
    // Checking `_fullLayout` catches the failure where React requested 0-100
    // but Plotly continued showing a stale, cropped internal range.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole('button', { name: 'Zoom in' }).click()
      await expect(page.getByText('Zoomed in', { exact: true })).toBeVisible()
      const zoomedRanges = await renderedRanges()
      const zoomedSpan = {
        x: zoomedRanges.x[1] - zoomedRanges.x[0],
        y: zoomedRanges.y[1] - zoomedRanges.y[0],
      }

      const renderedBox = await chart.boundingBox()
      expect(renderedBox).not.toBeNull()
      const startX = renderedBox.x + renderedBox.width * 0.58
      const startY = renderedBox.y + renderedBox.height * 0.48
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(startX - renderedBox.width * 0.2, startY + renderedBox.height * 0.2)
      await page.mouse.up()
      await expect.poll(renderedRanges).not.toEqual(zoomedRanges)
      await expect
        .poll(async () => {
          const pannedRanges = await renderedRanges()
          const epsilon = 0.001
          return (
            Math.abs(pannedRanges.x[1] - pannedRanges.x[0] - zoomedSpan.x) < epsilon &&
            Math.abs(pannedRanges.y[1] - pannedRanges.y[0] - zoomedSpan.y) < epsilon &&
            pannedRanges.x[0] >= 0 &&
            pannedRanges.x[1] <= 100 &&
            pannedRanges.y[0] >= 0 &&
            pannedRanges.y[1] <= 100
          )
        })
        .toBe(true)

      await page.getByRole('button', { name: 'Reset axes' }).click()
      await expect(page.getByText('Zoomed in', { exact: true })).toHaveCount(0)
      await expect.poll(renderedRanges).toEqual({ x: [0, 100], y: [0, 100] })
    }
  })
})
