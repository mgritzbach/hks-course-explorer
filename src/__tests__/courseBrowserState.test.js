import { describe, expect, it } from 'vitest'
import {
  ALL_COURSE_TERMS,
  courseFiltersFromSearchParams,
  withCourseFilterSearchParams,
  withCourseQuerySearchParams,
} from '../lib/courseBrowserState.js'

describe('course browser URL state', () => {
  it('initializes the existing default filters from a shareable URL', () => {
    expect(courseFiltersFromSearchParams(new URLSearchParams('y=2025&c=DPI'))).toEqual({
      year: 2025,
      terms: ['Fall', 'Spring', 'January'],
      concentration: 'DPI',
      academicArea: 'All',
      coreFilter: 'all',
      stemGroup: 'all',
      minInstructorPct: 'any',
      evalOnly: false,
    })
    expect(courseFiltersFromSearchParams(new URLSearchParams('y=all')).year).toBe('all')
    expect(ALL_COURSE_TERMS).toEqual(['Fall', 'Spring', 'January'])
  })

  it('updates URL filters without mutating unrelated parameters', () => {
    const current = new URLSearchParams('q=policy&id=API-101&y=2024&c=BGP')
    const next = withCourseFilterSearchParams(current, { year: 2025, concentration: 'DPI' })

    expect(next.toString()).toBe('q=policy&id=API-101&y=2025&c=DPI')
    expect(current.toString()).toBe('q=policy&id=API-101&y=2024&c=BGP')
  })

  it('removes default filters while preserving the query and selected course', () => {
    const next = withCourseFilterSearchParams(
      new URLSearchParams('id=API-101&y=2025&c=DPI&q=climate'),
      {
        year: 'all',
        concentration: 'All',
      },
    )

    expect(next.toString()).toBe('id=API-101&q=climate')
  })

  it('writes and clears only the text query', () => {
    const current = new URLSearchParams('id=API-101&y=2025')
    expect(withCourseQuerySearchParams(current, 'climate policy').toString()).toBe(
      'id=API-101&y=2025&q=climate+policy',
    )
    expect(
      withCourseQuerySearchParams(new URLSearchParams('id=API-101&q=old'), '').toString(),
    ).toBe('id=API-101')
  })
})
