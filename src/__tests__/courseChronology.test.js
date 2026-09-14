import { describe, expect, it } from 'vitest'
import { compareCourseChronology } from '../lib/courseChronology.js'

describe('course history chronology', () => {
  it('orders calendar years and J-term, Spring, Summer, Fall within each year', () => {
    const rows = [
      { year: 2026, term: 'Fall' },
      { year: 2025, term: 'Fall' },
      { year: 2026, term: 'Spring' },
      { year: 2025, term: 'Spring' },
      { year: 2026, term: 'January' },
      { year: 2025, term: 'January' },
      { year: 2026, term: 'Summer' },
    ]
    expect([...rows].sort(compareCourseChronology).map((row) => `${row.year} ${row.term}`)).toEqual(
      [
        '2025 January',
        '2025 Spring',
        '2025 Fall',
        '2026 January',
        '2026 Spring',
        '2026 Summer',
        '2026 Fall',
      ],
    )
  })

  it('keeps multiple instructors in the same term together without dropping records', () => {
    const first = { year: 2026, term: 'Spring', professor: 'First' }
    const second = { year: 2026, term: 'Spring', professor: 'Second' }
    expect(compareCourseChronology(first, second)).toBe(0)
    expect([first, second].sort(compareCourseChronology)).toEqual([first, second])
  })

  it('keeps undated averages after all calendar history without dropping them', () => {
    const average = { year: 0, term: 'Average', professor: 'First' }
    const anotherAverage = { year: 0, term: 'Average', professor: 'Second' }
    const oldest = { year: 2025, term: 'January' }
    const newest = { year: 2026, term: 'Fall' }
    expect([average, newest, anotherAverage, oldest].sort(compareCourseChronology)).toEqual([
      oldest,
      newest,
      average,
      anotherAverage,
    ])
    expect(compareCourseChronology(average, anotherAverage)).toBe(0)
  })
})
