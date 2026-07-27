import { describe, expect, it } from 'vitest'
import { computeProgress } from '../lib/requirementsEngine.js'

describe('degree requirement course identity', () => {
  it('counts section-form duplicates only once in the PAC', () => {
    const duplicateOffering = [
      { courseCode: 'DPI-681-M', credits: 2 },
      { courseCode: 'DPI-681-M-001', credits: 2 },
      { courseCode: 'DPI-681-M-A', credits: 2 },
    ]

    const progress = computeProgress('MPA_2YR', duplicateOffering, [], {
      preferredPacArea: 'DPI',
    })
    const pac = progress.categories.find((category) => category.id === 'pac')

    expect(pac.matchedCredits).toBe(2)
    expect(pac.appliedCredits).toBe(2)
    expect(pac.selectedCourses).toHaveLength(1)
    expect(pac.selectedCourses[0]._courseCode).toBe('DPI-681-M')
  })

  it('lets the completed record replace a planned copy of the same base course', () => {
    const progress = computeProgress(
      'MPA_2YR',
      [{ courseCode: 'DPI-681-M-001', credits: 2 }],
      [{ courseCode: 'DPI-681-M', credits: 2 }],
      { preferredPacArea: 'DPI' },
    )
    const pac = progress.categories.find((category) => category.id === 'pac')

    expect(progress.totalScheduledCredits).toBe(2)
    expect(pac.selectedCourses).toHaveLength(1)
    expect(pac.selectedCourses[0]._isCompleted).toBe(true)
  })

  it('globally reallocates courses when a new course can complete more degree requirements', () => {
    const courses = [
      { courseCode: 'DPI-610', credits: 4 },
      { courseCode: 'DPI-999', credits: 4 },
      { courseCode: 'API-318', credits: 4 },
    ]

    const progress = computeProgress('MPA_2YR', courses, [], {
      preferredPacArea: 'DPI',
    })
    const economics = progress.categories.find((category) => category.id === 'dist_econquant')
    const pac = progress.categories.find((category) => category.id === 'pac')

    expect(economics.selectedCourses).toEqual([expect.objectContaining({ _courseCode: 'API-318' })])
    expect(pac.appliedCredits).toBe(8)
    expect(pac.selectedCourses.map((course) => course._courseCode)).toEqual(['DPI-610', 'DPI-999'])
  })

  it('excludes DRP courses while SAT and II still fulfill degree credits', () => {
    const completed = [
      { courseCode: 'DPI-555', credits: 4, grade: 'DRP' },
      { courseCode: 'RAR-551', credits: 2, grade: 'SAT' },
      { courseCode: 'HBSMBA-6334', credits: 4, grade: 'II' },
      { courseCode: 'IGA-999', credits: 0, grade: 'A' },
    ]

    const progress = computeProgress('MPA_2YR', [], completed, {
      preferredPacArea: 'DPI',
    })
    const electives = progress.categories.find((category) => category.id === 'electives')

    expect(progress.totalScheduledCredits).toBe(6)
    expect(progress.overallAppliedCredits).toBe(6)
    expect(electives.appliedCredits).toBe(6)
  })
})
