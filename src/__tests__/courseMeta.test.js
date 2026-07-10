import { describe, expect, it } from 'vitest'
import { COURSE_METRICS, buildCourseMeta } from '../lib/courseMeta.js'

describe('buildCourseMeta', () => {
  it('builds sorted metadata and excludes average rows from rating medians', () => {
    const meta = buildCourseMeta([
      { concentration: 'DPI', year: 2024, has_eval: true, metrics_raw: { Instructor_Rating: 4 } },
      { concentration: 'BGP', year: 2025, has_eval: true, metrics_raw: { Instructor_Rating: 2 } },
      {
        concentration: 'DPI',
        year: 2025,
        has_eval: true,
        metrics_raw: { Instructor_Rating: 5 },
        is_average: true,
      },
    ])
    expect(meta.concentrations).toEqual(['BGP', 'DPI'])
    expect(meta.years).toEqual([2024, 2025])
    expect(meta.default_year).toBe(2025)
    expect(meta.overall_median_instructor).toBe(3)
    expect(meta.year_medians_instructor).toEqual({ 2024: 4, 2025: 2 })
    expect(meta.metrics).toBe(COURSE_METRICS)
  })

  it('uses the documented fallback year for an empty or malformed source', () => {
    expect(buildCourseMeta(null)).toMatchObject({
      concentrations: [],
      years: [],
      default_year: 2025,
      overall_median_instructor: null,
      year_medians_instructor: {},
    })
  })
})
