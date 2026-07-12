import { describe, expect, it } from 'vitest'
import { buildComparisonCandidatePool } from '../lib/compareCandidates.js'

describe('comparison candidate pool', () => {
  it('keeps current courses that have no evaluation history', () => {
    const candidates = buildComparisonCandidatePool([
      {
        id: 'evaluated',
        course_code_base: 'IGA-109',
        course_name: 'Negotiation and Diplomacy',
        has_eval: true,
        year: 2025,
      },
      {
        id: 'current-only',
        course_code_base: 'IGA-550',
        course_name: 'The Policy and Geopolitics of Artificial Intelligence',
        has_eval: false,
        year: 2026,
      },
    ])

    expect(candidates.map((course) => course.course_code_base)).toEqual(['IGA-109', 'IGA-550'])
  })
})
