import { describe, expect, it } from 'vitest'
import {
  condenseCourses,
  normalizeOptionalBoolean,
  selectRelevantHistory,
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
    expect(context).toHaveLength(3)
    expect(context.find((course) => course.base_code === 'DPI-851-M')).toMatchObject({
      code: 'DPI-851-M',
      year: 2025,
    })
    expect(context.find((course) => course.base_code === 'DPI-851-M').offering_history).toMatch(
      /DPI-851-M-B.*2025 Spring.*2024 Fall/,
    )
    expect(context.every((course) => course.instructor === 'Hong Qu')).toBe(true)
    expect(context.some((course) => course.code === 'MLD-215-B')).toBe(false)
  })

  it.each([
    ['D. Freeland', 'MLD-515-M', 'Grant Freeland'],
    ["Daniel D'Oca", 'DPI-201', 'Daniel Oca'],
    ['L. David Brown', 'MLD-301', 'David Brown'],
    ["Meghan O'Sullivan", 'IGA-401', 'Meghan Sullivan'],
    ["Timothy O'Brien", 'IGA-501', 'Timothy Brien'],
  ])(
    'matches the complete instructor name %s without selecting %s',
    (instructor, code, collidingInstructor) => {
      const courses = [
        {
          course_code: code,
          course_code_base: code,
          course_name: 'Named Instructor Seminar',
          professor_display: instructor,
          year: 2026,
          term: 'Spring',
          has_eval: true,
        },
        {
          course_code: 'COLLISION-1',
          course_code_base: 'COLLISION-1',
          course_name: 'Potential Identity Collision',
          professor_display: collidingInstructor,
          year: 2026,
          term: 'Spring',
          has_eval: true,
        },
        {
          course_code: 'UNRELATED-1',
          course_code_base: 'UNRELATED-1',
          course_name: 'Unrelated Seminar',
          professor_display: 'Another Professor',
          year: 2026,
          term: 'Spring',
          has_eval: true,
        },
      ]

      const context = condenseCourses(courses, `What does ${instructor} teach?`)

      expect(context).toHaveLength(1)
      expect(context[0]).toMatchObject({ code, instructor })
    },
  )

  it('uses an explicitly supplied initial to distinguish D. Freeland from Grant Freeland', () => {
    const courses = [
      {
        course_code: 'MLD-515-M',
        course_code_base: 'MLD-515-M',
        course_name: 'Presenting Quantitative Information',
        professor_display: 'D. Freeland',
        year: 2024,
        term: 'Spring',
        has_eval: true,
      },
      {
        course_code: 'MLD-632-M',
        course_code_base: 'MLD-632-M',
        course_name: 'Leading through Difference',
        professor_display: 'Grant Freeland',
        year: 2024,
        term: 'Spring',
        has_eval: true,
      },
    ]

    expect(condenseCourses(courses, 'What does D. Freeland teach?')).toMatchObject([
      { code: 'MLD-515-M', instructor: 'D. Freeland' },
    ])
    expect(condenseCourses(courses, 'What does Freeland teach?')).toEqual([])
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
      {
        course_code: 'ENV-250',
        course_code_base: 'ENV-250',
        course_name: 'Climate Adaptation Policy',
        professor_display: 'Ada Climate',
        year: 2026,
        term: 'Spring',
        has_eval: true,
      },
    ]

    const history = [
      { role: 'user', content: 'What are Hong Qu’s courses?' },
      { role: 'assistant', content: 'Hong Qu teaches the listed DPI courses.' },
    ]
    const context = condenseCourses(courses, 'Is Hong a good professor?', [], history)

    const firstTurnContext = condenseCourses(courses, 'What are Hong Qu’s courses?')
    expect(firstTurnContext).toHaveLength(1)
    expect(firstTurnContext[0]).toMatchObject({ code: 'DPI-852-M', instructor: 'Hong Qu' })
    expect(context).toHaveLength(1)
    expect(context[0]).toMatchObject({ code: 'DPI-852-M', instructor: 'Hong Qu' })
    expect(selectRelevantHistory(courses, 'Is Hong a good professor?', history, context)).toEqual(
      history,
    )

    expect(condenseCourses(courses, 'Is Hong a good professor?')).toEqual([])

    const independentContext = condenseCourses(
      courses,
      'Which climate courses have light workloads?',
      [],
      history,
    )
    expect(independentContext).toMatchObject([{ code: 'ENV-250', instructor: 'Ada Climate' }])
    expect(
      selectRelevantHistory(
        courses,
        'Which climate courses have light workloads?',
        history,
        independentContext,
      ),
    ).toEqual([])

    const explicitContext = condenseCourses(courses, 'Is Hong Qu a good professor?', [], history)
    expect(
      selectRelevantHistory(courses, 'Is Hong Qu a good professor?', history, explicitContext),
    ).toEqual([])

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

  it('preserves every offering and metric in a multi-decade instructor history', () => {
    const history = Array.from({ length: 36 }, (_, index) => ({
      course_code: index % 2 === 0 ? 'MLD-220-M' : 'MLD-220-M-A',
      course_code_base: 'MLD-220-M',
      course_name: 'Management and Leadership',
      professor_display: 'Brian Mandell',
      year: 1990 + index,
      term: index % 2 === 0 ? 'Fall' : 'Spring',
      has_eval: true,
      metrics_pct: {
        Course_Rating: 50 + (index % 40),
        Instructor_Rating: 55 + (index % 40),
        Workload: 20 + (index % 60),
      },
    }))

    const [context] = condenseCourses(history, 'What does Brian Mandell teach?')

    expect(context.offering_history.length).toBeGreaterThan(1_200)
    expect(context.offering_history.length).toBeLessThanOrEqual(4_000)
    expect(context.offering_history).toMatch(/2025 Spring \(course 85 pct, instructor 90 pct/)
    expect(context.offering_history).toMatch(/1990 Fall \(course 50 pct, instructor 55 pct/)
    expect(context.offering_history).toContain('MLD-220-M-A')
  })
})
