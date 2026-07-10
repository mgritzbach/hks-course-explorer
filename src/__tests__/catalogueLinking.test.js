import { describe, expect, it } from 'vitest'
import {
  buildHistoricalCourseIndex,
  instructorKeys,
  linkOfferingToHistory,
  normaliseInstructorName,
  normaliseCourseCode,
} from '../lib/catalogueLinking.js'

const historicalRows = [
  { id: 'exact', course_code_base: 'API-101', professor: 'Allison, Graham' },
  { id: 'pal', course_code_base: 'PAL-117', professor: 'Allison, Graham' },
  { id: 'mld', course_code_base: 'MLD-717-M', professor: 'Allison, Graham' },
  { id: 'section', course_code_base: 'DPI-802-M', professor: 'Allison, Graham' },
  { id: 'related', course_code_base: 'DPI-802', professor: 'Different, Professor' },
]

const index = buildHistoricalCourseIndex(historicalRows, {
  'PAL-117': 'DPI-803-M',
  'MLD-717-M': 'DPI-803-M',
})

describe('catalogue identity linking', () => {
  it('normalises display formatting without collapsing a course suffix', () => {
    expect(normaliseCourseCode(' dpi – 802 - m ')).toBe('DPI-802-M')
    expect(normaliseCourseCode('DPI-802-M-D')).toBe('DPI-802-M-D')
  })

  it('treats equivalent display orders as the same professor identity', () => {
    expect(normaliseInstructorName('Professor Graham Allison')).toBe('allison graham')
    expect(instructorKeys({ instructors: ['Graham Allison'] })).toEqual(['allison graham'])
  })

  it('links exact current and historical course codes', () => {
    expect(
      linkOfferingToHistory(
        { course_code_base: 'api-101', instructors: ['Graham Allison'] },
        index,
      ),
    ).toMatchObject({
      matchStatus: 'verified',
      matchMethod: 'exact_code_same_professor',
      historicalCodes: ['API-101'],
      records: [historicalRows[0]],
    })
  })

  it('links only aliases that are explicitly approved in the registry', () => {
    expect(
      linkOfferingToHistory(
        { course_code_base: 'DPI-803-M', instructors: ['Graham Allison'] },
        index,
      ),
    ).toMatchObject({
      matchStatus: 'verified',
      matchMethod: 'approved_alias_same_professor',
      historicalCodes: ['MLD-717-M', 'PAL-117'],
      records: [historicalRows[1], historicalRows[2]],
    })
  })

  it('does not attach a nearby course code by stripping its suffix', () => {
    expect(
      linkOfferingToHistory(
        { course_code_base: 'DPI-802-M-D', instructors: ['Graham Allison'] },
        index,
      ),
    ).toEqual({
      matchStatus: 'needs_review',
      matchMethod: 'suspected_section_split',
      historicalCodes: ['DPI-802-M'],
      records: [],
      courseHistoryRecords: [],
      reviewCandidates: [historicalRows[3]],
    })
  })

  it('keeps a different professor as course history rather than inherited teaching ratings', () => {
    expect(
      linkOfferingToHistory(
        { course_code_base: 'API-101', instructors: ['Different Professor'] },
        index,
      ),
    ).toMatchObject({
      matchStatus: 'course_only',
      matchMethod: 'exact_code_other_professor',
      records: [],
      courseHistoryRecords: [historicalRows[0]],
    })
  })
})
