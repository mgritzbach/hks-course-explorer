import { describe, expect, it } from 'vitest'
import {
  addCompletedCourse,
  addCourseToPlan,
  removeCompletedCourse,
  removeCompletedCoursesFromPlan,
  removeCourseFromPlan,
  updateCompletedCourse,
} from '../lib/schedulePlanMutations.js'

const course = {
  courseCode: 'DPI-802-M-A',
  title: 'Policy Lab',
  credits: 4,
  sections: [],
  instructors: [],
  enrichment: {},
}

describe('schedule plan mutations', () => {
  it('adds a normalized shortlist course and preserves plan ownership', () => {
    const result = addCourseToPlan({ name: 'Fall Plan', courses: [] }, course, 'Spring Plan')

    expect(result).toMatchObject({
      name: 'Spring Plan',
      courses: [{ courseCode: 'DPI-802-M-A', courseCodeBase: 'DPI-802-M', isOnGrid: false }],
    })
  })

  it('keeps the exact plan reference when a section variant of the base course is present', () => {
    const plan = { name: 'Spring Plan', courses: [{ ...course, courseCode: 'DPI-802-M' }] }

    expect(addCourseToPlan(plan, { ...course, courseCode: 'DPI-802-M-001' }, 'Spring Plan')).toBe(
      plan,
    )
  })

  it('removes normalized persisted plan variants', () => {
    const plan = { name: 'Spring Plan', courses: [course, { ...course, courseCode: 'API-101' }] }

    expect(removeCourseFromPlan(plan, 'DPI-802-M-001', 'Spring Plan').courses).toEqual([
      expect.objectContaining({ courseCode: 'API-101' }),
    ])
  })

  it('removes a detailed search result object when persisted identity uses its base code', () => {
    const persisted = {
      ...course,
      courseCode: 'API-101-A',
      courseCodeBase: 'API-101',
    }
    const plan = { name: 'Plan A', courses: [persisted] }

    expect(removeCourseFromPlan(plan, persisted, 'Plan A').courses).toEqual([])
  })
  it('removes planned section variants when the base course is completed', () => {
    const plan = {
      name: 'Spring Plan',
      courses: [course, { ...course, courseCode: 'API-101' }],
    }
    const result = removeCompletedCoursesFromPlan(
      plan,
      [{ courseCode: 'DPI-802-M-001' }],
      'Spring Plan',
    )

    expect(result.courses).toEqual([expect.objectContaining({ courseCode: 'API-101' })])
    expect(removeCompletedCoursesFromPlan(result, [], 'Spring Plan')).toBe(result)
  })

  it('marks completed courses once and flags them for requirements progress', () => {
    const completed = addCompletedCourse([], course)

    expect(completed).toEqual([
      expect.objectContaining({
        courseCode: 'DPI-802-M-A',
        courseCodeBase: 'DPI-802-M',
        _isCompleted: true,
      }),
    ])
    expect(addCompletedCourse(completed, { ...course, courseCode: 'DPI-802-M-001' })).toBe(
      completed,
    )
  })

  it('updates a completed course through any section-form code', () => {
    const completed = [course, { ...course, courseCode: 'API-101' }]
    const result = updateCompletedCourse(completed, 'DPI-802-M-001', { grade: 'B-' })

    expect(result[0]).toEqual(expect.objectContaining({ courseCode: 'DPI-802-M-A', grade: 'B-' }))
    expect(result[1]).toBe(completed[1])
  })

  it('removes a completed course without mutating unrelated entries', () => {
    const completed = [course, { ...course, courseCode: 'API-101' }]

    expect(removeCompletedCourse(completed, 'DPI-802-M-001')).toEqual([
      expect.objectContaining({ courseCode: 'API-101' }),
    ])
  })
})
