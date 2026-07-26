import { describe, expect, it } from 'vitest'
import { findConflicts, meetingsConflict } from '../lib/conflictDetector.js'

describe('multi-interval schedule conflicts', () => {
  const splitSchedule = {
    courseCode: 'API-201-A',
    meetings: [
      { day: 'TUE', start: '09:00', end: '10:15' },
      { day: 'THU', start: '09:00', end: '10:15' },
      { day: 'TUE', start: '16:30', end: '17:45' },
    ],
  }

  it('detects a conflict against a secondary meeting interval', () => {
    const eveningCourse = {
      courseCode: 'DPI-300',
      meeting_days: 'TUE',
      time_start: '17:00',
      time_end: '18:00',
    }
    expect(meetingsConflict(splitSchedule, eveningCourse)).toBe(true)
    expect(findConflicts([splitSchedule, eveningCourse])).toHaveLength(1)
  })

  it('does not invent conflicts on a different day', () => {
    expect(
      meetingsConflict(splitSchedule, {
        meeting_days: 'WED',
        time_start: '17:00',
        time_end: '18:00',
      }),
    ).toBe(false)
  })
})
