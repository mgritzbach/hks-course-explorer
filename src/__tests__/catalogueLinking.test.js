import { describe, expect, it } from 'vitest'
import {
  buildHistoricalCourseIndex,
  linkOfferingToHistory,
  normaliseCourseCode,
} from '../lib/catalogueLinking.js'

const historicalRows = [
  { id: 'exact', course_code_base: 'API-101' },
  { id: 'pal', course_code_base: 'PAL-117' },
  { id: 'mld', course_code_base: 'MLD-717-M' },
  { id: 'related', course_code_base: 'DPI-802' },
]

const index = buildHistoricalCourseIndex(historicalRows, {
  'PAL-117': 'DPI-802-M',
  'MLD-717-M': 'DPI-802-M',
})

describe('catalogue identity linking', () => {
  it('normalises display formatting without collapsing a course suffix', () => {
    expect(normaliseCourseCode(' dpi – 802 - m ')).toBe('DPI-802-M')
    expect(normaliseCourseCode('DPI-802-M-D')).toBe('DPI-802-M-D')
  })

  it('links exact current and historical course codes', () => {
    expect(linkOfferingToHistory({ course_code_base: 'api-101' }, index)).toMatchObject({
      matchStatus: 'verified',
      matchMethod: 'exact_code',
      historicalCodes: ['API-101'],
      records: [historicalRows[0]],
    })
  })

  it('links only aliases that are explicitly approved in the registry', () => {
    expect(linkOfferingToHistory({ course_code_base: 'DPI-802-M' }, index)).toMatchObject({
      matchStatus: 'verified',
      matchMethod: 'approved_alias',
      historicalCodes: ['MLD-717-M', 'PAL-117'],
      records: [historicalRows[1], historicalRows[2]],
    })
  })

  it('does not attach a nearby course code by stripping its suffix', () => {
    expect(linkOfferingToHistory({ course_code_base: 'DPI-802-M-D' }, index)).toEqual({
      matchStatus: 'unmatched',
      matchMethod: null,
      historicalCodes: [],
      records: [],
    })
  })
})
