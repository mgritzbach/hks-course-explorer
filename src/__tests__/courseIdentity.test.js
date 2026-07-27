import { describe, expect, it } from 'vitest'
import {
  dedupeCoursesByBase,
  getBaseCourseCode,
  getBaseCourseKey,
  getCourseSectionLetter,
  hasSameBaseCourse,
} from '../lib/courseIdentity.js'

describe('base course identity', () => {
  it('treats numeric and letter section suffixes as the same base course', () => {
    expect(getBaseCourseCode('DPI-681-M-001')).toBe('DPI-681-M')
    expect(getBaseCourseCode('DPI 101 M A')).toBe('DPI-101-M')
    expect(getBaseCourseCode('API-203M-B')).toBe('API-203M')
    expect(getBaseCourseCode('DPI-101-MA')).toBe('DPI-101-M')
    expect(getBaseCourseKey('DPI-681-M-001')).toBe('DPI681M')
    expect(hasSameBaseCourse('DPI-681-M', 'DPI-681-M-001')).toBe(true)
    expect(getCourseSectionLetter('API-203M-B')).toBe('B')
  })

  it('prefers an explicit catalogue base code and preserves real course variants', () => {
    expect(
      getBaseCourseCode({
        course_code: 'DPI-681-M-001',
        course_code_base: 'DPI-681-M',
      }),
    ).toBe('DPI-681-M')
    expect(
      getBaseCourseCode({
        course_code: 'DPI-386-MC',
        course_code_base: 'DPI-386-MC',
      }),
    ).toBe('DPI-386-MC')
    expect(hasSameBaseCourse({ course_code_base: 'DPI-386-MC' }, 'DPI-386-M')).toBe(false)
    expect(getBaseCourseCode('API-101A')).toBe('API-101A')
    expect(getBaseCourseCode('MLD-201-A')).toBe('MLD-201-A')
  })

  it('keeps only one record for every base course', () => {
    const courses = [
      { courseCode: 'DPI-681-M', credits: 2 },
      { courseCode: 'DPI-681-M-001', credits: 2 },
      { courseCode: 'DPI-681-M-A', credits: 2 },
    ]

    expect(dedupeCoursesByBase(courses)).toEqual([courses[0]])
    expect(dedupeCoursesByBase(courses, { keep: 'last' })).toEqual([courses[2]])
  })

  it('preserves a graded completed record when repairing legacy duplicates', () => {
    const ungraded = {
      courseCode: 'DPI-681-M',
      credits: 2,
      meetings: [{ day: 'MON' }, { day: 'WED' }],
    }
    const graded = { courseCode: 'DPI-681-M-001', credits: 2, grade: 'B-' }

    expect(dedupeCoursesByBase([ungraded, graded])).toEqual([graded])
    expect(dedupeCoursesByBase([graded, ungraded])).toEqual([graded])
  })
})
