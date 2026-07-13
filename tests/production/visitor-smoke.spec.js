import { expect, test } from '@playwright/test'
import { MOBILE_MORE_NAV_ITEMS, MOBILE_PRIMARY_NAV_ITEMS } from '../../src/lib/visitorNavigation.js'
import { ALL_TUTORIAL_STORAGE_KEYS } from '../../src/lib/tutorialPreferences.js'

const minimumHksOfferings = Number(process.env.DEPLOY_MIN_HKS_OFFERINGS)

if (!Number.isInteger(minimumHksOfferings) || minimumHksOfferings < 1) {
  throw new Error('DEPLOY_MIN_HKS_OFFERINGS must be a positive integer.')
}

const VISITOR_ROUTES = [
  ['/', 'HKS Course Search'],
  ['/courses', 'Course Explorer'],
  ['/faculty', 'Faculty Explorer'],
  ['/compare', 'Compare Courses'],
  ['/resources', 'HKS Resources'],
  ['/schedule-builder', 'Schedule Builder'],
  ['/requirements', 'Requirements Tracker'],
  ['/not-a-real-route', 'Page not found'],
]

function captureRuntimeErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // The request guard deliberately aborts observability traffic before it
    // can consume quota. Chromium reports those audited aborts as resource
    // errors; unexpected writes are still recorded and fail separately.
    if (message.text().includes('net::ERR_BLOCKED_BY_CLIENT')) return
    errors.push(`console: ${message.text()}`)
  })
  return errors
}

function isObservabilityRequest(url) {
  const target = new URL(url)
  const hostname = target.hostname.toLowerCase()
  return (
    hostname === 'us.i.posthog.com' ||
    hostname.endsWith('.sentry.io') ||
    target.pathname === '/cdn-cgi/rum'
  )
}

async function protectProductionFromWrites(page) {
  const audit = { blockedObservability: [], unexpectedWrites: [] }
  await page.route('**/*', async (route) => {
    const request = route.request()
    const entry = `${request.method()} ${request.url()}`
    if (isObservabilityRequest(request.url())) {
      audit.blockedObservability.push(entry)
      await route.abort('blockedbyclient')
      return
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      audit.unexpectedWrites.push(entry)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  return audit
}

function expectNoProductionWrites(audit) {
  expect(audit.unexpectedWrites, audit.unexpectedWrites.join('\n')).toEqual([])
}

function normaliseProviderReply(reply) {
  return reply
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\u00A0\u202F]/g, ' ')
}

async function exerciseLocalPlanControl(results, control) {
  const addName = await control.getAttribute('aria-label')
  const courseCode = addName?.match(/^Add (.+) to plan$/)?.[1]
  expect(courseCode).toBeTruthy()
  await control.click()
  const removeControl = results.getByRole('button', {
    name: `Remove ${courseCode} from plan`,
    exact: true,
  })
  await expect(removeControl).toBeVisible()
  await removeControl.click()
  await expect(control).toBeVisible()
}

async function prepareReadOnlyBrowser(page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
}

async function skipOnboarding(page) {
  await page.addInitScript((tutorialKeys) => {
    localStorage.clear()
    localStorage.setItem('hks-splash-shown', '1')
    for (const key of tutorialKeys) localStorage.setItem(key, '1')
  }, ALL_TUTORIAL_STORAGE_KEYS)
}

test.describe('read-only production acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await prepareReadOnlyBrowser(page)
  })

  test('renders every visitor route without a client runtime error', async ({ page }) => {
    test.slow()
    await skipOnboarding(page)
    const runtimeErrors = captureRuntimeErrors(page)
    const requestAudit = await protectProductionFromWrites(page)
    let chatRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/chat') chatRequests += 1
    })

    for (const [route, marker] of VISITOR_ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      const main = page.getByRole('main')
      await expect(main).toHaveCount(1)
      await expect(main).toContainText(marker, { timeout: 20_000 })
      await expect(page.locator('h1:visible')).toHaveCount(1)
    }

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const advisorToggle = page.getByRole('button', { name: 'Open course advisor' })
    await advisorToggle.click()
    const advisor = page.getByRole('dialog', { name: 'Course Advisor' })
    await expect(advisor).toBeVisible()
    await expect(advisor.getByPlaceholder(/light workload/i)).toBeFocused()
    await advisor.getByRole('button', { name: 'Close Course Advisor', exact: true }).click()
    await expect(advisor).toHaveCount(0)
    expect(chatRequests).toBe(0)

    expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([])
    expectNoProductionWrites(requestAudit)
  })

  test('returns a verified zero-cost OpenRouter answer grounded in course data', async ({
    request,
  }) => {
    const response = await request.post('/api/chat', {
      data: {
        message: 'What are Hong Qu’s courses?',
        history: [],
        courses: [
          {
            code: 'DPI-851-M',
            base_code: 'DPI-851-M',
            name: 'Data and Information Visualization',
            instructor: 'Hong Qu',
            year: 2025,
            term: 'Fall',
          },
          {
            code: 'DPI-852-M',
            base_code: 'DPI-852-M',
            name: 'Advanced Data and Information Visualization',
            instructor: 'Hong Qu',
            year: 2025,
            term: 'Spring',
          },
          {
            code: 'DPI-853-M',
            base_code: 'DPI-853-M',
            name: 'Data Visualization: Storytelling Strategies',
            instructor: 'Hong Qu',
            year: 2026,
            term: 'Spring',
          },
        ],
        context: { shortlisted: [] },
      },
    })

    const responseBody = await response.text()
    expect(
      response.status(),
      `Course Advisor acceptance returned HTTP ${response.status()}: ${responseBody}`,
    ).toBe(200)

    let body
    try {
      body = JSON.parse(responseBody)
    } catch {
      throw new Error(`Course Advisor acceptance returned malformed JSON: ${responseBody}`)
    }
    expect(body).toMatchObject({
      source: 'openrouter',
      cost: 0,
      model: expect.stringMatching(/:free$/),
      reply: expect.any(String),
    })
    expect(body.reply.trim().length).toBeGreaterThan(0)
    const groundedReply = normaliseProviderReply(body.reply)
    expect(groundedReply).toMatch(/DPI-851-M/i)
    expect(groundedReply).toMatch(/DPI-852-M/i)
    expect(groundedReply).toMatch(/DPI-853-M/i)
    expect(groundedReply).not.toMatch(/Robert Wilkinson|MLD-215-B/i)
  })

  test('proves every advertised HKS catalogue row is selectable', async ({ page }) => {
    test.slow()
    await skipOnboarding(page)
    const runtimeErrors = captureRuntimeErrors(page)
    const requestAudit = await protectProductionFromWrites(page)
    const authoritativeIdsByTerm = new Map()
    const authoritativeIdsByTermSession = new Map()
    const catalogueResponseReads = []
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (!url.pathname.endsWith('/rest/v1/live_courses')) return
      const read = response
        .json()
        .then((rows) => {
          for (const row of Array.isArray(rows) ? rows : []) {
            if (
              row?.is_hks !== true ||
              typeof row.id !== 'string' ||
              typeof row.term !== 'string'
            ) {
              continue
            }
            if (!authoritativeIdsByTerm.has(row.term)) {
              authoritativeIdsByTerm.set(row.term, new Set())
            }
            authoritativeIdsByTerm.get(row.term).add(row.id)
            if (typeof row.session_description === 'string' && row.session_description) {
              const sessionKey = JSON.stringify([row.term, row.session_description])
              if (!authoritativeIdsByTermSession.has(sessionKey)) {
                authoritativeIdsByTermSession.set(sessionKey, new Set())
              }
              authoritativeIdsByTermSession.get(sessionKey).add(row.id)
            }
          }
        })
        .catch(() => undefined)
      catalogueResponseReads.push(read)
    })
    await page.goto('/schedule-builder', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()

    const termSelect = page.getByLabel('Catalogue term')
    const readTermOptions = () =>
      termSelect.locator('option').evaluateAll((options) =>
        options.map((option) => ({
          value: option.value,
          label: option.textContent?.trim() || '',
        })),
      )
    await expect
      .poll(
        async () => {
          const options = await readTermOptions()
          return (
            options.length >= 2 &&
            options.every((option) => /^(.+) \(([1-9]\d*) HKS\)$/.test(option.label))
          )
        },
        { timeout: 20_000 },
      )
      .toBe(true)
    const terms = await readTermOptions()

    await expect(page.getByLabel('School filter')).toHaveValue('HKS')
    await expect(page.getByRole('button', { name: 'Live', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const sessionFilter = page.getByLabel('Session filter')
    await expect(sessionFilter).toHaveValue('all')
    await expect(page.getByLabel('Filter by concentration')).toHaveValue('All')
    await expect(page.getByLabel('Filter by STEM')).toHaveValue('all')
    await expect(page.getByLabel('Minimum instructor rating percentile')).toHaveValue('')
    await sessionFilter.selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Reset all filters' }).click()
    await expect(sessionFilter).toHaveValue('all')

    const parsedTerms = terms.map(({ value, label }) => {
      const match = label.match(/^(.+) \((\d+) HKS\)$/)
      expect(match, `Unparseable catalogue option: ${label}`).not.toBeNull()
      return { value, label, count: Number(match[2]) }
    })
    expect(parsedTerms.length).toBeGreaterThanOrEqual(2)
    expect(parsedTerms.every((term) => term.count > 0)).toBe(true)

    const expectedTotal = parsedTerms.reduce((total, term) => total + term.count, 0)
    expect(expectedTotal).toBeGreaterThanOrEqual(minimumHksOfferings)
    await expect(
      page.getByText(
        `${expectedTotal} current HKS offerings across ${parsedTerms.length} catalogue terms`,
      ),
    ).toBeVisible()

    for (const term of parsedTerms) {
      await termSelect.selectOption(term.value)
      const results = page.getByRole('list', { name: 'Course search results' })
      await expect(results).toContainText(`${term.count} live courses`, { timeout: 20_000 })

      for (;;) {
        const showMore = results.getByRole('button', { name: /^Show more/ })
        if ((await showMore.count()) === 0) break
        await showMore.click()
      }

      await expect(results.getByRole('listitem')).toHaveCount(term.count)
      await Promise.all(catalogueResponseReads)
      await expect
        .poll(() => authoritativeIdsByTerm.get(term.value)?.size || 0, { timeout: 20_000 })
        .toBe(term.count)
      const renderedOfferingIds = await results
        .getByRole('listitem')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-offering-id')))
      expect(renderedOfferingIds.every(Boolean)).toBe(true)
      expect(new Set(renderedOfferingIds).size).toBe(term.count)
      expect([...renderedOfferingIds].sort()).toEqual(
        [...authoritativeIdsByTerm.get(term.value)].sort(),
      )
      const addControls = results.getByRole('button', { name: /^Add .* to plan$/ })
      await expect(addControls).toHaveCount(term.count)
      const controlState = await addControls.evaluateAll((controls) =>
        controls.map((control) => ({
          disabled: control.disabled,
          name: control.getAttribute('aria-label'),
        })),
      )
      expect(controlState.every((control) => !control.disabled)).toBe(true)
      expect(controlState.every((control) => /^Add .+ to plan$/.test(control.name || ''))).toBe(
        true,
      )
      expect(new Set(controlState.map((control) => control.name)).size).toBe(term.count)

      await exerciseLocalPlanControl(results, addControls.first())
      if (term.count > 1) await exerciseLocalPlanControl(results, addControls.last())

      const advertisedSessionOptions = await sessionFilter
        .locator('option')
        .evaluateAll((options) =>
          options.map((option) => option.value).filter((value) => value && value !== 'all'),
        )
      const dataSessions = [...authoritativeIdsByTermSession.keys()]
        .map((key) => JSON.parse(key))
        .filter(([catalogueTerm]) => catalogueTerm === term.value)
        .map(([, session]) => session)
        .sort()
      expect(dataSessions.length).toBeGreaterThan(0)
      expect(advertisedSessionOptions).toEqual(expect.arrayContaining(dataSessions))
      const sessionUnion = new Set()
      for (const session of dataSessions) {
        const sessionKey = JSON.stringify([term.value, session])
        const expectedSessionIds = authoritativeIdsByTermSession.get(sessionKey)
        for (const offeringId of expectedSessionIds) {
          expect(sessionUnion.has(offeringId), `${offeringId} belongs to multiple sessions`).toBe(
            false,
          )
          sessionUnion.add(offeringId)
        }

        await sessionFilter.selectOption(session)
        await expect(results).toContainText(
          `${expectedSessionIds.size} live course${expectedSessionIds.size === 1 ? '' : 's'}`,
          { timeout: 20_000 },
        )
        for (;;) {
          const showMore = results.getByRole('button', { name: /^Show more/ })
          if ((await showMore.count()) === 0) break
          await showMore.click()
        }
        const renderedSessionIds = await results
          .getByRole('listitem')
          .evaluateAll((items) => items.map((item) => item.getAttribute('data-offering-id')))
        expect([...renderedSessionIds].sort()).toEqual([...expectedSessionIds].sort())
      }
      expect([...sessionUnion].sort()).toEqual([...authoritativeIdsByTerm.get(term.value)].sort())
      await sessionFilter.selectOption('all')
    }

    expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([])
    expectNoProductionWrites(requestAudit)
  })

  test('resets the rendered comparison graph after zooming and panning', async ({ page }) => {
    test.slow()
    await skipOnboarding(page)
    const runtimeErrors = captureRuntimeErrors(page)
    const requestAudit = await protectProductionFromWrites(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible({
      timeout: 20_000,
    })

    const chart = page.locator('.js-plotly-plot')
    await expect(chart).toBeVisible({ timeout: 30_000 })
    const renderedRanges = () =>
      chart.evaluate((element) => ({
        x: [...element._fullLayout.xaxis.range],
        y: [...element._fullLayout.yaxis.range],
      }))

    await expect.poll(renderedRanges).toEqual({ x: [0, 100], y: [0, 100] })
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(renderedRanges).not.toEqual({ x: [0, 100], y: [0, 100] })

    const box = await chart.boundingBox()
    expect(box).not.toBeNull()
    const startX = box.x + box.width * 0.58
    const startY = box.y + box.height * 0.48
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - box.width * 0.15, startY + box.height * 0.15)
    await page.mouse.up()

    await page.getByRole('button', { name: 'Reset axes' }).click()
    await expect.poll(renderedRanges).toEqual({ x: [0, 100], y: [0, 100] })

    const pointOffset = await chart.evaluate((element) => {
      for (const trace of element._fullData || []) {
        const index = (trace.customdata || []).findIndex((datum) => datum?.id)
        if (index < 0 || !Number.isFinite(trace.x?.[index]) || !Number.isFinite(trace.y?.[index])) {
          continue
        }
        return {
          x: element._fullLayout._size.l + element._fullLayout.xaxis.l2p(trace.x[index]),
          y: element._fullLayout._size.t + element._fullLayout.yaxis.l2p(trace.y[index]),
        }
      }
      return null
    })
    expect(pointOffset).not.toBeNull()
    const resetBox = await chart.boundingBox()
    expect(resetBox).not.toBeNull()
    await page.mouse.click(resetBox.x + pointOffset.x, resetBox.y + pointOffset.y)
    const pinnedControls = page.getByRole('button', { name: 'Close course panel' }).locator('..')
    const addToShortlist = pinnedControls.getByRole('button', { name: 'Add to shortlist' })
    await expect(addToShortlist).toBeVisible()
    await addToShortlist.click()
    const removeFromShortlist = pinnedControls.getByRole('button', {
      name: 'Remove from shortlist',
    })
    await expect(removeFromShortlist).toBeVisible()
    await removeFromShortlist.click()
    await expect(addToShortlist).toBeVisible()
    expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([])
    expectNoProductionWrites(requestAudit)
  })

  test('keeps first-visit and primary navigation flows usable on mobile', async ({ page }) => {
    test.slow()
    await page.setViewportSize({ width: 390, height: 844 })
    const runtimeErrors = captureRuntimeErrors(page)
    const requestAudit = await protectProductionFromWrites(page)

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const landing = page.getByRole('dialog', { name: 'Welcome to the HKS Course Explorer' })
    const direct = landing.getByRole('button', {
      name: 'Continue directly and skip all tutorial boxes',
    })
    const tutorial = landing.getByRole('button', { name: 'Continue with the guided tutorial' })
    await expect(landing).toBeVisible()
    for (const action of [tutorial, direct]) {
      const bounds = await action.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
    }

    await direct.click()
    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('dialog', { name: 'Start with the Year' })).toHaveCount(0)

    const navigation = page.getByRole('navigation', { name: 'Mobile navigation' })
    for (const item of MOBILE_PRIMARY_NAV_ITEMS) {
      await expect(navigation.getByRole('link', { name: item.label, exact: true })).toBeVisible()
    }

    await navigation.getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page).toHaveURL(/\/courses$/)
    await expect(page.getByRole('heading', { name: 'Course Explorer' })).toBeVisible()
    await expect(page.locator('#main-content')).toBeFocused()

    const moreButton = navigation.getByRole('button', { name: 'More', exact: true })
    await moreButton.click()
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
    await expect(page.getByRole('heading', { name: 'HKS Resources' })).toBeVisible()
    await expect(page.locator('#mobile-more-navigation')).toHaveCount(0)

    await navigation.getByRole('link', { name: 'Schedule Builder', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule-builder$/)
    await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()

    await navigation.getByRole('link', { name: 'My Degree', exact: true }).click()
    await expect(page).toHaveURL(/\/requirements(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'Requirements Tracker' })).toBeVisible()

    await page.evaluate(() => localStorage.clear())
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Continue with the guided tutorial' }).click()
    await expect(page.getByRole('dialog', { name: 'Start with the Year' })).toBeVisible({
      timeout: 20_000,
    })

    expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([])
    expectNoProductionWrites(requestAudit)
  })
})
