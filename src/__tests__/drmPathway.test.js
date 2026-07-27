import { describe, expect, it } from 'vitest'
import drmQualifyingCourses from '../data/drmQualifyingCourses.json'
import { computeProgress } from '../lib/requirementsEngine.js'
import {
  computeDrmProgress,
  getDrmCourseKey,
  getDrmEligibility,
  isPassingDrmGrade,
} from '../lib/drmPathway.js'

function course(code, overrides = {}) {
  return {
    courseCode: code,
    year: 2026,
    term: 'Fall',
    credits: 4,
    ...overrides,
  }
}

describe('official DRM pathway rules', () => {
  it('keeps the complete official workbook snapshot for every published academic year', () => {
    expect(drmQualifyingCourses._meta.articleUpdated).toBe('2026-07-14')
    expect(
      Object.fromEntries(
        ['AY27', 'AY26', 'AY25', 'AY24'].map((year) => {
          const courses = drmQualifyingCourses[year].courses
          return [
            year,
            {
              total: courses.length,
              groupA: courses.filter(([group]) => group === 'A').length,
              groupB: courses.filter(([group]) => group === 'B').length,
            },
          ]
        }),
      ),
    ).toEqual({
      AY27: { total: 121, groupA: 78, groupB: 43 },
      AY26: { total: 121, groupA: 78, groupB: 43 },
      AY25: { total: 82, groupA: 55, groupB: 27 },
      AY24: { total: 79, groupA: 54, groupB: 25 },
    })
  })
  it('uses the course offering academic year instead of a generic STEM flag', () => {
    expect(
      getDrmEligibility(course('DPI-681-M', { year: 2025, term: 'Spring', is_stem: false })),
    ).toMatchObject({ status: 'qualifying', academicYear: 'AY25', group: 'A' })

    expect(
      getDrmEligibility(course('DPI-681', { year: 2026, term: 'Spring', is_stem: false })),
    ).toMatchObject({ status: 'qualifying', academicYear: 'AY26', group: 'A' })

    expect(
      getDrmEligibility(course('DPI-681-M', { year: 2026, term: 'Fall', is_stem: false })),
    ).toMatchObject({ status: 'qualifying', academicYear: 'AY27', group: 'A' })
  })

  it('applies the official API-203M group by section', () => {
    expect(getDrmEligibility(course('API-203M', { drmSection: 'A', credits: 2 }))).toMatchObject({
      status: 'qualifying',
      group: 'A',
    })
    expect(getDrmEligibility(course('API-203M', { drmSection: 'Z', credits: 2 }))).toMatchObject({
      status: 'qualifying',
      group: 'A',
    })
    expect(getDrmEligibility(course('API-203M', { drmSection: 'B', credits: 2 }))).toMatchObject({
      status: 'qualifying',
      group: 'B',
    })
    expect(getDrmEligibility(course('API-203M-B', { credits: 2 }))).toMatchObject({
      status: 'qualifying',
      group: 'B',
    })
    expect(getDrmEligibility(course('API-203M', { credits: 2 }))).toMatchObject({
      status: 'section-required',
      group: null,
    })
    expect(
      getDrmEligibility(
        course('API-203M', {
          credits: 2,
          sections: [
            { id: 'a', sectionCode: 'A' },
            { id: 'b', sectionCode: 'B' },
          ],
        }),
      ),
    ).toMatchObject({ status: 'section-required', group: null })
  })

  it('requires both four Group A and four Group B credits', () => {
    const allGroupA = ['API-114', 'API-115', 'API-121', 'API-141'].map((code) =>
      course(code, { grade: 'A' }),
    )
    const result = computeDrmProgress('MPA_2YR', [], allGroupA)

    expect(result.verifiedCredits).toBe(16)
    expect(result.verifiedGroupA).toBe(16)
    expect(result.verifiedGroupB).toBe(0)
    expect(result.courseRequirementsVerified).toBe(false)
  })

  it('marks the course component verified only with 16 credits, both groups, and B- or better', () => {
    const completed = [
      course('API-114', { grade: 'B-' }),
      course('API-115', { grade: 'A' }),
      course('IGA-108', { grade: 'B' }),
      course('MLD-125', { grade: 'A-' }),
    ]
    const result = computeDrmProgress('MPA_2YR', [], completed)

    expect(result.verifiedCredits).toBe(16)
    expect(result.verifiedGroupA).toBe(8)
    expect(result.verifiedGroupB).toBe(8)
    expect(result.courseRequirementsVerified).toBe(true)
  })

  it('accepts B- but rejects lower and missing grades for verified completion', () => {
    expect(isPassingDrmGrade('B-')).toBe(true)
    expect(isPassingDrmGrade('C+')).toBe(false)

    const result = computeDrmProgress(
      'MPA_2YR',
      [],
      [
        course('API-114', { grade: 'B-' }),
        course('IGA-108', { grade: 'C+' }),
        course('MLD-125', { grade: '' }),
      ],
    )

    expect(result.verifiedCredits).toBe(4)
    expect(result.pendingGradeCredits).toBe(4)
    expect(result.courses.find((item) => item.code === 'IGA-108').gradeStatus).toBe('below-minimum')
  })

  it('counts a base course only once across section variants and planned/completed lists', () => {
    const result = computeDrmProgress(
      'MPA_2YR',
      [
        course('DPI-681-M', { year: 2025, term: 'Spring', credits: 2 }),
        course('DPI-681-M-001', { year: 2025, term: 'Spring', credits: 2 }),
      ],
      [course('DPI-681-M-A', { year: 2025, term: 'Spring', credits: 2, grade: 'A' })],
    )

    expect(result.courses).toHaveLength(1)
    expect(result.verifiedCredits).toBe(2)
    expect(result.projectedCredits).toBe(2)
  })

  it('does not invent four credits when the selected offering has no credit value', () => {
    const result = computeDrmProgress('MPA_2YR', [course('DPI-681-M', { credits: null })], [])

    expect(result.projectedCredits).toBe(0)
    expect(result.courses[0]).toMatchObject({ credits: null, countsTowardDrm: false })
  })

  it('limits MPA and MC/MPA distribution double-counting to four whole credits', () => {
    const planned = ['API-165', 'API-205', 'API-222'].map((code) => course(code))
    const automatic = computeDrmProgress('MPA_2YR', planned, [])

    expect(automatic.bucketUsage['mpa-distribution']).toBe(4)
    expect(automatic.courses.map((item) => item.allocation)).toEqual([
      'drm-only',
      'drm-only',
      'overlap',
    ])
    expect(automatic.projectedCredits).toBe(12)

    const drmOnlyKey = getDrmCourseKey(planned[1])
    const reassigned = computeDrmProgress('MPA_2YR', planned, [], {
      assignments: { [drmOnlyKey]: 'drm' },
    })

    expect(reassigned.projectedCredits).toBe(12)
    expect(reassigned.categoryExclusions.dist_econquant).toContain(drmOnlyKey)
  })

  it('removes a DRM-only MPA course from every restricted category it could satisfy', () => {
    const planned = [course('DPI-610')]
    const key = getDrmCourseKey(planned[0])
    const result = computeDrmProgress('MPA_2YR', planned, [], {
      assignments: { [key]: 'drm' },
      preferredPacArea: 'DPI',
    })

    expect(result.categoryExclusions.dist_econquant).toContain(key)
    expect(result.categoryExclusions.pac).toContain(key)
  })

  it('keeps DRM-only credits available as electives without restricted double-counting', () => {
    const planned = [course('APCOMP-221')]
    const key = getDrmCourseKey(planned[0])
    const drmOnly = computeDrmProgress('MPA_2YR', planned, [])

    expect(drmOnly.courses[0].allocation).toBe('drm-only')
    expect(drmOnly.categoryExclusions).toEqual({})
    const degreeProgress = computeProgress('MPA_2YR', planned, [], {
      categoryExclusions: drmOnly.categoryExclusions,
    })
    expect(
      degreeProgress.categories.find((category) => category.id === 'electives').appliedCredits,
    ).toBe(4)

    const degreeOnly = computeDrmProgress('MPA_2YR', planned, [], {
      assignments: { [key]: 'degree' },
    })
    expect(degreeOnly.courses[0].allocation).toBe('degree-only')
    expect(degreeOnly.projectedCredits).toBe(0)
    expect(degreeOnly.categoryExclusions).toEqual({})
  })

  it('fills degree requirements first, then reallocates only surplus courses to STEM', () => {
    const completed = [
      course('API-222', { year: 2024, term: 'Fall', credits: 4, grade: 'B' }),
      course('DPI-802-M', { year: 2024, term: 'Fall', credits: 2, grade: 'A' }),
      course('DPI-851-M', { year: 2024, term: 'Fall', credits: 2, grade: 'A' }),
      course('MIT-15.390', { year: 2024, term: 'Fall', credits: 4, grade: 'A' }),
      course('MLD-201', { year: 2024, term: 'Fall', credits: 4, grade: 'A-' }),
      course('MLD-515-M', { year: 2024, term: 'Fall', credits: 2, grade: 'A-' }),
      course('DPI-678-M', { year: 2025, term: 'Spring', credits: 2, grade: 'A' }),
      course('DPI-681-M', { year: 2025, term: 'Spring', credits: 2, grade: 'A' }),
      course('DPI-830-M', { year: 2025, term: 'Spring', credits: 2, grade: 'A-' }),
      course('DPI-835-M', { year: 2025, term: 'Spring', credits: 2, grade: 'A' }),
      course('HBSMBA-6334', { year: 2025, term: 'Spring', credits: 4, grade: '' }),
      course('IGA-250', { year: 2025, term: 'Spring', credits: 4, grade: 'A' }),
      course('MLD-215', { year: 2025, term: 'Spring', credits: 4, grade: 'A' }),
      course('API-318', { year: 2025, term: 'Fall', credits: 4, grade: 'A-' }),
      course('IGA-260', { year: 2025, term: 'Fall', credits: 4, grade: 'A' }),
      course('RUSS-AA', { year: 2025, term: 'Fall', credits: 4, grade: 'A' }),
      course('DPI-891-M', { year: 2026, term: 'Spring', credits: 2, grade: 'A' }),
      course('IGA-108', { year: 2026, term: 'Spring', credits: 4, grade: 'A' }),
      course('MLD-280', { year: 2026, term: 'Spring', credits: 4, grade: 'A-' }),
      course('RAR-551', { year: 2026, term: 'Spring', credits: 4, grade: '' }),
    ]

    const result = computeDrmProgress('MPA_2YR', [], completed, {
      preferredPacArea: 'DPI',
    })
    const degreeProgress = computeProgress('MPA_2YR', [], completed, {
      preferredPacArea: 'DPI',
      categoryExclusions: result.categoryExclusions,
    })

    expect(result.verifiedCredits).toBeGreaterThanOrEqual(16)
    expect(result.verifiedGroupA).toBeGreaterThanOrEqual(4)
    expect(result.verifiedGroupB).toBeGreaterThanOrEqual(4)
    expect(result.courseRequirementsVerified).toBe(true)
    expect(degreeProgress.overallAppliedCredits).toBe(64)
    expect(degreeProgress.categories.every((category) => category.isComplete)).toBe(true)

    const surplusStemCodes = result.courses
      .filter((record) => record.allocation === 'drm-only')
      .map((record) => record.code)
    expect(surplusStemCodes).toEqual(
      expect.arrayContaining(['API-222', 'DPI-851-M', 'DPI-681-M', 'IGA-250', 'IGA-260']),
    )
    expect(result.bucketUsage['mpa-distribution']).toBeLessThanOrEqual(4)
  })

  it('uses separate four-credit MPP core and declared-PAC allowances', () => {
    const result = computeDrmProgress(
      'MPP_Y2',
      [course('API-201'), course('API-202M', { credits: 2 }), course('IGA-108')],
      [],
      { preferredPacArea: 'IGA' },
    )

    expect(result.bucketUsage).toMatchObject({ 'mpp-core': 4, 'mpp-pac': 4 })
    expect(result.courses.find((item) => item.code === 'API-202M').allocation).toBe('degree-only')
    expect(result.projectedCredits).toBe(8)
  })

  it('lets the official selected-year workbook override a later denial', () => {
    expect(getDrmEligibility(course('DPI-562', { year: 2024, term: 'Spring' }))).toMatchObject({
      status: 'qualifying',
      academicYear: 'AY24',
      group: 'B',
    })
    expect(getDrmEligibility(course('DPI-562', { year: 2026, term: 'Fall' }))).toMatchObject({
      status: 'denied',
      academicYear: 'AY27',
      group: null,
    })
  })

  it('keeps MPA/ID outside the optional pathway and identifies officially denied courses', () => {
    expect(computeDrmProgress('MPA_ID', [course('API-114')], []).eligibleProgram).toBe(false)
    expect(getDrmEligibility(course('API-111'))).toMatchObject({ status: 'denied' })
    expect(getDrmEligibility({ courseCode: 'API-111' })).toMatchObject({ status: 'denied' })
  })
})
