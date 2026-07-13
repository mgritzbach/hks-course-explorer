import { test, expect } from '@playwright/test'
import config from '../../src/school.config.js'
import { installMockBackend } from './support/mockBackend.js'

test.describe('course advisor lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await installMockBackend(page)
    await page.addInitScript(() => {
      localStorage.setItem('hks-splash-shown', '1')
      localStorage.setItem('hks-tour-home', '1')
    })
  })

  test('welcomes once and restores trigger focus after either keyboard or button close', async ({
    page,
  }) => {
    await page.goto('/')
    const toggle = page.getByRole('button', { name: 'Open course advisor' })
    await toggle.click()

    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(config.chatWelcome, { exact: true })).toHaveCount(1)
    await expect(dialog.getByPlaceholder(/light workload/i)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toBeFocused()

    await toggle.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(config.chatWelcome, { exact: true })).toHaveCount(1)
    await expect(dialog.getByPlaceholder(/light workload/i)).toBeFocused()

    await dialog.getByRole('button', { name: 'Close Course Advisor', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toBeFocused()

    await toggle.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(config.chatWelcome, { exact: true })).toHaveCount(1)
  })

  test('serializes a real course question and labels a verified free-model response', async ({
    page,
  }) => {
    await page.route('**/api/chat', async (route) => {
      const payload = route.request().postDataJSON()
      expect(payload.message).toBe('Suggest a light workload course')
      expect(payload.courses.length).toBeGreaterThan(0)
      expect(
        payload.courses.every(
          (course) => course.is_core === undefined || typeof course.is_core === 'boolean',
        ),
      ).toBe(true)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'API-101 is a grounded recommendation from the course database.',
          source: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          cost: 0,
        }),
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Open course advisor' }).click()
    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    await dialog.getByPlaceholder(/light workload/i).fill('Suggest a light workload course')
    await dialog.getByRole('button', { name: 'Send message' }).click()

    await expect(dialog.getByText(/API-101 is a grounded recommendation/)).toBeVisible()
    await expect(
      dialog.getByText('Free AI response · openai/gpt-oss-20b:free · verified cost $0.00'),
    ).toBeVisible()
    await expect(dialog.getByText(/Error:/)).toHaveCount(0)
  })

  test('uses history only for a genuine follow-up and resets it for a new question', async ({
    page,
  }) => {
    const advisorFixture = [
      ['DPI-852-M', 'Advanced Data and Information Visualization', 'Hong Qu'],
      ['MLD-223', 'Organizing for Good', 'Kessely Hong'],
      ['API-202', 'Empirical Methods II', 'Joshua Goodman'],
      ['DPI-802-M-D-2', 'The Arts of Communication', 'Allison Shapira'],
      ['MLD-215-B', 'Negotiation and Leadership', 'Robert Wilkinson'],
      ['ENV-250', 'Climate Adaptation Policy', 'Ada Climate'],
      ['SUP-442', 'Housing Policy', 'Richard Light'],
      ['API-206', 'How Do You Know It Works?', 'Jane Evidence'],
      ['API-309', 'Networks, Complexity and Their Applications', 'John Networks'],
    ].map(([course_code, course_name, professor_display]) => ({
      id: `${course_code}-${professor_display}`,
      course_code,
      course_code_base: course_code,
      course_name,
      professor_display,
      year: 2026,
      term: 'Spring',
      has_eval: true,
      is_average: false,
      metrics_pct: { Instructor_Rating: 80, Course_Rating: 75, Workload: 40 },
    }))

    await page.unroute('**/rest/v1/**')
    let historicalPageServed = false
    await page.route('**/rest/v1/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      const body = pathname.endsWith('/courses') && !historicalPageServed ? advisorFixture : []
      if (pathname.endsWith('/courses')) historicalPageServed = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      })
    })

    let requestNumber = 0
    await page.route('**/api/chat', async (route) => {
      requestNumber += 1
      const payload = route.request().postDataJSON()
      expect(payload.courses.length).toBeGreaterThan(0)
      const contextInstructors = [...new Set(payload.courses.map((course) => course.instructor))]

      if (requestNumber === 1) {
        expect(payload.message).toBe('What are Hong Qu’s courses?')
        expect(payload.history).toEqual([])
      } else if (requestNumber === 2) {
        expect(payload.message).toBe('Is Hong a good professor?')
        expect(payload.history).toEqual(
          expect.arrayContaining([
            { role: 'user', content: 'What are Hong Qu’s courses?' },
            { role: 'assistant', content: 'Hong Qu teaches the listed DPI courses.' },
          ]),
        )
      } else if (requestNumber === 3) {
        expect(payload.message).toBe('How is their workload?')
        expect(payload.history).toEqual([
          { role: 'user', content: 'Is Hong a good professor?' },
          {
            role: 'assistant',
            content: 'The database records for Hong Qu show strong instructor ratings.',
          },
        ])
      } else if (requestNumber === 4) {
        expect(payload.message).toBe('Is it a good course?')
        expect(payload.history).toEqual([
          { role: 'user', content: 'How is their workload?' },
          {
            role: 'assistant',
            content: 'Hong Qu’s course history contains the available workload data.',
          },
        ])
      } else {
        expect(payload.message).toBe('Which climate courses have light workloads?')
        expect(payload.history).toEqual([])
        expect(contextInstructors).toEqual(['Ada Climate'])
        expect(payload.courses.every((course) => /climate/i.test(course.name))).toBe(true)
        expect(payload.courses.some((course) => course.instructor === 'Richard Light')).toBe(false)
      }

      if (requestNumber <= 4) {
        expect(
          payload.courses.every((course) => course.instructor === 'Hong Qu'),
          `Unexpected advisor context for request ${requestNumber} (${payload.message}), history ${JSON.stringify(payload.history)}: ${JSON.stringify(contextInstructors)}`,
        ).toBe(true)
        expect(payload.courses.some((course) => course.instructor === 'Allison Shapira')).toBe(
          false,
        )
        expect(payload.courses.some((course) => course.instructor === 'Robert Wilkinson')).toBe(
          false,
        )
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply:
            requestNumber === 1
              ? 'Hong Qu teaches the listed DPI courses.'
              : requestNumber === 2
                ? 'The database records for Hong Qu show strong instructor ratings.'
                : requestNumber === 3
                  ? 'Hong Qu’s course history contains the available workload data.'
                  : requestNumber === 4
                    ? 'The grounded Hong Qu course records contain the available ratings.'
                    : 'ENV-250 is a climate course with workload data.',
          source: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          cost: 0,
        }),
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Open course advisor' }).click()
    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    const input = dialog.getByPlaceholder(/light workload/i)
    const send = dialog.getByRole('button', { name: 'Send message' })

    await input.fill('What are Hong Qu’s courses?')
    await send.click()
    await expect(dialog.getByText('Hong Qu teaches the listed DPI courses.')).toBeVisible()

    await input.fill('Is Hong a good professor?')
    await send.click()
    await expect(
      dialog.getByText('The database records for Hong Qu show strong instructor ratings.'),
    ).toBeVisible()

    await input.fill('How is their workload?')
    await send.click()
    await expect(
      dialog.getByText('Hong Qu’s course history contains the available workload data.'),
    ).toBeVisible()

    await input.fill('Is it a good course?')
    await send.click()
    await expect(
      dialog.getByText('The grounded Hong Qu course records contain the available ratings.'),
    ).toBeVisible()

    await input.fill('Which climate courses have light workloads?')
    await send.click()
    await expect(dialog.getByText('ENV-250 is a climate course with workload data.')).toBeVisible()
    expect(requestNumber).toBe(5)
  })

  test('shows provider failure explicitly and never substitutes a canned answer', async ({
    page,
  }) => {
    await page.route('**/api/chat', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Please wait 3 seconds before sending another AI request.',
          code: 'AI_RATE_LIMITED',
        }),
      }),
    )

    await page.goto('/')
    await page.getByRole('button', { name: 'Open course advisor' }).click()
    const dialog = page.getByRole('dialog', { name: 'Course Advisor' })
    await dialog.getByPlaceholder(/light workload/i).fill('What are Hong Qu’s courses?')
    await dialog.getByRole('button', { name: 'Send message' }).click()

    await expect(dialog.getByText(/Please wait 3 seconds/)).toBeVisible()
    await expect(dialog.getByText('No AI answer was accepted')).toBeVisible()
    await expect(dialog.getByText(/Based on the available course data/)).toHaveCount(0)
  })
})
