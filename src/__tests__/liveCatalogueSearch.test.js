import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findLiveCatalogueRows, toScheduleSearchItem } from '../lib/liveCatalogueSearch.js'

const rows = [
  {
    id: 'hks',
    course_code: 'API-101',
    title: 'Policy Analysis',
    instructors: ['Avery Example'],
    term: '2026 Spring',
    school: 'HKS',
    is_hks: true,
  },
  {
    id: 'january',
    course_code: 'IGA-299-A',
    title: 'January Policy Lab',
    instructors: ['Jamie January'],
    term: '2027 Spring',
    session_description: 'January',
    school: 'HKS',
    is_hks: true,
  },
  {
    id: 'hbs',
    course_code: 'MBA-101',
    title: 'Business Strategy',
    term: '2026 Spring',
    school: 'HBSD',
    is_hks: false,
  },
  {
    id: 'old',
    course_code: 'API-101',
    title: 'Policy Analysis',
    term: '2025 Fall',
    school: 'HKS',
    is_hks: true,
  },
]

describe('live catalogue search', () => {
  it('searches only daily-synced offerings for the selected term', () => {
    expect(
      findLiveCatalogueRows(rows, { query: 'avery', year: '2026', semester: 'Spring' }),
    ).toEqual([rows[0]])
  })

  it('applies selected-school rules without contacting a remote API', () => {
    expect(
      findLiveCatalogueRows(rows, { year: '2026', semester: 'Spring', school: 'HBS' }),
    ).toEqual([rows[2]])
    expect(
      findLiveCatalogueRows(rows, { year: '2026', semester: 'Spring', school: 'Non-HKS' }),
    ).toEqual([rows[2]])
  })

  it('searches J-Term inside the Spring source term', () => {
    expect(
      findLiveCatalogueRows(rows, {
        query: 'january',
        year: '2027',
        semester: 'January',
      }),
    ).toEqual([rows[1]])
  })

  it('keeps source-school metadata when a current offering enters scheduling', () => {
    expect(toScheduleSearchItem(rows[2])).toMatchObject({ school: 'HBSD', is_hks: false })
  })

  it('preserves current-offering identity and session metadata', () => {
    expect(
      toScheduleSearchItem({
        ...rows[0],
        session_description: 'Spring 1',
        cross_reg_eligible: 'NOXREG',
      }),
    ).toMatchObject({
      id: 'hks',
      sessionDescription: 'Spring 1',
      crossRegEligible: 'NOXREG',
    })
  })

  it('keeps the Schedule Builder on the synced catalogue path', () => {
    const source = readFileSync(
      resolve(globalThis.process.cwd(), 'src/pages/ScheduleBuilder.jsx'),
      'utf8',
    )
    expect(source).toContain('findLiveCatalogueRows')
    expect(source).not.toContain('searchHarvardCourses')
  })
})
