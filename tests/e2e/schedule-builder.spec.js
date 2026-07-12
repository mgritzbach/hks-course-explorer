import { test, expect } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

test.describe('Schedule Builder critical flows', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => localStorage.setItem('hks-splash-shown', '1'))
    await page.setViewportSize({ width: 1440, height: 1000 })
  })

  test('filters the locally loaded catalogue by session', async ({ page }) => {
    await page.goto('/schedule-builder')

    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
    await page.getByLabel('Year').selectOption('2026')
    await page.getByLabel('Semester').selectOption('Spring')
    const results = page.getByRole('list', { name: 'Course search results' })
    await expect(results).toContainText('API-101')
    await expect(results).toContainText('BGP-201')
    await expect(results).toContainText('2 live courses · 2 scheduled')

    await page.getByLabel('Session filter').selectOption('Spring 1')
    await expect(results).toContainText('1 live course · 1 scheduled')
    await expect(results).toContainText('API-101')
    await expect(results).not.toContainText('BGP-201')
  })

  test('browses non-HKS results and typed catalogue search without an error boundary', async ({
    page,
  }) => {
    await page.goto('/schedule-builder')
    const results = page.getByRole('list', { name: 'Course search results' })

    await page.getByLabel('Year').selectOption('2026')
    await page.getByLabel('Semester').selectOption('Spring')

    await page.getByLabel('School filter').selectOption('Non-HKS')
    await expect(results).toContainText('ECON-50')
    await expect(results).toContainText('1 live course · 1 scheduled')

    await page.getByLabel('School filter').selectOption('HKS')
    await page.getByLabel('Search courses and instructors').fill('policy')
    await expect(results).toContainText('API-101')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })

  test('searches the synced catalogue without calling the Harvard proxy', async ({ page }) => {
    await installMockBackend(page)
    let harvardRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/harvard-courses') harvardRequests += 1
    })
    await page.addInitScript(() => localStorage.setItem('hks-splash-shown', '1'))
    await page.goto('/schedule-builder')

    await page.getByLabel('Year').selectOption('2026')
    await page.getByLabel('Semester').selectOption('Spring')

    await page.getByLabel('Search courses and instructors').fill('policy')
    await expect(page.getByRole('list', { name: 'Course search results' })).toContainText('API-101')
    expect(harvardRequests).toBe(0)
  })

  test('reads only the selected synced term and refetches when the term changes', async ({
    page,
  }) => {
    const requestedTerms = []
    await installMockBackend(page, {
      onLiveCoursesRequest: (url) => requestedTerms.push(url.searchParams.get('term')),
    })
    await page.addInitScript(() => localStorage.setItem('hks-splash-shown', '1'))
    await page.goto('/schedule-builder')

    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
    await expect.poll(() => requestedTerms).toContain('eq.2026 Fall')

    await page.getByLabel('Semester').selectOption('Spring')
    await expect.poll(() => requestedTerms).toContain('eq.2026 Spring')
  })

  test('clears an incompatible session and keeps every HKS offering visible', async ({ page }) => {
    await page.goto('/schedule-builder')
    const results = page.getByRole('list', { name: 'Course search results' })

    await page.getByLabel('Year').selectOption('2026')
    await page.getByLabel('Semester').selectOption('Spring')
    await page.getByLabel('Session filter').selectOption('Spring 1')
    await page.getByLabel('Semester').selectOption('Fall')

    await expect(page.getByLabel('Session filter')).toHaveValue('all')
    await expect(results).toContainText('2 live courses')
    await expect(results).toContainText('2 schedule pending')
    await expect(results).toContainText('API-201-A')
    await expect(results).toContainText('DPI-100-A')
  })

  test('maps J-Term to January offerings inside the Spring source term', async ({ page }) => {
    const requestedTerms = []
    await installMockBackend(page, {
      onLiveCoursesRequest: (url) => requestedTerms.push(url.searchParams.get('term')),
    })
    await page.goto('/schedule-builder')
    const results = page.getByRole('list', { name: 'Course search results' })

    await page.getByLabel('Year').selectOption('2027')
    await page.getByLabel('Semester').selectOption('January')
    await expect.poll(() => requestedTerms).toContain('eq.2027 Spring')
    await expect(results).toContainText('IGA-299-A')
    await expect(results).toContainText('1 live course')

    await page.getByLabel('Search courses and instructors').fill('January Policy')
    await expect(results).toContainText('IGA-299-A')
    await expect(results).toContainText('1 live course')
  })

  test('does not claim schedule-pending courses match explicit day filters', async ({ page }) => {
    await page.goto('/schedule-builder')
    const results = page.getByRole('list', { name: 'Course search results' })
    await expect(results).toContainText('2 schedule pending')

    await page.getByRole('button', { name: 'Mon', exact: true }).click()
    await expect(page.getByText(/0 live courses match/)).toBeVisible()
  })

  test('does not substitute historical section stubs for an empty live HKS term', async ({
    page,
  }) => {
    await installMockBackend(page, { liveCoursesResponse: [] })
    await page.goto('/schedule-builder')

    await expect(page.getByText(/0 live courses match/)).toBeVisible()
    await expect(page.getByText(/Historical \/ no schedule/)).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Course search results' })).toHaveCount(0)
  })

  test('makes a failed synced-catalogue read visible for typed searches instead of showing empty results', async ({
    page,
  }) => {
    await installMockBackend(page, { liveCoursesStatus: 503 })
    await page.addInitScript(() => localStorage.setItem('hks-splash-shown', '1'))
    await page.goto('/schedule-builder')

    await page.getByLabel('School filter').selectOption('Non-HKS')
    await page.getByLabel('Search courses and instructors').fill('policy')
    await expect(page.getByRole('alert')).toContainText(
      'Current catalogue is temporarily unavailable.',
      {
        timeout: 10_000,
      },
    )
  })

  test('adds a missing cross-registration course through the manual form', async ({ page }) => {
    await page.goto('/schedule-builder')
    await page.getByLabel('School filter').selectOption('Non-HKS')
    await page.getByLabel('Search courses and instructors').fill('mit 15.783')
    await page.getByRole('button', { name: /Add MIT-15.783 with details/ }).click()

    const manualCourseDialog = page.getByRole('dialog', { name: 'Add a cross-registration course' })
    await expect(manualCourseDialog).toBeVisible()
    await manualCourseDialog
      .getByRole('textbox', { name: 'Title' })
      .fill('Machine Learning for Policy')
    await manualCourseDialog.getByRole('button', { name: 'MON', exact: true }).click()
    await manualCourseDialog.getByRole('button', { name: 'Add to schedule' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Added MIT-15.783 to plan', { exact: true })).toBeVisible()
  })
})
