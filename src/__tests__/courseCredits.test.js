import { describe, expect, it } from 'vitest'
import {
  applyCourseCreditMap,
  buildCourseCreditMap,
  resolveCourseCredits,
} from '../lib/courseCredits.js'

describe('course credit resolution', () => {
  const credits = buildCourseCreditMap([
    {
      course_code_base: 'DPI-681-M',
      term: '2025 Spring',
      session_description: 'Spring 2',
      credits: 2,
    },
    {
      course_code_base: 'DPI-681-M',
      term: '2024 Spring',
      session_description: 'Full Term',
      credits: 4,
    },
  ])

  it('uses the database credits for the selected year and term', () => {
    expect(
      resolveCourseCredits(
        { courseCode: 'DPI-681-M', year: 2025, term: 'Spring', credits: 4 },
        credits,
      ),
    ).toBe(2)
    expect(
      resolveCourseCredits(
        { courseCode: 'DPI-681-M', year: 2024, term: 'Spring', credits: 2 },
        credits,
      ),
    ).toBe(4)
  })

  it('matches a numbered half-term offering before the semester fallback', () => {
    expect(
      resolveCourseCredits(
        {
          courseCode: 'DPI-681-M',
          year: 2025,
          term: 'Spring',
          sessionDescription: 'Spring 2',
        },
        credits,
      ),
    ).toBe(2)
  })

  it('repairs previously stored fallback credits without mutating unrelated entries', () => {
    const existing = [
      { courseCode: 'DPI-681-M', year: 2025, term: 'Spring', credits: 4 },
      { courseCode: 'IGA-108', year: 2025, term: 'Spring', credits: 4 },
    ]
    const corrected = applyCourseCreditMap(existing, credits)

    expect(corrected).toEqual([
      expect.objectContaining({ courseCode: 'DPI-681-M', credits: 2 }),
      existing[1],
    ])
    expect(existing[0].credits).toBe(4)
  })
})
