import { describe, expect, it } from 'vitest'
import { mergeCurrentOfferings } from '../lib/courseDiscovery.js'
import {
  buildCourseOptions,
  countActiveCourseFilters,
  filterCourseOptions,
} from '../lib/courseCatalogPresentation.js'

const defaults = {
  year: 'all',
  terms: ['Fall', 'Spring', 'January'],
  concentration: 'All',
  academicArea: 'All',
  coreFilter: 'all',
  stemGroup: 'all',
  minInstructorPct: 'any',
  evalOnly: false,
}
const courses = [
  {
    id: 'api-old',
    course_code_base: 'API-101',
    course_code: 'API-101',
    course_name: 'Policy Analysis',
    year: 2024,
    term: 'Fall',
    has_eval: true,
    last_bid_price: 20,
    metrics_pct: { Instructor_Rating: 78 },
  },
  {
    id: 'api-new',
    course_code_base: 'API-101',
    course_code: 'API-101',
    course_name: 'Policy Analysis',
    year: 2025,
    term: 'Spring',
    has_eval: true,
    last_bid_price: 40,
    metrics_pct: { Instructor_Rating: 82 },
  },
  {
    id: 'bgp',
    course_code_base: 'BGP-201',
    course_code: 'BGP-201',
    course_name: 'Economics',
    year: 2025,
    term: 'Fall',
    has_eval: false,
    last_bid_price: 60,
    stem_group: 'A',
    academic_area: 'Economics',
  },
]

describe('course catalogue presentation', () => {
  it('keeps only the latest offering for each catalogue option', () => {
    expect(buildCourseOptions(courses).map((course) => course.id)).toEqual(['bgp', 'api-new'])
  })

  it('selects the representative from the requested year and term', () => {
    const allOptions = buildCourseOptions(courses)
    expect(
      filterCourseOptions({
        allOptions,
        courses,
        filters: { ...defaults, year: 2024, terms: ['Fall'] },
        query: '',
      }),
    ).toEqual([expect.objectContaining({ id: 'api-old' })])
  })

  it('applies filters, bidding order, and text search without mutating options', () => {
    const allOptions = buildCourseOptions(courses)
    const result = filterCourseOptions({
      allOptions,
      courses,
      filters: { ...defaults, minInstructorPct: '80' },
      query: 'policy',
    })

    expect(result).toEqual([expect.objectContaining({ id: 'api-new' })])
    expect(allOptions.map((course) => course.id)).toEqual(['bgp', 'api-new'])
  })

  it('counts only visible non-default filters', () => {
    expect(countActiveCourseFilters(defaults)).toBe(0)
    expect(
      countActiveCourseFilters({ ...defaults, year: 2025, terms: ['Spring'], evalOnly: true }),
    ).toBe(3)
  })

  it('preserves historical evaluations and professor search after a future offering arrives', () => {
    const history = [
      {
        ...courses[0],
        professor_display: 'Historical Professor',
        is_core: true,
        is_stem: true,
        stem_group: 'A',
      },
    ]
    const combined = mergeCurrentOfferings(history, [
      {
        is_hks: true,
        term: '2027 Spring',
        course_code: 'API-101-A',
        course_code_base: 'API-101',
        title: 'Policy Analysis',
        instructors: ['Current Professor'],
      },
    ])
    const search = (filters, query) =>
      filterCourseOptions({ courses: combined, filters: { ...defaults, ...filters }, query })
    expect(search({ year: 2024, evalOnly: true }, 'Historical Professor')).toEqual(history)
    expect(search({ evalOnly: true }, 'Historical Professor')).toEqual(history)
    expect(
      search({ year: 2027, coreFilter: 'core', stemGroup: 'A' }, 'Current Professor'),
    ).toHaveLength(1)
    expect(search({ year: 2027, evalOnly: true }, '')).toEqual([
      expect.objectContaining({
        year: 2027,
        evaluation_source: expect.objectContaining({ year: 2024 }),
      }),
    ])
  })
})
