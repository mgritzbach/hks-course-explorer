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

  it('keeps a second-turn professor question focused on the named instructor', () => {
    const courses = [
      {
        course_code: 'DPI-852-M',
        course_code_base: 'DPI-852-M',
        course_name: 'Advanced Data and Information Visualization',
        professor_display: 'Hong Qu',
        year: 2025,
        term: 'Spring',
        has_eval: true,
      },
      {
        course_code: 'DPI-802-M-D-2',
        course_code_base: 'DPI-802-M-D-2',
        course_name: 'The Arts of Communication',
        professor_display: 'Allison Shapira',
        year: 2026,
        term: 'Spring',
        has_eval: true,
      },
      {
        course_code: 'MLD-215-B',
        course_code_base: 'MLD-215-B',
        course_name: 'Negotiation and Leadership',
        professor_display: 'Robert Wilkinson',
        year: 2026,
        term: 'Spring',
        has_eval: true,
      },
      {
        course_code: 'API-202',
        course_code_base: 'API-202',
        course_name: 'Empirical Methods II',
        professor_display: 'Joshua Goodman',
        year: 2026,
        term: 'Spring',
        has_eval: true,
      },
      {
        course_code: 'MLD-223',
        course_code_base: 'MLD-223',
        course_name: 'Organizing for Good',
        professor_display: 'Kessely Hong',
        year: 2026,
        term: 'Spring',
        has_eval: true,
      },
    ]

    const context = condenseCourses(
      courses,
      'Is Hong a good professor?',
      [],
      [
        { role: 'user', content: 'What are Hong Qu’s courses?' },
        { role: 'assistant', content: 'Hong Qu teaches the listed DPI courses.' },
      ],
    )

    expect(context).toHaveLength(1)
    expect(context[0]).toMatchObject({ code: 'DPI-852-M', instructor: 'Hong Qu' })

    expect(condenseCourses(courses, 'Is Hong a good professor?')).toEqual([])

    const genericContext = condenseCourses(courses, 'Who is a good professor?')
    expect(genericContext.length).toBeGreaterThan(1)
    expect(genericContext.every((course) => course.instructor === 'Joshua Goodman')).toBe(false)
  })

  it('keeps query matches ahead of a favorite with extensive history', () => {
    const favoriteHistory = Array.from({ length: 35 }, (_, index) => ({
      id: `api-201-${index}`,
      course_code: 'API-201',
      course_code_base: 'API-201',
      course_name: 'Quantitative Analysis and Empirical Methods',
      professor_display: `Professor ${index}`,
      year: 1990 + index,
      term: 'Fall',
      has_eval: true,
    }))
    const climateMatch = {
      id: 'env-250-2026',
      course_code: 'ENV-250',
      course_code_base: 'ENV-250',
      course_name: 'Climate Adaptation Policy',
      professor_display: 'Ada Climate',
      year: 2026,
      term: 'Spring',
      has_eval: true,
    }

    const context = condenseCourses([...favoriteHistory, climateMatch], 'climate adaptation', [
      'API-201',
    ])
    expect(context).toHaveLength(30)
    expect(context[0]).toMatchObject({ code: 'ENV-250', name: 'Climate Adaptation Policy' })
    expect(context.some((course) => course.code === 'ENV-250')).toBe(true)
  })
})
