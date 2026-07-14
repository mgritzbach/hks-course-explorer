import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import process from 'node:process'

const evidence = {
  code: process.env.ATS_ACTIVE_CODE,
  term: process.env.ATS_ACTIVE_TERM,
  school: process.env.ATS_ACTIVE_SCHOOL,
  termCount: Number(process.env.ATS_ACTIVE_TERM_COUNT),
  termDigest: process.env.ATS_ACTIVE_TERM_SHA256,
}

const hasEvidence =
  typeof evidence.code === 'string' &&
  typeof evidence.term === 'string' &&
  typeof evidence.school === 'string' &&
  Number.isInteger(evidence.termCount) &&
  evidence.termCount > 0 &&
  /^[0-9a-f]{64}$/.test(evidence.termDigest || '')

if (!hasEvidence) {
  throw new Error('Protected ATS browser evidence is missing or invalid.')
}

async function openCandidate(page, candidate, observedIds, catalogueReads) {
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.endsWith('/rest/v1/live_courses')) return
    const read = response
      .json()
      .then((rows) => {
        for (const row of Array.isArray(rows) ? rows : []) {
          if (
            row?.source === 'ats' &&
            row?.is_hks === false &&
            row?.active === true &&
            row?.term === candidate.term &&
            typeof row.id === 'string'
          ) {
            observedIds.add(row.id)
          }
        }
      })
      .catch(() => undefined)
    catalogueReads.push(read)
  })

  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hks-splash-shown', '1')
  })
  await page.goto('/schedule-builder', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Schedule Builder' })).toBeVisible()
  await page.getByLabel('Catalogue term').selectOption(candidate.term)
  await page.getByLabel('School filter').selectOption(candidate.school)
  await page.getByLabel('Search courses and instructors').fill(candidate.code)
  await expect(page.getByRole('list', { name: 'Course search results' })).toContainText(
    candidate.code,
    { timeout: 20_000 },
  )
  await Promise.all(catalogueReads)
  await expect.poll(() => observedIds.size, { timeout: 20_000 }).toBe(candidate.termCount)
  const digest = createHash('sha256')
    .update([...observedIds].sort().join('\n'))
    .digest('hex')
  expect(digest).toBe(candidate.termDigest)
}

test.describe('post-sync ATS catalogue close-out', () => {
  test('shows a current ATS course and exposes only its exact active term manifest', async ({
    page,
  }) => {
    test.slow()
    const observedIds = new Set()
    const catalogueReads = []
    await openCandidate(page, evidence, observedIds, catalogueReads)
    const addButton = page.getByRole('button', {
      name: new RegExp(`Add ${evidence.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to plan`, 'i'),
    })
    await expect(addButton).toBeEnabled()
    await addButton.click()
    await expect(
      page.getByText(
        new RegExp(`Added ${evidence.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to plan`, 'i'),
      ),
    ).toBeVisible()
  })
})
