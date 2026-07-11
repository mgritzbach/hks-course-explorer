// Pure schedule/course normalization shared by scheduling UI and tests.
// Keep these functions free of React or browser state so they can be reused at
// input boundaries without importing a page component.

export const DAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 }

function contractError(message) {
  throw new Error(`Schedule normalization contract: ${message}`)
}

/**
 * Validate the canonical weekday-order mapping used by the pure normalizers.
 * @param {unknown} dayIndex Candidate weekday-order mapping.
 * @returns {true} True when the mapping preserves the schedule ordering contract.
 * @throws {Error} When keys are missing or have an unexpected position.
 */
export function assertScheduleNormalizationContract(dayIndex = DAY_INDEX) {
  if (!dayIndex || typeof dayIndex !== 'object' || Array.isArray(dayIndex))
    contractError('DAY_INDEX must be an object')
  const expected = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  for (const [index, day] of expected.entries()) {
    if (dayIndex[day] !== index) contractError(`DAY_INDEX.${day} must equal ${index}`)
  }
  if (Object.keys(dayIndex).length !== expected.length)
    contractError('DAY_INDEX must contain only the seven canonical weekdays')
  return true
}

export function normalizeDayToken(token) {
  const value = String(token || '')
    .trim()
    .toUpperCase()
  const map = {
    M: 'MON',
    MON: 'MON',
    MONDAY: 'MON',
    T: 'TUE',
    TU: 'TUE',
    TUE: 'TUE',
    TUES: 'TUE',
    TUESDAY: 'TUE',
    W: 'WED',
    WED: 'WED',
    WEDNESDAY: 'WED',
    R: 'THU',
    TH: 'THU',
    THU: 'THU',
    THUR: 'THU',
    THURS: 'THU',
    THURSDAY: 'THU',
    F: 'FRI',
    FRI: 'FRI',
    FRIDAY: 'FRI',
    S: 'SAT',
    SA: 'SAT',
    SAT: 'SAT',
    SATURDAY: 'SAT',
    SU: 'SUN',
    SUN: 'SUN',
    SUNDAY: 'SUN',
  }
  return map[value] || null
}

export function extractDays(value) {
  if (!value) return []
  const parts = String(value)
    .trim()
    .replace(/&/g, '/')
    .replace(/,/g, '/')
    .split(/[/\s]+/)
    .filter(Boolean)
  const days = new Set()
  parts.forEach((part) => {
    const direct = normalizeDayToken(part)
    if (direct) return void days.add(direct)
    let cursor = part.replace(/[^A-Za-z]/g, '').toUpperCase()
    const combos = ['THU', 'MON', 'TUE', 'WED', 'FRI', 'TH', 'TU', 'M', 'T', 'W', 'R', 'F']
    while (cursor) {
      const match = combos.find((candidate) => cursor.startsWith(candidate))
      if (!match) {
        cursor = cursor.slice(1)
      } else {
        const day = normalizeDayToken(match)
        if (day) days.add(day)
        cursor = cursor.slice(match.length)
      }
    }
  })
  return [...days].sort((a, b) => DAY_INDEX[a] - DAY_INDEX[b])
}

export function parseTimeParts(value) {
  if (!value) return null
  const match = String(value)
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})(?::?(\d{2}))?\s*(AM|PM)?$/)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] || '0')
  if (match[3] === 'AM' && hours === 12) hours = 0
  if (match[3] === 'PM' && hours !== 12) hours += 12
  return { hours, minutes }
}

export function minutesFromValue(value) {
  const parts = parseTimeParts(value)
  return parts ? parts.hours * 60 + parts.minutes : null
}

export function formatClockLabel(value) {
  const parts = parseTimeParts(value)
  if (!parts) return 'TBA'
  const date = new Date()
  date.setHours(parts.hours, parts.minutes, 0, 0)
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
}

function toNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

export function normalizeSection(section, course) {
  if (!section || typeof section !== 'object') return null
  const code =
    section.code ||
    section.sectionCode ||
    section.section_code ||
    section.name ||
    section.title ||
    'Section'
  return {
    id: section.id || code,
    code,
    title: section.title || code,
    instructors: Array.isArray(section.instructors)
      ? section.instructors.filter(Boolean)
      : [section.instructor, section.professor, section.faculty].filter(Boolean),
    meeting_days:
      section.meeting_days ||
      section.meetingDays ||
      section.days ||
      section.pattern ||
      course?.meeting_days ||
      '',
    time_start:
      section.time_start || section.start || section.start_time || course?.time_start || '',
    time_end: section.time_end || section.end || section.end_time || course?.time_end || '',
    location: section.location || '',
  }
}

export function normalizeCourse(raw, index = 0) {
  const sections = (Array.isArray(raw?.sections) ? raw.sections : [])
    .map((section) => normalizeSection(section, raw))
    .filter(Boolean)
  const main = sections[0] || null
  return {
    id:
      raw?.id ||
      `${raw?.courseCode || raw?.course_code || raw?.course_code_base || raw?.code || 'course'}-${index}`,
    courseCode:
      raw?.courseCode ||
      raw?.course_code ||
      raw?.course_code_base ||
      raw?.code ||
      `course-${index}`,
    title: raw?.title || raw?.course_name || raw?.name || 'Untitled course',
    instructors: Array.isArray(raw?.instructors)
      ? raw.instructors.filter(Boolean)
      : [raw?.instructor, raw?.professor, raw?.professor_display].filter(Boolean),
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
    // Keep an explicit source classification. Undefined remains possible for
    // user-entered historical courses, which are not current catalogue rows.
    is_hks: typeof raw?.is_hks === 'boolean' ? raw.is_hks : undefined,
    school: raw?.school || null,
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

export function getActiveSection(course) {
  return (
    course?.sections?.find((section) => section.id === course?.selectedSectionId) ||
    course?.sections?.[0] ||
    null
  )
}

export function courseHasSchedule(course) {
  return (
    extractDays(course?.meeting_days).length > 0 &&
    minutesFromValue(course?.time_start) != null &&
    minutesFromValue(course?.time_end) != null
  )
}
