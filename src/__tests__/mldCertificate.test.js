import { describe, expect, it } from 'vitest'
import {
  computeMldCertificateProgress,
  getMldCertificateEligibility,
} from '../lib/mldCertificate.js'

describe('MLD Certificate progress', () => {
  it('counts current eligible HKS electives using their actual credits', () => {
    const progress = computeMldCertificateProgress(
      [{ courseCode: 'BGP-235-M', credits: 2 }],
      [
        { courseCode: 'MLD-201-A', credits: 4, grade: 'A' },
        { courseCode: 'DEV-210', credits: 4, grade: 'B+' },
      ],
      'MPA_2YR',
    )

    expect(progress).toMatchObject({
      completedCredits: 8,
      plannedCredits: 2,
      totalCredits: 10,
      remainingCredits: 2,
    })
  })

  it('excludes required courses and applies the MPA/ID exception for MLD-102', () => {
    expect(
      getMldCertificateEligibility({ courseCode: 'MLD-220-M', credits: 2 }, 'MPP_Y1'),
    ).toBeNull()
    expect(getMldCertificateEligibility({ courseCode: 'MLD-102', credits: 4 }, 'MPA_ID')).toBeNull()
    expect(
      getMldCertificateEligibility({ courseCode: 'MLD-102', credits: 4 }, 'MPA_2YR'),
    ).toMatchObject({ credits: 4 })
  })

  it('does not double-count a course appearing as both planned and completed', () => {
    const progress = computeMldCertificateProgress(
      [{ courseCode: 'MLD-502', credits: 4 }],
      [{ courseCode: 'MLD-502', credits: 4, grade: 'A-' }],
      'MPA_2YR',
    )

    expect(progress.completedCredits).toBe(4)
    expect(progress.plannedCredits).toBe(0)
  })

  it('enforces B+ per completed course while preserving legitimate certificate overfill', () => {
    const progress = computeMldCertificateProgress(
      [],
      [
        { courseCode: 'API-222', credits: 4, grade: 'B' },
        { courseCode: 'MLD-201', credits: 4, grade: 'A-' },
        { courseCode: 'MLD-515-M', credits: 2, grade: 'A-' },
        { courseCode: 'DPI-678-M', credits: 2, grade: 'A' },
        { courseCode: 'MLD-215', credits: 4, grade: 'A' },
        { courseCode: 'API-318', credits: 4, grade: 'A-' },
        { courseCode: 'MLD-280', credits: 4, grade: 'A-' },
      ],
      'MPA_2YR',
    )

    expect(progress.completedCredits).toBe(20)
    expect(progress.totalCredits).toBe(20)
    expect(progress.remainingCredits).toBe(0)
    expect(progress.ineligibleCompleted).toHaveLength(1)
    expect(progress.ineligibleCompleted[0]).toMatchObject({ displayCode: 'API-222', grade: 'B' })
  })
})
