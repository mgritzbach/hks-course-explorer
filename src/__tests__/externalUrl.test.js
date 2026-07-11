import { describe, expect, it } from 'vitest'
import { safeCourseLinks, safeExternalUrl } from '../lib/externalUrl.js'

describe('safeExternalUrl', () => {
  it('keeps normal course and faculty web links', () => {
    expect(safeExternalUrl('https://www.hks.harvard.edu/courses/example')).toBe(
      'https://www.hks.harvard.edu/courses/example',
    )
    expect(safeExternalUrl('http://example.test/profile')).toBe('http://example.test/profile')
  })

  it('drops executable, data, and malformed imported values', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('data:text/html,test')).toBeNull()
    expect(safeExternalUrl('not a URL')).toBeNull()
  })

  it('derives only safe course and faculty links from imported rows', () => {
    expect(
      safeCourseLinks({
        course_url: 'javascript:alert(1)',
        instructor_profile_url: 'https://example.test/a',
      }),
    ).toEqual({ courseUrl: null, instructorProfileUrl: 'https://example.test/a' })
  })
})
