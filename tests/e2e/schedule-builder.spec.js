import { test, expect } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

test.describe('Schedule Builder critical flows', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => localStorage.setItem('hks-splash-shown', '1'))
    await page.setViewportSize({ width: 1440, height: 1000 })
  })

  test('offers only synced catalogue terms and discloses complete HKS coverage', async ({
    page,
  }) => {
    await page.goto('/schedule-builder')

    const term = page.getByLabel('Catalogue term')
    await expect(term.locator('option')).toHaveText([
      'Spring 2026 (2 HKS)',
      'Fall 2026 (2 HKS)',
      'Spring 2027 (1 HKS)',
    ])
    await expect(term.locator('option[value="2027 Fall"]')).toHaveCount(0)
    await expect(page.getByText('5 current HKS offerings across 3 catalogue terms')).toBeVisible()
  })

  test('restores the complete live HKS baseline when every filter is reset', async ({ page }) => {
    await page.goto('/schedule-builder')
    const results = page.getByRole('list', { name: 'Course search results' })
    const session = page.getByLabel('Session filter')
    const concentration = page.getByLabel('Filter by concentration')
    const stem = page.getByLabel('Filter by STEM')
    const rating = page.getByLabel('Minimum instructor rating percentile')

    await expect(page.getByLabel('School filter')).toHaveValue('HKS')
    await expect(page.getByRole('button', { name: 'Live', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(session).toHaveValue('all')
    await expect(results).toContainText('2 live courses · 0 scheduled · 2 schedule pending')

    await session.selectOption('Fall 1')
    await stem.selectOption('stem')
    await rating.selectOption('75')
    await page.getByRole('button', { name: 'Mon', exact: true }).click()
    await page.getByRole('button', { name: '4 cr', exact: true }).click()
    await page.getByLabel('Start time from').fill('09:00')
    await page.getByRole('button', { name: 'Reset all filters' }).click()

    await expect(page.getByLabel('School filter')).toHaveValue('HKS')
    await expect(session).toHaveValue('all')
    await expect(concentration).toHaveValue('All')
    await expect(stem).toHaveValue('all')
    await expect(rating).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Mon', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: 'Any', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByLabel('Start time from')).toHaveValue('')
    await expect(results).toContainText('2 live courses · 0 scheduled · 2 schedule pending')
  })

  test('reveals and allows selection of every current offering, including schedule-pending rows', async ({
    page,
  }) => {
    const completeTerm = Array.from({ length: 30 }, (_, index) => {
      const sequence = String(index + 1).padStart(3, '0')
      return {
        id: `myh|HKS|2026-Fall|api7${sequence}|1|001`,
        course_code: `API-7${sequence}-001`,
        course_code_base: `API-7${sequence}`,
        title: `Complete catalogue course ${sequence}`,
        term: '2026 Fall',
        credits: 4,
        instructors: [`Instructor ${sequence}`],
        meeting_days: '',
        time_start: '',
        time_end: '',
        location: '',
        school: 'HKS',
        is_hks: true,
        session_code: 'FULLTERM',
        session_description: 'Full Term',
        cross_reg_eligible: 'YESXREG',
        source: 'myharvard',
        section_code: '001',
        source_url: `https://my.harvard.edu/course/API7${sequence}/2026-Fall/001`,
        active: true,
      }
    })
    await installMockBackend(page, { liveCoursesResponse: completeTerm })
    await page.goto('/schedule-builder')

    const results = page.getByRole('list', { name: 'Course search results' })
    await expect(results).toContainText('30 live courses · 0 scheduled · 30 schedule pending')
    await expect(results.getByRole('listitem')).toHaveCount(25)

    await results.getByRole('button', { name: 'Show more (5 remaining)' }).click()
    await expect(results.getByRole('listitem')).toHaveCount(30)
    const renderedOfferingIds = await results
      .getByRole('listitem')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-offering-id')))
    expect(renderedOfferingIds.sort()).toEqual(completeTerm.map((course) => course.id).sort())
    await expect(results.getByText('Schedule pending', { exact: true })).toHaveCount(30)

    const lastOffering = 'API-7030-001'
    await results.getByRole('button', { name: `Add ${lastOffering} to plan` }).click()
    await expect(
      results.getByRole('button', { name: `Remove ${lastOffering} from plan` }),
    ).toBeVisible()
  })

  test('never shows a false zero or shortlist fallback while a new term is loading', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('hks_favorites', '["API-101"]'))
    await installMockBackend(page, {
      liveCoursesResponseResolver: async (url, rows) => {
        if (url.searchParams.get('term') === 'eq.2027 Spring') {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        return { body: rows }
      },
    })
    await page.goto('/schedule-builder')
    const term = page.getByLabel('Catalogue term')
    await expect(term.locator('option')).toHaveCount(3)

    await term.selectOption('2027 Spring')

    await expect(page.getByText('Loading current catalogue…', { exact: true })).toBeVisible()
    await expect(page.getByText(/0 live courses match/)).toHaveCount(0)
    await expect(page.getByText('★ From your shortlist', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Course search results' })).toContainText(
      '1 live course · 0 scheduled · 1 schedule pending',
    )
  })

  test('fails closed when the HKS term inventory cannot be read', async ({ page }) => {
    await installMockBackend(page, {
      liveCoursesResponseResolver: async (url, rows) => {
        const select = url.searchParams.get('select') || ''
        const isTermInventory =
          select.includes('term') && select.includes('is_hks') && !select.includes('course_code')
        return isTermInventory ? { status: 503, body: { error: 'unavailable' } } : { body: rows }
      },
    })
    await page.goto('/schedule-builder')

    await expect(
      page.getByRole('alert').filter({
        hasText: 'Current HKS catalogue terms are temporarily unavailable.',
      }),
    ).toBeVisible({ timeout: 12_000 })
    const term = page.getByLabel('Catalogue term')
    await expect(term).toBeDisabled()
    await expect(term.locator('option')).toHaveText(['Catalogue terms unavailable'])
    await expect(page.getByText(/current HKS offerings across/)).toHaveCount(0)
    await expect(page.getByText(/0 live courses match/)).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Course search results' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Add .* to plan$/ })).toHaveCount(0)
  })

  test('keeps non-HKS-only catalogue terms visible and selectable', async ({ page }) => {
    await page.goto('/schedule-builder')
    await page.getByLabel('School filter').selectOption('Non-HKS')
    await page.getByLabel('Year').selectOption('2025')
    await page.getByLabel('Semester').selectOption('Fall')
    await expect(page.getByRole('list', { name: 'Course search results' })).toContainText('ECON-60')
  })

  test('filters the locally loaded catalogue by session', async ({ page }) => {
    await page.goto('/schedule-builder')

    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
    await page.getByLabel('Catalogue term').selectOption('2026 Spring')
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

    await page.getByLabel('Catalogue term').selectOption('2026 Spring')

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

    await page.getByLabel('Catalogue term').selectOption('2026 Spring')

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

    await page.getByLabel('Catalogue term').selectOption('2026 Spring')
    await expect.poll(() => requestedTerms).toContain('eq.2026 Spring')
  })

  test('clears an incompatible session and keeps every HKS offering visible', async ({ page }) => {
    await page.goto('/schedule-builder')
    const results = page.getByRole('list', { name: 'Course search results' })

    await page.getByLabel('Catalogue term').selectOption('2026 Spring')
    await page.getByLabel('Session filter').selectOption('Spring 1')
    await page.getByLabel('Catalogue term').selectOption('2026 Fall')

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

    await page.getByLabel('Catalogue term').selectOption('2027 Spring')
    await page.getByLabel('Session filter').selectOption('January')
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

    await expect(page.getByRole('alert')).toContainText(
      'No active HKS catalogue terms are available.',
    )
    await expect(page.getByText(/0 live courses match/)).toHaveCount(0)
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
