import { describe, expect, it } from 'vitest'
import {
  condenseCourses,
  normalizeOptionalBoolean,
  toCourseSummary,
} from '../components/ChatBot.jsx'

describe('chat course context', () => {
  it.each([
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ['true', true],
    ['false', false],
    [null, undefined],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeOptionalBoolean(input)).toBe(expected)
  })

  it('never sends a non-boolean is_core value to the chat Worker', () => {
    const summary = toCourseSummary({ course_code: 'IGA-550', is_core: null })
    expect(summary.is_core).toBeUndefined()
    expect(JSON.parse(JSON.stringify(summary))).not.toHaveProperty('is_core')
  })

  it('omits missing evaluation metrics instead of reporting false zero percentiles', () => {
    const summary = toCourseSummary({
      course_code: 'IGA-550',
      metrics_pct: { Course_Rating: null, Workload: undefined, Instructor_Rating: null },
    })
    const transmitted = JSON.parse(JSON.stringify(summary))

    expect(transmitted).not.toHaveProperty('rating_pct')
    expect(transmitted).not.toHaveProperty('workload_pct')
    expect(transmitted).not.toHaveProperty('instructor_pct')
  })

  it('grounds a named-faculty question in the complete matching database history', () => {
    const courses = [
      {
        id: 'dpi-853-2026',
        course_code: 'DPI-853-M',
        course_code_base: 'DPI-853-M',
        course_name: 'Data Visualization: Storytelling Strategies',
        professor_display: 'Hong Qu',
        year: 2026,
        term: 'Spring',
        has_eval: true,
      },
      {
        id: 'dpi-851b-2025',
        course_code: 'DPI-851-M-B',
        course_code_base: 'DPI-851-M',
        course_name: 'Data and Information Visualization',
        professor_display: 'Hong Qu',
        year: 2025,
        term: 'Spring',
        has_eval: true,
      },
      {
        id: 'dpi-851-2024',
        course_code: 'DPI-851-M',
        course_code_base: 'DPI-851-M',
        course_name: 'Data and Information Visualization',
        professor_display: 'Hong Qu',
        year: 2024,
        term: 'Fall',
        has_eval: true,
      },
      {
        id: 'dpi-852-2025',
        course_code: 'DPI-852-M',
        course_code_base: 'DPI-852-M',
        course_name: 'Advanced Data and Information Visualization',
        professor_display: 'Hong Qu',
        year: 2025,
        term: 'Spring',
        has_eval: true,
      },
      {
        id: 'unrelated-2026',
        course_code: 'MLD-215-B',
        course_code_base: 'MLD-215-B',
        course_name: 'Negotiation and Leadership',
        professor_display: 'Robert Wilkinson',
        year: 2026,
        term: 'Spring',
        has_eval: true,
      },
    ]

    const context = condenseCourses(courses, 'What are Hong Qu’s courses?')
    expect(new Set(context.map((course) => course.base_code))).toEqual(
      new Set(['DPI-851-M', 'DPI-852-M', 'DPI-853-M']),
    )
    expect(context.map((course) => course.code)).toContain('DPI-851-M-B')
    expect(context.map((course) => course.year)).toEqual(expect.arrayContaining([2024, 2025, 2026]))
    expect(context.every((course) => course.instructor === 'Hong Qu')).toBe(true)
    expect(context.some((course) => course.code === 'MLD-215-B')).toBe(false)
  })
})
