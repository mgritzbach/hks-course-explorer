import { describe, expect, it } from 'vitest'
import {
  courseHasSchedule,
  extractDays,
  formatClockLabel,
  getActiveSection,
  getCourseMeetings,
  minutesFromValue,
  normalizeCourse,
  normalizeDayToken,
  normalizeSection,
  parseTimeParts,
} from '../lib/scheduleCourseNormalization.js'

describe('schedule course normalization', () => {
  it('normalizes compact and long-form day tokens', () => {
    expect(normalizeDayToken('r')).toBe('THU')
    expect(normalizeDayToken('Tuesday')).toBe('TUE')
    expect(normalizeDayToken('unknown')).toBeNull()
  })

  it('extracts, deduplicates, and orders mixed day formats', () => {
    expect(extractDays('W/M, Thursday & MON')).toEqual(['MON', 'WED', 'THU'])
    expect(extractDays(null)).toEqual([])
  })

  it('parses schedule times without changing the established clock output', () => {
    expect(parseTimeParts('12:05 AM')).toEqual({ hours: 0, minutes: 5 })
    expect(parseTimeParts('1:05pm')).toEqual({ hours: 13, minutes: 5 })
    expect(parseTimeParts('not a time')).toBeNull()
    expect(minutesFromValue('1:05pm')).toBe(785)
    expect(formatClockLabel('13:05')).toBe('1:05 PM')
  })

  it('normalizes section aliases and inherits the course meeting pattern', () => {
    expect(
      normalizeSection(
        { sectionCode: 'A', faculty: 'Professor' },
        {
          meeting_days: 'MON/WED',
          time_start: '09:00',
          time_end: '10:15',
        },
      ),
    ).toMatchObject({
      id: 'A',
      code: 'A',
      instructors: ['Professor'],
      meeting_days: 'MON/WED',
      time_start: '09:00',
      time_end: '10:15',
    })
  })

  it('keeps the existing normalized course fallbacks and enrichment contract', () => {
    const course = normalizeCourse({
      course_code_base: 'MLD-101',
      course_name: 'Leadership',
      credits_min: '3',
      is_stem: true,
      sections: [{ id: 'section-a', meetingDays: 'T/TH', start: '11:00', end: '12:15' }],
    })

    expect(course).toMatchObject({
      id: 'MLD-101-0',
      courseCode: 'MLD-101',
      title: 'Leadership',
      credits: 3,
      selectedSectionId: 'section-a',
      meeting_days: 'T/TH',
      time_start: '11:00',
      time_end: '12:15',
      is_hks: undefined,
      school: null,
      enrichment: { is_stem: true, is_core: false, metrics_pct: null },
    })
  })

  it('keeps an explicit current-offering school classification', () => {
    expect(normalizeCourse({ courseCode: 'API-101', school: 'HLS', is_hks: false })).toMatchObject({
      school: 'HLS',
      is_hks: false,
    })
  })

  it('preserves an explicit zero-credit offering instead of inventing four credits', () => {
    expect(normalizeCourse({ courseCode: 'IGA-000', credits: 0 }).credits).toBe(0)
  })

  it('preserves the visible offering code while exposing its canonical base identity', () => {
    expect(normalizeCourse({ courseCode: 'DPI-681-M-001' })).toMatchObject({
      courseCode: 'DPI-681-M-001',
      courseCodeBase: 'DPI-681-M',
    })
  })

  it('preserves and recognizes multiple meeting intervals without flattening them', () => {
    const course = normalizeCourse({
      courseCode: 'API-201-A',
      meetings: [
        { day: 'TUE', start: '09:00', end: '10:15', location: 'Wexner' },
        { day: 'THU', start: '09:00', end: '10:15', location: 'Wexner' },
        { day: 'TUE', start: '16:30', end: '17:45', location: 'Littauer' },
      ],
    })

    expect(getCourseMeetings(course)).toHaveLength(3)
    expect(course.meeting_days).toBe('TUE/THU')
    expect(course.time_start).toBe('')
    expect(course.time_end).toBe('')
    expect(courseHasSchedule(course)).toBe(true)
  })

  it('selects the active section and recognizes complete schedules only', () => {
    const course = normalizeCourse({
      courseCode: 'API-101',
      selectedSectionId: 'late',
      sections: [
        { id: 'early', days: 'MON', start: '09:00', end: '10:00' },
        { id: 'late', days: 'WED', start: '14:00', end: '15:00' },
      ],
    })

    expect(getActiveSection(course)?.id).toBe('late')
    expect(courseHasSchedule(course)).toBe(true)
    expect(
      courseHasSchedule({ meeting_days: 'MON/WED', time_start: '09:00', time_end: '10:15' }),
    ).toBe(true)
    expect(courseHasSchedule({ meeting_days: 'MON', time_start: 'TBA', time_end: '10:15' })).toBe(
      false,
    )
  })
})
