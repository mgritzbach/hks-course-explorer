import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDiscoveryCourses, mergeCurrentOfferings } from '../lib/courseDiscovery.js'
import { buildCourseMeta } from '../lib/courseMeta.js'
import { loadSnapshotRows } from '../lib/catalogueSnapshot.js'
import { fetchAllCoursesWithCache } from '../lib/courseDataCache.js'

vi.mock('../lib/catalogueSnapshot.js', () => ({
  usesCatalogueSnapshots: true,
  loadSnapshotRows: vi.fn(),
}))
vi.mock('../lib/courseDataCache.js', () => ({ fetchAllCoursesWithCache: vi.fn() }))

const offering = (year, extra = {}) => ({
  id: `source-${year}`,
  is_hks: true,
  active: true,
  term: `${year} Spring`,
  course_code: 'API-102-A',
  course_code_base: 'API-102',
  title: 'Public Policy',
  instructors: ['Current Professor'],
  ...extra,
})

describe('current course discovery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('automatically adds new years while keeping old evaluations in their own year', () => {
    const historical = {
      id: 'old',
      course_code_base: 'API-102',
      course_code: 'API-102-A',
      year: 2026,
      term: 'Spring',
      has_eval: true,
      metrics_raw: { Instructor_Rating: 4.8 },
    }
    for (const year of [2027, 2028, 2031]) {
      const rows = mergeCurrentOfferings([historical], [offering(year)])
      expect(rows).toHaveLength(2)
      expect(rows[0]).toBe(historical)
      expect(rows[1]).toMatchObject({
        year,
        professor_display: 'Current Professor',
        has_eval: true,
        metrics_raw: { Instructor_Rating: 4.8 },
        evaluation_source: { year: 2026 },
      })
      expect(buildCourseMeta(rows)).toMatchObject({
        default_year: year,
        years: [2026, year],
        evaluation_year: 2026,
      })
    }
  })

  it('includes January and sections, excludes inactive and non-HKS rows, and avoids exact duplicates', () => {
    const rows = mergeCurrentOfferings(
      [],
      [
        offering(2027),
        offering(2027),
        offering(2027, { course_code: 'API-102-B' }),
        offering(2027, { course_code: 'MLD-101', session_description: 'January' }),
        offering(2027, { is_hks: false }),
        offering(2027, { active: false }),
      ],
    )
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.term)).toEqual(['Spring', 'Spring', 'January'])
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
  })

  it('discovers every published HKS term instead of maintaining a year list', async () => {
    vi.mocked(fetchAllCoursesWithCache).mockResolvedValue([])
    vi.mocked(loadSnapshotRows).mockImplementation(async (name) =>
      name === 'terms' ? [offering(2027), offering(2031)] : [offering(Number(name.slice(5, 9)))],
    )
    const { courses } = await fetchDiscoveryCourses()
    expect(courses.map((c) => c.year)).toEqual([2027, 2031])
    expect(loadSnapshotRows).toHaveBeenCalledWith('live/2031 Spring')
  })

  it('reports unavailable current data instead of silently returning an incomplete catalogue', async () => {
    vi.mocked(fetchAllCoursesWithCache).mockResolvedValue([])
    vi.mocked(loadSnapshotRows).mockRejectedValue(new Error('unavailable'))
    await expect(fetchDiscoveryCourses()).resolves.toMatchObject({
      courses: [],
      currentCatalogueError: expect.stringContaining('historical courses only'),
    })
  })

  it('carries stable classifications alongside attributed historical data', () => {
    const history = [
      {
        course_code_base: 'API-102',
        year: 2026,
        is_core: true,
        is_stem: true,
        stem_group: 'A',
        stem_school: 'HKS',
        has_eval: true,
        has_bidding: true,
        metrics_raw: { Instructor_Rating: 5 },
        last_bid_price: 500,
      },
    ]
    const current = mergeCurrentOfferings(history, [offering(2027)]).at(-1)
    expect(current).toMatchObject({
      is_core: true,
      is_stem: true,
      stem_group: 'A',
      stem_school: 'HKS',
      has_eval: true,
      has_bidding: true,
      metrics_raw: { Instructor_Rating: 5 },
      evaluation_source: { year: 2026 },
      bidding_source: { year: 2026 },
    })
    expect(current.last_bid_price).toBe(500)
  })
})
