function rawCourseCode(courseOrCode) {
  if (typeof courseOrCode === 'string') return courseOrCode
  return (
    courseOrCode?.course_code_base ||
    courseOrCode?.courseCodeBase ||
    courseOrCode?.course_code ||
    courseOrCode?.courseCode ||
    courseOrCode?.code ||
    ''
  )
}

/**
 * Returns the catalogue-level course code. Section identifiers do not create
 * separately countable courses:
 *   DPI-681-M-001 -> DPI-681-M
 *   DPI-101-M-A   -> DPI-101-M
 *   API-203M-B    -> API-203M
 */
export function getBaseCourseCode(courseOrCode) {
  const code = String(rawCourseCode(courseOrCode) || '')
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  if (!code) return ''

  const numericSection = code.match(/^(.+?-\d+[A-Z]?(?:-M)?)-\d{3}$/)
  if (numericSection) return numericSection[1]

  const letterSection = code.match(/^(.+?-\d+(?:M|-M))-[A-Z]$/)
  if (letterSection) return letterSection[1]

  const compactLetterSection = code.match(/^(.+?-\d+(?:M|-M))[A-Z]$/)
  if (compactLetterSection) return compactLetterSection[1]

  return code
}

export function getCourseSectionLetter(courseOrCode) {
  const detailedCode =
    typeof courseOrCode === 'string'
      ? courseOrCode
      : courseOrCode?.course_code || courseOrCode?.courseCode || courseOrCode?.code || ''
  const normalizedDetailed = String(detailedCode)
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  const baseCode = getBaseCourseCode(courseOrCode)
  if (!baseCode || normalizedDetailed === baseCode) return ''

  const suffix = normalizedDetailed.slice(baseCode.length).replace(/^-/, '')
  return /^[A-Z]$/.test(suffix) ? suffix : ''
}

export function getBaseCourseKey(courseOrCode) {
  return getBaseCourseCode(courseOrCode).replace(/[^A-Z0-9]/g, '')
}

export function hasSameBaseCourse(left, right) {
  const leftKey = getBaseCourseKey(left)
  return Boolean(leftKey) && leftKey === getBaseCourseKey(right)
}

function courseDetailScore(course) {
  const credits = course?.credits ?? course?.credits_min ?? course?.credits_max
  return (
    (credits != null && credits !== '' ? 4 : 0) +
    (Array.isArray(course?.meetings) ? Math.min(course.meetings.length, 3) : 0) +
    (Array.isArray(course?.sections) ? Math.min(course.sections.length, 3) : 0) +
    (course?.year ? 1 : 0) +
    (course?.term || course?.semester ? 1 : 0) +
    (course?.title || course?.course_name ? 1 : 0)
  )
}

/**
 * One catalogue course can satisfy requirements only once. Keep the richest
 * record by default, or the last record when explicitly requested.
 */
export function dedupeCoursesByBase(courses, { keep = 'first' } = {}) {
  const result = []
  const indexByKey = new Map()

  for (const course of Array.isArray(courses) ? courses : []) {
    const key = getBaseCourseKey(course)
    if (!key || !indexByKey.has(key)) {
      if (key) indexByKey.set(key, result.length)
      result.push(course)
      continue
    }
    const existingIndex = indexByKey.get(key)
    if (keep === 'last' || courseDetailScore(course) > courseDetailScore(result[existingIndex])) {
      result[existingIndex] = course
    }
  }

  return result
}
