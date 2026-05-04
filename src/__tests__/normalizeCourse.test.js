import { describe, it, expect } from 'vitest'

function normalizeCourse(raw, index = 0) {
  if (!raw) return null
  const sections = (Array.isArray(raw?.sections) ? raw.sections : []).map((s) => {
    if (!s || typeof s !== 'object') return null
    const code = s.code || s.sectionCode || s.section_code || s.name || s.title || 'Section'
    return {
      id: s.id || code,
      code,
      title: s.title || code,
      instructors: Array.isArray(s.instructors) ? s.instructors.filter(Boolean) : [s.instructor, s.professor, s.faculty].filter(Boolean),
      meeting_days: s.meeting_days || s.meetingDays || s.days || s.pattern || raw?.meeting_days || '',
      time_start: s.time_start || s.start || s.start_time || raw?.time_start || '',
      time_end: s.time_end || s.end || s.end_time || raw?.time_end || '',
      location: s.location || '',
    }
  }).filter(Boolean)
  const main = sections[0] || null
  const toNumber = (value, fallback = 0) => {
    const next = Number(value)
    return Number.isFinite(next) ? next : fallback
  }
  return {
    id: raw?.id || `${raw?.courseCode || raw?.course_code || raw?.course_code_base || raw?.code || 'course'}-${index}`,
    courseCode: raw?.courseCode || raw?.course_code || raw?.course_code_base || raw?.code || `course-${index}`,
    title: raw?.title || raw?.course_name || raw?.name || 'Untitled course',
    instructors: Array.isArray(raw?.instructors) ? raw.instructors.filter(Boolean) : [raw?.instructor, raw?.professor, raw?.professor_display].filter(Boolean),
    credits: toNumber(raw?.credits ?? raw?.credits_min ?? raw?.credits_max, 4) || 4,
    sections,
    selectedSectionId: raw?.selectedSectionId || main?.id || '',
    meeting_days: raw?.meeting_days || main?.meeting_days || '',
    time_start: raw?.time_start || main?.time_start || '',
    time_end: raw?.time_end || main?.time_end || '',
    location: raw?.location || main?.location || '',
    isOnGrid: Boolean(raw?.isOnGrid),
    year: raw?.year ?? null,
    term: raw?.term ?? null,
    sessionDescription: raw?.sessionDescription ?? raw?.session_description ?? '',
    enrichment: {
      is_core: Boolean(raw?.enrichment?.is_core ?? raw?.is_core),
      is_stem: Boolean(raw?.enrichment?.is_stem ?? raw?.is_stem),
      metrics_pct: raw?.enrichment?.metrics_pct ?? raw?.metrics_pct ?? null,
      bid_clearing_price: raw?.enrichment?.bid_clearing_price ?? raw?.bid_clearing_price ?? null,
      last_bid_price: raw?.enrichment?.last_bid_price ?? raw?.last_bid_price ?? null,
    },
  }
}

describe('normalizeCourse', () => {
  it('returns null for undefined input', () => {
    expect(normalizeCourse(undefined)).toBeNull()
  })

  it('returns null for null input', () => {
    expect(normalizeCourse(null)).toBeNull()
  })

  it('sessionDescription defaults to empty string when not provided', () => {
    const result = normalizeCourse({ courseCode: 'API-101', title: 'Test' })
    expect(result.sessionDescription).toBe('')
  })

  it('sessionDescription reads from raw.sessionDescription', () => {
    const result = normalizeCourse({ courseCode: 'API-101', sessionDescription: 'Spring 1' })
    expect(result.sessionDescription).toBe('Spring 1')
  })

  it('sessionDescription falls back to session_description (snake_case)', () => {
    const result = normalizeCourse({ courseCode: 'API-101', session_description: 'Full Term' })
    expect(result.sessionDescription).toBe('Full Term')
  })

  it('credits defaults to 4 when not provided', () => {
    const result = normalizeCourse({ courseCode: 'API-101', title: 'Test' })
    expect(result.credits).toBe(4)
  })

  it('uses courseCode from raw.courseCode', () => {
    const result = normalizeCourse({ courseCode: 'DPI-101', title: 'Test' })
    expect(result.courseCode).toBe('DPI-101')
  })

  it('falls back to course_code_base for courseCode', () => {
    const result = normalizeCourse({ course_code_base: 'MLD-101', title: 'Test' })
    expect(result.courseCode).toBe('MLD-101')
  })

  it('enrichment.is_stem reads from root field when no enrichment object', () => {
    const result = normalizeCourse({ courseCode: 'STEM-101', is_stem: true })
    expect(result.enrichment.is_stem).toBe(true)
  })

  it('enrichment.metrics_pct is null when not provided', () => {
    const result = normalizeCourse({ courseCode: 'API-101' })
    expect(result.enrichment.metrics_pct).toBeNull()
  })

  it('title falls back to course_name', () => {
    const result = normalizeCourse({ courseCode: 'API-101', course_name: 'Policy 101' })
    expect(result.title).toBe('Policy 101')
  })
})
