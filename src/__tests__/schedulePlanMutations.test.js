import { describe, expect, it } from 'vitest'
import {
  addCompletedCourse,
  addCourseToPlan,
  removeCompletedCourse,
  removeCourseFromPlan,
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
      courses: [{ courseCode: 'DPI-802-M-A', isOnGrid: false }],
    })
  })

  it('keeps the exact plan reference when an equivalent course is already present', () => {
    const plan = { name: 'Spring Plan', courses: [{ ...course, courseCode: 'DPI-802-M-A' }] }

    expect(addCourseToPlan(plan, { ...course, courseCode: 'DPI-802-M-A' }, 'Spring Plan')).toBe(
      plan,
    )
  })

  it('removes normalized persisted plan variants', () => {
    const plan = { name: 'Spring Plan', courses: [course, { ...course, courseCode: 'API-101' }] }

    expect(removeCourseFromPlan(plan, 'DPI-802-M-A', 'Spring Plan').courses).toEqual([
      expect.objectContaining({ courseCode: 'API-101' }),
    ])
  })

  it('marks completed courses once and flags them for requirements progress', () => {
    const completed = addCompletedCourse([], course)

    expect(completed).toEqual([
      expect.objectContaining({ courseCode: 'DPI-802-M-A', _isCompleted: true }),
    ])
    expect(addCompletedCourse(completed, course)).toBe(completed)
  })

  it('removes a completed course without mutating unrelated entries', () => {
    const completed = [course, { ...course, courseCode: 'API-101' }]

    expect(removeCompletedCourse(completed, 'DPI-802-M-A')).toEqual([
      expect.objectContaining({ courseCode: 'API-101' }),
    ])
  })
})
