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
})
