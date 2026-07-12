import { expect, test } from '@playwright/test'

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
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hks-splash-shown', '1')
    localStorage.setItem('hks-tour-home', '1')
    localStorage.setItem('hks-tour-courses', '1')
    localStorage.setItem('hks-tour-course-detail', '1')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
}

test.describe('read-only production acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await prepareReadOnlyBrowser(page)
  })

  test('renders every visitor route without a client runtime error', async ({ page }) => {
    test.slow()
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

  test('proves every advertised HKS catalogue row is selectable', async ({ page }) => {
    test.slow()
    const runtimeErrors = captureRuntimeErrors(page)
    const requestAudit = await protectProductionFromWrites(page)
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
    }

    expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([])
    expectNoProductionWrites(requestAudit)
  })

  test('resets the rendered comparison graph after zooming and panning', async ({ page }) => {
    test.slow()
    const runtimeErrors = captureRuntimeErrors(page)
    const requestAudit = await protectProductionFromWrites(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Course Comparisons' })).toBeVisible()

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
})
