import { test, expect } from '@playwright/test'
import { ALL_TUTORIAL_STORAGE_KEYS } from '../../src/lib/tutorialPreferences.js'
import { installMockBackend } from './support/mockBackend.js'

test('plots future courses with explicitly attributed historical scores and bidding', async ({
  page,
}) => {
  await installMockBackend(page, {
    liveCoursesResponse: [
      {
        id: 'future',
        active: true,
        is_hks: true,
        school: 'HKS',
        term: '2027 Spring',
        course_code: 'API-101-A',
        course_code_base: 'API-101',
        title: 'Policy Analysis Foundations',
        instructors: ['New Professor'],
        session_description: 'Full Term',
      },
    ],
  })
  await page.addInitScript((keys) => {
    localStorage.setItem('hks-splash-shown', '1')
    for (const key of keys) localStorage.setItem(key, '1')
  }, ALL_TUTORIAL_STORAGE_KEYS)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByLabel('Academic year').last()).toHaveValue('2027')
  const plot = page.locator('.js-plotly-plot')
  await expect(plot).toBeVisible({ timeout: 15000 })
  const point = await plot.evaluate((element) => {
    const trace = element.data.find((item) => item.customdata?.some((row) => row.year === 2027))
    const row = trace.customdata[0]
    element.emit('plotly_click', { points: [{ customdata: row }] })
    return { row, symbol: trace.marker.symbol[0] }
  })
  expect(point.symbol).toBe('circle-open')
  expect(point.row).toMatchObject({
    year: 2027,
    professor_display: 'New Professor',
    metrics_raw: { Instructor_Rating: 4.1 },
    evaluation_source: { year: 2025, professor: 'Avery Analyst' },
    bidding_source: { year: 2025 },
    last_bid_price: 650,
  })
  const panel = page.locator('[data-tour="scatter-plot"]')
  await expect(panel.getByText('Historical evaluations: Spring 2025.')).toBeVisible()
  await expect(panel.getByText('Historical bidding: Spring 2025.')).toBeVisible()
  await expect(panel.getByText(/Evaluated instructor: Avery Analyst/)).toBeVisible()
  await panel.getByRole('button', { name: 'Course Details', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Past Performance' })).toBeVisible()
  await expect(page.getByText('Historical evaluations: Spring 2025.')).toBeVisible()
  await page.getByRole('tab', { name: 'Past Performance' }).click()
  await expect(page.getByText('Historical evaluations: Spring 2025.')).toHaveCount(0)
})
