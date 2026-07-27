import { describe, expect, it } from 'vitest'
import { mergePlanCsvRecords, parsePlansCsv, serializePlansCsv } from '../lib/planCsv.js'

const emptyPlans = Object.fromEntries(
  ['Plan A', 'Plan B', 'Plan C', 'Plan D'].map((name) => [name, { name, courses: [] }]),
)

describe('plan CSV import and export', () => {
  it('round-trips real credits, grid placement, sections, and meeting metadata', () => {
    const plans = {
      ...emptyPlans,
      'Plan B': {
        name: 'Plan B',
        courses: [
          {
            courseCode: 'DPI-681-M-A',
            courseCodeBase: 'DPI-681-M',
            title: 'Digital, Government "Lab"',
            credits: 2,
            year: 2026,
            term: 'Fall 1',
            selectedSectionId: 'section-a',
            isOnGrid: true,
            meetings: [{ day: 'MON', start: '10:30', end: '11:45' }],
            sections: [{ id: 'section-a', instructors: ['Ada Lovelace'] }],
          },
        ],
      },
    }

    const csv = serializePlansCsv(plans)
    const records = parsePlansCsv(csv)
    const merged = mergePlanCsvRecords(emptyPlans, records)

    expect(csv).toContain('course_json')
    const imported = merged['Plan B'].courses[0]
    expect(imported).toMatchObject({
      courseCode: 'DPI-681-M-A',
      courseCodeBase: 'DPI-681-M',
      credits: 2,
      isOnGrid: true,
    })
    expect(imported.meetings).toEqual([
      expect.objectContaining({ day: 'MON', start: '10:30', end: '11:45' }),
    ])
    expect(imported.sections).toEqual([
      expect.objectContaining({ id: 'section-a', instructors: ['Ada Lovelace'] }),
    ])
  })

  it('accepts a minimal hand-edited CSV and falls back to the active plan', () => {
    const records = parsePlansCsv(
      'plan,course_code,title,credits,is_on_grid\r\nCustom,API-101-A,"Resources, Incentives",4,false\r\n',
      'Plan C',
    )

    expect(records).toEqual([
      {
        plan: 'Plan C',
        course: expect.objectContaining({
          courseCode: 'API-101-A',
          title: 'Resources, Incentives',
          credits: 4,
          isOnGrid: false,
        }),
      },
    ])
  })

  it('deduplicates section variants by their base course during import', () => {
    const records = parsePlansCsv(
      'plan,course_code,title,credits\nPlan A,DPI-681-M-A,Lab A,2\nPlan A,DPI-681-M-001,Lab B,2\n',
    )
    const merged = mergePlanCsvRecords(emptyPlans, records)

    expect(merged['Plan A'].courses).toHaveLength(1)
    expect(merged['Plan A'].courses[0].courseCodeBase).toBe('DPI-681-M')
  })
})
