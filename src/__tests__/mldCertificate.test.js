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
        { courseCode: 'MLD-201-A', credits: 4 },
        { courseCode: 'DEV-210', credits: 4 },
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
      [{ courseCode: 'MLD-502', credits: 4 }],
      'MPA_2YR',
    )

    expect(progress.completedCredits).toBe(4)
    expect(progress.plannedCredits).toBe(0)
  })
})
