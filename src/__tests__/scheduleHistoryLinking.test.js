import { describe, expect, it } from 'vitest'
import {
  buildHistoricalRatingsByCode,
  findVerifiedHistoricalRating,
} from '../lib/scheduleHistoryLinking.js'

const history = [
  {
    course_code_base: 'DPI-802-M',
    professor: 'Allison, Graham',
    year: 2024,
    metrics_pct: { Instructor_Rating: 82 },
  },
  {
    course_code_base: 'DPI-802-M',
    professor: 'Other, Professor',
    year: 2025,
    metrics_pct: { Instructor_Rating: 99 },
  },
]

describe('Schedule Builder historical-rating links', () => {
  it('uses only an exact code with a matching instructor', () => {
    const index = buildHistoricalRatingsByCode(history)
    expect(
      findVerifiedHistoricalRating(
        { courseCode: 'DPI-802-M', instructors: ['Graham Allison'] },
        index,
      ),
    ).toMatchObject({ metrics_pct: { Instructor_Rating: 82 } })
  })

  it('does not borrow a rating from a suffix variant, different professor, or unknown instructor', () => {
    const index = buildHistoricalRatingsByCode(history)
    expect(
      findVerifiedHistoricalRating(
        { courseCode: 'DPI-802-M-D', instructors: ['Graham Allison'] },
        index,
      ),
    ).toBeNull()
    expect(
      findVerifiedHistoricalRating(
        { courseCode: 'DPI-802-M', instructors: ['Different Professor'] },
        index,
      ),
    ).toBeNull()
    expect(
      findVerifiedHistoricalRating({ courseCode: 'DPI-802-M', instructors: [] }, index),
    ).toBeNull()
  })
})
